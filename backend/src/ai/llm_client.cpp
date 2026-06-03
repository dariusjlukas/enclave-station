#include "ai/llm_client.h"

#include <arpa/inet.h>
#include <httplib.h>

#include <cstdlib>
#include <cstring>
#include <map>
#include <regex>
#include <sstream>

#include "logging/logger.h"

LlmClient::LlmClient(const LlmConfig& config) : config_(config) {}

namespace {

// Extract the host (no scheme, no port, no brackets) from a URL's authority.
// Returns "" if no host is present. Handles "[::1]:8080" IPv6 bracket form.
std::string extract_host(const std::string& url) {
  auto scheme_end = url.find("://");
  std::string rest = (scheme_end == std::string::npos) ? url : url.substr(scheme_end + 3);
  // authority ends at the first '/', '?' or '#'
  auto auth_end = rest.find_first_of("/?#");
  std::string authority = (auth_end == std::string::npos) ? rest : rest.substr(0, auth_end);
  // strip userinfo
  auto at = authority.rfind('@');
  if (at != std::string::npos) authority = authority.substr(at + 1);
  if (!authority.empty() && authority.front() == '[') {
    // [IPv6]:port
    auto close = authority.find(']');
    if (close != std::string::npos) return authority.substr(1, close - 1);
    return authority.substr(1);
  }
  auto colon = authority.find(':');
  return (colon == std::string::npos) ? authority : authority.substr(0, colon);
}

// True if `host` is a literal IP in a link-local / cloud-metadata range that is
// never a legitimate LLM endpoint (e.g. 169.254.169.254, fe80::/10). These are
// always rejected, regardless of the private-network policy.
bool is_link_local_ip(const std::string& host) {
  in_addr v4{};
  if (inet_pton(AF_INET, host.c_str(), &v4) == 1) {
    uint32_t a = ntohl(v4.s_addr);
    return (a & 0xFFFF0000u) == 0xA9FE0000u;  // 169.254.0.0/16
  }
  in6_addr v6{};
  if (inet_pton(AF_INET6, host.c_str(), &v6) == 1) {
    return v6.s6_addr[0] == 0xFE && (v6.s6_addr[1] & 0xC0) == 0x80;  // fe80::/10
  }
  return false;
}

// True if `host` is a literal loopback / private-range IP, or "localhost".
// Self-hosted LLMs frequently live here (Ollama on localhost, a sidecar on the
// docker network), so this is only enforced when LLM_BLOCK_PRIVATE_NETWORKS=1.
bool is_private_or_loopback(const std::string& host) {
  if (host == "localhost") return true;
  in_addr v4{};
  if (inet_pton(AF_INET, host.c_str(), &v4) == 1) {
    uint32_t a = ntohl(v4.s_addr);
    if ((a & 0xFF000000u) == 0x7F000000u) return true;  // 127.0.0.0/8
    if ((a & 0xFF000000u) == 0x0A000000u) return true;  // 10.0.0.0/8
    if ((a & 0xFFF00000u) == 0xAC100000u) return true;  // 172.16.0.0/12
    if ((a & 0xFFFF0000u) == 0xC0A80000u) return true;  // 192.168.0.0/16
    if (a == 0x00000000u) return true;                  // 0.0.0.0
    return false;
  }
  in6_addr v6{};
  if (inet_pton(AF_INET6, host.c_str(), &v6) == 1) {
    static const unsigned char loop[16] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
    if (std::memcmp(v6.s6_addr, loop, 16) == 0) return true;  // ::1
    if ((v6.s6_addr[0] & 0xFE) == 0xFC) return true;          // fc00::/7 (ULA)
    return false;
  }
  return false;
}

}  // namespace

namespace llm_url {
std::string validate(const std::string& url) {
  if (url.rfind("http://", 0) != 0 && url.rfind("https://", 0) != 0) {
    return "LLM endpoint must use http:// or https://";
  }
  std::string host = extract_host(url);
  if (host.empty()) {
    return "LLM endpoint has no host";
  }
  if (is_link_local_ip(host)) {
    return "LLM endpoint resolves to a link-local/metadata address, which is not allowed";
  }
  const char* block = std::getenv("LLM_BLOCK_PRIVATE_NETWORKS");
  if (block && (std::strcmp(block, "1") == 0 || std::strcmp(block, "true") == 0)) {
    if (is_private_or_loopback(host)) {
      return "LLM endpoint resolves to a private/loopback address, which is blocked by policy";
    }
  }
  return "";
}
}  // namespace llm_url

json LlmClient::build_request_body(
  const std::vector<LlmMessage>& messages, const json& tools) const {
  json body;
  body["model"] = config_.model;
  body["stream"] = true;
  body["max_tokens"] = config_.max_tokens;

  // Build messages array
  json msgs = json::array();

  // Prepend system prompt if configured
  if (!config_.system_prompt.empty()) {
    msgs.push_back({{"role", "system"}, {"content", config_.system_prompt}});
  }

  for (const auto& msg : messages) {
    json m;
    m["role"] = msg.role;

    if (msg.role == "tool") {
      // Tool result messages
      m["content"] = msg.content;
      m["tool_call_id"] = msg.tool_call_id;
      if (!msg.name.empty()) {
        m["name"] = msg.name;
      }
    } else if (msg.role == "assistant" && !msg.tool_calls.is_null() && !msg.tool_calls.empty()) {
      // Assistant message with tool calls
      if (!msg.content.empty()) {
        m["content"] = msg.content;
      } else {
        m["content"] = nullptr;
      }
      m["tool_calls"] = msg.tool_calls;
    } else {
      // Regular user/system/assistant message
      m["content"] = msg.content;
    }

    msgs.push_back(m);
  }
  body["messages"] = msgs;

  // Include tools if provided
  if (!tools.is_null() && !tools.empty()) {
    body["tools"] = tools;
  }

  return body;
}

// Parse scheme, host, port, and path prefix from a URL like "http://localhost:8080/v1"
static void parse_url(const std::string& url, std::string& base_url, std::string& path_prefix) {
  // Find scheme
  auto scheme_end = url.find("://");
  if (scheme_end == std::string::npos) {
    base_url = url;
    path_prefix = "";
    return;
  }

  // Find the path portion after host:port
  auto path_start = url.find('/', scheme_end + 3);
  if (path_start == std::string::npos) {
    base_url = url;
    path_prefix = "";
  } else {
    base_url = url.substr(0, path_start);
    path_prefix = url.substr(path_start);
    // Remove trailing slash from path prefix
    while (!path_prefix.empty() && path_prefix.back() == '/') {
      path_prefix.pop_back();
    }
  }
}

void LlmClient::chat_completion(
  const std::vector<LlmMessage>& messages, const json& tools, const LlmStreamCallback& cb) {
  if (auto err = llm_url::validate(config_.api_url); !err.empty()) {
    if (cb.on_error) cb.on_error(err);
    return;
  }

  std::string base_url, path_prefix;
  parse_url(config_.api_url, base_url, path_prefix);

  std::string endpoint = path_prefix + "/chat/completions";

  httplib::Client cli(base_url);
  cli.set_connection_timeout(5);
  cli.set_read_timeout(120);

  // Build request
  json body = build_request_body(messages, tools);
  std::string body_str = body.dump();

  // Set headers
  httplib::Headers headers;
  headers.emplace("Content-Type", "application/json");
  if (!config_.api_key.empty()) {
    headers.emplace("Authorization", "Bearer " + config_.api_key);
  }

  // Accumulated tool calls by index
  std::map<int, json> tool_call_accum;
  bool done_called = false;
  std::string line_buffer;

  auto result = cli.Post(
    endpoint, headers, body_str, "application/json", [&](const char* data, size_t len) -> bool {
      line_buffer.append(data, len);

      // Process complete lines
      size_t pos;
      while ((pos = line_buffer.find('\n')) != std::string::npos) {
        std::string line = line_buffer.substr(0, pos);
        line_buffer.erase(0, pos + 1);

        // Strip carriage return
        if (!line.empty() && line.back() == '\r') {
          line.pop_back();
        }

        // Skip empty lines and SSE comments
        if (line.empty() || line[0] == ':') {
          continue;
        }

        // Must start with "data: "
        if (line.substr(0, 6) != "data: ") {
          continue;
        }

        std::string payload = line.substr(6);

        // Check for stream termination
        if (payload == "[DONE]") {
          // Emit any remaining accumulated tool calls
          for (auto& [idx, tc] : tool_call_accum) {
            if (cb.on_tool_call) {
              cb.on_tool_call(tc);
            }
          }
          tool_call_accum.clear();
          if (!done_called && cb.on_done) {
            done_called = true;
            cb.on_done();
          }
          return true;
        }

        // Parse JSON
        json chunk;
        try {
          chunk = json::parse(payload);
        } catch (const json::parse_error& e) {
          // Skip malformed chunks
          continue;
        }

        // Check for API-level errors
        if (chunk.contains("error")) {
          std::string err_msg = "API error";
          if (chunk["error"].is_object() && chunk["error"].contains("message")) {
            err_msg = chunk["error"]["message"].get<std::string>();
          } else if (chunk["error"].is_string()) {
            err_msg = chunk["error"].get<std::string>();
          }
          if (cb.on_error) {
            cb.on_error(err_msg);
          }
          return false;
        }

        // Extract delta from choices[0]
        if (!chunk.contains("choices") || chunk["choices"].empty()) {
          continue;
        }

        const auto& choice = chunk["choices"][0];

        // Check finish_reason
        if (choice.contains("finish_reason") && !choice["finish_reason"].is_null()) {
          std::string reason = choice["finish_reason"].get<std::string>();
          if (reason == "stop" || reason == "tool_calls") {
            // Emit accumulated tool calls
            for (auto& [idx, tc] : tool_call_accum) {
              if (cb.on_tool_call) {
                cb.on_tool_call(tc);
              }
            }
            tool_call_accum.clear();
            if (!done_called && cb.on_done) {
              done_called = true;
              cb.on_done();
            }
          }
          continue;
        }

        if (!choice.contains("delta")) {
          continue;
        }

        const auto& delta = choice["delta"];

        // Content delta (check both "content" and "reasoning_content" for reasoning models)
        if (delta.contains("content") && !delta["content"].is_null()) {
          std::string content = delta["content"].get<std::string>();
          if (!content.empty() && cb.on_content) {
            cb.on_content(content);
          }
        } else if (delta.contains("reasoning_content") && !delta["reasoning_content"].is_null()) {
          // Reasoning models (e.g. QwQ, DeepSeek-R1) emit thinking tokens here
          // Skip these — they're internal reasoning, not the final answer
        }

        // Tool call fragments
        if (delta.contains("tool_calls") && delta["tool_calls"].is_array()) {
          for (const auto& tc_fragment : delta["tool_calls"]) {
            int idx = tc_fragment.value("index", 0);

            if (tool_call_accum.find(idx) == tool_call_accum.end()) {
              // First fragment for this index — initialize
              tool_call_accum[idx] = {
                {"index", idx},
                {"id", tc_fragment.value("id", "")},
                {"type", "function"},
                {"function", {{"name", ""}, {"arguments", ""}}}};
            }

            auto& accum = tool_call_accum[idx];

            // Update id if present
            if (tc_fragment.contains("id") && !tc_fragment["id"].is_null()) {
              accum["id"] = tc_fragment["id"];
            }

            // Update function name if present
            if (
              tc_fragment.contains("function") && tc_fragment["function"].contains("name") &&
              !tc_fragment["function"]["name"].is_null()) {
              accum["function"]["name"] = tc_fragment["function"]["name"];
            }

            // Append function arguments
            if (
              tc_fragment.contains("function") && tc_fragment["function"].contains("arguments") &&
              !tc_fragment["function"]["arguments"].is_null()) {
              std::string existing = accum["function"]["arguments"].get<std::string>();
              existing += tc_fragment["function"]["arguments"].get<std::string>();
              accum["function"]["arguments"] = existing;
            }
          }
        }
      }

      return true;
    });

  // Handle connection/HTTP errors
  if (!result) {
    std::string err_msg = "HTTP request failed: " + httplib::to_string(result.error());
    if (cb.on_error) {
      cb.on_error(err_msg);
    }
    return;
  }

  if (result->status != 200) {
    std::string err_msg =
      "HTTP " + std::to_string(result->status) + ": " + result->body.substr(0, 500);
    if (cb.on_error) {
      cb.on_error(err_msg);
    }
    return;
  }

  // If stream ended without a [DONE] or finish_reason, still call on_done
  if (!done_called) {
    // Emit any remaining tool calls
    for (auto& [idx, tc] : tool_call_accum) {
      if (cb.on_tool_call) {
        cb.on_tool_call(tc);
      }
    }
    if (cb.on_done) {
      cb.on_done();
    }
  }
}

std::string LlmClient::simple_completion(const std::vector<LlmMessage>& messages, int max_tokens) {
  if (auto err = llm_url::validate(config_.api_url); !err.empty()) {
    LOG_ERROR_N("ai", nullptr, "simple_completion rejected URL: " + err);
    return "";
  }

  std::string base_url, path_prefix;
  parse_url(config_.api_url, base_url, path_prefix);

  std::string endpoint = path_prefix + "/chat/completions";

  httplib::Client cli(base_url);
  cli.set_connection_timeout(5);
  cli.set_read_timeout(30);

  json body;
  body["model"] = config_.model;
  body["stream"] = false;
  body["max_tokens"] = max_tokens;

  json msgs = json::array();
  for (const auto& msg : messages) {
    msgs.push_back({{"role", msg.role}, {"content", msg.content}});
  }
  body["messages"] = msgs;

  httplib::Headers headers;
  headers.emplace("Content-Type", "application/json");
  if (!config_.api_key.empty()) {
    headers.emplace("Authorization", "Bearer " + config_.api_key);
  }

  auto result = cli.Post(endpoint, headers, body.dump(), "application/json");
  if (!result) {
    LOG_ERROR_N(
      "ai",
      nullptr,
      std::string("simple_completion HTTP failed: ") + httplib::to_string(result.error()));
    return "";
  }
  if (result->status != 200) {
    LOG_ERROR_N(
      "ai",
      nullptr,
      "simple_completion HTTP " + std::to_string(result->status) + ": " +
        result->body.substr(0, 300));
    return "";
  }

  try {
    auto resp = json::parse(result->body);
    auto content = resp["choices"][0]["message"]["content"];
    if (content.is_null()) {
      LOG_ERROR_N(
        "ai",
        nullptr,
        std::string("simple_completion: content is null. Response: ") +
          result->body.substr(0, 500));
      return "";
    }
    return content.get<std::string>();
  } catch (const std::exception& e) {
    LOG_ERROR_N(
      "ai",
      nullptr,
      std::string("simple_completion parse error: ") + e.what() +
        ". Response: " + result->body.substr(0, 500));
    return "";
  }
}

std::string LlmClient::streaming_completion(
  const std::vector<LlmMessage>& messages, int max_tokens) {
  // Temporarily override config to avoid prepending the main system prompt
  auto saved_max = config_.max_tokens;
  auto saved_prompt = config_.system_prompt;
  config_.max_tokens = max_tokens;
  config_.system_prompt = "";  // Messages already contain their own system prompt

  std::string accumulated;
  LlmStreamCallback cb;
  cb.on_content = [&](const std::string& delta) { accumulated += delta; };
  cb.on_tool_call = [](const json&) {};
  cb.on_done = []() {};
  cb.on_error = [](const std::string& err) {
    LOG_ERROR_N("ai", nullptr, "streaming_completion error: " + err);
  };

  chat_completion(messages, json::array(), cb);

  config_.max_tokens = saved_max;
  config_.system_prompt = saved_prompt;
  return accumulated;
}

#include <gtest/gtest.h>
#include <cstdlib>
#include "ai/llm_client.h"

// SSRF guard for the configurable LLM endpoint URL. By default only scheme and
// link-local/metadata addresses are enforced; private/loopback blocking is
// opt-in via LLM_BLOCK_PRIVATE_NETWORKS.

class LlmUrlTest : public ::testing::Test {
protected:
  void SetUp() override { unsetenv("LLM_BLOCK_PRIVATE_NETWORKS"); }
  void TearDown() override { unsetenv("LLM_BLOCK_PRIVATE_NETWORKS"); }
};

TEST_F(LlmUrlTest, AcceptsNormalHttpAndHttps) {
  EXPECT_EQ(llm_url::validate("http://api.example.com/v1"), "");
  EXPECT_EQ(llm_url::validate("https://api.openai.com/v1"), "");
  EXPECT_EQ(llm_url::validate("http://llm:8080/v1"), "");  // docker service name
}

TEST_F(LlmUrlTest, RejectsNonHttpSchemes) {
  EXPECT_NE(llm_url::validate("file:///etc/passwd"), "");
  EXPECT_NE(llm_url::validate("gopher://host/"), "");
  EXPECT_NE(llm_url::validate("ftp://host/"), "");
  EXPECT_NE(llm_url::validate("localhost:8080"), "");  // no scheme
}

TEST_F(LlmUrlTest, AlwaysRejectsCloudMetadataAndLinkLocal) {
  // AWS/GCP/Azure metadata endpoint must always be blocked.
  EXPECT_NE(llm_url::validate("http://169.254.169.254/latest/meta-data/"), "");
  EXPECT_NE(llm_url::validate("http://169.254.0.1/"), "");
  // IPv6 link-local
  EXPECT_NE(llm_url::validate("http://[fe80::1]/v1"), "");
}

TEST_F(LlmUrlTest, AllowsPrivateAndLoopbackByDefault) {
  // Self-hosted LLMs commonly live on localhost / the private docker network.
  EXPECT_EQ(llm_url::validate("http://localhost:11434/v1"), "");
  EXPECT_EQ(llm_url::validate("http://127.0.0.1:8080/v1"), "");
  EXPECT_EQ(llm_url::validate("http://10.0.0.5:8080/v1"), "");
  EXPECT_EQ(llm_url::validate("http://192.168.1.10/v1"), "");
  EXPECT_EQ(llm_url::validate("http://172.16.0.3/v1"), "");
  EXPECT_EQ(llm_url::validate("http://[::1]:8080/v1"), "");
}

TEST_F(LlmUrlTest, BlocksPrivateAndLoopbackWhenPolicyEnabled) {
  setenv("LLM_BLOCK_PRIVATE_NETWORKS", "1", 1);
  EXPECT_NE(llm_url::validate("http://localhost:11434/v1"), "");
  EXPECT_NE(llm_url::validate("http://127.0.0.1:8080/v1"), "");
  EXPECT_NE(llm_url::validate("http://10.0.0.5:8080/v1"), "");
  EXPECT_NE(llm_url::validate("http://192.168.1.10/v1"), "");
  EXPECT_NE(llm_url::validate("http://172.20.5.5/v1"), "");
  EXPECT_NE(llm_url::validate("http://[::1]:8080/v1"), "");
  EXPECT_NE(llm_url::validate("http://[fc00::1]/v1"), "");  // ULA
  // A public host is still fine under the strict policy.
  EXPECT_EQ(llm_url::validate("https://api.openai.com/v1"), "");
  // 172.32 is OUTSIDE the 172.16/12 private block — public.
  EXPECT_EQ(llm_url::validate("http://172.32.0.1/v1"), "");
}

TEST_F(LlmUrlTest, HandlesUserinfoAndPorts) {
  // userinfo must not confuse host extraction (the @-host is what's used).
  EXPECT_NE(
    llm_url::validate("http://user:pass@169.254.169.254/"), "");  // still metadata
  EXPECT_EQ(llm_url::validate("http://user@api.example.com:443/v1"), "");
}

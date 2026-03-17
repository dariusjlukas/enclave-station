#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace webauthn {

struct ParsedCredential {
  std::string credential_id;              // base64url-encoded
  std::vector<unsigned char> public_key;  // raw x||y coordinates (64 bytes for P-256)
  uint32_t sign_count;
  std::string transports;  // JSON array from client, e.g. '["internal","hybrid"]'
};

// Verify a WebAuthn registration (attestation) response.
// Returns the parsed credential on success, nullopt on failure.
// attestation_object_b64: base64url-encoded attestation object (CBOR)
// client_data_json_b64: base64url-encoded clientDataJSON
// expected_challenge: the base64url-encoded challenge we sent
// expected_origin: the expected origin (e.g. "https://example.com")
// rp_id: the relying party ID (e.g. "example.com")
std::optional<ParsedCredential> verify_registration(
  const std::string& attestation_object_b64,
  const std::string& client_data_json_b64,
  const std::string& expected_challenge,
  const std::string& expected_origin,
  const std::string& rp_id);

// Verify a WebAuthn authentication (assertion) response.
// Returns the new sign count on success, nullopt on failure.
// auth_data_b64: base64url-encoded authenticator data
// client_data_json_b64: base64url-encoded clientDataJSON
// signature_b64: base64url-encoded signature
// stored_public_key: the stored raw public key bytes (x||y, 64 bytes)
// stored_sign_count: the stored sign count for replay detection
// expected_challenge: the base64url-encoded challenge we sent
// expected_origin: the expected origin
// rp_id: the relying party ID
std::optional<uint32_t> verify_authentication(
  const std::string& auth_data_b64,
  const std::string& client_data_json_b64,
  const std::string& signature_b64,
  const std::vector<unsigned char>& stored_public_key,
  uint32_t stored_sign_count,
  const std::string& expected_challenge,
  const std::string& expected_origin,
  const std::string& rp_id);

// Encoding helpers
std::string base64url_encode(const std::vector<unsigned char>& data);
std::string base64url_encode(const unsigned char* data, size_t len);
std::vector<unsigned char> base64url_decode(const std::string& input);

// Generate a random challenge (32 bytes, returned as base64url)
std::string generate_challenge();

// --- PKI (Web Crypto ECDSA P-256) support ---

// Verify an ECDSA P-256 signature over a challenge using an SPKI-encoded public key.
bool verify_pki_signature(
  const std::string& public_key_spki_b64url,
  const std::string& challenge,
  const std::string& signature_b64url);

// Generate 8 recovery keys. Returns {plaintext_keys, sha256_hashes}.
std::pair<std::vector<std::string>, std::vector<std::string>> generate_recovery_keys();

// Hash a recovery key for storage/verification (SHA-256, hex output).
std::string hash_recovery_key(const std::string& key);

}  // namespace webauthn

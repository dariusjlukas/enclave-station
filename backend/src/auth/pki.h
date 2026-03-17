#pragma once
#include <string>
#include <vector>

namespace pki {

// Verify an Ed25519 signature
// public_key_pem: PEM-encoded Ed25519 public key
// message: the original message that was signed
// signature_b64: base64-encoded signature
bool verify_signature(
  const std::string& public_key_pem, const std::string& message, const std::string& signature_b64);

// Decode base64 string to raw bytes
std::vector<unsigned char> base64_decode(const std::string& b64);

// Encode raw bytes to base64
std::string base64_encode(const std::vector<unsigned char>& data);
std::string base64_encode(const unsigned char* data, size_t len);

// Generate a random challenge string (hex)
std::string generate_challenge();

}  // namespace pki

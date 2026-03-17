#include "auth/pki.h"
#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <random>
#include <sstream>

namespace pki {

std::vector<unsigned char> base64_decode(const std::string& b64) {
  // Handle URL-safe base64
  std::string input = b64;
  for (auto& c : input) {
    if (c == '-')
      c = '+';
    else if (c == '_')
      c = '/';
  }
  // Add padding if needed
  while (input.size() % 4 != 0) input += '=';

  BIO* bio = BIO_new_mem_buf(input.data(), static_cast<int>(input.size()));
  BIO* b64_bio = BIO_new(BIO_f_base64());
  bio = BIO_push(b64_bio, bio);
  BIO_set_flags(bio, BIO_FLAGS_BASE64_NO_NL);

  std::vector<unsigned char> out(input.size());
  int len = BIO_read(bio, out.data(), static_cast<int>(out.size()));
  BIO_free_all(bio);

  if (len < 0) return {};
  out.resize(len);
  return out;
}

std::string base64_encode(const unsigned char* data, size_t len) {
  BIO* bio = BIO_new(BIO_s_mem());
  BIO* b64_bio = BIO_new(BIO_f_base64());
  bio = BIO_push(b64_bio, bio);
  BIO_set_flags(bio, BIO_FLAGS_BASE64_NO_NL);
  BIO_write(bio, data, static_cast<int>(len));
  BIO_flush(bio);

  BUF_MEM* bptr;
  BIO_get_mem_ptr(bio, &bptr);
  std::string result(bptr->data, bptr->length);
  BIO_free_all(bio);
  return result;
}

std::string base64_encode(const std::vector<unsigned char>& data) {
  return base64_encode(data.data(), data.size());
}

bool verify_signature(
  const std::string& public_key_pem, const std::string& message, const std::string& signature_b64) {
  // Decode the signature from base64
  auto sig_bytes = base64_decode(signature_b64);
  if (sig_bytes.empty()) {
    std::cerr << "[PKI] Failed to decode signature from base64" << std::endl;
    return false;
  }

  // Load the public key from PEM
  BIO* bio = BIO_new_mem_buf(public_key_pem.data(), static_cast<int>(public_key_pem.size()));
  if (!bio) {
    std::cerr << "[PKI] Failed to create BIO" << std::endl;
    return false;
  }

  EVP_PKEY* pkey = PEM_read_bio_PUBKEY(bio, nullptr, nullptr, nullptr);
  BIO_free(bio);

  if (!pkey) {
    // Try reading as raw Ed25519 public key (base64 of 32 bytes)
    // The frontend sends the raw key in SPKI/PEM format, so this path
    // is mainly a fallback
    std::cerr << "[PKI] Failed to read PEM public key" << std::endl;
    ERR_print_errors_fp(stderr);
    return false;
  }

  // Verify the signature
  EVP_MD_CTX* md_ctx = EVP_MD_CTX_new();
  bool valid = false;

  if (EVP_DigestVerifyInit(md_ctx, nullptr, nullptr, nullptr, pkey) == 1) {
    int rc = EVP_DigestVerify(
      md_ctx,
      sig_bytes.data(),
      sig_bytes.size(),
      reinterpret_cast<const unsigned char*>(message.data()),
      message.size());
    valid = (rc == 1);
    if (!valid) {
      std::cerr << "[PKI] Signature verification failed (rc=" << rc << ")" << std::endl;
      ERR_print_errors_fp(stderr);
    }
  }

  EVP_MD_CTX_free(md_ctx);
  EVP_PKEY_free(pkey);
  return valid;
}

std::string generate_challenge() {
  std::random_device rd;
  std::mt19937 gen(rd());
  std::uniform_int_distribution<> dist(0, 255);
  std::ostringstream ss;
  for (int i = 0; i < 32; i++) ss << std::hex << std::setfill('0') << std::setw(2) << dist(gen);
  return ss.str();
}

}  // namespace pki

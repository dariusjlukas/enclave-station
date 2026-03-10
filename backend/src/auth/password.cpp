#include "auth/password.h"
#include <argon2.h>
#include <openssl/rand.h>
#include <cstring>
#include <sstream>
#include <algorithm>

namespace password_auth {

// Argon2id parameters (OWASP recommended minimum)
static constexpr uint32_t T_COST = 3;          // iterations
static constexpr uint32_t M_COST = 65536;      // 64 MB memory
static constexpr uint32_t PARALLELISM = 4;
static constexpr uint32_t HASH_LEN = 32;
static constexpr uint32_t SALT_LEN = 16;

std::string hash_password(const std::string& password) {
    unsigned char salt[SALT_LEN];
    RAND_bytes(salt, SALT_LEN);

    // Calculate encoded length
    size_t encoded_len = argon2_encodedlen(T_COST, M_COST, PARALLELISM,
                                           SALT_LEN, HASH_LEN, Argon2_id);
    std::vector<char> encoded(encoded_len);

    int rc = argon2id_hash_encoded(T_COST, M_COST, PARALLELISM,
                                    password.c_str(), password.size(),
                                    salt, SALT_LEN,
                                    HASH_LEN,
                                    encoded.data(), encoded.size());
    if (rc != ARGON2_OK) {
        throw std::runtime_error(std::string("Argon2 hashing failed: ") + argon2_error_message(rc));
    }

    return std::string(encoded.data());
}

bool verify_password(const std::string& password, const std::string& encoded_hash) {
    int rc = argon2id_verify(encoded_hash.c_str(), password.c_str(), password.size());
    return rc == ARGON2_OK;
}

std::string validate_password(const std::string& password, const PasswordPolicy& policy) {
    if (static_cast<int>(password.size()) < policy.min_length) {
        return "Password must be at least " + std::to_string(policy.min_length) + " characters";
    }

    if (policy.require_uppercase) {
        if (std::none_of(password.begin(), password.end(), ::isupper)) {
            return "Password must contain at least one uppercase letter";
        }
    }

    if (policy.require_lowercase) {
        if (std::none_of(password.begin(), password.end(), ::islower)) {
            return "Password must contain at least one lowercase letter";
        }
    }

    if (policy.require_number) {
        if (std::none_of(password.begin(), password.end(), ::isdigit)) {
            return "Password must contain at least one number";
        }
    }

    if (policy.require_special) {
        bool has_special = std::any_of(password.begin(), password.end(), [](char c) {
            return !std::isalnum(static_cast<unsigned char>(c));
        });
        if (!has_special) {
            return "Password must contain at least one special character";
        }
    }

    return "";
}

bool matches_history(const std::string& password, const std::vector<std::string>& old_hashes) {
    for (const auto& hash : old_hashes) {
        if (verify_password(password, hash)) {
            return true;
        }
    }
    return false;
}

} // namespace password_auth

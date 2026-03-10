#pragma once
#include <string>
#include <vector>
#include <optional>

namespace password_auth {

struct PasswordPolicy {
    int min_length = 8;
    bool require_uppercase = true;
    bool require_lowercase = true;
    bool require_number = true;
    bool require_special = false;
    int max_age_days = 0;       // 0 = no expiry
    int history_count = 0;      // 0 = no history check
};

// Hash a password using Argon2id. Returns the encoded hash string
// (includes algorithm, salt, parameters, and hash).
std::string hash_password(const std::string& password);

// Verify a password against an Argon2id encoded hash.
bool verify_password(const std::string& password, const std::string& encoded_hash);

// Validate password against complexity policy.
// Returns empty string if valid, error message if not.
std::string validate_password(const std::string& password, const PasswordPolicy& policy);

// Check if a password matches any of the given historical hashes.
bool matches_history(const std::string& password, const std::vector<std::string>& old_hashes);

} // namespace password_auth

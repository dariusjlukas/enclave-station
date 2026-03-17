#include <gtest/gtest.h>
#include "handlers/file_access_utils.h"

TEST(FileAccessUtils, ParsesSizeSettingsWithFallbacks) {
    EXPECT_EQ(file_access_utils::parse_max_file_size(std::optional<std::string>{"2048"}, 12), 2048);
    EXPECT_EQ(file_access_utils::parse_max_file_size(std::optional<std::string>{"bad"}, 12), 12);
    EXPECT_EQ(file_access_utils::parse_max_storage_size(std::optional<std::string>{"8192"}), 8192);
    EXPECT_EQ(file_access_utils::parse_max_storage_size(std::optional<std::string>{"bad"}), 0);
    EXPECT_EQ(file_access_utils::parse_space_storage_limit(std::optional<std::string>{"4096"}), 4096);
    EXPECT_EQ(file_access_utils::parse_space_storage_limit(std::nullopt), 0);
}

TEST(FileAccessUtils, DetectsStorageLimitExceededOnlyWhenLimited) {
    EXPECT_FALSE(file_access_utils::exceeds_storage_limit(0, 100, 50));
    EXPECT_FALSE(file_access_utils::exceeds_storage_limit(200, 100, 100));
    EXPECT_TRUE(file_access_utils::exceeds_storage_limit(199, 100, 100));
}

TEST(FileAccessUtils, ValidatesHexIds) {
    EXPECT_FALSE(file_access_utils::is_valid_hex_id(""));
    EXPECT_TRUE(file_access_utils::is_valid_hex_id("a0B9ff"));
    EXPECT_FALSE(file_access_utils::is_valid_hex_id("abc-123"));
    EXPECT_FALSE(file_access_utils::is_valid_hex_id("../etc/passwd"));
}

TEST(FileAccessUtils, BuildsMessagesAndDispositionHeaders) {
    EXPECT_EQ(file_access_utils::file_too_large_message(1024), "File too large (max 1 KB)");
    EXPECT_EQ(file_access_utils::inline_disposition("photo.png"),
              "inline; filename=\"photo.png\"");
    EXPECT_EQ(file_access_utils::attachment_disposition("report.pdf"),
              "attachment; filename=\"report.pdf\"");
    EXPECT_EQ(file_access_utils::versioned_attachment_disposition(3, "report.pdf"),
              "attachment; filename=\"v3_report.pdf\"");
}

TEST(FileAccessUtils, SanitizesFilenamesInDispositionHeaders) {
    EXPECT_EQ(file_access_utils::inline_disposition("file\"name.txt"),
              "inline; filename=\"file'name.txt\"");
    EXPECT_EQ(file_access_utils::attachment_disposition("bad\r\nname.txt"),
              "attachment; filename=\"badname.txt\"");
}

// --- Additional parse tests ---

TEST(FileAccessUtils, ParseMaxFileSizeWithNullopt) {
    EXPECT_EQ(file_access_utils::parse_max_file_size(std::nullopt, 999), 999);
}

TEST(FileAccessUtils, ParseMaxFileSizeWithZero) {
    EXPECT_EQ(file_access_utils::parse_max_file_size(std::optional<std::string>{"0"}, 100), 0);
}

TEST(FileAccessUtils, ParseMaxStorageSizeWithNullopt) {
    EXPECT_EQ(file_access_utils::parse_max_storage_size(std::nullopt), 0);
}

TEST(FileAccessUtils, ParseSpaceStorageLimitWithValue) {
    EXPECT_EQ(file_access_utils::parse_space_storage_limit(std::optional<std::string>{"65536"}), 65536);
}

TEST(FileAccessUtils, ParseSpaceStorageLimitWithBadValue) {
    EXPECT_EQ(file_access_utils::parse_space_storage_limit(std::optional<std::string>{"abc"}), 0);
}

// --- File size limit tests ---

TEST(FileAccessUtils, ExceedsFileSizeLimitZeroMeansUnlimited) {
    EXPECT_FALSE(file_access_utils::exceeds_file_size_limit(0, 999999));
}

TEST(FileAccessUtils, ExceedsFileSizeLimitExactlyAtLimit) {
    EXPECT_FALSE(file_access_utils::exceeds_file_size_limit(100, 100));
}

TEST(FileAccessUtils, ExceedsFileSizeLimitOneOver) {
    EXPECT_TRUE(file_access_utils::exceeds_file_size_limit(100, 101));
}

TEST(FileAccessUtils, ExceedsFileSizeLimitZeroFileSize) {
    EXPECT_FALSE(file_access_utils::exceeds_file_size_limit(100, 0));
}

// --- Storage limit tests ---

TEST(FileAccessUtils, ExceedsStorageLimitExactlyAtLimit) {
    EXPECT_FALSE(file_access_utils::exceeds_storage_limit(200, 100, 100));
}

TEST(FileAccessUtils, ExceedsStorageLimitOneOver) {
    EXPECT_TRUE(file_access_utils::exceeds_storage_limit(200, 100, 101));
}

TEST(FileAccessUtils, ExceedsStorageLimitZeroIncoming) {
    EXPECT_FALSE(file_access_utils::exceeds_storage_limit(100, 50, 0));
}

TEST(FileAccessUtils, ExceedsStorageLimitZeroUsed) {
    EXPECT_TRUE(file_access_utils::exceeds_storage_limit(100, 0, 101));
    EXPECT_FALSE(file_access_utils::exceeds_storage_limit(100, 0, 100));
}

// --- Hex ID validation tests ---

TEST(FileAccessUtils, ValidatesUppercaseHex) {
    EXPECT_TRUE(file_access_utils::is_valid_hex_id("ABCDEF"));
}

TEST(FileAccessUtils, ValidatesMixedCaseHex) {
    EXPECT_TRUE(file_access_utils::is_valid_hex_id("aAbBcC0123"));
}

TEST(FileAccessUtils, ValidatesSingleCharHex) {
    EXPECT_TRUE(file_access_utils::is_valid_hex_id("f"));
    EXPECT_TRUE(file_access_utils::is_valid_hex_id("0"));
}

TEST(FileAccessUtils, RejectsSpacesInHex) {
    EXPECT_FALSE(file_access_utils::is_valid_hex_id("ab cd"));
}

TEST(FileAccessUtils, RejectsHexWithSpecialChars) {
    EXPECT_FALSE(file_access_utils::is_valid_hex_id("abc!"));
    EXPECT_FALSE(file_access_utils::is_valid_hex_id("abc_def"));
    EXPECT_FALSE(file_access_utils::is_valid_hex_id("0x1234"));
}

// --- File size message tests ---

TEST(FileAccessUtils, FileTooLargeMessageBytes) {
    EXPECT_EQ(file_access_utils::file_too_large_message(512), "File too large (max 512 B)");
}

TEST(FileAccessUtils, FileTooLargeMessageMB) {
    EXPECT_EQ(file_access_utils::file_too_large_message(10 * 1024 * 1024), "File too large (max 10 MB)");
}

TEST(FileAccessUtils, FileTooLargeMessageGB) {
    EXPECT_EQ(file_access_utils::file_too_large_message(2LL * 1024 * 1024 * 1024), "File too large (max 2 GB)");
}

// --- Disposition header tests ---

TEST(FileAccessUtils, InlineDispositionEmptyFilename) {
    EXPECT_EQ(file_access_utils::inline_disposition(""), "inline; filename=\"\"");
}

TEST(FileAccessUtils, AttachmentDispositionWithSpaces) {
    EXPECT_EQ(file_access_utils::attachment_disposition("my file.pdf"),
              "attachment; filename=\"my file.pdf\"");
}

TEST(FileAccessUtils, VersionedDispositionVersionOne) {
    EXPECT_EQ(file_access_utils::versioned_attachment_disposition(1, "doc.txt"),
              "attachment; filename=\"v1_doc.txt\"");
}

TEST(FileAccessUtils, VersionedDispositionLargeVersion) {
    EXPECT_EQ(file_access_utils::versioned_attachment_disposition(999, "doc.txt"),
              "attachment; filename=\"v999_doc.txt\"");
}

TEST(FileAccessUtils, SanitizesMultipleQuotesInFilename) {
    EXPECT_EQ(file_access_utils::inline_disposition("a\"b\"c.txt"),
              "inline; filename=\"a'b'c.txt\"");
}

TEST(FileAccessUtils, SanitizesCarriageReturnOnly) {
    EXPECT_EQ(file_access_utils::attachment_disposition("bad\rname.txt"),
              "attachment; filename=\"badname.txt\"");
}

TEST(FileAccessUtils, SanitizesNewlineOnly) {
    EXPECT_EQ(file_access_utils::attachment_disposition("bad\nname.txt"),
              "attachment; filename=\"badname.txt\"");
}

#include <gtest/gtest.h>
#include "zip_builder.h"

// Minimal ZIP format validation: check magic bytes and that we can
// find the end-of-central-directory signature.

static bool has_zip_signature(const std::string& data) {
    // ZIP files start with PK\x03\x04 (local file header)
    // or PK\x05\x06 (empty archive, EOCD only)
    if (data.size() < 4) return false;
    return (data[0] == 'P' && data[1] == 'K');
}

static bool has_eocd(const std::string& data) {
    // End of central directory signature: PK\x05\x06
    std::string sig = {'\x50', '\x4b', '\x05', '\x06'};
    return data.find(sig) != std::string::npos;
}

TEST(ZipBuilder, EmptyArchive) {
    ZipBuilder zip;
    auto data = zip.build();
    EXPECT_TRUE(has_eocd(data));
    // Empty zip should still have the EOCD record (22 bytes)
    EXPECT_GE(data.size(), 22u);
}

TEST(ZipBuilder, SingleFile) {
    ZipBuilder zip;
    zip.add_file("hello.txt", "Hello, World!");
    auto data = zip.build();

    EXPECT_TRUE(has_zip_signature(data));
    EXPECT_TRUE(has_eocd(data));
    // Should contain the filename in the archive
    EXPECT_NE(data.find("hello.txt"), std::string::npos);
}

TEST(ZipBuilder, MultipleFiles) {
    ZipBuilder zip;
    zip.add_file("a.txt", "alpha");
    zip.add_file("dir/b.txt", "bravo");
    zip.add_file("dir/sub/c.txt", "charlie");
    auto data = zip.build();

    EXPECT_TRUE(has_zip_signature(data));
    EXPECT_TRUE(has_eocd(data));
    EXPECT_NE(data.find("a.txt"), std::string::npos);
    EXPECT_NE(data.find("dir/b.txt"), std::string::npos);
    EXPECT_NE(data.find("dir/sub/c.txt"), std::string::npos);
}

TEST(ZipBuilder, EmptyFileContent) {
    ZipBuilder zip;
    zip.add_file("empty.txt", "");
    auto data = zip.build();

    EXPECT_TRUE(has_zip_signature(data));
    EXPECT_TRUE(has_eocd(data));
    EXPECT_NE(data.find("empty.txt"), std::string::npos);
}

TEST(ZipBuilder, LargeContent) {
    ZipBuilder zip;
    std::string big(100000, 'X');
    zip.add_file("big.bin", big);
    auto data = zip.build();

    EXPECT_TRUE(has_zip_signature(data));
    EXPECT_TRUE(has_eocd(data));
    // Compressed data should be smaller than uncompressed for repeated chars
    EXPECT_LT(data.size(), big.size());
}

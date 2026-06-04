#include <gtest/gtest.h>
#include "storage/aws_sigv4.h"

using namespace storage::sigv4;

// Known-answer tests for the primitives.

TEST(Sigv4, Sha256Hex) {
  // SHA-256 of the empty string.
  EXPECT_EQ(
    sha256_hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  // SHA-256 of "abc".
  EXPECT_EQ(
    sha256_hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

TEST(Sigv4, UriEncodeKeepsUnreservedAndSlash) {
  EXPECT_EQ(uri_encode("abcABC123-_.~", true), "abcABC123-_.~");
  EXPECT_EQ(uri_encode("a/b c", true), "a/b%20c");
  EXPECT_EQ(uri_encode("a/b c", false), "a%2Fb%20c");
  EXPECT_EQ(uri_encode("k+y=z", true), "k%2By%3Dz");
}

// Known-answer test using the AWS example credentials from the SigV4 docs, with
// the signature independently computed (in Python) from the *same* canonical
// form this signer produces — i.e. one that always signs
// host;x-amz-content-sha256;x-amz-date. This pins the full algorithm: canonical
// request, string-to-sign, the HMAC signing-key chain, and the final signature.
//   AccessKey: AKIDEXAMPLE
//   SecretKey: wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY
//   Region: us-east-1, Service: service, Date: 20150830T123600Z
//   GET / Host: example.amazonaws.com, no query, empty body
TEST(Sigv4, KnownAnswerGetVanilla) {
  Credentials creds;
  creds.access_key = "AKIDEXAMPLE";
  creds.secret_key = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
  creds.region = "us-east-1";
  creds.service = "service";

  Request req;
  req.method = "GET";
  req.host = "example.amazonaws.com";
  req.canonical_uri = "/";
  req.canonical_query = "";
  req.payload = "";
  req.amz_date = "20150830T123600Z";
  req.datestamp = "20150830";

  auto headers = sign(creds, req);
  ASSERT_TRUE(headers.count("authorization"));
  const std::string& auth = headers["authorization"];

  EXPECT_NE(
    auth.find("Signature=726c5c4879a6b4ccbbd3b24edbd6b8826d34f87450fbbf4e85546fc7ba9c1642"),
    std::string::npos)
    << "Authorization was: " << auth;
  EXPECT_NE(auth.find("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/"
                      "aws4_request"),
            std::string::npos);
  EXPECT_NE(auth.find("SignedHeaders=host;x-amz-content-sha256;x-amz-date"), std::string::npos);
  EXPECT_EQ(headers["x-amz-content-sha256"],
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
}

// Two signatures for the same request differ only if inputs differ; a stable
// input must give a stable signature (determinism).
TEST(Sigv4, Deterministic) {
  Credentials creds{"AK", "SK", "us-east-1", "s3"};
  Request req;
  req.method = "PUT";
  req.host = "minio:9000";
  req.canonical_uri = "/bucket/key";
  req.payload = "hello";
  req.amz_date = "20240101T000000Z";
  req.datestamp = "20240101";
  auto a = sign(creds, req)["authorization"];
  auto b = sign(creds, req)["authorization"];
  EXPECT_EQ(a, b);
}

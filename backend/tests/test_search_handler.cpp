#include <gtest/gtest.h>
#include "handlers/search_handler.h"

using SH = SearchHandler<false>;

// --- split_terms ---

TEST(SearchHandler_SplitTerms, SingleTerm) {
    auto result = SH::split_terms("hello");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0], "hello");
}

TEST(SearchHandler_SplitTerms, MultiplePipeDelimited) {
    auto result = SH::split_terms("foo | bar | baz");
    ASSERT_EQ(result.size(), 3);
    EXPECT_EQ(result[0], "foo");
    EXPECT_EQ(result[1], "bar");
    EXPECT_EQ(result[2], "baz");
}

TEST(SearchHandler_SplitTerms, TrimsWhitespace) {
    auto result = SH::split_terms("  hello  |  world  ");
    ASSERT_EQ(result.size(), 2);
    EXPECT_EQ(result[0], "hello");
    EXPECT_EQ(result[1], "world");
}

TEST(SearchHandler_SplitTerms, NoPipeReturnsSingleTerm) {
    auto result = SH::split_terms("just one term");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0], "just one term");
}

TEST(SearchHandler_SplitTerms, EmptySegmentsSkipped) {
    auto result = SH::split_terms("a||b");
    // The middle segment is empty (all whitespace), so it gets skipped
    ASSERT_EQ(result.size(), 2);
    EXPECT_EQ(result[0], "a");
    EXPECT_EQ(result[1], "b");
}

TEST(SearchHandler_SplitTerms, AllWhitespaceSegmentSkipped) {
    auto result = SH::split_terms("a|   |b");
    ASSERT_EQ(result.size(), 2);
    EXPECT_EQ(result[0], "a");
    EXPECT_EQ(result[1], "b");
}

TEST(SearchHandler_SplitTerms, EmptyInputReturnsSelf) {
    auto result = SH::split_terms("");
    // Empty string -> find_first_not_of returns npos -> falls through to push_back(input)
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0], "");
}

// --- quote_literal ---

TEST(SearchHandler_QuoteLiteral, NormalString) {
    EXPECT_EQ(SH::quote_literal("hello"), "'hello'");
}

TEST(SearchHandler_QuoteLiteral, SingleQuotesEscaped) {
    EXPECT_EQ(SH::quote_literal("it's"), "'it''s'");
}

TEST(SearchHandler_QuoteLiteral, MultipleSingleQuotes) {
    EXPECT_EQ(SH::quote_literal("a'b'c"), "'a''b''c'");
}

TEST(SearchHandler_QuoteLiteral, EmptyString) {
    EXPECT_EQ(SH::quote_literal(""), "''");
}

TEST(SearchHandler_QuoteLiteral, NoQuotesPassthrough) {
    EXPECT_EQ(SH::quote_literal("no quotes here"), "'no quotes here'");
}

TEST(SearchHandler_QuoteLiteral, OnlySingleQuote) {
    EXPECT_EQ(SH::quote_literal("'"), "''''");
}

// --- build_tsquery ---

TEST(SearchHandler_BuildTsquery, SingleTermAndMode) {
    auto result = SH::build_tsquery({"hello"}, "and");
    EXPECT_EQ(result, "websearch_to_tsquery('english', 'hello')");
}

TEST(SearchHandler_BuildTsquery, MultipleTermsAndMode) {
    auto result = SH::build_tsquery({"hello", "world"}, "and");
    EXPECT_EQ(result,
        "websearch_to_tsquery('english', 'hello') && websearch_to_tsquery('english', 'world')");
}

TEST(SearchHandler_BuildTsquery, MultipleTermsOrMode) {
    auto result = SH::build_tsquery({"foo", "bar"}, "or");
    EXPECT_EQ(result,
        "websearch_to_tsquery('english', 'foo') || websearch_to_tsquery('english', 'bar')");
}

TEST(SearchHandler_BuildTsquery, ThreeTermsAndMode) {
    auto result = SH::build_tsquery({"a", "b", "c"}, "and");
    EXPECT_EQ(result,
        "websearch_to_tsquery('english', 'a') && "
        "websearch_to_tsquery('english', 'b') && "
        "websearch_to_tsquery('english', 'c')");
}

TEST(SearchHandler_BuildTsquery, QuotesInTermsAreEscaped) {
    auto result = SH::build_tsquery({"it's"}, "and");
    EXPECT_EQ(result, "websearch_to_tsquery('english', 'it''s')");
}

TEST(SearchHandler_BuildTsquery, DefaultModeIsAnd) {
    // Any mode string that isn't "or" should default to &&
    auto result = SH::build_tsquery({"x", "y"}, "something");
    EXPECT_TRUE(result.find("&&") != std::string::npos);
    EXPECT_TRUE(result.find("||") == std::string::npos);
}

// --- parse_filters ---

TEST(SearchHandler_ParseFilters, SingleValidFilter) {
    auto result = SH::parse_filters("messages:hello");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0].type, "messages");
    EXPECT_EQ(result[0].value, "hello");
}

TEST(SearchHandler_ParseFilters, MultipleFilters) {
    auto result = SH::parse_filters("messages:hello,users:john,files:report");
    ASSERT_EQ(result.size(), 3);
    EXPECT_EQ(result[0].type, "messages");
    EXPECT_EQ(result[0].value, "hello");
    EXPECT_EQ(result[1].type, "users");
    EXPECT_EQ(result[1].value, "john");
    EXPECT_EQ(result[2].type, "files");
    EXPECT_EQ(result[2].value, "report");
}

TEST(SearchHandler_ParseFilters, AllValidTypes) {
    auto result = SH::parse_filters("messages:a,users:b,files:c,channels:d,spaces:e");
    ASSERT_EQ(result.size(), 5);
    EXPECT_EQ(result[0].type, "messages");
    EXPECT_EQ(result[1].type, "users");
    EXPECT_EQ(result[2].type, "files");
    EXPECT_EQ(result[3].type, "channels");
    EXPECT_EQ(result[4].type, "spaces");
}

TEST(SearchHandler_ParseFilters, InvalidTypeIgnored) {
    auto result = SH::parse_filters("invalid:test,messages:hello");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0].type, "messages");
}

TEST(SearchHandler_ParseFilters, MissingColonIgnored) {
    auto result = SH::parse_filters("nocolon,messages:hello");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0].type, "messages");
}

TEST(SearchHandler_ParseFilters, EmptyValueIgnored) {
    auto result = SH::parse_filters("messages:");
    ASSERT_EQ(result.size(), 0);
}

TEST(SearchHandler_ParseFilters, EmptyTypeIgnored) {
    auto result = SH::parse_filters(":value");
    ASSERT_EQ(result.size(), 0);
}

TEST(SearchHandler_ParseFilters, EmptyInput) {
    auto result = SH::parse_filters("");
    ASSERT_EQ(result.size(), 0);
}

TEST(SearchHandler_ParseFilters, WhitespaceTrimmed) {
    auto result = SH::parse_filters(" messages : hello ");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0].type, "messages");
    EXPECT_EQ(result[0].value, "hello");
}

// --- Additional split_terms tests ---

TEST(SearchHandler_SplitTerms, LeadingPipeSkipsEmpty) {
    auto result = SH::split_terms("|hello");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0], "hello");
}

TEST(SearchHandler_SplitTerms, TrailingPipeSkipsEmpty) {
    auto result = SH::split_terms("hello|");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0], "hello");
}

TEST(SearchHandler_SplitTerms, OnlyPipesReturnsOriginal) {
    auto result = SH::split_terms("|||");
    // All segments are empty, so terms is empty, falls back to push_back(input)
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0], "|||");
}

TEST(SearchHandler_SplitTerms, OnlyWhitespace) {
    auto result = SH::split_terms("   ");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0], "   ");
}

TEST(SearchHandler_SplitTerms, TermsWithInternalSpaces) {
    auto result = SH::split_terms("hello world | foo bar");
    ASSERT_EQ(result.size(), 2);
    EXPECT_EQ(result[0], "hello world");
    EXPECT_EQ(result[1], "foo bar");
}

TEST(SearchHandler_SplitTerms, SingleCharTerms) {
    auto result = SH::split_terms("a|b|c");
    ASSERT_EQ(result.size(), 3);
    EXPECT_EQ(result[0], "a");
    EXPECT_EQ(result[1], "b");
    EXPECT_EQ(result[2], "c");
}

// --- Additional build_tsquery tests ---

TEST(SearchHandler_BuildTsquery, CustomConfig) {
    auto result = SH::build_tsquery({"test"}, "and", "simple");
    EXPECT_EQ(result, "websearch_to_tsquery('simple', 'test')");
}

TEST(SearchHandler_BuildTsquery, EmptyTermsList) {
    auto result = SH::build_tsquery({}, "and");
    EXPECT_EQ(result, "");
}

TEST(SearchHandler_BuildTsquery, OrModeSingleTerm) {
    auto result = SH::build_tsquery({"hello"}, "or");
    // Single term, no operator needed regardless of mode
    EXPECT_EQ(result, "websearch_to_tsquery('english', 'hello')");
}

TEST(SearchHandler_BuildTsquery, TermWithBackslash) {
    auto result = SH::build_tsquery({"path\\to"}, "and");
    EXPECT_EQ(result, "websearch_to_tsquery('english', 'path\\to')");
}

TEST(SearchHandler_BuildTsquery, TermWithSqlInjection) {
    auto result = SH::build_tsquery({"'; DROP TABLE users; --"}, "and");
    // The single quote should be escaped to ''
    EXPECT_EQ(result, "websearch_to_tsquery('english', '''; DROP TABLE users; --')");
}

// --- Additional quote_literal tests ---

TEST(SearchHandler_QuoteLiteral, BackslashesPreserved) {
    EXPECT_EQ(SH::quote_literal("a\\b"), "'a\\b'");
}

TEST(SearchHandler_QuoteLiteral, DoubleQuotesPreserved) {
    EXPECT_EQ(SH::quote_literal("say \"hello\""), "'say \"hello\"'");
}

TEST(SearchHandler_QuoteLiteral, ConsecutiveSingleQuotes) {
    EXPECT_EQ(SH::quote_literal("''"), "''''''");
}

// --- Additional parse_filters tests ---

TEST(SearchHandler_ParseFilters, DuplicateTypesAllowed) {
    auto result = SH::parse_filters("messages:hello,messages:world");
    ASSERT_EQ(result.size(), 2);
    EXPECT_EQ(result[0].value, "hello");
    EXPECT_EQ(result[1].value, "world");
}

TEST(SearchHandler_ParseFilters, ValueWithColons) {
    // Only the first colon splits type from value
    auto result = SH::parse_filters("messages:hello:world");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0].type, "messages");
    EXPECT_EQ(result[0].value, "hello:world");
}

TEST(SearchHandler_ParseFilters, OnlyCommas) {
    auto result = SH::parse_filters(",,,");
    ASSERT_EQ(result.size(), 0);
}

TEST(SearchHandler_ParseFilters, AllInvalidTypes) {
    auto result = SH::parse_filters("invalid:a,unknown:b,bad:c");
    ASSERT_EQ(result.size(), 0);
}

TEST(SearchHandler_ParseFilters, MixedValidAndInvalid) {
    auto result = SH::parse_filters("bad:x,users:alice,fake:y,files:doc");
    ASSERT_EQ(result.size(), 2);
    EXPECT_EQ(result[0].type, "users");
    EXPECT_EQ(result[0].value, "alice");
    EXPECT_EQ(result[1].type, "files");
    EXPECT_EQ(result[1].value, "doc");
}

TEST(SearchHandler_ParseFilters, ValueWithSpaces) {
    auto result = SH::parse_filters("messages:hello world");
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0].value, "hello world");
}

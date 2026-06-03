#include <gtest/gtest.h>
#include <chrono>
#include <optional>
#include "config.h"
#include "db/connection_pool.h"

// Integration test: requires a reachable PostgreSQL (see Config::from_env).

class ConnectionPoolTest : public ::testing::Test {
protected:
  static std::string conn_string() {
    return Config::from_env().pg_connection_string();
  }
};

TEST_F(ConnectionPoolTest, AcquireReturnsUsableConnection) {
  ConnectionPool pool(conn_string(), 2, 1000);
  auto c = pool.acquire();
  pqxx::work txn(c.get());
  auto r = txn.exec("SELECT 1");
  txn.commit();
  EXPECT_EQ(r[0][0].as<int>(), 1);
}

TEST_F(ConnectionPoolTest, AcquireTimesOutWhenExhausted) {
  // Single-connection pool with a short timeout. Hold the only connection, then
  // a second acquire must throw ConnectionPoolTimeout rather than hang forever.
  ConnectionPool pool(conn_string(), 1, 200);
  auto held = pool.acquire();

  auto start = std::chrono::steady_clock::now();
  EXPECT_THROW(pool.acquire(), ConnectionPoolTimeout);
  auto elapsed = std::chrono::steady_clock::now() - start;
  // It should have waited roughly the timeout (not returned instantly, not hung).
  EXPECT_GE(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count(), 150);
  EXPECT_LE(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count(), 2000);
}

TEST_F(ConnectionPoolTest, ReleaseUnblocksAWaiter) {
  ConnectionPool pool(conn_string(), 1, 2000);
  {
    auto held = pool.acquire();
    // held goes out of scope here, returning the connection to the pool.
  }
  // The next acquire succeeds immediately (connection was returned).
  auto c = pool.acquire();
  EXPECT_TRUE(c.get().is_open());
}

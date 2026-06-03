#pragma once
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <memory>
#include <mutex>
#include <pqxx/pqxx>
#include <queue>
#include <stdexcept>
#include <string>

class ConnectionPool;

// Thrown by ConnectionPool::acquire() when no connection becomes available
// within the configured timeout (pool exhausted / all workers stalled).
// Handlers can map this to a 503 instead of hanging forever.
class ConnectionPoolTimeout : public std::runtime_error {
public:
  ConnectionPoolTimeout() : std::runtime_error("Timed out waiting for a database connection") {}
};

// RAII guard: checks out a connection on construction, returns it on destruction.
class PooledConnection {
public:
  PooledConnection(ConnectionPool& pool, std::unique_ptr<pqxx::connection> conn);
  ~PooledConnection();

  PooledConnection(const PooledConnection&) = delete;
  PooledConnection& operator=(const PooledConnection&) = delete;
  PooledConnection(PooledConnection&& other) noexcept;
  PooledConnection& operator=(PooledConnection&& other) noexcept;

  pqxx::connection& get();
  pqxx::connection& operator*();
  pqxx::connection* operator->();

private:
  ConnectionPool* pool_;
  std::unique_ptr<pqxx::connection> conn_;
};

class ConnectionPool {
public:
  explicit ConnectionPool(
    const std::string& conn_string, int pool_size = 10, int acquire_timeout_ms = 30000);
  ~ConnectionPool() = default;

  ConnectionPool(const ConnectionPool&) = delete;
  ConnectionPool& operator=(const ConnectionPool&) = delete;

  // Checks out a connection, blocking until one is free. Throws
  // ConnectionPoolTimeout if none becomes available within acquire_timeout_ms
  // (0 = wait forever).
  PooledConnection acquire();
  void release(std::unique_ptr<pqxx::connection> conn);

  int size() const {
    return pool_size_;
  }
  int available() const;

  // Metrics accessors. size_total() is the constructed pool size;
  // size_in_use() is connections currently checked out by callers.
  size_t size_total() const {
    return static_cast<size_t>(pool_size_);
  }
  size_t size_in_use() const;

private:
  std::string conn_string_;
  int pool_size_;
  int acquire_timeout_ms_;
  std::queue<std::unique_ptr<pqxx::connection>> connections_;
  mutable std::mutex mutex_;
  std::condition_variable cv_;

  std::unique_ptr<pqxx::connection> create_connection();
};

#pragma once
#include <atomic>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

class DbThreadPool {
public:
  explicit DbThreadPool(int num_threads = 32);
  ~DbThreadPool();

  DbThreadPool(const DbThreadPool&) = delete;
  DbThreadPool& operator=(const DbThreadPool&) = delete;

  // Submit a task to be executed on a worker thread.
  void submit(std::function<void()> task);

  int size() const {
    return static_cast<int>(workers_.size());
  }

private:
  std::vector<std::thread> workers_;
  std::queue<std::function<void()>> tasks_;
  std::mutex mutex_;
  std::condition_variable cv_;
  std::atomic<bool> stopped_{false};
};

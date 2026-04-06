#include "db_thread_pool.h"
#include <iostream>

DbThreadPool::DbThreadPool(int num_threads) {
  workers_.reserve(num_threads);
  for (int i = 0; i < num_threads; ++i) {
    workers_.emplace_back([this]() {
      while (true) {
        std::function<void()> task;
        {
          std::unique_lock<std::mutex> lock(mutex_);
          cv_.wait(lock, [this]() { return stopped_.load() || !tasks_.empty(); });
          if (stopped_.load() && tasks_.empty()) return;
          task = std::move(tasks_.front());
          tasks_.pop();
        }
        task();
      }
    });
  }
  std::cout << "[ThreadPool] Started " << num_threads << " worker threads" << std::endl;
}

DbThreadPool::~DbThreadPool() {
  stopped_.store(true);
  cv_.notify_all();
  for (auto& w : workers_) {
    if (w.joinable()) w.join();
  }
}

void DbThreadPool::submit(std::function<void()> task) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    tasks_.push(std::move(task));
  }
  cv_.notify_one();
}

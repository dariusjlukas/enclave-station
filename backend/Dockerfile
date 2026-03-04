FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    libssl-dev \
    libpq-dev \
    libpqxx-dev \
    pkg-config \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone dependencies
RUN mkdir -p libs && \
    git clone --depth 1 --recurse-submodules https://github.com/uNetworking/uWebSockets.git libs/uWebSockets && \
    git clone --depth 1 --branch v3.11.3 https://github.com/nlohmann/json.git libs/json

# Copy source
COPY CMakeLists.txt .
COPY src/ src/

# Build
RUN mkdir build && cd build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release && \
    make -j$(nproc)

# Runtime stage
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    libssl3 \
    libpq5 \
    libpqxx-7.8t64 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/build/chat-server .

EXPOSE 9001
CMD ["./chat-server"]

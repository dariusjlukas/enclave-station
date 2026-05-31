FROM alpine:3.21 AS builder

RUN apk add --no-cache \
    build-base \
    cmake \
    git \
    openssl-dev \
    postgresql-dev \
    pkgconf \
    zlib-dev \
    linux-headers

WORKDIR /app

# Build libpqxx from source (not available in Alpine 3.21 repos)
RUN git clone --depth 1 --branch 7.9.2 https://github.com/jtv/libpqxx.git /tmp/libpqxx && \
    cd /tmp/libpqxx && mkdir build && cd build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release -DSKIP_BUILD_TEST=ON -DBUILD_SHARED_LIBS=ON && \
    make -j$(nproc) && make install && \
    rm -rf /tmp/libpqxx

# Copy submodule dependencies and source
COPY libs/ libs/
COPY CMakeLists.txt .
COPY src/ src/

# Build. Cap parallelism by available memory (~1.5 GB per job): the large
# template-heavy translation units (space_handler.cpp, space_file_handler.cpp)
# can each use >1 GB under -O2, so -j$(nproc) OOM-kills cc1plus on low-RAM
# Docker VMs. Use the smaller of (CPU count, memory-derived job count).
RUN mkdir build && cd build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release && \
    CPU_JOBS=$(nproc) && \
    MEM_JOBS=$(awk '/MemTotal/ {j=int($2/1572864); print (j<1)?1:j}' /proc/meminfo) && \
    JOBS=$([ "$MEM_JOBS" -lt "$CPU_JOBS" ] && echo "$MEM_JOBS" || echo "$CPU_JOBS") && \
    echo "Compiling with -j$JOBS (cpus=$CPU_JOBS, mem-limited=$MEM_JOBS)" && \
    make -j"$JOBS"

# Runtime stage
FROM alpine:3.21

RUN apk add --no-cache \
    libssl3 \
    libpq \
    libstdc++ \
    libgcc

WORKDIR /app
COPY --from=builder /app/build/chat-server .
COPY --from=builder /usr/local/lib/libpqxx*.so* /usr/local/lib/
RUN ldconfig /usr/local/lib 2>/dev/null || true
RUN mkdir -p /data/uploads

EXPOSE 9001
CMD ["./chat-server"]

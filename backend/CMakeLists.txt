cmake_minimum_required(VERSION 3.16)
project(chat-server C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find system packages
find_package(OpenSSL REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(LIBPQXX REQUIRED IMPORTED_TARGET libpqxx)

# uWebSockets (header-only, but needs uSockets built)
set(USOCKETS_DIR ${CMAKE_SOURCE_DIR}/libs/uWebSockets/uSockets)
set(UWS_DIR ${CMAKE_SOURCE_DIR}/libs/uWebSockets/src)

# Build uSockets as a static library
file(GLOB USOCKETS_SRC
    ${USOCKETS_DIR}/src/*.c
    ${USOCKETS_DIR}/src/eventing/*.c
    ${USOCKETS_DIR}/src/crypto/*.c
    ${USOCKETS_DIR}/src/crypto/*.cpp
    ${USOCKETS_DIR}/src/internal/*.c
)
add_library(uSockets STATIC ${USOCKETS_SRC})
target_include_directories(uSockets PUBLIC ${USOCKETS_DIR}/src)
target_link_libraries(uSockets OpenSSL::SSL OpenSSL::Crypto)
target_compile_definitions(uSockets PUBLIC LIBUS_USE_OPENSSL)

# nlohmann/json (header-only)
set(JSON_DIR ${CMAKE_SOURCE_DIR}/libs/json/single_include)

# Application sources
file(GLOB_RECURSE APP_SOURCES src/*.cpp)

add_executable(chat-server ${APP_SOURCES})

target_include_directories(chat-server PRIVATE
    ${UWS_DIR}
    ${USOCKETS_DIR}/src
    ${JSON_DIR}
    src
)

target_link_libraries(chat-server
    uSockets
    OpenSSL::SSL
    OpenSSL::Crypto
    PkgConfig::LIBPQXX
    z
    pthread
)

target_compile_definitions(chat-server PRIVATE LIBUS_USE_OPENSSL)

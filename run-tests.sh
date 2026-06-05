#!/usr/bin/env bash
set -uo pipefail

# Require bash 4+ (this script uses associative arrays / `declare -A`).
# macOS ships bash 3.2, where `declare -A` is a silent no-op and string array
# subscripts like RESULTS["Backend Static Analysis"] get mis-parsed as
# arithmetic, producing a cryptic "Analysis: unbound variable" under `set -u`.
if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    echo "Error: run-tests.sh requires bash 4.0+ (detected: ${BASH_VERSION:-non-bash shell})." >&2
    echo "On macOS: 'brew install bash', then run './run-tests.sh' (uses /usr/bin/env bash)" >&2
    echo "or '\$(brew --prefix)/bin/bash run-tests.sh'. Do not invoke with 'sh' or '/bin/bash'." >&2
    exit 1
fi

CI="${CI:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BUILD_DIR="$BACKEND_DIR/build"
API_TESTS_DIR="$SCRIPT_DIR/tests/api"
E2E_TESTS_DIR="$SCRIPT_DIR/tests/e2e"

# Portable CPU count: Linux has `nproc`; macOS/BSD use `sysctl -n hw.ncpu`.
NPROC="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

# Portable total-RAM in GB: macOS uses `sysctl hw.memsize` (bytes); Linux reads
# /proc/meminfo (kB). Used to size the parallel test-worker pools below.
if [ "$(uname)" = "Darwin" ]; then
    RAM_GB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 ))
else
    RAM_GB=$(( $(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1048576 ))
fi
[ "${RAM_GB:-0}" -lt 1 ] && RAM_GB=1

# Homebrew's LLVM (which provides clang-tidy) is keg-only on macOS — it is not
# symlinked onto PATH. Add its bin dir so the static-analysis check finds
# clang-tidy. On Linux these paths don't exist, so this is a harmless no-op.
if ! command -v clang-tidy &>/dev/null; then
    for _llvm_bin in "$(brew --prefix llvm 2>/dev/null)/bin" /opt/homebrew/opt/llvm/bin /usr/local/opt/llvm/bin; do
        if [ -x "$_llvm_bin/clang-tidy" ]; then
            PATH="$_llvm_bin:$PATH"
            break
        fi
    done
fi

# Several Homebrew formulae (libpq, openssl) are keg-only and not on the default
# pkg-config search path. libpqxx.pc lists libpq as a private dependency, so a
# fresh CMake configure (e.g. the static-analysis build dir) fails with
# "Package 'libpq' not found" unless we add these. Harmless no-op without brew.
if command -v brew &>/dev/null; then
    for _pc_pkg in libpq openssl@3 openssl; do
        _pc_dir="$(brew --prefix "$_pc_pkg" 2>/dev/null)/lib/pkgconfig"
        [ -d "$_pc_dir" ] && PKG_CONFIG_PATH="$_pc_dir:${PKG_CONFIG_PATH:-}"
    done
    export PKG_CONFIG_PATH
fi

# The vendored libs/hiredis declares cmake_minimum_required(VERSION 3.0.0),
# which CMake 4.x rejects ("Compatibility with CMake < 3.5 has been removed").
# Restore < 3.5 policy compatibility so fresh configures succeed. This is a
# no-op on CMake 3.x and matches the workaround already cached in build/.
CMAKE_COMPAT="-DCMAKE_POLICY_VERSION_MINIMUM=3.5"

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''
fi

# Results tracking
declare -A RESULTS
MISSING_DEPS=()
FAILED=0

# Temporary directory for parallel job output
PARALLEL_TMPDIR=$(mktemp -d)
trap 'rm -rf "$PARALLEL_TMPDIR"' EXIT

run_check() {
    local name="$1"
    shift
    printf "\n${BLUE}${BOLD}=== %s ===${NC}\n" "$name"
    if "$@"; then
        RESULTS["$name"]="PASS"
        printf -- "${GREEN}--- %s: PASSED ---${NC}\n" "$name"
    else
        RESULTS["$name"]="FAIL"
        FAILED=1
        printf -- "${RED}--- %s: FAILED ---${NC}\n" "$name"
    fi
}

# Run a check in the background, capturing output to a temp file.
# Usage: run_check_bg "Name" command args...
# Sets BGPID_<sanitized_name> and BGFILE_<sanitized_name>
run_check_bg() {
    local name="$1"
    shift
    local safe_name
    safe_name=$(echo "$name" | tr ' ' '_' | tr -cd 'A-Za-z0-9_')
    local outfile="$PARALLEL_TMPDIR/$safe_name.out"
    (
        if "$@" >"$outfile" 2>&1; then
            echo "PASS" > "$PARALLEL_TMPDIR/$safe_name.result"
        else
            echo "FAIL" > "$PARALLEL_TMPDIR/$safe_name.result"
        fi
    ) &
    eval "BGPID_${safe_name}=$!"
    eval "BGFILE_${safe_name}=$outfile"
    eval "BGNAME_${safe_name}='$name'"
}

# Wait for a background check and report its result.
# Usage: wait_check_bg "Name"
wait_check_bg() {
    local name="$1"
    local safe_name
    safe_name=$(echo "$name" | tr ' ' '_' | tr -cd 'A-Za-z0-9_')
    local pid_var="BGPID_${safe_name}"
    local file_var="BGFILE_${safe_name}"
    local result_file="$PARALLEL_TMPDIR/$safe_name.result"

    wait "${!pid_var}" 2>/dev/null

    printf "\n${BLUE}${BOLD}=== %s ===${NC}\n" "$name"
    cat "${!file_var}" 2>/dev/null

    if [ -f "$result_file" ] && [ "$(cat "$result_file")" = "PASS" ]; then
        RESULTS["$name"]="PASS"
        printf -- "${GREEN}--- %s: PASSED ---${NC}\n" "$name"
    else
        RESULTS["$name"]="FAIL"
        FAILED=1
        printf -- "${RED}--- %s: FAILED ---${NC}\n" "$name"
    fi
}

# Build the static-analysis tree (clang-tidy) and FAIL on any clang-tidy finding.
# CMake's clang-tidy integration only prints findings; it does not fail the build,
# so we scan the output ourselves. clang-tidy findings end with a [check-name]
# (e.g. [performance-...], [bugprone-...]); compiler warnings end with [-Wflag]
# (leading dash) and are deliberately NOT counted, so third-party/system
# -Wdeprecated noise can't fail the check. Run via run_check_bg (a subshell that
# inherits this function), so no fragile bash -c escaping is needed.
run_static_analysis() {
    cd "$BACKEND_DIR" || return 1
    # Clean first: CMake only runs clang-tidy while (re)compiling a file, so an
    # up-to-date build-analysis would skip analysis entirely and the check would
    # pass despite existing findings. A from-scratch build guarantees clang-tidy
    # runs on every file, so the gate is deterministic.
    rm -rf build-analysis
    cmake -B build-analysis -DCMAKE_BUILD_TYPE=Debug $CMAKE_COMPAT -DSTATIC_ANALYSIS=ON || return 1
    # clang-tidy is memory-hungry (~1.5 GB/process). Cap parallelism by RAM so a
    # from-scratch analysis doesn't swap on low-memory hosts (it also runs
    # alongside the main build during phase 1).
    local sa_jobs=$NPROC
    local sa_by_ram=$(( (RAM_GB - 2) / 2 )); [ "$sa_by_ram" -lt 1 ] && sa_by_ram=1
    [ "$sa_jobs" -gt "$sa_by_ram" ] && sa_jobs=$sa_by_ram
    local log
    log=$(mktemp)
    cmake --build build-analysis -j"$sa_jobs" 2>&1 | tee "$log"
    local rc=${PIPESTATUS[0]}
    if [ "$rc" -ne 0 ]; then rm -f "$log"; return "$rc"; fi
    local n
    n=$(grep -cE 'warning:.*\[[a-z][a-z0-9]*-[a-z0-9-]+\]$' "$log" 2>/dev/null || true)
    rm -f "$log"
    if [ "${n:-0}" -gt 0 ]; then
        printf "\n%s clang-tidy finding(s) detected; treating static analysis as FAILED.\n" "$n"
        return 1
    fi
    return 0
}

# Install the Playwright browsers WITHOUT relying on Playwright's bundled Node
# extractor, which hangs during extraction on newer Node (e.g. Node 24: the
# download reaches 100% but extract-zip then stalls indefinitely with no CPU/IO).
# Instead we ask Playwright for the artifact list + URLs via `--dry-run` (it omits
# the "Download url" line for already-installed artifacts), download each with
# curl, and unpack with the OS-native unarchiver (ditto on macOS, unzip on Linux)
# into Playwright's cache, writing its INSTALLATION_COMPLETE marker. Idempotent
# and fast on subsequent runs. Returns non-zero if any artifact can't be installed.
ensure_playwright_browsers() {
    local e2e_dir="$1"
    local plan
    plan=$(cd "$e2e_dir" && npx playwright install chromium --dry-run 2>/dev/null) || return 1
    # dry-run lists every artifact's install location + download URL regardless
    # of install state, so we discover the full set here and decide skip/install
    # per-artifact via its INSTALLATION_COMPLETE marker (a reliable idempotency
    # signal we control).
    local pairs
    pairs=$(printf '%s\n' "$plan" | awk '
        /Install location:/ { loc=$3 }
        /Download url:/ && loc { print loc "\t" $3; loc="" }' | sort -u)
    [ -z "$pairs" ] && return 0  # nothing to install

    local failed=0 loc url tmpzip
    while IFS=$'\t' read -r loc url; do
        [ -z "$loc" ] && continue
        if [ -f "$loc/INSTALLATION_COMPLETE" ]; then
            printf "  already installed: %s\n" "$(basename "$loc")"
            continue
        fi
        printf "  installing %s\n" "$(basename "$loc")"
        tmpzip=$(mktemp)
        if ! curl -fsSL -o "$tmpzip" "$url"; then
            printf "  download failed: %s\n" "$url"; rm -f "$tmpzip"; failed=1; break
        fi
        rm -rf "$loc"; mkdir -p "$loc"
        if [ "$(uname)" = "Darwin" ]; then
            ditto -x -k "$tmpzip" "$loc" || { rm -f "$tmpzip"; failed=1; break; }
        else
            unzip -q -o "$tmpzip" -d "$loc" || { rm -f "$tmpzip"; failed=1; break; }
        fi
        rm -f "$tmpzip"
        touch "$loc/INSTALLATION_COMPLETE"
    done < <(printf '%s\n' "$pairs")
    return "$failed"
}

print_summary() {
    local order=("Frontend Lint" "Frontend Type Check" "Frontend Format Check"
                 "Frontend Build" "Backend Build" "Backend Static Analysis"
                 "Backend Unit Tests" "Backend Integration Tests"
                 "API Tests" "E2E Tests" "Docker Compose Config" "Docker Build"
                 "Helm Chart Lint" "Nginx Security Headers" "Sqitch Schema Check"
                 "Redis Multi-Instance")

    printf "\n${BOLD}========================================${NC}\n"
    printf "${BOLD}  TEST RESULTS SUMMARY${NC}\n"
    printf "${BOLD}========================================${NC}\n"

    for name in "${order[@]}"; do
        local status="${RESULTS[$name]:-SKIP}"
        local color="$YELLOW"
        if [ "$status" = "PASS" ]; then color="$GREEN"; fi
        if [ "$status" = "FAIL" ]; then color="$RED"; fi
        printf "  %-30s ${color}%s${NC}\n" "$name" "$status"
    done

    printf "${BOLD}========================================${NC}\n"
    if [ "$FAILED" -eq 0 ]; then
        printf "  ${GREEN}${BOLD}Result: ALL PASSED${NC}\n"
    else
        printf "  ${RED}${BOLD}Result: FAILED${NC}\n"
    fi
    printf "${BOLD}========================================${NC}\n"

    if [ "${#MISSING_DEPS[@]}" -gt 0 ]; then
        printf "\n${YELLOW}${BOLD}Some checks were skipped due to missing dependencies:${NC}\n"
        for dep in "${MISSING_DEPS[@]}"; do
            printf "  ${YELLOW}- %s${NC}\n" "$dep"
        done
        printf "\n"
    fi
}

usage() {
    cat <<EOF
Usage: ./run-tests.sh [OPTIONS]

Run all project tests and checks with a summary report.

Options:
  --all              Run everything (default if no flags given)
  --frontend         Run all frontend checks (lint, typecheck, format, build)
  --backend          Run all backend tests (build + unit + integration)
  --backend-unit     Run only backend unit tests (builds if needed)
  --backend-integ    Run only backend integration tests (builds if needed)
  --lint             Run frontend lint check only
  --typecheck        Run frontend type check only
  --format           Run frontend format check only
  --build            Run frontend production build only
  --api-tests        Run black-box API tests (needs backend build + PostgreSQL)
  --e2e              Run Playwright E2E tests (needs backend + frontend + PostgreSQL)
  --parallel N       Run API/E2E tests with N parallel workers (each gets own backend/DB)
  --static-analysis  Run C++ static analysis (clang-tidy)
  --docker           Run Docker container builds
  --nginx-headers    Assert security headers are emitted by nginx (needs running stack on :80)
  --sqitch-check     Verify sqitch schema matches run_migrations() output (needs docker)
  --redis-multi-instance
                     Bring up postgres + redis + 2 backends and verify cross-
                     instance WS broadcast, Redis-down fallback, self-echo
                     filtering, and the shared auth rate-limiter (needs docker,
                     ~3min on first run)
  --helm             Lint the Helm chart and render its eval/production value
                     profiles (skipped if helm isn't installed)
  --no-build         Skip the backend CMake build step
  --help             Show this help message

Examples:
  ./run-tests.sh                    # Run everything
  ./run-tests.sh --frontend         # Frontend checks only
  ./run-tests.sh --backend-unit     # Build and run backend unit tests
  ./run-tests.sh --lint --typecheck # Run specific frontend checks
  ./run-tests.sh --api-tests        # Black-box API endpoint tests
  ./run-tests.sh --e2e              # Playwright E2E tests
  ./run-tests.sh --e2e --parallel 3 # E2E tests with 3 parallel workers
  ./run-tests.sh --docker           # Build Docker containers
EOF
}

# Parse arguments
RUN_LINT=false
RUN_TYPECHECK=false
RUN_FORMAT=false
RUN_FE_BUILD=false
RUN_BACKEND_UNIT=false
RUN_BACKEND_INTEG=false
RUN_API_TESTS=false
RUN_E2E=false
RUN_DOCKER=false
RUN_STATIC_ANALYSIS=false
RUN_NGINX_HEADERS=false
RUN_SQITCH_CHECK=false
RUN_REDIS_MI=false
RUN_HELM=false
SKIP_BUILD=false

# Auto-size the parallel test-worker pools to the host. Each API worker runs its
# own backend process; each E2E worker additionally runs a Vite dev server and a
# Chromium instance, so E2E workers are far heavier (RAM + CPU). We bound by both
# CPU and RAM and clamp to sane maxima. (16 cores / 128 GB lands on the previous
# 64 / 16 defaults; a 6-core / 8 GB laptop gets a handful instead of thrashing.)
# Override either pool explicitly with `--parallel N`.
_usable_gb=$(( RAM_GB > 2 ? RAM_GB - 2 : 1 ))           # reserve ~2 GB for OS + PostgreSQL
API_WORKERS=$(( 4 * NPROC ))                            # API tests are I/O-bound
[ "$API_WORKERS" -gt "$_usable_gb" ] && API_WORKERS=$_usable_gb   # ~1 GB per backend
[ "$API_WORKERS" -gt 64 ] && API_WORKERS=64             # cap (PostgreSQL conn limit)
[ "$API_WORKERS" -lt 1 ] && API_WORKERS=1
E2E_WORKERS=$NPROC                                      # E2E is CPU/RAM-heavy
_e2e_by_ram=$(( _usable_gb / 3 ))                       # ~3 GB per backend+vite+chromium
[ "$E2E_WORKERS" -gt "$_e2e_by_ram" ] && E2E_WORKERS=$_e2e_by_ram
[ "$E2E_WORKERS" -gt 16 ] && E2E_WORKERS=16             # cap
[ "$E2E_WORKERS" -lt 1 ] && E2E_WORKERS=1

ANY_FLAG=false
NEXT_IS_WORKERS=false

for arg in "$@"; do
    if [ "$NEXT_IS_WORKERS" = true ]; then
        E2E_WORKERS="$arg"
        API_WORKERS="$arg"
        NEXT_IS_WORKERS=false
        continue
    fi
    case "$arg" in
        --all)
            RUN_LINT=true; RUN_TYPECHECK=true; RUN_FORMAT=true; RUN_FE_BUILD=true
            RUN_BACKEND_UNIT=true; RUN_BACKEND_INTEG=true; RUN_API_TESTS=true; RUN_E2E=true; RUN_DOCKER=true; RUN_STATIC_ANALYSIS=true
            RUN_HELM=true
            ANY_FLAG=true ;;
        --frontend)
            RUN_LINT=true; RUN_TYPECHECK=true; RUN_FORMAT=true; RUN_FE_BUILD=true
            ANY_FLAG=true ;;
        --backend)
            RUN_BACKEND_UNIT=true; RUN_BACKEND_INTEG=true; RUN_API_TESTS=true
            ANY_FLAG=true ;;
        --backend-unit)
            RUN_BACKEND_UNIT=true; ANY_FLAG=true ;;
        --backend-integ)
            RUN_BACKEND_INTEG=true; ANY_FLAG=true ;;
        --api-tests)
            RUN_API_TESTS=true; ANY_FLAG=true ;;
        --e2e)
            RUN_E2E=true; ANY_FLAG=true ;;
        --lint)
            RUN_LINT=true; ANY_FLAG=true ;;
        --typecheck)
            RUN_TYPECHECK=true; ANY_FLAG=true ;;
        --format)
            RUN_FORMAT=true; ANY_FLAG=true ;;
        --build)
            RUN_FE_BUILD=true; ANY_FLAG=true ;;
        --parallel)
            NEXT_IS_WORKERS=true ;;
        --static-analysis)
            RUN_STATIC_ANALYSIS=true; ANY_FLAG=true ;;
        --docker)
            RUN_DOCKER=true; ANY_FLAG=true ;;
        --nginx-headers)
            RUN_NGINX_HEADERS=true; ANY_FLAG=true ;;
        --sqitch-check)
            RUN_SQITCH_CHECK=true; ANY_FLAG=true ;;
        --redis-multi-instance)
            RUN_REDIS_MI=true; ANY_FLAG=true ;;
        --helm)
            RUN_HELM=true; ANY_FLAG=true ;;
        --no-build)
            SKIP_BUILD=true ;;
        --help)
            usage; exit 0 ;;
        *)
            printf "${RED}Unknown option: %s${NC}\n" "$arg"
            usage; exit 1 ;;
    esac
done

# Default: run everything
if [ "$ANY_FLAG" = false ]; then
    RUN_LINT=true; RUN_TYPECHECK=true; RUN_FORMAT=true; RUN_FE_BUILD=true
    RUN_BACKEND_UNIT=true; RUN_BACKEND_INTEG=true; RUN_API_TESTS=true; RUN_E2E=true; RUN_DOCKER=true; RUN_STATIC_ANALYSIS=true
    RUN_HELM=true
fi

NEED_BACKEND=$( [ "$RUN_BACKEND_UNIT" = true ] || [ "$RUN_BACKEND_INTEG" = true ] || [ "$RUN_API_TESTS" = true ] || [ "$RUN_E2E" = true ] && echo true || echo false )
NEED_PG=$( [ "$RUN_BACKEND_INTEG" = true ] || [ "$RUN_API_TESTS" = true ] || [ "$RUN_E2E" = true ] && echo true || echo false )

printf "${BOLD}Chat App Test Runner${NC}\n"
if [ "$RUN_API_TESTS" = true ] || [ "$RUN_E2E" = true ]; then
    printf "${BLUE}Host: %s cores / %s GB RAM -> API workers=%s, E2E workers=%s (override: --parallel N)${NC}\n" \
        "$NPROC" "$RAM_GB" "$API_WORKERS" "$E2E_WORKERS"
fi

# =====================================================================
# Phase 1: Run frontend lint/typecheck/format AND backend build in parallel
# =====================================================================

FE_PARALLEL_CHECKS=()

# Run formatters before checking, so format:check only fails on unfixable issues
# Skip in CI (e.g. GitHub Actions) — CI should only check, not fix
if [ "$RUN_FORMAT" = true ] && [ "$CI" != "true" ]; then
    printf "\n${BLUE}${BOLD}=== Running Frontend Formatter ===${NC}\n"
    (cd "$FRONTEND_DIR" && npm run format) || true
fi

if [ "$NEED_BACKEND" = true ] && [ "$CI" != "true" ]; then
    if command -v clang-format &>/dev/null; then
        printf "\n${BLUE}${BOLD}=== Running Backend Formatter ===${NC}\n"
        find "$BACKEND_DIR/src" -type f \( -name '*.cpp' -o -name '*.h' \) -exec clang-format -i {} +
    else
        MISSING_DEPS+=("clang-format (backend auto-formatting)")
    fi
fi

if [ "$RUN_LINT" = true ]; then
    run_check_bg "Frontend Lint" bash -c "cd '$FRONTEND_DIR' && npm run lint"
    FE_PARALLEL_CHECKS+=("Frontend Lint")
fi

if [ "$RUN_TYPECHECK" = true ]; then
    run_check_bg "Frontend Type Check" bash -c "cd '$FRONTEND_DIR' && npm run typecheck"
    FE_PARALLEL_CHECKS+=("Frontend Type Check")
fi

if [ "$RUN_FORMAT" = true ]; then
    run_check_bg "Frontend Format Check" bash -c "cd '$FRONTEND_DIR' && npm run format:check"
    FE_PARALLEL_CHECKS+=("Frontend Format Check")
fi

# Start backend build in parallel with frontend checks
BUILD_OK=true
BACKEND_BUILD_BG=false
if [ "$NEED_BACKEND" = true ] && [ "$SKIP_BUILD" = false ]; then
    if [ ! -d "$BACKEND_DIR/libs/uWebSockets" ] || [ ! -d "$BACKEND_DIR/libs/json" ]; then
        printf "\n${RED}Error: Backend library dependencies not found.${NC}\n"
        printf "Run the following to initialize submodules:\n"
        printf "  git submodule update --init --recursive\n"
        FAILED=1
        RESULTS["Backend Build"]="FAIL"
        BUILD_OK=false
    else
        COVERAGE_FLAG=""
        SANITIZER_FLAG=""
        if [ "$RUN_BACKEND_UNIT" = true ]; then
            COVERAGE_FLAG="-DCODE_COVERAGE=ON"
            # Enable sanitizers only if the toolchain can actually LINK them.
            # A compile-only (-c) check passes even when the runtime is missing,
            # and probing for "libasan.so" is Linux-specific — Apple's clang
            # ships the sanitizer runtimes as libclang_rt.*san_*.dylib, not a
            # libasan.so. Linking a tiny program is the portable test: it
            # requires libasan/libubsan on Linux and the clang_rt dylibs on macOS.
            _santest_bin="$(mktemp)"
            if printf 'int main(void){return 0;}\n' | \
               gcc -fsanitize=address,undefined -x c - -o "$_santest_bin" &>/dev/null; then
                SANITIZER_FLAG="-DSANITIZERS=ON"
            else
                MISSING_DEPS+=("libasan + libubsan (runtime sanitizers for unit tests)")
            fi
            rm -f "$_santest_bin"
        fi
        run_check_bg "Backend Build" bash -c "cd '$BACKEND_DIR' && cmake -B build -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTS=ON $CMAKE_COMPAT $COVERAGE_FLAG $SANITIZER_FLAG && cmake --build build -j$NPROC"
        BACKEND_BUILD_BG=true
    fi
fi

# Start static analysis build in parallel (separate build directory)
STATIC_ANALYSIS_BG=false
if [ "$RUN_STATIC_ANALYSIS" = true ] && [ "$SKIP_BUILD" = false ] && [ "$BUILD_OK" = true ]; then
    if command -v clang-tidy &>/dev/null; then
        run_check_bg "Backend Static Analysis" run_static_analysis
        STATIC_ANALYSIS_BG=true
    else
        RESULTS["Backend Static Analysis"]="SKIP"
        MISSING_DEPS+=("clang-tidy (backend static analysis)")
    fi
fi

# Also start PostgreSQL container early if we'll need it later
PG_CONTAINER_STARTED=false
if [ "$NEED_PG" = true ]; then
    TEST_PG_CONTAINER="chatapp-test-postgres-$$"
    TEST_PG_PORT=5433
    TEST_PG_USER=chatapp_test
    TEST_PG_PASS=testpassword
    TEST_PG_DB=chatapp_test

    # Clean up any stale test containers from previous runs on the same port
    for cid in $(docker ps -aq --filter "publish=$TEST_PG_PORT"); do
        docker rm -f "$cid" &>/dev/null
    done

    printf "\n${BLUE}Starting test PostgreSQL container on port %s...${NC}\n" "$TEST_PG_PORT"
    docker run -d --rm \
        --name "$TEST_PG_CONTAINER" \
        -e POSTGRES_USER="$TEST_PG_USER" \
        -e POSTGRES_PASSWORD="$TEST_PG_PASS" \
        -e POSTGRES_DB="$TEST_PG_DB" \
        -p "$TEST_PG_PORT:5432" \
        postgres:16-alpine \
        -c max_locks_per_transaction=512 \
        -c max_connections=200 >/dev/null

    PG_CONTAINER_STARTED=true
fi

# Wait for all parallel frontend checks
for name in "${FE_PARALLEL_CHECKS[@]}"; do
    wait_check_bg "$name"
done

# Wait for backend build
if [ "$BACKEND_BUILD_BG" = true ]; then
    wait_check_bg "Backend Build"
    if [ "${RESULTS["Backend Build"]}" = "FAIL" ]; then
        BUILD_OK=false
    fi
fi

# Wait for static analysis
if [ "$STATIC_ANALYSIS_BG" = true ]; then
    wait_check_bg "Backend Static Analysis"
fi

# =====================================================================
# Phase 2: Frontend build (depends on no specific phase 1 result, but
# runs after to avoid competing for CPU with backend build)
# =====================================================================

if [ "$RUN_FE_BUILD" = true ]; then
    run_check "Frontend Build" bash -c "cd '$FRONTEND_DIR' && npm run build"
fi

# =====================================================================
# Phase 3: Backend unit tests + wait for PostgreSQL
# =====================================================================

if [ "$BUILD_OK" = true ] && [ "$RUN_BACKEND_UNIT" = true ]; then
    # Clear stale gcov data only for files that were recompiled (checksum mismatch).
    # Compare gcno (compile-time) and gcda (runtime) timestamps — if gcno is newer,
    # the source was recompiled and the gcda is stale.
    while IFS= read -r gcno_file; do
        gcda_file="${gcno_file%.gcno}.gcda"
        if [ -f "$gcda_file" ] && [ "$gcno_file" -nt "$gcda_file" ]; then
            rm -f "$gcda_file"
        fi
    done < <(find "$BUILD_DIR" -name '*.gcno' 2>/dev/null)

    # PasswordTests exercises Argon2, which is deliberately CPU-heavy; on
    # constrained machines (or when this runs as part of the full suite) it can
    # exceed a tight per-test timeout. 120s leaves ample headroom without
    # masking a genuine hang.
    run_check "Backend Unit Tests" bash -c "cd '$BUILD_DIR' && ctest --output-on-failure -L unit --timeout 120 -j$NPROC"
fi

# Wait for PostgreSQL to be ready (it was started during phase 1)
PG_READY=false
if [ "$PG_CONTAINER_STARTED" = true ]; then
    printf "\n${BLUE}Waiting for PostgreSQL to be ready...${NC}\n"
    for i in $(seq 1 30); do
        if docker exec "$TEST_PG_CONTAINER" pg_isready -U "$TEST_PG_USER" &>/dev/null; then
            PG_READY=true
            break
        fi
        sleep 1
    done

    if [ "$PG_READY" = false ]; then
        printf "${RED}Error: Test PostgreSQL container failed to start within 30s.${NC}\n"
        FAILED=1
    fi
fi

# Apply the canonical schema to the shared test database. The backend's
# run_migrations() is now a deprecated no-op (schema is managed by sqitch), so
# the integration tests and the single-worker API/E2E runs — which all connect
# to this shared DB — need the sqitch deploy script applied here. Multi-worker
# API/E2E runs create their own per-worker DBs and apply the schema themselves
# (see tests/api/conftest.py and tests/e2e/fixtures.ts).
SCHEMA_SQL="$SCRIPT_DIR/sqitch/deploy/0001-initial-schema.sql"
if [ "$PG_READY" = true ]; then
    printf "\n${BLUE}Applying sqitch schema to test database...${NC}\n"
    if ! docker exec -i "$TEST_PG_CONTAINER" \
            psql -v ON_ERROR_STOP=1 -U "$TEST_PG_USER" -d "$TEST_PG_DB" \
            <"$SCHEMA_SQL" >/dev/null 2>&1; then
        printf "${RED}Error: failed to apply sqitch schema to test database.${NC}\n"
        printf "  Source: %s\n" "$SCHEMA_SQL"
        PG_READY=false
        FAILED=1
    fi
fi

# =====================================================================
# Phase 4: Integration tests, API tests, E2E tests (all share one PG)
# =====================================================================

if [ "$BUILD_OK" = true ] && [ "$RUN_BACKEND_INTEG" = true ] && [ "$PG_READY" = true ]; then
    run_check "Backend Integration Tests" bash -c "
        export POSTGRES_HOST=localhost
        export POSTGRES_PORT=$TEST_PG_PORT
        export POSTGRES_USER=$TEST_PG_USER
        export POSTGRES_PASSWORD=$TEST_PG_PASS
        export POSTGRES_DB=$TEST_PG_DB
        cd '$BUILD_DIR' && ctest --output-on-failure -L integration --timeout 60
    "
fi

# Report combined code coverage (unit + integration tests)
COVERAGE_RAN=false
if [ "$BUILD_OK" = true ] && command -v gcov &>/dev/null; then
    # Show report if either unit or integration tests ran successfully
    UNIT_PASSED=$( [ "${RESULTS["Backend Unit Tests"]:-SKIP}" = "PASS" ] && echo true || echo false )
    INTEG_PASSED=$( [ "${RESULTS["Backend Integration Tests"]:-SKIP}" = "PASS" ] && echo true || echo false )
    if [ "$UNIT_PASSED" = true ] || [ "$INTEG_PASSED" = true ]; then
        COVERAGE_LABEL="Code Coverage Report"
        if [ "$UNIT_PASSED" = true ] && [ "$INTEG_PASSED" = true ]; then
            COVERAGE_LABEL="Code Coverage Report (unit + integration tests)"
        elif [ "$INTEG_PASSED" = true ]; then
            COVERAGE_LABEL="Code Coverage Report (integration tests)"
        fi

        printf "\n${BLUE}${BOLD}=== %s ===${NC}\n" "$COVERAGE_LABEL"
        GCDA_DIR="$BUILD_DIR/CMakeFiles/chat-lib.dir/src"
        if [ -d "$GCDA_DIR" ]; then
            # Process all gcda files in one gcov invocation for reliable results
            GCOV_OUTPUT=$(cd "$GCDA_DIR" && find . -name '*.gcda' -exec gcov -n {} + 2>/dev/null)

            unset FILE_LINES FILE_COVERED 2>/dev/null
            declare -A FILE_LINES FILE_COVERED
            FILE_ORDER=()
            current_file=""
            while IFS= read -r line; do
                if [[ "$line" =~ ^File\ \'.*/backend/src/.*\.cpp ]]; then
                    current_file=$(echo "$line" | sed "s|.*src/|src/|; s|'$||")
                elif [[ "$line" =~ ^Lines\ executed: ]] && [ -n "$current_file" ]; then
                    pct=$(echo "$line" | sed -n 's/Lines executed:\([0-9.]*\)% of \([0-9]*\)/\1 \2/p')
                    if [ -n "$pct" ]; then
                        file_pct=$(echo "$pct" | cut -d' ' -f1)
                        file_lines=$(echo "$pct" | cut -d' ' -f2)
                        file_covered=$(echo "$file_pct $file_lines" | awk '{printf "%d", ($1/100)*$2}')
                        prev_covered="${FILE_COVERED[$current_file]:-0}"
                        if [ "$file_covered" -gt "$prev_covered" ] || [ -z "${FILE_LINES[$current_file]+x}" ]; then
                            if [ -z "${FILE_LINES[$current_file]+x}" ]; then
                                FILE_ORDER+=("$current_file")
                            fi
                            FILE_LINES[$current_file]=$file_lines
                            FILE_COVERED[$current_file]=$file_covered
                        fi
                    fi
                    current_file=""
                else
                    current_file=""
                fi
            done <<< "$GCOV_OUTPUT"

            TOTAL_LINES=0
            COVERED_LINES=0
            for f in "${FILE_ORDER[@]}"; do
                fl=${FILE_LINES[$f]}
                fc=${FILE_COVERED[$f]}
                TOTAL_LINES=$((TOTAL_LINES + fl))
                COVERED_LINES=$((COVERED_LINES + fc))
                file_pct=$(awk "BEGIN {printf \"%.2f\", ($fc/$fl)*100}")
                printf "  %-45s %s%% (%s lines)\n" "$f" "$file_pct" "$fl"
            done

            if [ "$TOTAL_LINES" -gt 0 ]; then
                COVERAGE_PCT=$(awk "BEGIN {printf \"%.1f\", ($COVERED_LINES/$TOTAL_LINES)*100}")
                printf "\n  ${BOLD}%-45s %s${NC}\n" "Overall coverage:" "$COVERAGE_PCT% ($COVERED_LINES/$TOTAL_LINES lines)"
            fi
        fi
        printf "${BLUE}${BOLD}=============================${NC}\n"
    fi
fi

if [ "$RUN_API_TESTS" = true ]; then
    if [ "$BUILD_OK" = false ] || [ "$PG_READY" = false ]; then
        RESULTS["API Tests"]="SKIP"
    else
        # Ensure Python venv with test dependencies
        API_VENV="$API_TESTS_DIR/.venv"
        if [ ! -d "$API_VENV" ]; then
            printf "\n${BLUE}Creating Python venv for API tests...${NC}\n"
            python3 -m venv "$API_VENV"
        fi
        "$API_VENV/bin/pip" install -q -r "$API_TESTS_DIR/requirements.txt" 2>/dev/null

        API_PYTEST_ARGS="-v --tb=short"
        if [ "$API_WORKERS" -gt 1 ]; then
            API_PYTEST_ARGS="-v --tb=short -n $API_WORKERS"
        fi

        if [ "$API_WORKERS" -gt 1 ]; then
            # Multi-worker mode: each xdist worker starts its own backend via fixture
            printf "\n${BLUE}Running API tests with %s parallel workers...${NC}\n" "$API_WORKERS"
            run_check "API Tests" bash -c "
                export TEST_BACKEND_BINARY='$BUILD_DIR/chat-server'
                export TEST_BUILD_DIR='$BUILD_DIR'
                export POSTGRES_HOST=localhost
                export POSTGRES_PORT=$TEST_PG_PORT
                export POSTGRES_USER=$TEST_PG_USER
                export POSTGRES_PASSWORD=$TEST_PG_PASS
                export POSTGRES_DB=$TEST_PG_DB
                export DB_POOL_SIZE=2
                export DB_THREAD_POOL_SIZE=4
                cd '$API_TESTS_DIR' && '$API_VENV/bin/python' -m pytest $API_PYTEST_ARGS
            "
        else
            # Single-worker mode: start one backend server
            TEST_BACKEND_PORT=9099
            API_UPLOAD_DIR=$(mktemp -d)

            printf "\n${BLUE}Starting backend server on port %s for API tests...${NC}\n" "$TEST_BACKEND_PORT"
            BACKEND_PORT="$TEST_BACKEND_PORT" \
            POSTGRES_HOST=localhost \
            POSTGRES_PORT="$TEST_PG_PORT" \
            POSTGRES_USER="$TEST_PG_USER" \
            POSTGRES_PASSWORD="$TEST_PG_PASS" \
            POSTGRES_DB="$TEST_PG_DB" \
            UPLOAD_DIR="$API_UPLOAD_DIR" \
            "$BUILD_DIR/chat-server" &
            API_SERVER_PID=$!

            API_SERVER_READY=false
            for i in $(seq 1 15); do
                if curl -sf "http://127.0.0.1:$TEST_BACKEND_PORT/api/health" >/dev/null 2>&1; then
                    API_SERVER_READY=true
                    break
                fi
                sleep 1
            done

            if [ "$API_SERVER_READY" = false ]; then
                printf "${RED}Error: Backend server failed to start for API tests.${NC}\n"
                kill "$API_SERVER_PID" 2>/dev/null || true
                RESULTS["API Tests"]="FAIL"
                FAILED=1
            else
                run_check "API Tests" bash -c "
                    export TEST_SERVER_URL=http://127.0.0.1:$TEST_BACKEND_PORT
                    export TEST_BACKEND_PORT=$TEST_BACKEND_PORT
                    export POSTGRES_HOST=localhost
                    export POSTGRES_PORT=$TEST_PG_PORT
                    export POSTGRES_USER=$TEST_PG_USER
                    export POSTGRES_PASSWORD=$TEST_PG_PASS
                    export POSTGRES_DB=$TEST_PG_DB
                    cd '$API_TESTS_DIR' && '$API_VENV/bin/python' -m pytest $API_PYTEST_ARGS
                "
                kill "$API_SERVER_PID" 2>/dev/null || true
                wait "$API_SERVER_PID" 2>/dev/null || true
            fi

            rm -rf "$API_UPLOAD_DIR"
        fi
    fi
fi

if [ "$RUN_E2E" = true ]; then
    if [ "$BUILD_OK" = false ] || [ "$PG_READY" = false ]; then
        RESULTS["E2E Tests"]="SKIP"
    else
        # Ensure Node dependencies are installed
        if [ ! -d "$E2E_TESTS_DIR/node_modules" ]; then
            printf "\n${BLUE}Installing E2E test dependencies...${NC}\n"
            (cd "$E2E_TESTS_DIR" && npm install) || true
        fi

        # Ensure the Playwright browser binaries are installed (native extraction;
        # see ensure_playwright_browsers). If it can't, skip E2E rather than hang.
        printf "\n${BLUE}Ensuring Playwright browser (chromium) is installed...${NC}\n"
        E2E_BROWSER_OK=true
        if ! ensure_playwright_browsers "$E2E_TESTS_DIR"; then
            printf "${YELLOW}Could not install the Playwright browser; skipping E2E tests.${NC}\n"
            printf "${YELLOW}  Install manually: (cd tests/e2e && npx playwright install chromium)${NC}\n"
            RESULTS["E2E Tests"]="SKIP"
            MISSING_DEPS+=("playwright chromium browser (E2E)")
            E2E_BROWSER_OK=false
        fi

        if [ "$E2E_BROWSER_OK" = false ]; then
            :  # browser unavailable — E2E already marked SKIP above
        elif [ "$E2E_WORKERS" -gt 1 ]; then
            # Multi-worker mode: fixtures handle per-worker backend/Vite
            printf "\n${BLUE}Running E2E tests with %s parallel workers...${NC}\n" "$E2E_WORKERS"
            run_check "E2E Tests" bash -c "
                export TEST_WORKERS=$E2E_WORKERS
                export TEST_BUILD_DIR='$BUILD_DIR'
                export TEST_FRONTEND_DIR='$FRONTEND_DIR'
                export TEST_PG_CONTAINER=$TEST_PG_CONTAINER
                export POSTGRES_USER=$TEST_PG_USER
                export POSTGRES_PASSWORD=$TEST_PG_PASS
                export POSTGRES_PORT=$TEST_PG_PORT
                export DB_POOL_SIZE=2
                export DB_THREAD_POOL_SIZE=4
                cd '$E2E_TESTS_DIR' && npx playwright test
            "
        else
            # Single-worker mode: start one backend + Vite server
            E2E_BACKEND_PORT=9098
            E2E_FRONTEND_PORT=5199
            E2E_UPLOAD_DIR=$(mktemp -d)

            printf "\n${BLUE}Starting backend server on port %s for E2E tests...${NC}\n" "$E2E_BACKEND_PORT"
            BACKEND_PORT="$E2E_BACKEND_PORT" \
            POSTGRES_HOST=localhost \
            POSTGRES_PORT="$TEST_PG_PORT" \
            POSTGRES_USER="$TEST_PG_USER" \
            POSTGRES_PASSWORD="$TEST_PG_PASS" \
            POSTGRES_DB="$TEST_PG_DB" \
            UPLOAD_DIR="$E2E_UPLOAD_DIR" \
            ALLOWED_ORIGINS="http://localhost:$E2E_FRONTEND_PORT" \
            "$BUILD_DIR/chat-server" >/tmp/e2e-backend.log 2>&1 &
            E2E_SERVER_PID=$!

            E2E_SERVER_READY=false
            for i in $(seq 1 15); do
                if curl -sf "http://127.0.0.1:$E2E_BACKEND_PORT/api/health" >/dev/null 2>&1; then
                    E2E_SERVER_READY=true
                    break
                fi
                sleep 1
            done

            if [ "$E2E_SERVER_READY" = false ]; then
                printf "${RED}Error: Backend server failed to start for E2E tests.${NC}\n"
                kill "$E2E_SERVER_PID" 2>/dev/null || true
                RESULTS["E2E Tests"]="FAIL"
                FAILED=1
            else
                printf "${BLUE}Starting Vite dev server on port %s...${NC}\n" "$E2E_FRONTEND_PORT"
                (cd "$FRONTEND_DIR" && VITE_BACKEND_PORT="$E2E_BACKEND_PORT" npx vite --port "$E2E_FRONTEND_PORT" --strictPort) >/dev/null 2>&1 &
                E2E_VITE_PID=$!

                E2E_VITE_READY=false
                for i in $(seq 1 30); do
                    if curl -sf "http://localhost:$E2E_FRONTEND_PORT/" >/dev/null 2>&1; then
                        E2E_VITE_READY=true
                        break
                    fi
                    sleep 1
                done

                if [ "$E2E_VITE_READY" = false ]; then
                    printf "${RED}Error: Vite dev server failed to start for E2E tests.${NC}\n"
                    kill "$E2E_VITE_PID" 2>/dev/null || true
                    kill "$E2E_SERVER_PID" 2>/dev/null || true
                    RESULTS["E2E Tests"]="FAIL"
                    FAILED=1
                else
                    run_check "E2E Tests" bash -c "
                        export TEST_WORKERS=1
                        export TEST_BACKEND_PORT=$E2E_BACKEND_PORT
                        export TEST_FRONTEND_PORT=$E2E_FRONTEND_PORT
                        export TEST_PG_CONTAINER=$TEST_PG_CONTAINER
                        export POSTGRES_USER=$TEST_PG_USER
                        export POSTGRES_DB=$TEST_PG_DB
                        cd '$E2E_TESTS_DIR' && npx playwright test
                    "
                    kill "$E2E_VITE_PID" 2>/dev/null || true
                    wait "$E2E_VITE_PID" 2>/dev/null || true
                fi

                kill "$E2E_SERVER_PID" 2>/dev/null || true
                wait "$E2E_SERVER_PID" 2>/dev/null || true
            fi

            rm -rf "$E2E_UPLOAD_DIR"
        fi
    fi
fi

# =====================================================================
# Phase 5: Docker build
# =====================================================================

if [ "$RUN_DOCKER" = true ]; then
    # Validate compose file syntax + required env vars before attempting a build.
    # Uses .env.example as the env source so the check does not require a real .env.
    run_check "Docker Compose Config" bash -c "cd '$SCRIPT_DIR' && docker compose --env-file .env.example config --quiet && docker compose --env-file .env.example -f docker-compose.yml -f docker-compose.dev.yml config --quiet"
    run_check "Docker Build" bash -c "cd '$SCRIPT_DIR' && docker compose build"
fi

# =====================================================================
# Optional: nginx security-headers smoke check (requires the stack to be
# running on localhost:80, e.g. after `docker compose up -d`).
# =====================================================================

check_nginx_headers() {
    local url="${NGINX_HEADERS_URL:-http://localhost/}"
    local headers
    headers=$(curl -sI "$url") || {
        printf "curl to %s failed\n" "$url"
        return 1
    }
    printf "%s\n" "$headers"
    local missing=()
    local expected=(
        "Strict-Transport-Security:"
        "X-Frame-Options: DENY"
        "X-Content-Type-Options: nosniff"
        "Referrer-Policy:"
        "Content-Security-Policy-Report-Only:"
    )
    for needle in "${expected[@]}"; do
        if ! grep -qi "^$needle" <<<"$headers"; then
            missing+=("$needle")
        fi
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        printf "\nMissing security headers:\n"
        for m in "${missing[@]}"; do
            printf "  - %s\n" "$m"
        done
        return 1
    fi
    return 0
}

# =====================================================================
# Helm chart lint + render (P2 release engineering). Validates the chart
# templates and that the eval + production value profiles render to valid
# manifests. SKIPs gracefully when helm isn't installed.
# =====================================================================

check_helm() {
    local chart="$SCRIPT_DIR/deploy/helm/enclave-station"
    helm lint "$chart" || return 1
    # The bare defaults intentionally omit required secrets (password, S3
    # bucket), so render against the shipped value profiles instead, which
    # supply them. A template bug fails the render.
    helm template t "$chart" -f "$chart/ci/eval-values.yaml" >/dev/null || return 1
    helm template t "$chart" -f "$chart/ci/production-values.yaml" >/dev/null || return 1
    printf "helm lint + eval/production renders OK\n"
    return 0
}

if [ "$RUN_HELM" = true ]; then
    if command -v helm &>/dev/null; then
        run_check "Helm Chart Lint" check_helm
    else
        printf "${YELLOW}helm not found; skipping Helm chart lint.${NC}\n"
        RESULTS["Helm Chart Lint"]="SKIP"
        MISSING_DEPS+=("helm (Helm chart lint)")
    fi
fi

if [ "$RUN_NGINX_HEADERS" = true ]; then
    run_check "Nginx Security Headers" check_nginx_headers
fi

if [ "$RUN_SQITCH_CHECK" = true ]; then
    run_check "Sqitch Schema Check" "$SCRIPT_DIR/tools/sqitch-check.sh"
fi

if [ "$RUN_REDIS_MI" = true ]; then
    run_check "Redis Multi-Instance" "$SCRIPT_DIR/tests/integration/multi_instance/run.sh"
fi

# =====================================================================
# Cleanup
# =====================================================================

if [ "$PG_CONTAINER_STARTED" = true ]; then
    printf "\n${BLUE}Stopping test PostgreSQL container...${NC}\n"
    docker rm -f "$TEST_PG_CONTAINER" &>/dev/null
fi

# --- Summary ---
print_summary

exit "$FAILED"

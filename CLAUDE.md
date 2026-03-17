# Enclave Station

A self-hosted team collaboration platform with real-time chat, calendars, tasks, wiki, and file sharing.

## Tech Stack

- **Frontend:** React 19 + TypeScript, Vite, Tailwind CSS 4, HeroUI, TipTap (collaborative editing)
- **Backend:** C++17, uWebSockets, libpqxx, PostgreSQL 16
- **Infrastructure:** Docker Compose (postgres, backend, frontend/nginx)

## Project Layout

```
frontend/          React SPA (Vite)
backend/           C++ server (CMake)
  src/handlers/    HTTP route handlers
  src/auth/        Authentication (PKI, WebAuthn, TOTP, passwords)
  src/db/          Database layer
  src/ws/          WebSocket handlers
  tests/           GTest unit & integration tests
  libs/            Git submodules (uWebSockets, nlohmann/json, argon2)
tests/api/         Python pytest black-box API tests
tests/e2e/         Playwright E2E tests
sql/               Database schema (init.sql)
nginx/             Nginx config (API proxy + SPA serving)
docs/              VitePress documentation
docker-compose.yml Container orchestration
run-tests.sh       Aggregate test runner
```

## Commands

### Frontend (run from `frontend/`)

```bash
npm run dev          # Dev server (proxies /api and /ws to backend)
npm run build        # TypeScript check + production build
npm run lint         # ESLint
npm run typecheck    # TypeScript type checking only
npm run format       # Prettier auto-format
npm run format:check # Prettier check (no write)
```

### Backend (run from `backend/`)

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTS=ON
cmake --build build -j$(nproc)
ctest --test-dir build -L unit --output-on-failure --timeout 30  # Unit tests only
```

### Test Runner (run from project root)

```bash
./run-tests.sh                    # Everything
./run-tests.sh --frontend         # Lint + typecheck + format:check + build
./run-tests.sh --backend-unit     # C++ unit tests only
./run-tests.sh --backend          # Build + unit + integration tests
./run-tests.sh --static-analysis  # C++ static analysis (clang-tidy)
./run-tests.sh --api-tests        # Python API tests (needs running services)
./run-tests.sh --e2e              # Playwright E2E (needs running services)
./run-tests.sh --e2e --parallel 1 # E2E single-threaded (for debugging)
```

### Docker

```bash
docker compose up -d              # Start all services
docker compose down               # Stop all services
docker compose build               # Rebuild images
```

## Workflow: After Making Changes

After modifying frontend code, always run:
1. `cd frontend && npm run format` (auto-fix formatting)
2. `cd frontend && npm run lint` (check for lint errors)
3. `cd frontend && npm run typecheck` (verify types)

After modifying backend code, always run:
1. Format: `find backend/src -name '*.cpp' -o -name '*.h' | xargs clang-format -i` (if clang-format is installed)
2. Build: `cd backend && cmake --build build -j$(nproc)`
3. Unit tests: `ctest --test-dir backend/build -L unit --output-on-failure --timeout 30`

## Code Style

### Frontend
- Prettier: semi, single quotes, JSX single quotes, trailing commas, 80 char width, 2-space indent
- ESLint with typescript-eslint + React Hooks/Refresh plugins
- Strict TypeScript (ES2022 target)

### Backend
- C++17
- CMake build system
- clang-format: 2-space indent, 100 char width (config in `backend/.clang-format`)
- clang-tidy static analysis (config in `backend/.clang-tidy`)
- Compiler warnings: `-Wall -Wextra -Wno-unused-parameter`

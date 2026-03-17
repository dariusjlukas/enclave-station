#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Defaults
PROFILE="ci"
SCENARIO=""
HOST="http://127.0.0.1:9001"
EXTRA_ARGS=""

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Options:
  --profile PROFILE   Load profile: baseline, moderate, stress, spike, ci (default: ci)
  --scenario NAME     Scenario class: AuthLoadUser, MessagingUser, RestApiMixUser,
                      FileUploadUser, SearchUser, RealisticUser (default: all)
  --host URL          Server URL (default: http://127.0.0.1:9001)
  -h, --help          Show this help

Examples:
  $0 --profile moderate --scenario MessagingUser --host http://localhost:9001
  $0 --profile baseline
  $0  # runs with ci profile against localhost:9001
EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile) PROFILE="$2"; shift 2 ;;
        --scenario) SCENARIO="$2"; shift 2 ;;
        --host) HOST="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) EXTRA_ARGS="$EXTRA_ARGS $1"; shift ;;
    esac
done

# Load profile config
PROFILES_FILE="$SCRIPT_DIR/config/profiles.json"
if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 is required"
    exit 1
fi

USERS=$(python3 -c "import json; p=json.load(open('$PROFILES_FILE')); print(p['$PROFILE']['users'])")
SPAWN_RATE=$(python3 -c "import json; p=json.load(open('$PROFILES_FILE')); print(p['$PROFILE']['spawn_rate'])")
RUN_TIME=$(python3 -c "import json; p=json.load(open('$PROFILES_FILE')); print(p['$PROFILE']['run_time'])")
DESC=$(python3 -c "import json; p=json.load(open('$PROFILES_FILE')); print(p['$PROFILE']['description'])")

echo "=== Load Test: $PROFILE ==="
echo "  $DESC"
echo "  Users: $USERS, Spawn rate: $SPAWN_RATE/s, Duration: $RUN_TIME"
echo "  Host: $HOST"
if [ -n "$SCENARIO" ]; then
    echo "  Scenario: $SCENARIO"
fi
echo ""

# Set up venv if needed
VENV_DIR="$SCRIPT_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

echo "Installing dependencies..."
"$VENV_DIR/bin/pip" install -q -r "$SCRIPT_DIR/requirements.txt"

# Build locust command
LOCUST_CMD=(
    "$VENV_DIR/bin/python" -m locust
    --headless
    --host="$HOST"
    -u "$USERS"
    -r "$SPAWN_RATE"
    --run-time="$RUN_TIME"
    --csv="$SCRIPT_DIR/reports/$PROFILE"
    --html="$SCRIPT_DIR/reports/$PROFILE.html"
    --exit-code-on-error 1
)

if [ -n "$SCENARIO" ]; then
    LOCUST_CMD+=("$SCENARIO")
fi

# Run from the load test directory so locustfile.py is found
cd "$SCRIPT_DIR"

echo "Running Locust..."
echo ""
"${LOCUST_CMD[@]}" $EXTRA_ARGS
LOCUST_EXIT=$?

echo ""

# Run validation
echo "Running post-test validation..."
"$VENV_DIR/bin/python" "$SCRIPT_DIR/validate.py" \
    --reports-dir "$SCRIPT_DIR/reports" \
    --host "$HOST"
VALIDATE_EXIT=$?

# Exit with failure if either step failed
if [ $LOCUST_EXIT -ne 0 ] || [ $VALIDATE_EXIT -ne 0 ]; then
    echo "Load test FAILED (locust=$LOCUST_EXIT, validate=$VALIDATE_EXIT)"
    exit 1
fi

echo "Load test PASSED"
exit 0

#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}!${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; }

run_with_spinner() {
  local message="$1"
  shift
  local spin='-\|/'
  local i=0
  local pid

  "$@" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  %s %s" "$message" "${spin:i++%${#spin}:1}"
    sleep 0.15
  done
  wait "$pid"
  local status=$?
  printf "\r  %s\n" "$message"
  return "$status"
}

run_logged_with_spinner() {
  local message="$1"
  local log_file="$2"
  shift 2
  local spin='-\|/'
  local i=0
  local pid

  "$@" >"$log_file" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  %s %s" "$message" "${spin:i++%${#spin}:1}"
    sleep 0.15
  done
  wait "$pid"
  local status=$?
  printf "\r  %s\n" "$message"
  return "$status"
}

ALLOW_PRE=0
VERSION=""

usage() {
  cat <<'EOF'
usage: install.sh [--pre|--rc] [--version VERSION]

Options:
  --pre, --rc          Allow pip to resolve prerelease versions.
  --version VERSION    Install an exact agentsquid version, such as 0.1.1rc2.
  -h, --help           Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pre|--rc)
      ALLOW_PRE=1
      shift
      ;;
    --version)
      if [[ -z "${2:-}" ]]; then
        fail "--version requires a value"
        exit 1
      fi
      VERSION="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#--version=}"
      if [[ -z "$VERSION" ]]; then
        fail "--version requires a value"
        exit 1
      fi
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

PACKAGE_SPEC="agentsquid"
INSTALL_LABEL="latest stable"

if [[ -n "$VERSION" ]]; then
  PACKAGE_SPEC="agentsquid==${VERSION}"
  INSTALL_LABEL="${VERSION}"
elif [[ "$ALLOW_PRE" == "1" ]]; then
  INSTALL_LABEL="latest prerelease"
fi

echo -e "\n${BOLD}agentsquid — install (${INSTALL_LABEL})${RESET}\n"

if ! command -v pipx &>/dev/null; then
  warn "pipx not found — installing"
  pipx_ready=0
  brew_attempted=0
  BREW_LOG=$(mktemp -t agentsquid-brew.XXXXXX)
  # A working `brew` binary doesn't guarantee `brew install` works — a broken
  # Cellar (ownership reset by an OS update, more common on Macs running past
  # their official macOS support window, e.g. via OpenCore Legacy Patcher)
  # fails here often enough that checking writability first — and keeping any
  # other brew failure in a log instead of dumping it to the screen — beats
  # printing Homebrew's own multi-line permissions error for a failure mode
  # that isn't actually fatal to installing agentsquid.
  if command -v brew &>/dev/null; then
    BREW_CELLAR=$(brew --cellar 2>/dev/null || echo /usr/local/Cellar)
    if [[ ! -e "$BREW_CELLAR" || -w "$BREW_CELLAR" ]]; then
      brew_attempted=1
      if run_logged_with_spinner "installing pipx with Homebrew" "$BREW_LOG" brew install pipx; then
        pipx ensurepath &>/dev/null || true
        pipx_ready=1
      fi
    else
      BREW_PREFIX=$(dirname "$BREW_CELLAR")
      warn "Homebrew found but $BREW_CELLAR isn't writable — using pip instead"
      warn "(fix later with: sudo chown -R \$(whoami) $BREW_PREFIX)"
    fi
  fi
  if [[ "$pipx_ready" != "1" ]] && command -v python3 &>/dev/null; then
    run_with_spinner "installing pipx with Python" python3 -m pip install --user --quiet pipx
    python3 -m pipx ensurepath &>/dev/null || true
    export PATH="$PATH:$(python3 -m site --user-base)/bin"
    pipx_ready=1
  fi
  if [[ "$pipx_ready" != "1" ]] || ! command -v pipx &>/dev/null; then
    fail "Could not install pipx automatically."
    if [[ "$brew_attempted" == "1" && -s "$BREW_LOG" ]]; then
      fail "Homebrew's error:"
      sed -n '1,20p' "$BREW_LOG" >&2
    fi
    fail "Fix Homebrew or install Python 3.9+, then re-run this script."
    fail "Or install pipx yourself: python3 -m pip install --user pipx && python3 -m pipx ensurepath"
    rm -f "$BREW_LOG"
    exit 1
  fi
  rm -f "$BREW_LOG"
  ok "pipx installed"
else
  ok "pipx found"
fi

# `pipx install` on an already-installed app is a no-op unless forced. Exact
# version installs use --force so rc test installs replace an existing stable
# package. Unpinned installs upgrade only when pipx already has agentsquid.
echo ""
PREVIOUS_VERSION=$(pipx runpip agentsquid show agentsquid 2>/dev/null | awk -F': ' '/^Version:/{print $2; exit}' || true)
LOG_FILE=$(mktemp -t agentsquid-install.XXXXXX)
if [[ -n "$VERSION" ]]; then
  if run_logged_with_spinner "installing agentsquid ${VERSION}" "$LOG_FILE" pipx install --force "$PACKAGE_SPEC"; then
    ok "agentsquid ${VERSION} installed"
  else
    fail "could not install ${PACKAGE_SPEC}"
    sed -n '1,40p' "$LOG_FILE" >&2
    rm -f "$LOG_FILE"
    exit 1
  fi
elif [[ -n "$PREVIOUS_VERSION" ]]; then
  if [[ "$ALLOW_PRE" == "1" ]]; then
    upgrade_ok=0
    run_logged_with_spinner "upgrading agentsquid (${INSTALL_LABEL})" "$LOG_FILE" pipx upgrade agentsquid --pip-args=--pre && upgrade_ok=1
  else
    upgrade_ok=0
    run_logged_with_spinner "upgrading agentsquid (${INSTALL_LABEL})" "$LOG_FILE" pipx upgrade agentsquid && upgrade_ok=1
  fi
  if [[ "$upgrade_ok" == "1" ]]; then
    ok "agentsquid package resolved"
  else
    fail "could not upgrade ${PACKAGE_SPEC}"
    sed -n '1,40p' "$LOG_FILE" >&2
    rm -f "$LOG_FILE"
    exit 1
  fi
else
  if [[ "$ALLOW_PRE" == "1" ]]; then
    install_ok=0
    run_logged_with_spinner "installing agentsquid" "$LOG_FILE" pipx install "$PACKAGE_SPEC" --pip-args=--pre && install_ok=1
  else
    install_ok=0
    run_logged_with_spinner "installing agentsquid" "$LOG_FILE" pipx install "$PACKAGE_SPEC" && install_ok=1
  fi
  if [[ "$install_ok" == "1" ]]; then
    ok "agentsquid installed"
  else
    fail "could not install ${PACKAGE_SPEC}"
    sed -n '1,40p' "$LOG_FILE" >&2
    rm -f "$LOG_FILE"
    exit 1
  fi
fi
rm -f "$LOG_FILE"

INSTALLED_VERSION=$(pipx runpip agentsquid show agentsquid 2>/dev/null | awk -F': ' '/^Version:/{print $2; exit}' || true)
RESTART_FOR_UPGRADE=0
if [[ -n "$INSTALLED_VERSION" ]]; then
  if [[ -n "$PREVIOUS_VERSION" && "$PREVIOUS_VERSION" != "$INSTALLED_VERSION" ]]; then
    ok "upgraded agentsquid ${PREVIOUS_VERSION} → ${INSTALLED_VERSION}"
    RESTART_FOR_UPGRADE=1
  elif [[ -n "$PREVIOUS_VERSION" ]]; then
    ok "agentsquid already at ${INSTALLED_VERSION}"
  else
    ok "installed version: agentsquid ${INSTALLED_VERSION}"
  fi
else
  warn "installed version could not be determined"
fi

# pipx's shim dir isn't necessarily on PATH yet in this same shell — `pipx
# ensurepath` only edits shell rc files for future shells, it can't affect
# the process already running this script.
export PATH="$PATH:$HOME/.local/bin"

# ── start it through the installed CLI lifecycle ───────────────────────────
SQUID_HOME="$HOME/.squid"
CONFIG="$SQUID_HOME/squid.yaml"
SERVER_LOG="$SQUID_HOME/logs/server.log"
START_SCRIPT="$SQUID_HOME/start.sh"
STOP_SCRIPT="$SQUID_HOME/stop.sh"
RESTART_SCRIPT="$SQUID_HOME/restart.sh"
STATUS_SCRIPT="$SQUID_HOME/status.sh"
mkdir -p "$SQUID_HOME/logs"

cat > "$START_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec agentsquid start "$@"
EOF
chmod +x "$START_SCRIPT"

cat > "$STOP_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec agentsquid stop "$@"
EOF
chmod +x "$STOP_SCRIPT"

cat > "$RESTART_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec agentsquid restart "$@"
EOF
chmod +x "$RESTART_SCRIPT"

cat > "$STATUS_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec agentsquid status "$@"
EOF
chmod +x "$STATUS_SCRIPT"

echo ""
LIFECYCLE_LOG=$(mktemp -t agentsquid-lifecycle.XXXXXX)
if [[ "$RESTART_FOR_UPGRADE" == "1" ]]; then
  if run_logged_with_spinner "restarting agentsquid" "$LIFECYCLE_LOG" agentsquid restart; then
    ok "agentsquid restarted"
  else
    fail "could not restart agentsquid"
    sed -n '1,40p' "$LIFECYCLE_LOG" >&2
    rm -f "$LIFECYCLE_LOG"
    exit 1
  fi
else
  if run_logged_with_spinner "starting agentsquid" "$LIFECYCLE_LOG" agentsquid start; then
    ok "agentsquid started"
  else
    fail "could not start agentsquid"
    sed -n '1,40p' "$LIFECYCLE_LOG" >&2
    rm -f "$LIFECYCLE_LOG"
    exit 1
  fi
fi
rm -f "$LIFECYCLE_LOG"

# ~/.squid/squid.yaml is bootstrapped by agent/config.py on first launch, so
# on a brand-new install it doesn't exist until the process above starts.
for i in {1..10}; do
  [[ -f "$CONFIG" ]] && break
  sleep 0.2
done
PORT=$(grep -A5 '^server:' "$CONFIG" 2>/dev/null | grep -m1 'port:' | grep -oE '[0-9]+' || true)
HOST=$(grep -A5 '^server:' "$CONFIG" 2>/dev/null | grep -m1 'host:' | grep -oE '[0-9.]+' || true)
PORT=${PORT:-8000}
HOST=${HOST:-127.0.0.1}

echo -n "  checking agentsquid"
started=0
for i in {1..20}; do
  sleep 0.5
  if curl -sf "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
    started=1
    break
  fi
  echo -n "."
done
echo ""
if [[ "$started" == "1" ]]; then
  ok "agentsquid is up → http://${HOST}:${PORT}"
else
  warn "agentsquid did not respond within 10s — check $SERVER_LOG"
fi

echo ""
echo -e "  ${BOLD}Open:${RESET}  http://${HOST}:${PORT}"
echo -e "  ${BOLD}Active runs:${RESET} let them finish, or use /stop or /stopall in Squid"
echo -e "  ${BOLD}Start app:${RESET} $START_SCRIPT"
echo -e "  ${BOLD}Stop app:${RESET} $STOP_SCRIPT"
echo -e "  ${BOLD}Restart:${RESET}  $RESTART_SCRIPT"
echo -e "  ${BOLD}Status:${RESET}   $STATUS_SCRIPT"
echo -e "  ${BOLD}Config:${RESET} $CONFIG"
echo -e "  ${BOLD}Logs:${RESET}   tail -f $SERVER_LOG"
echo ""

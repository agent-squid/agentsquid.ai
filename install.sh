#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}!${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; }

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
PIPX_PIP_ARGS=()

if [[ -n "$VERSION" ]]; then
  PACKAGE_SPEC="agentsquid==${VERSION}"
  INSTALL_LABEL="${VERSION}"
elif [[ "$ALLOW_PRE" == "1" ]]; then
  INSTALL_LABEL="latest prerelease"
  PIPX_PIP_ARGS=(--pip-args "--pre")
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
      if brew install pipx >"$BREW_LOG" 2>&1; then
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
    python3 -m pip install --user --quiet pipx
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
# package. Unpinned installs keep the normal upgrade-then-install behavior.
echo ""
LOG_FILE=$(mktemp -t agentsquid-install.XXXXXX)
if [[ -n "$VERSION" ]]; then
  if pipx install --force "$PACKAGE_SPEC" >"$LOG_FILE" 2>&1; then
    ok "agentsquid ${VERSION} installed"
  else
    fail "could not install ${PACKAGE_SPEC}"
    sed -n '1,40p' "$LOG_FILE" >&2
    rm -f "$LOG_FILE"
    exit 1
  fi
elif pipx upgrade agentsquid "${PIPX_PIP_ARGS[@]}" >"$LOG_FILE" 2>&1; then
  ok "agentsquid up to date"
else
  if pipx install "$PACKAGE_SPEC" "${PIPX_PIP_ARGS[@]}" >"$LOG_FILE" 2>&1; then
    ok "agentsquid installed"
  else
    fail "could not install ${PACKAGE_SPEC}"
    sed -n '1,40p' "$LOG_FILE" >&2
    rm -f "$LOG_FILE"
    exit 1
  fi
fi
rm -f "$LOG_FILE"

# pipx's shim dir isn't necessarily on PATH yet in this same shell — `pipx
# ensurepath` only edits shell rc files for future shells, it can't affect
# the process already running this script.
export PATH="$PATH:$HOME/.local/bin"

# ── run it, in the background, and print a copy-pasteable URL ───────────────
SQUID_HOME="$HOME/.squid"
CONFIG="$SQUID_HOME/squid.yaml"
PID_FILE="$SQUID_HOME/agentsquid.pid"
BOOT_LOG="$SQUID_HOME/logs/boot.log"
mkdir -p "$SQUID_HOME/logs"

echo ""
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  ALREADY_RUNNING=1
else
  ALREADY_RUNNING=0
  nohup agentsquid >"$BOOT_LOG" 2>&1 &
  echo $! > "$PID_FILE"
fi

# ~/.squid/squid.yaml is bootstrapped by agent/config.py on first launch, so
# on a brand-new install it doesn't exist until the process above starts.
for i in {1..10}; do
  [[ -f "$CONFIG" ]] && break
  sleep 0.2
done
PORT=$(grep -A5 '^server:' "$CONFIG" 2>/dev/null | grep -m1 'port:' | grep -oE '[0-9]+')
HOST=$(grep -A5 '^server:' "$CONFIG" 2>/dev/null | grep -m1 'host:' | grep -oE '[0-9.]+')
PORT=${PORT:-8000}
HOST=${HOST:-127.0.0.1}

if [[ "$ALREADY_RUNNING" == "1" ]]; then
  ok "agentsquid already running (PID $(cat "$PID_FILE")) → http://${HOST}:${PORT}"
else
  echo -n "  starting agentsquid"
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
    warn "agentsquid did not respond within 10s — check $BOOT_LOG"
  fi
fi

echo ""
echo -e "  ${BOLD}Open:${RESET}  http://${HOST}:${PORT}"
echo -e "  ${BOLD}Stop:${RESET}  kill \$(cat $PID_FILE)"
echo ""

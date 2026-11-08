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

INSTALL_ARGS=("$@")

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

# Python used by pipx itself and Python used by agentsquid can differ.
# Always select and pass a compatible interpreter explicitly.
python_ok() {
  "$1" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' >/dev/null 2>&1
}

confirm() (
  local answer
  # Piped installs use stdin for the script; read consent from the terminal.
  # Keep the descriptor in a subshell so it closes on every return path.
  { exec 3<> /dev/tty; } 2>/dev/null || return 1
  [[ -t 3 ]] || return 1
  printf '  %s [Y/n] ' "$1" >&3
  read -r answer <&3 || return 1
  case "$answer" in ""|y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
)

export PATH="$PATH:$HOME/.local/bin"
UV=$(command -v uv || true)
PYTHON=""
APP_PYTHON=""
APP_PRESENT=0
if command -v pipx &>/dev/null; then
  PIPX_VENVS=$(pipx environment --value PIPX_LOCAL_VENVS 2>/dev/null || true)
  if [[ -n "$PIPX_VENVS" ]]; then
    [[ ! -d "$PIPX_VENVS/agentsquid" ]] || APP_PRESENT=1
    APP_PYTHON="$PIPX_VENVS/agentsquid/bin/python"
    if python_ok "$APP_PYTHON"; then PYTHON="$APP_PYTHON"; fi
  fi
fi
if [[ -z "$PYTHON" ]]; then
  for candidate in python3.14 python3.13 python3.12 python3.11 python3.10 python3 python; do
    if command -v "$candidate" &>/dev/null && python_ok "$candidate"; then
      PYTHON=$(command -v "$candidate")
      break
    fi
  done
fi
if [[ -z "$PYTHON" && -n "$UV" ]]; then
  candidate=$("$UV" python find --system --no-python-downloads '>=3.10' 2>/dev/null || true)
  if [[ -n "$candidate" ]] && python_ok "$candidate"; then PYTHON="$candidate"; fi
fi

if [[ -z "$PYTHON" ]]; then
  warn "AgentSquid needs Python 3.10 or newer; no compatible interpreter was found."
  if command -v python3 &>/dev/null; then
    warn "Found $(command -v python3): $(python3 --version 2>&1 || true)"
  fi
  if [[ -n "$UV" ]]; then
    PROMPT="Install Python 3.13 with uv and continue?"
  else
    PROMPT="Install uv and Python 3.13 for AgentSquid?"
  fi
  if confirm "$PROMPT"; then
    if [[ -z "$UV" ]]; then
      UV_INSTALLER=$(mktemp -t agentsquid-uv.XXXXXX)
      if curl -LsSf https://astral.sh/uv/install.sh -o "$UV_INSTALLER" &&
          env UV_INSTALL_DIR="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh "$UV_INSTALLER"; then
        [[ ! -x "$HOME/.local/bin/uv" ]] || UV="$HOME/.local/bin/uv"
      fi
      rm -f "$UV_INSTALLER"
    fi
    if [[ -n "$UV" ]] && "$UV" python install 3.13; then
      candidate=$("$UV" python find --system --no-python-downloads 3.13 2>/dev/null || true)
      if [[ -n "$candidate" ]] && python_ok "$candidate"; then PYTHON="$candidate"; fi
    fi
  fi
fi
if [[ -z "$PYTHON" ]]; then
  fail "Python 3.10+ is required. Install it with uv without replacing system Python:"
  if [[ -z "$UV" ]]; then
    echo '    curl -LsSf https://astral.sh/uv/install.sh | sh'
    echo '    "$HOME/.local/bin/uv" python install 3.13'
  else
    printf '    %q python install 3.13\n' "$UV"
  fi
  echo '  Then download and run the installer at a terminal:'
  echo '    curl -fsSL https://agentsquid.ai/install.sh -o /tmp/agentsquid-install.sh'
  printf '    bash /tmp/agentsquid-install.sh'
  if [[ ${#INSTALL_ARGS[@]} -gt 0 ]]; then printf ' %q' "${INSTALL_ARGS[@]}"; fi
  printf '\n'
  exit 1
fi
ok "Python: $("$PYTHON" --version 2>&1) ($PYTHON)"

if ! command -v pipx &>/dev/null; then
  warn "pipx not found — installing in its own virtualenv"
  PIPX_BOOTSTRAP="$HOME/.local/share/agentsquid-installer/pipx"
  PIPX_LOG=$(mktemp -t agentsquid-pipx.XXXXXX)
  if "$PYTHON" -m venv "$PIPX_BOOTSTRAP" >"$PIPX_LOG" 2>&1 &&
      run_logged_with_spinner "installing pipx" "$PIPX_LOG" "$PIPX_BOOTSTRAP/bin/python" -m pip install --quiet pipx; then
    mkdir -p "$HOME/.local/bin"
    ln -sf "$PIPX_BOOTSTRAP/bin/pipx" "$HOME/.local/bin/pipx"
    pipx ensurepath &>/dev/null || true
    ok "pipx installed"
  else
    fail "Could not install pipx with $PYTHON."
    sed -n '1,40p' "$PIPX_LOG" >&2
    warn "If this Python lacks venv support, install Python 3.13 with uv and retry."
    rm -f "$PIPX_LOG"
    exit 1
  fi
  rm -f "$PIPX_LOG"
else
  ok "pipx found"
fi

# `pipx install` on an already-installed app is a no-op unless forced. Exact
# version installs use --force so rc test installs replace an existing stable
# package. Unpinned installs upgrade only when pipx already has agentsquid.
echo ""
PREVIOUS_VERSION=$(pipx runpip agentsquid show agentsquid 2>/dev/null | awk -F': ' '/^Version:/{print $2; exit}' || true)
LOG_FILE=$(mktemp -t agentsquid-install.XXXXXX)
if [[ "$APP_PRESENT" == "1" || -n "$PREVIOUS_VERSION" ]] && { [[ -z "$APP_PYTHON" ]] || ! python_ok "$APP_PYTHON"; }; then
  warn "Rebuilding agentsquid's pipx environment with compatible Python"
  MIGRATE_ARGS=(reinstall agentsquid --python "$PYTHON")
  # Older pipx versions do not accept --pip-args on reinstall. The
  # subsequent upgrade applies this invocation's prerelease policy.
  if ! run_logged_with_spinner "updating agentsquid Python" "$LOG_FILE" pipx "${MIGRATE_ARGS[@]}"; then
    fail "Could not rebuild agentsquid's Python environment."
    sed -n '1,40p' "$LOG_FILE" >&2
    rm -f "$LOG_FILE"
    exit 1
  fi
fi
if [[ -n "$VERSION" ]]; then
  if run_logged_with_spinner "installing agentsquid ${VERSION}" "$LOG_FILE" pipx install --force --python "$PYTHON" "$PACKAGE_SPEC"; then
    ok "agentsquid ${VERSION} installed"
  else
    fail "could not install ${PACKAGE_SPEC}"
    sed -n '1,40p' "$LOG_FILE" >&2
    rm -f "$LOG_FILE"
    exit 1
  fi
elif [[ "$APP_PRESENT" == "1" || -n "$PREVIOUS_VERSION" ]]; then
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
    run_logged_with_spinner "installing agentsquid" "$LOG_FILE" pipx install --python "$PYTHON" "$PACKAGE_SPEC" --pip-args=--pre && install_ok=1
  else
    install_ok=0
    run_logged_with_spinner "installing agentsquid" "$LOG_FILE" pipx install --python "$PYTHON" "$PACKAGE_SPEC" && install_ok=1
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
RESTART_AFTER_INSTALL=$APP_PRESENT
if [[ -n "$INSTALLED_VERSION" ]]; then
  if [[ -n "$PREVIOUS_VERSION" && "$PREVIOUS_VERSION" != "$INSTALLED_VERSION" ]]; then
    ok "upgraded agentsquid ${PREVIOUS_VERSION} → ${INSTALLED_VERSION}"
    RESTART_AFTER_INSTALL=1
  elif [[ -n "$PREVIOUS_VERSION" ]]; then
    ok "agentsquid already at ${INSTALLED_VERSION}"
    RESTART_AFTER_INSTALL=1
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
mkdir -p "$SQUID_HOME/logs"

echo ""
# `agentsquid start`/`restart` already polls its own health check and prints
# "agentsquid is up -> ..." plus any Tailscale access URLs (see
# _lifecycle_start/_print_tailscale_access in agent/server.py) — run it
# directly rather than capturing it, so that output reaches the user as-is
# instead of being reimplemented (and losing the Tailscale lines) here.
if [[ "$RESTART_AFTER_INSTALL" == "1" ]]; then
  if ! agentsquid restart; then
    fail "could not restart agentsquid"
    exit 1
  fi
else
  if ! agentsquid start; then
    fail "could not start agentsquid"
    exit 1
  fi
fi

echo ""
echo -e "  ${BOLD}Active runs:${RESET} let them finish, or use /stop or /stopall in Squid"
echo -e "  ${BOLD}Start app:${RESET} agentsquid start"
echo -e "  ${BOLD}Stop app:${RESET}  agentsquid stop"
echo -e "  ${BOLD}Restart:${RESET}   agentsquid restart"
echo -e "  ${BOLD}Status:${RESET}    agentsquid status"
echo -e "  ${BOLD}Config:${RESET} $CONFIG"
echo -e "  ${BOLD}Logs:${RESET}   tail -f $SERVER_LOG"
echo ""

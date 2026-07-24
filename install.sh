#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}!${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; }

echo -e "\n${BOLD}agentsquid — install${RESET}\n"

if ! command -v pipx &>/dev/null; then
  warn "pipx not found — installing"
  pipx_ready=0
  # A working `brew` binary doesn't guarantee `brew install` works — a broken
  # Cellar (e.g. ownership reset by an OS update) fails here often enough
  # that a hard stop on brew's error is the wrong default; fall through to
  # the pip-based path instead of leaving pipx (and therefore agentsquid)
  # never installed.
  if command -v brew &>/dev/null && brew install pipx; then
    pipx ensurepath &>/dev/null || true
    pipx_ready=1
  elif command -v python3 &>/dev/null; then
    python3 -m pip install --user --quiet pipx
    python3 -m pipx ensurepath &>/dev/null || true
    export PATH="$PATH:$(python3 -m site --user-base)/bin"
    pipx_ready=1
  fi
  if [[ "$pipx_ready" != "1" ]] || ! command -v pipx &>/dev/null; then
    fail "Could not install pipx automatically."
    fail "Fix Homebrew (see its error above) or install Python 3.9+, then re-run this script."
    fail "Or install pipx yourself: python3 -m pip install --user pipx && python3 -m pipx ensurepath"
    exit 1
  fi
  ok "pipx installed"
else
  ok "pipx found"
fi

# `pipx install` on an already-installed app is a no-op (exit 0) rather than
# an upgrade, so try upgrade first — it exits non-zero only when nothing is
# installed yet, which is exactly the fresh-install case.
echo ""
LOG_FILE=$(mktemp -t agentsquid-install.XXXXXX)
if pipx upgrade agentsquid >"$LOG_FILE" 2>&1; then
  ok "agentsquid up to date"
else
  pipx install agentsquid
  ok "agentsquid installed"
fi
rm -f "$LOG_FILE"

echo ""
echo -e "  ${BOLD}Now running agentsquid…${RESET}"
echo -e "  ${BOLD}Run:${RESET}  agentsquid"
echo ""

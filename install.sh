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
  if command -v brew &>/dev/null; then
    brew install pipx
    pipx ensurepath &>/dev/null || true
  elif command -v python3 &>/dev/null; then
    python3 -m pip install --user --quiet pipx
    python3 -m pipx ensurepath &>/dev/null || true
    export PATH="$PATH:$(python3 -m site --user-base)/bin"
  else
    fail "Python 3 not found — install Python 3.9+ first, then re-run this script"
    exit 1
  fi
  if ! command -v pipx &>/dev/null; then
    fail "pipx installed but not on PATH yet — restart your shell and re-run this script"
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
echo -e "  ${BOLD}Run:${RESET}  agentsquid"
echo ""

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

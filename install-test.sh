#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}!${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; }

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  fail "usage: curl -fsSL https://agentsquid.ai/install-test.sh | sh -s -- <version>"
  exit 1
fi

PACKAGE="agentsquid"
APP_NAME="agentsquid-test"
TMPDIR=$(mktemp -d -t agentsquid-test.XXXXXX)
trap 'rm -rf "$TMPDIR"' EXIT

echo -e "\n${BOLD}agentsquid — install-test (TestPyPI, ${VERSION})${RESET}\n"

if ! command -v pipx &>/dev/null; then
  fail "pipx not found — install pipx first (see install.sh), then re-run this script."
  exit 1
fi
ok "pipx found"

export PATH="$PATH:$HOME/.local/bin"

echo ""
python3 -m pip download \
  --no-deps \
  --only-binary=:all: \
  --index-url https://test.pypi.org/simple/ \
  "${PACKAGE}==${VERSION}" \
  -d "$TMPDIR"
ok "downloaded ${PACKAGE}==${VERSION} from TestPyPI"

WHEEL=$(find "$TMPDIR" -name "${PACKAGE}-${VERSION}-*.whl" -print -quit)
if [[ -z "$WHEEL" ]]; then
  fail "no wheel found for ${PACKAGE}==${VERSION} in TestPyPI download"
  exit 1
fi

pipx install --suffix=-test --force "$WHEEL" >/dev/null
ok "installed as '${APP_NAME}'"

echo ""
pipx runpip "$APP_NAME" show "$PACKAGE"

echo ""
echo -e "  ${BOLD}Installed:${RESET}  ${PACKAGE} ${VERSION} (TestPyPI) as '${APP_NAME}'"
echo -e "  ${BOLD}Run:${RESET}        ${APP_NAME}"
echo -e "  ${BOLD}Remove:${RESET}     pipx uninstall ${APP_NAME}"
echo ""

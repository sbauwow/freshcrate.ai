#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/bootstrap-common.sh
source "${SCRIPT_DIR}/lib/bootstrap-common.sh"

usage() {
  cat <<'EOF'
Usage: bash scripts/bootstrap-salt-local.sh [--bundle BUNDLE] [--mode headless|light-desktop] [--channel stable|beta|nightly]

Seeds /opt/freshcrate/salt and applies local Salt states with salt-call --local when available.
EOF
}

if ! parse_common_args "$@"; then
  usage
  exit 0
fi

SALT_ROOT="${SALT_ROOT:-/opt/freshcrate/salt}"
SALT_STATE_ROOT="${SALT_ROOT}/states"
SALT_PILLAR_ROOT="${SALT_ROOT}/pillar"
RECEIPT_PATH="${FRESHCRATE_HOME}/receipts/salt-local-${BUNDLE}.txt"
REPO_SALT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)/salt"
STATUS="skipped"
DETAIL="salt-call unavailable"

mkdir -p "${FRESHCRATE_HOME}/receipts"
rm -rf "$SALT_ROOT"
mkdir -p "$SALT_STATE_ROOT" "$SALT_PILLAR_ROOT"

if [[ -d "$REPO_SALT_DIR" ]]; then
  cp -a "$REPO_SALT_DIR"/. "$SALT_ROOT"/
fi

if ! command -v salt-call >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  if apt-cache show salt-minion >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    sudo apt-get update -y
    sudo apt-get install -y salt-minion
  else
    DETAIL="salt-minion package unavailable on this image"
  fi
fi

if command -v salt-call >/dev/null 2>&1; then
  salt-call --local \
    --file-root="$SALT_STATE_ROOT" \
    --pillar-root="$SALT_PILLAR_ROOT" \
    state.apply
  STATUS="applied"
  DETAIL="salt local states applied"
fi

write_text_file "$RECEIPT_PATH" <<EOF
bundle=${BUNDLE}
mode=${MODE}
channel=${CHANNEL}
status=${STATUS}
salt_root=${SALT_ROOT}
detail=${DETAIL}
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

log "salt-local status=${STATUS} receipt=${RECEIPT_PATH}"

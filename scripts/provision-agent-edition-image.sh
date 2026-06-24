#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/bootstrap-common.sh
source "${SCRIPT_DIR}/lib/bootstrap-common.sh"
BUNDLE="${1:-solo-builder-core}"
MODE="${2:-headless}"
CHANNEL="${3:-stable}"
IMAGE_KIND="${4:-generic-image}"
ROOTFS_MANIFEST_PATH="${5:-}"
ROOTFS_RECEIPT_PATH="${6:-}"
FRESHCRATE_HOME="${FRESHCRATE_HOME:-/opt/freshcrate/home}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/opt/freshcrate/workspace}"

mkdir -p /opt/freshcrate
chmod +x "${SCRIPT_DIR}/bootstrap-agent-edition.sh" "${SCRIPT_DIR}/bootstrap-salt-local.sh" "${SCRIPT_DIR}/verify-agent-edition.sh"

if [[ -n "$ROOTFS_MANIFEST_PATH" && -f "$ROOTFS_MANIFEST_PATH" ]]; then
  mkdir -p /opt/freshcrate/rootfs-contract
  if [[ "$ROOTFS_MANIFEST_PATH" != "/opt/freshcrate/rootfs-contract/package-manifest.txt" ]]; then
    cp "$ROOTFS_MANIFEST_PATH" /opt/freshcrate/rootfs-contract/package-manifest.txt
  fi
fi

if [[ -n "$ROOTFS_RECEIPT_PATH" && -f "$ROOTFS_RECEIPT_PATH" ]]; then
  mkdir -p /opt/freshcrate/rootfs-contract
  if [[ "$ROOTFS_RECEIPT_PATH" != "/opt/freshcrate/rootfs-contract/image-build-receipt.txt" ]]; then
    cp "$ROOTFS_RECEIPT_PATH" /opt/freshcrate/rootfs-contract/image-build-receipt.txt
  fi
fi

bash "${SCRIPT_DIR}/bootstrap-agent-edition.sh" \
  --bundle "${BUNDLE}" \
  --mode "${MODE}" \
  --channel "${CHANNEL}" \
  --freshcrate-home "${FRESHCRATE_HOME}" \
  --workspace-dir "${WORKSPACE_DIR}"

bash "${SCRIPT_DIR}/bootstrap-salt-local.sh" \
  --bundle "${BUNDLE}" \
  --mode "${MODE}" \
  --channel "${CHANNEL}" \
  --freshcrate-home "${FRESHCRATE_HOME}" \
  --workspace-dir "${WORKSPACE_DIR}"

bash "${SCRIPT_DIR}/verify-agent-edition.sh" \
  --bundle "${BUNDLE}" \
  --mode "${MODE}" \
  --channel "${CHANNEL}" \
  --freshcrate-home "${FRESHCRATE_HOME}" \
  --workspace-dir "${WORKSPACE_DIR}"

write_text_file /opt/freshcrate/image-build-receipt.txt <<EOF
image_kind=${IMAGE_KIND}
bundle=${BUNDLE}
mode=${MODE}
channel=${CHANNEL}
freshcrate_home=${FRESHCRATE_HOME}
workspace_dir=${WORKSPACE_DIR}
rootfs_manifest_path=${ROOTFS_MANIFEST_PATH:-none}
rootfs_receipt_path=${ROOTFS_RECEIPT_PATH:-none}
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

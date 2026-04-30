#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ISO_PATH="${ROOT_DIR}/output/iso-live-persistent-x86_64/freshcrate-solo-builder-core-stable.iso"
TIMEOUT_SECONDS=180
MEMORY_MB=4096
CPUS=2
PERSISTENCE_SIZE="8G"
LOG_DIR="${ROOT_DIR}/output/qemu-live-usb-smoke"
KEEP_WORKDIR=0

usage() {
  cat <<'EOF'
Usage: bash scripts/qemu-smoke-test-live-usb.sh [options]

Boot the freshcrate persistent live USB ISO in QEMU and verify that it reaches
bootloader/kernel/live-userland output on the serial console with `persistent`
enabled and a writable casper-rw disk attached.

Options:
  --iso PATH               ISO path
  --timeout SECONDS        Boot timeout              (default: 180)
  --memory MB              Guest RAM                 (default: 4096)
  --cpus N                 vCPUs                     (default: 2)
  --persistence-size SIZE  casper-rw disk size       (default: 8G)
  --log-dir DIR            Output log dir
  --keep-workdir           Keep temp disks for inspection
  -h, --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --iso) ISO_PATH="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    --memory) MEMORY_MB="${2:-}"; shift 2 ;;
    --cpus) CPUS="${2:-}"; shift 2 ;;
    --persistence-size) PERSISTENCE_SIZE="${2:-}"; shift 2 ;;
    --log-dir) LOG_DIR="${2:-}"; shift 2 ;;
    --keep-workdir) KEEP_WORKDIR=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_cmd qemu-system-x86_64
require_cmd qemu-img
require_cmd mkfs.ext4
require_cmd timeout
require_cmd grep
require_cmd tee
[[ -f "$ISO_PATH" ]] || { echo "missing ISO: $ISO_PATH" >&2; exit 1; }

mkdir -p "$LOG_DIR"
WORKDIR="$(mktemp -d)"
PERSISTENCE_DISK="${WORKDIR}/casper-rw.img"
LOG_FILE="${LOG_DIR}/live-usb-smoke.log"

cleanup() {
  if [[ "$KEEP_WORKDIR" -eq 0 && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

qemu-img create -f raw "$PERSISTENCE_DISK" "$PERSISTENCE_SIZE" >/dev/null
mkfs.ext4 -F -L casper-rw "$PERSISTENCE_DISK" >/dev/null 2>&1

echo "==> Live USB smoke test"
echo "    iso:         $ISO_PATH"
echo "    persistence: $PERSISTENCE_DISK"
echo "    workdir:     $WORKDIR"
echo "    log:         $LOG_FILE"

set +e
timeout --signal=TERM --kill-after=15s "${TIMEOUT_SECONDS}s" \
  qemu-system-x86_64 \
    -machine q35,accel=tcg \
    -m "$MEMORY_MB" \
    -smp "$CPUS" \
    -boot order=d \
    -cdrom "$ISO_PATH" \
    -drive "file=${PERSISTENCE_DISK},if=virtio,format=raw" \
    -netdev user,id=n1 \
    -device virtio-net-pci,netdev=n1 \
    -nographic \
    -serial mon:stdio \
    -monitor none \
    -no-reboot \
    2>&1 | tee "$LOG_FILE"
QEMU_STATUS=${PIPESTATUS[0]}
set -e

patterns=(
  'GNU GRUB'
  'Loading Linux'
  'Linux version '
  'Ubuntu'
  'cloud-init'
  'casper'
  'persistent'
  'Reached target .*Login Prompts'
)

matched=1
for pat in "${patterns[@]}"; do
  if grep -Eiq "$pat" "$LOG_FILE"; then
    matched=0
    break
  fi
done

if [[ "$matched" -ne 0 ]]; then
  echo "No expected live USB boot markers found." >&2
  echo "Last 120 log lines:" >&2
  tail -n 120 "$LOG_FILE" >&2 || true
  exit 1
fi

case "$QEMU_STATUS" in
  0|124|137)
    ;;
  *)
    echo "qemu exited with status $QEMU_STATUS" >&2
    exit 1
    ;;
esac

echo
echo "Live USB smoke test: PASS"
echo "Log: $LOG_FILE"

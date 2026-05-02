#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ISO_PATH="${ROOT_DIR}/output/iso-live-persistent-x86_64/freshcrate-solo-builder-core-stable.iso"
BOOT_TIMEOUT=600
MEMORY_MB=4096
CPUS=2
PERSISTENCE_SIZE="8G"
LOG_DIR="${ROOT_DIR}/output/qemu-live-usb-verify"
KEEP_WORKDIR=0

usage() {
  cat <<'EOF'
Usage: bash scripts/qemu-verify-live-usb-persistence.sh [options]

Boot the freshcrate persistent live USB ISO twice in QEMU.
The verifier relies on the live lane's embedded NoCloud datasource at
`/cdrom/nocloud/`, reuses one writable `casper-rw` disk across both boots,
and fails unless the second boot reports `boot_count=2` with the bootstrap
state still present.

Options:
  --iso PATH               ISO path
  --boot-timeout SECONDS   Per-boot timeout          (default: 600)
  --memory MB              Guest RAM                 (default: 4096)
  --cpus N                 vCPUs                     (default: 2)
  --persistence-size SIZE  casper-rw disk size       (default: 8G)
  --log-dir DIR            Output log dir
  --keep-workdir           Keep temp artifacts for inspection
  -h, --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --iso) ISO_PATH="${2:-}"; shift 2 ;;
    --boot-timeout) BOOT_TIMEOUT="${2:-}"; shift 2 ;;
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

run_boot() {
  local log_file="$1"

  set +e
  timeout --signal=TERM --kill-after=20s "${BOOT_TIMEOUT}s" \
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
      2>&1 | tee "$log_file"
  local qemu_status=${PIPESTATUS[0]}
  set -e

  case "$qemu_status" in
    0|124|137)
      ;;
    *)
      echo "qemu exited with status $qemu_status" >&2
      return 1
      ;;
  esac
}

assert_log_marker() {
  local log_file="$1"
  local pattern="$2"
  if ! grep -Fq "$pattern" "$log_file"; then
    echo "missing marker '$pattern' in $log_file" >&2
    echo "Last 160 log lines:" >&2
    tail -n 160 "$log_file" >&2 || true
    exit 1
  fi
}

PERSISTENCE_UPPER_PREFIX="upper/var/lib/freshcrate-live"

read_persistence_file() {
  local relative_path="$1"
  debugfs -R "cat /${relative_path}" "$PERSISTENCE_DISK" 2>/dev/null || true
}

persistence_file_exists() {
  local relative_path="$1"
  debugfs -R "stat /${relative_path}" "$PERSISTENCE_DISK" >/dev/null 2>&1
}

assert_persistence_state() {
  local expected_boot_count="$1"
  local require_marker="$2"
  local boot_count_path="${PERSISTENCE_UPPER_PREFIX}/boot-count"
  local marker_path="${PERSISTENCE_UPPER_PREFIX}/bootstrap-complete"
  local log_path="${PERSISTENCE_UPPER_PREFIX}/bootstrap.log"
  local boot_count
  boot_count="$(read_persistence_file "$boot_count_path" | tr -d '\r' | tr -d '\n')"
  local log_tail
  log_tail="$(read_persistence_file "$log_path" | tail -n 40 2>/dev/null || true)"
  echo "persistence path=/${PERSISTENCE_UPPER_PREFIX} boot-count=${boot_count:-missing} marker=$([[ $(persistence_file_exists "$marker_path"; echo $?) -eq 0 ]] && echo present || echo missing)"
  if [[ "$boot_count" != "$expected_boot_count" ]]; then
    echo "unexpected persistence boot-count at /${boot_count_path}: expected $expected_boot_count got ${boot_count:-missing}" >&2
    exit 1
  fi
  if [[ "$require_marker" == "yes" ]] && ! persistence_file_exists "$marker_path"; then
    echo "missing persistence marker at /${marker_path}" >&2
    exit 1
  fi
  if [[ -n "$log_tail" ]]; then
    printf '%s\n' "$log_tail"
  fi
}

require_cmd qemu-system-x86_64
require_cmd qemu-img
require_cmd mkfs.ext4
require_cmd e2label
require_cmd timeout
require_cmd grep
require_cmd tee
[[ -f "$ISO_PATH" ]] || { echo "missing ISO: $ISO_PATH" >&2; exit 1; }

mkdir -p "$LOG_DIR"
WORKDIR="$(mktemp -d)"
PERSISTENCE_DISK="${WORKDIR}/casper-rw.img"
BOOT1_LOG="${LOG_DIR}/boot-1.log"
BOOT2_LOG="${LOG_DIR}/boot-2.log"

cleanup() {
  if [[ "$KEEP_WORKDIR" -eq 0 && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

qemu-img create -f raw "$PERSISTENCE_DISK" "$PERSISTENCE_SIZE" >/dev/null
mkfs.ext4 -F "$PERSISTENCE_DISK" >/dev/null 2>&1
e2label "$PERSISTENCE_DISK" casper-rw >/dev/null 2>&1
rm -f "$BOOT1_LOG" "$BOOT2_LOG"

echo "==> Boot 1: exercise embedded nocloud live bootstrap"
echo "    source iso:  $ISO_PATH"
echo "    persistence: $PERSISTENCE_DISK"
echo "    datasource:  /cdrom/nocloud/"
echo "    log:         $BOOT1_LOG"
run_boot "$BOOT1_LOG"
assert_log_marker "$BOOT1_LOG" "cloud-init-local.service"
assert_persistence_state "1" "no"

echo "==> Boot 2: verify persisted state survives reboot"
echo "    log: $BOOT2_LOG"
run_boot "$BOOT2_LOG"
assert_persistence_state "2" "yes"

echo
echo "Live USB persistence verification: PASS"
echo "Boot 1 log: $BOOT1_LOG"
echo "Boot 2 log: $BOOT2_LOG"
echo "Expected markers: boot_count=1 -> boot_count=2"

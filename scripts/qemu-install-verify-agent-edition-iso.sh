#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ISO_PATH="${ROOT_DIR}/output/iso-autoinstall-headless/freshcrate-solo-builder-core-stable.iso"
INSTALL_TIMEOUT=2400
FIRST_BOOT_TIMEOUT=180
MEMORY_MB=4096
CPUS=2
DISK_SIZE="20G"
LOG_DIR="${ROOT_DIR}/output/qemu-install-verify"
SSH_PORT=2222
KEEP_WORKDIR=0
BUNDLE="solo-builder-core"
MODE="headless"
CHANNEL="stable"
FRESHCRATE_HOME="/opt/freshcrate/home"
WORKSPACE_DIR="/opt/freshcrate/workspace"

usage() {
  cat <<'EOF'
Usage: bash scripts/qemu-install-verify-agent-edition-iso.sh [options]

Runs an end-to-end QEMU verification for the freshcrate Agent Edition ISO:
1. boots the ISO and waits for autoinstall to finish writing the target disk
2. mounts the installed root filesystem and verifies freshcrate receipts/files
3. injects a temporary SSH key into the installed disk
4. boots from disk only and verifies first boot + SSH + receipt contents

Options:
  --iso PATH                 ISO path
  --install-timeout SEC      Installer phase timeout    (default: 2400)
  --boot-timeout SEC         First-boot SSH timeout     (default: 180)
  --memory MB                Guest RAM                  (default: 4096)
  --cpus N                   vCPUs                      (default: 2)
  --disk-size SIZE           Install target disk        (default: 20G)
  --log-dir DIR              Output log dir
  --ssh-port PORT            Host forwarded SSH port    (default: 2222)
  --keep-workdir             Keep temp disk / mounts / keys for inspection
  -h, --help                 Show this help

Important:
  This script uses sudo for loop setup and mounts. Run `sudo -v` first so
  subsequent `sudo -n` calls succeed non-interactively.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --iso) ISO_PATH="${2:-}"; shift 2 ;;
    --install-timeout) INSTALL_TIMEOUT="${2:-}"; shift 2 ;;
    --boot-timeout) FIRST_BOOT_TIMEOUT="${2:-}"; shift 2 ;;
    --memory) MEMORY_MB="${2:-}"; shift 2 ;;
    --cpus) CPUS="${2:-}"; shift 2 ;;
    --disk-size) DISK_SIZE="${2:-}"; shift 2 ;;
    --log-dir) LOG_DIR="${2:-}"; shift 2 ;;
    --ssh-port) SSH_PORT="${2:-}"; shift 2 ;;
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

ensure_sudo_ready() {
  sudo -n true >/dev/null 2>&1 || {
    echo "sudo credentials not cached. Run: sudo -v" >&2
    exit 1
  }
}

find_root_partition() {
  local loopdev="$1"
  local rootdev
  rootdev="$(lsblk -rno PATH,FSTYPE,SIZE "$loopdev" | awk '$2 == "ext4" { print $1 " " $3 }' | sort -k2 -h | tail -n1 | awk '{print $1}')"
  [[ -n "$rootdev" ]] || return 1
  printf '%s\n' "$rootdev"
}

wait_for_ssh() {
  local key_path="$1"
  local timeout_seconds="$2"
  local start now
  start="$(date +%s)"
  while true; do
    set +e
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
      -i "$key_path" -p "$SSH_PORT" freshcrate@127.0.0.1 true >/dev/null 2>&1
    local ssh_status=$?
    set -e
    if [[ "$ssh_status" -eq 0 ]]; then
      return 0
    fi
    now="$(date +%s)"
    if (( now - start >= timeout_seconds )); then
      return 1
    fi
    sleep 5
  done
}

require_cmd qemu-system-x86_64
require_cmd qemu-img
require_cmd timeout
require_cmd ssh
require_cmd ssh-keygen
require_cmd lsblk
require_cmd losetup
require_cmd mount
require_cmd umount
require_cmd awk
require_cmd grep
ensure_sudo_ready
[[ -f "$ISO_PATH" ]] || { echo "missing ISO: $ISO_PATH" >&2; exit 1; }

mkdir -p "$LOG_DIR"
WORKDIR="$(mktemp -d)"
(
  while true; do
    sudo -n true >/dev/null 2>&1 || exit 0
    sleep 60
  done
) &
SUDO_KEEPALIVE_PID=$!
INSTALL_LOG="${LOG_DIR}/install.log"
FIRST_BOOT_LOG="${LOG_DIR}/first-boot.log"
DISK="${WORKDIR}/install.img"
MOUNT_DIR="${WORKDIR}/mnt"
KEY_PATH="${WORKDIR}/freshcrate-test-key"
LOOPDEV=""
QEMU_PID=""
SUDO_KEEPALIVE_PID=""

cleanup() {
  set +e
  if [[ -n "$SUDO_KEEPALIVE_PID" ]] && kill -0 "$SUDO_KEEPALIVE_PID" >/dev/null 2>&1; then
    kill "$SUDO_KEEPALIVE_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$QEMU_PID" ]] && kill -0 "$QEMU_PID" >/dev/null 2>&1; then
    kill "$QEMU_PID" >/dev/null 2>&1 || true
    sleep 2
    kill -9 "$QEMU_PID" >/dev/null 2>&1 || true
  fi
  if mountpoint -q "$MOUNT_DIR"; then
    sudo -n umount "$MOUNT_DIR" >/dev/null 2>&1 || true
  fi
  if [[ -n "$LOOPDEV" ]]; then
    sudo -n losetup -d "$LOOPDEV" >/dev/null 2>&1 || true
  fi
  if [[ "$KEEP_WORKDIR" -eq 0 && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

truncate -s "$DISK_SIZE" "$DISK"
mkdir -p "$MOUNT_DIR"
ssh-keygen -q -t ed25519 -N '' -f "$KEY_PATH" >/dev/null

echo "==> Phase 1: autoinstall to disk"
echo "    iso:  $ISO_PATH"
echo "    log:  $INSTALL_LOG"
echo "    disk: $DISK"
set +e
yes '' | timeout --signal=TERM --kill-after=20s "${INSTALL_TIMEOUT}s" \
  qemu-system-x86_64 \
    -machine q35,accel=tcg \
    -m "$MEMORY_MB" \
    -smp "$CPUS" \
    -boot once=d \
    -cdrom "$ISO_PATH" \
    -drive "file=${DISK},if=virtio,format=raw" \
    -netdev user,id=n1 \
    -device virtio-net-pci,netdev=n1 \
    -nographic \
    -serial stdio \
    -monitor none \
    -no-reboot \
    2>&1 | tee "$INSTALL_LOG"
INSTALL_STATUS=${PIPESTATUS[1]}
set -e

echo "==> Phase 2: inspect installed disk"
LOOPDEV="$(sudo -n losetup --find --show -Pf "$DISK")"
ROOT_PART="$(find_root_partition "$LOOPDEV" || true)"
[[ -n "$ROOT_PART" ]] || { echo "could not locate ext4 root partition on $LOOPDEV" >&2; exit 1; }
sudo -n mount "$ROOT_PART" "$MOUNT_DIR"

[[ -f "$MOUNT_DIR/opt/freshcrate/image-build-receipt.txt" ]] || { echo "missing image build receipt" >&2; exit 1; }
[[ -f "$MOUNT_DIR${FRESHCRATE_HOME}/receipts/bootstrap-${BUNDLE}.txt" ]] || { echo "missing bootstrap receipt" >&2; exit 1; }
[[ -f "$MOUNT_DIR${FRESHCRATE_HOME}/receipts/verify-${BUNDLE}.txt" ]] || { echo "missing verify receipt" >&2; exit 1; }
grep -q '^fail_count=0$' "$MOUNT_DIR${FRESHCRATE_HOME}/receipts/verify-${BUNDLE}.txt" || {
  echo "verify receipt reports failures" >&2
  cat "$MOUNT_DIR${FRESHCRATE_HOME}/receipts/verify-${BUNDLE}.txt" >&2
  exit 1
}
grep -q '^hostname: freshcrate-agent-edition$' "$MOUNT_DIR/etc/cloud/cloud.cfg.d/subiquity-disable-cloudinit-networking.cfg" 2>/dev/null || true

sudo -n mkdir -p "$MOUNT_DIR/home/freshcrate/.ssh"
sudo -n cp "$KEY_PATH.pub" "$MOUNT_DIR/home/freshcrate/.ssh/authorized_keys"
sudo -n chown -R 1000:1000 "$MOUNT_DIR/home/freshcrate/.ssh"
sudo -n chmod 700 "$MOUNT_DIR/home/freshcrate/.ssh"
sudo -n chmod 600 "$MOUNT_DIR/home/freshcrate/.ssh/authorized_keys"
sudo -n umount "$MOUNT_DIR"
sudo -n losetup -d "$LOOPDEV"
LOOPDEV=""

echo "==> Phase 3: first boot from installed disk + SSH verification"
echo "    log: $FIRST_BOOT_LOG"
qemu-system-x86_64 \
  -machine q35,accel=tcg \
  -m "$MEMORY_MB" \
  -smp "$CPUS" \
  -drive "file=${DISK},if=virtio,format=raw" \
  -netdev "user,id=n1,hostfwd=tcp:127.0.0.1:${SSH_PORT}-:22" \
  -device virtio-net-pci,netdev=n1 \
  -nographic \
  -serial mon:stdio \
  >"$FIRST_BOOT_LOG" 2>&1 &
QEMU_PID=$!

if ! wait_for_ssh "$KEY_PATH" "$FIRST_BOOT_TIMEOUT"; then
  echo "SSH did not become reachable on port ${SSH_PORT} within ${FIRST_BOOT_TIMEOUT}s" >&2
  tail -n 120 "$FIRST_BOOT_LOG" >&2 || true
  exit 1
fi

SSH_BASE=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -i "$KEY_PATH" -p "$SSH_PORT" freshcrate@127.0.0.1)
"${SSH_BASE[@]}" "test -f /opt/freshcrate/image-build-receipt.txt"
"${SSH_BASE[@]}" "test -f ${FRESHCRATE_HOME}/receipts/bootstrap-${BUNDLE}.txt"
"${SSH_BASE[@]}" "test -f ${FRESHCRATE_HOME}/receipts/verify-${BUNDLE}.txt"
REMOTE_VERIFY="$(${SSH_BASE[@]} "cat ${FRESHCRATE_HOME}/receipts/verify-${BUNDLE}.txt")"
printf '%s
' "$REMOTE_VERIFY" | grep -q '^fail_count=0$'

IMAGE_RECEIPT="$(${SSH_BASE[@]} 'cat /opt/freshcrate/image-build-receipt.txt')"
BOOTSTRAP_RECEIPT="$(${SSH_BASE[@]} "cat ${FRESHCRATE_HOME}/receipts/bootstrap-${BUNDLE}.txt")"

echo
printf 'Install phase status: %s\n' "$INSTALL_STATUS"
printf 'Root partition: %s\n' "$ROOT_PART"
printf 'SSH verification: PASS on port %s\n' "$SSH_PORT"
printf 'Install log: %s\n' "$INSTALL_LOG"
printf 'First boot log: %s\n' "$FIRST_BOOT_LOG"
printf 'Remote image receipt:\n%s\n' "$IMAGE_RECEIPT"
printf 'Remote bootstrap receipt:\n%s\n' "$BOOTSTRAP_RECEIPT"
printf 'Remote verify receipt:\n%s\n' "$REMOTE_VERIFY"

echo
echo "End-to-end install verification passed."

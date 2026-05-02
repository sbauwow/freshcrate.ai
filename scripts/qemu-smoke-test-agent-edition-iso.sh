#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ISO_PATH="${ROOT_DIR}/output/iso-autoinstall-headless/freshcrate-solo-builder-core-stable.iso"
FIRMWARE="both"
TIMEOUT_SECONDS=120
MEMORY_MB=4096
CPUS=2
DISK_SIZE="20G"
LOG_DIR="${ROOT_DIR}/output/qemu-smoke"
KEEP_WORKDIR=0

usage() {
  cat <<'EOF'
Usage: bash scripts/qemu-smoke-test-agent-edition-iso.sh [options]

Boot the freshcrate autoinstall ISO in QEMU and verify that it reaches
bootloader/kernel/installer output on the serial console.

Options:
  --iso PATH             ISO path
  --firmware MODE        bios | uefi | both   (default: both)
  --timeout SECONDS      Per-boot timeout     (default: 120)
  --memory MB            Guest RAM            (default: 4096)
  --cpus N               vCPUs                (default: 2)
  --disk-size SIZE       Install target disk  (default: 20G)
  --log-dir DIR          Output log dir
  --keep-workdir         Keep temp disks / OVMF vars for inspection
  -h, --help             Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --iso) ISO_PATH="${2:-}"; shift 2 ;;
    --firmware) FIRMWARE="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    --memory) MEMORY_MB="${2:-}"; shift 2 ;;
    --cpus) CPUS="${2:-}"; shift 2 ;;
    --disk-size) DISK_SIZE="${2:-}"; shift 2 ;;
    --log-dir) LOG_DIR="${2:-}"; shift 2 ;;
    --keep-workdir) KEEP_WORKDIR=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    return 1
  }
}

find_ovmf_code() {
  local candidates=(
    /usr/share/OVMF/OVMF_CODE.fd
    /usr/share/OVMF/OVMF_CODE_4M.fd
    /usr/share/edk2/ovmf/OVMF_CODE.fd
    /usr/share/edk2-ovmf/x64/OVMF_CODE.fd
  )
  local p
  for p in "${candidates[@]}"; do
    [[ -f "$p" ]] && { printf '%s\n' "$p"; return 0; }
  done
  return 1
}

find_ovmf_vars() {
  local candidates=(
    /usr/share/OVMF/OVMF_VARS.fd
    /usr/share/OVMF/OVMF_VARS_4M.fd
    /usr/share/edk2/ovmf/OVMF_VARS.fd
    /usr/share/edk2-ovmf/x64/OVMF_VARS.fd
  )
  local p
  for p in "${candidates[@]}"; do
    [[ -f "$p" ]] && { printf '%s\n' "$p"; return 0; }
  done
  return 1
}

ensure_dep_hints() {
  if ! command -v qemu-system-x86_64 >/dev/null 2>&1; then
    echo "qemu-system-x86_64 is missing." >&2
    echo "Install with: sudo apt-get update && sudo apt-get install -y qemu-system-x86 ovmf" >&2
    exit 1
  fi
  require_cmd timeout
  require_cmd grep
  require_cmd truncate
  require_cmd tee
}

run_one() {
  local mode="$1"
  local workdir="$2"
  local logfile="${LOG_DIR}/${mode}.log"
  local disk="${workdir}/${mode}.img"
  local ovmf_code=""
  local ovmf_vars=""
  local ovmf_vars_copy=""
  local -a qemu_args

  truncate -s "$DISK_SIZE" "$disk"
  qemu_args=(
    -machine q35,accel=tcg
    -m "$MEMORY_MB"
    -smp "$CPUS"
    -boot order=d
    -cdrom "$ISO_PATH"
    -drive "file=${disk},if=virtio,format=raw"
    -netdev user,id=n1
    -device virtio-net-pci,netdev=n1
    -nographic
    -serial mon:stdio
    -no-reboot
  )

  if [[ "$mode" == "uefi" ]]; then
    ovmf_code="$(find_ovmf_code || true)"
    ovmf_vars="$(find_ovmf_vars || true)"
    [[ -n "$ovmf_code" && -n "$ovmf_vars" ]] || {
      echo "OVMF firmware files not found for UEFI smoke test." >&2
      echo "Expected ovmf package. Install with: sudo apt-get install -y ovmf" >&2
      return 1
    }
    ovmf_vars_copy="${workdir}/OVMF_VARS.fd"
    cp "$ovmf_vars" "$ovmf_vars_copy"
    qemu_args+=(
      -drive "if=pflash,format=raw,readonly=on,file=${ovmf_code}"
      -drive "if=pflash,format=raw,file=${ovmf_vars_copy}"
    )
  fi

  echo "==> ${mode^^} smoke test"
  echo "    log:  $logfile"
  echo "    disk: $disk"

  set +e
  timeout --signal=TERM --kill-after=10s "${TIMEOUT_SECONDS}s" \
    qemu-system-x86_64 "${qemu_args[@]}" 2>&1 | tee "$logfile"
  local cmd_status=${PIPESTATUS[0]}
  set -e

  local patterns=(
    'GNU GRUB'
    'Ubuntu Server'
    'Loading Linux'
    'Linux version '
    'cloud-init'
    'subiquity'
    'starting installer'
    'Reached target .*Login Prompts'
  )

  local matched=1
  local pat
  for pat in "${patterns[@]}"; do
    if grep -Eiq "$pat" "$logfile"; then
      matched=0
      break
    fi
  done

  if [[ $matched -ne 0 ]]; then
    echo "No expected boot/installer markers found in ${mode} log." >&2
    echo "Last 80 log lines:" >&2
    tail -n 80 "$logfile" >&2 || true
    return 1
  fi

  case "$cmd_status" in
    0|124|137)
      echo "${mode}: PASS"
      ;;
    *)
      echo "${mode}: qemu exited with status ${cmd_status}" >&2
      return 1
      ;;
  esac
}

ensure_dep_hints
[[ -f "$ISO_PATH" ]] || { echo "missing ISO: $ISO_PATH" >&2; exit 1; }
[[ "$FIRMWARE" =~ ^(bios|uefi|both)$ ]] || { echo "invalid --firmware value: $FIRMWARE" >&2; exit 1; }
mkdir -p "$LOG_DIR"
WORKDIR="$(mktemp -d)"
cleanup() {
  if [[ "$KEEP_WORKDIR" -eq 0 && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

modes=()
case "$FIRMWARE" in
  bios) modes=(bios) ;;
  uefi) modes=(uefi) ;;
  both) modes=(bios uefi) ;;
esac

for mode in "${modes[@]}"; do
  run_one "$mode" "$WORKDIR"
done

echo
printf 'Smoke test passed for: %s\n' "${modes[*]}"
printf 'Logs: %s\n' "$LOG_DIR"

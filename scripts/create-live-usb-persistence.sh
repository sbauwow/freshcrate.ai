#!/usr/bin/env bash
set -euo pipefail

DEVICE=""
SIZE=""
DRY_RUN=0
YES=0
LABEL="casper-rw"

usage() {
  cat <<'EOF'
Usage: bash scripts/create-live-usb-persistence.sh --device /dev/sdX [options]

Create an ext4 persistence partition for the freshcrate live USB lane.
The script finds the last free span on the device, creates a new partition,
formats it ext4, and labels it casper-rw for Ubuntu casper persistence.

Options:
  --device PATH     Target whole-disk device (required), e.g. /dev/sdb
  --size SIZE       Partition size to carve from the end of the last free span
                    (examples: 8G, 40G, 16384M). Default: use all remaining free space.
  --label LABEL     Filesystem label (default: casper-rw)
  --dry-run         Print the computed plan and shell commands, but do not modify disk
  --yes             Execute without an additional confirmation gate
  -h, --help        Show this help

Examples:
  bash scripts/create-live-usb-persistence.sh --device /dev/sdb --size 40G --dry-run
  bash scripts/create-live-usb-persistence.sh --device /dev/sdb --size 40G --yes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) DEVICE="${2:-}"; shift 2 ;;
    --size) SIZE="${2:-}"; shift 2 ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$DEVICE" ]] || { echo "--device is required" >&2; usage; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

for cmd in lsblk findmnt parted python3 mkfs.ext4 e2label partprobe udevadm awk sed grep; do
  require_cmd "$cmd"
done

[[ -b "$DEVICE" ]] || { echo "not a block device: $DEVICE" >&2; exit 1; }

if [[ "$(lsblk -dn -o TYPE "$DEVICE" 2>/dev/null || true)" != "disk" ]]; then
  echo "device must be a whole-disk node, not a partition: $DEVICE" >&2
  exit 1
fi

ROOT_SOURCE="$(findmnt -n -o SOURCE / 2>/dev/null || true)"
if [[ -n "$ROOT_SOURCE" && "$ROOT_SOURCE" == "$DEVICE"* ]]; then
  echo "refusing to partition the current root device: $DEVICE" >&2
  exit 1
fi

if findmnt -rn -S "$DEVICE" >/dev/null 2>&1; then
  echo "refusing to operate on a mounted whole device: $DEVICE" >&2
  exit 1
fi

if lsblk -nrpo NAME,MOUNTPOINT "$DEVICE" | awk 'NF > 1 && $2 != "" { found=1 } END { exit(found ? 0 : 1) }'; then
  echo "warning: one or more partitions on $DEVICE are mounted" >&2
  echo "unmount them before running this helper" >&2
  lsblk -nrpo NAME,MOUNTPOINT "$DEVICE" >&2 || true
  exit 1
fi

PARTED_FREE="$(parted -s "$DEVICE" unit MiB print free)"
EXPORTS="$(python3 - "$DEVICE" "$SIZE" <<'PY'
import re
import subprocess
import sys
from pathlib import Path

device = sys.argv[1]
size_arg = sys.argv[2]
text = subprocess.check_output(["parted", "-s", device, "unit", "MiB", "print", "free"], text=True)
lines = [line.rstrip() for line in text.splitlines() if line.strip()]
free_spans = []
for line in lines:
    if "Free Space" not in line:
        continue
    matches = re.findall(r'([0-9]+(?:\.[0-9]+)?)MiB', line)
    if len(matches) < 2:
        continue
    start = float(matches[0])
    end = float(matches[1])
    if end > start:
        free_spans.append((start, end, line.strip()))
if not free_spans:
    print("ERROR=no_free_span")
    sys.exit(0)
start, end, raw = free_spans[-1]
free_size = end - start
if free_size < 128:
    print("ERROR=free_span_too_small")
    print(f"FREE_START={start:.2f}")
    print(f"FREE_END={end:.2f}")
    print(f"FREE_SIZE={free_size:.2f}")
    sys.exit(0)

def parse_size_to_mib(value: str) -> float:
    value = value.strip().upper()
    m = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)([KMGTP]?I?B?)', value)
    if not m:
        raise SystemExit("ERROR=bad_size")
    number = float(m.group(1))
    unit = m.group(2) or 'MIB'
    if unit in ('M', 'MB', 'MIB', ''):
        return number
    if unit in ('G', 'GB', 'GIB'):
        return number * 1024
    if unit in ('T', 'TB', 'TIB'):
        return number * 1024 * 1024
    if unit in ('K', 'KB', 'KIB'):
        return number / 1024
    raise SystemExit("ERROR=bad_size")

if size_arg:
    requested = parse_size_to_mib(size_arg)
    if requested + 4 > free_size:
        print("ERROR=requested_size_exceeds_free")
        print(f"REQUESTED_MIB={requested:.2f}")
        print(f"FREE_SIZE={free_size:.2f}")
        sys.exit(0)
    part_start = end - requested
    part_end = end
else:
    part_start = start
    part_end = end
# shave a tiny margin to avoid end-of-disk rounding issues
part_start = round(part_start + 1, 2)
part_end = round(part_end - 1, 2)
if part_end <= part_start:
    print("ERROR=collapsed_range")
    sys.exit(0)
# next partition number = count of existing child partitions + 1
lsblk = subprocess.check_output(["lsblk", "-nr", "-o", "NAME,TYPE", device], text=True)
children = [line.split()[0] for line in lsblk.splitlines()[1:] if line.split() and line.split()[-1] == 'part']
next_num = len(children) + 1
base = Path(device).name
partition_path = f"{device}p{next_num}" if base[-1].isdigit() else f"{device}{next_num}"
print(f"FREE_START={start:.2f}")
print(f"FREE_END={end:.2f}")
print(f"FREE_SIZE={free_size:.2f}")
print(f"PART_START={part_start:.2f}")
print(f"PART_END={part_end:.2f}")
print(f"PARTITION={partition_path}")
print(f"PART_NUM={next_num}")
PY
)"

eval "$EXPORTS"

if [[ "${ERROR:-}" == "no_free_span" ]]; then
  echo "no free span found on $DEVICE" >&2
  echo "$PARTED_FREE" >&2
  exit 1
fi
if [[ -n "${ERROR:-}" ]]; then
  echo "unable to compute persistence partition plan: ${ERROR}" >&2
  echo "$PARTED_FREE" >&2
  [[ -n "${FREE_SIZE:-}" ]] && echo "free size: ${FREE_SIZE} MiB" >&2
  [[ -n "${REQUESTED_MIB:-}" ]] && echo "requested: ${REQUESTED_MIB} MiB" >&2
  exit 1
fi

PLAN=$(cat <<EOF
Device:        $DEVICE
Free span:     ${FREE_START} MiB -> ${FREE_END} MiB (${FREE_SIZE} MiB)
New partition: ${PARTITION}
Partition #:   ${PART_NUM}
Create range:  ${PART_START} MiB -> ${PART_END} MiB
Label:         ${LABEL}
EOF
)

echo "$PLAN"
echo
echo "Commands:"
echo "  parted -s '$DEVICE' unit MiB mkpart primary ext4 ${PART_START} ${PART_END}"
echo "  partprobe '$DEVICE' && udevadm settle"
echo "  mkfs.ext4 -F -L '$LABEL' '$PARTITION'"
echo "  lsblk -f '$DEVICE'"

if [[ "$DRY_RUN" -eq 1 ]]; then
  exit 0
fi

if [[ "$YES" -ne 1 ]]; then
  echo
  echo "Refusing to modify disk without --yes." >&2
  echo "Re-run with --yes after checking the plan above." >&2
  exit 2
fi

parted -s "$DEVICE" unit MiB mkpart primary ext4 "$PART_START" "$PART_END"
partprobe "$DEVICE"
udevadm settle || true

for _ in $(seq 1 20); do
  [[ -b "$PARTITION" ]] && break
  sleep 1
done
[[ -b "$PARTITION" ]] || { echo "new partition node not found: $PARTITION" >&2; exit 1; }

mkfs.ext4 -F -L "$LABEL" "$PARTITION"
e2label "$PARTITION" "$LABEL" >/dev/null 2>&1 || true

echo
echo "Created persistence partition: $PARTITION"
lsblk -f "$DEVICE"

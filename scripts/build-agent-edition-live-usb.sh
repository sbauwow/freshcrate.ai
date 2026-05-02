#!/usr/bin/env bash
set -euo pipefail

IMAGE="iso-live-persistent-x86_64"
BUNDLE="solo-builder-core"
MODE="headless"
CHANNEL="stable"
OUTPUT_DIR=""
CACHE_DIR=""
SOURCE_ISO_URL="https://releases.ubuntu.com/24.04.2/ubuntu-24.04.2-live-server-amd64.iso"
ROOTFS_DIR=""
WORK_DIR=""
# Stable contract: output/iso-live-persistent-x86_64/freshcrate-solo-builder-core-stable.iso

usage() {
  cat <<'EOF'
Usage: bash scripts/build-agent-edition-live-usb.sh [--image IMAGE] [--bundle BUNDLE] [--mode MODE] [--channel CHANNEL] [--output-dir DIR] [--cache-dir DIR] [--source-iso-url URL] [--rootfs-dir DIR]

Builds a freshcrate Ubuntu 24.04 live USB ISO for true live USB boot.
The bootloader/kernel/initrd still come from Ubuntu media, but the live rootfs
is rebuilt from the minimal Ubuntu Noble Agent Edition rootfs lane instead of
shipping the full stock Ubuntu live-server payload.
This lane is persistence-ready: boot config is patched for casper `persistent`
and expects a writable USB partition labeled `casper-rw`.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) IMAGE="${2:-}"; shift 2 ;;
    --bundle) BUNDLE="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --cache-dir) CACHE_DIR="${2:-}"; shift 2 ;;
    --source-iso-url) SOURCE_ISO_URL="${2:-}"; shift 2 ;;
    --rootfs-dir) ROOTFS_DIR="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ "$IMAGE" == "iso-live-persistent-x86_64" ]] || {
  echo "unsupported image: $IMAGE" >&2
  exit 1
}

for cmd in curl 7z python3 xorriso sha256sum mksquashfs awk sed cpio find unmkinitramfs gzip; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "$cmd is required" >&2
    exit 1
  }
done

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/rootfs-common.sh
source "${ROOT_DIR}/scripts/lib/rootfs-common.sh"
OUTPUT_DIR="${OUTPUT_DIR:-${ROOT_DIR}/output/${IMAGE}}"
CACHE_DIR="${CACHE_DIR:-${ROOT_DIR}/output/cache/${IMAGE}}"
WORK_DIR="${WORK_DIR:-$(mktemp -d)}"
STAGING_DIR="${WORK_DIR}/staging"
SOURCE_ISO="${CACHE_DIR}/ubuntu-24.04-live-server-amd64.iso"
FINAL_ISO="${OUTPUT_DIR}/freshcrate-${BUNDLE}-${CHANNEL}.iso"
LIVE_CONFIG_DIR="${STAGING_DIR}/freshcrate-live"
SEED_DIR="${STAGING_DIR}/nocloud"
ROOTFS_DIR="${ROOTFS_DIR:-${ROOT_DIR}/$(rootfs_output_dir "$BUNDLE" "$CHANNEL")/rootfs}"
ROOTFS_MANIFEST="${ROOT_DIR}/$(rootfs_output_dir "$BUNDLE" "$CHANNEL")/package-manifest.txt"
CASPER_DIR="${STAGING_DIR}/casper"
INITRD_WORK_DIR="${WORK_DIR}/initrd-live"
ROOTFS_SQUASHFS="${CASPER_DIR}/ubuntu-server-minimal.squashfs"
ROOTFS_SIZE_FILE="${CASPER_DIR}/ubuntu-server-minimal.size"
ROOTFS_MANIFEST_FILE="${CASPER_DIR}/ubuntu-server-minimal.manifest"
UBUNTU_SERVER_SQUASHFS="${CASPER_DIR}/ubuntu-server-minimal.ubuntu-server.squashfs"
UBUNTU_SERVER_SIZE_FILE="${CASPER_DIR}/ubuntu-server-minimal.ubuntu-server.size"
UBUNTU_SERVER_MANIFEST_FILE="${CASPER_DIR}/ubuntu-server-minimal.ubuntu-server.manifest"
INSTALLER_SQUASHFS="${CASPER_DIR}/ubuntu-server-minimal.ubuntu-server.installer.squashfs"
INSTALLER_GENERIC_SQUASHFS="${CASPER_DIR}/ubuntu-server-minimal.ubuntu-server.installer.generic.squashfs"
INSTALLER_SIZE_FILE="${CASPER_DIR}/ubuntu-server-minimal.ubuntu-server.installer.size"
INSTALLER_GENERIC_SIZE_FILE="${CASPER_DIR}/ubuntu-server-minimal.ubuntu-server.installer.generic.size"
INSTALLER_MANIFEST_FILE="${CASPER_DIR}/ubuntu-server-minimal.ubuntu-server.installer.manifest"
INSTALLER_GENERIC_MANIFEST_FILE="${CASPER_DIR}/ubuntu-server-minimal.ubuntu-server.installer.generic.manifest"
FILESYSTEM_MANIFEST_FILE="${CASPER_DIR}/filesystem.manifest"
FILESYSTEM_SIZE_FILE="${CASPER_DIR}/filesystem.size"

cleanup() {
  if [[ -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR" "$CACHE_DIR" "$STAGING_DIR" "$LIVE_CONFIG_DIR/scripts/lib" "$SEED_DIR"

ROOTFS_NEEDS_REBUILD=0
ROOTFS_FORCE_TEMP_REBUILD=0
if [[ ! -d "$ROOTFS_DIR" ]]; then
  ROOTFS_NEEDS_REBUILD=1
elif [[ ! -f "$ROOTFS_MANIFEST" ]]; then
  ROOTFS_NEEDS_REBUILD=1
elif ! grep -qx 'cloud-init' "$ROOTFS_MANIFEST"; then
  ROOTFS_NEEDS_REBUILD=1
elif [[ ! -f "$ROOTFS_DIR/usr/bin/cloud-init" ]]; then
  ROOTFS_NEEDS_REBUILD=1
fi

ROOTFS_DEFAULT_PARENT="$(dirname "$ROOTFS_DIR")"
ROOTFS_SEED_PARENT="${ROOTFS_DIR}/var/lib/cloud/seed"
if ! sudo -n true >/dev/null 2>&1; then
  if [[ -d "$ROOTFS_DIR" && ! -w "$ROOTFS_DIR" ]]; then
    ROOTFS_FORCE_TEMP_REBUILD=1
  elif [[ -e "$ROOTFS_SEED_PARENT" && ! -w "$ROOTFS_SEED_PARENT" ]]; then
    ROOTFS_FORCE_TEMP_REBUILD=1
  elif [[ ! -e "$ROOTFS_SEED_PARENT" && -e "$ROOTFS_DEFAULT_PARENT" && ! -w "$ROOTFS_DEFAULT_PARENT" ]]; then
    ROOTFS_FORCE_TEMP_REBUILD=1
  fi
fi

if [[ "$ROOTFS_FORCE_TEMP_REBUILD" -eq 1 ]]; then
  ROOTFS_NEEDS_REBUILD=1
fi

if [[ "$ROOTFS_NEEDS_REBUILD" -eq 1 ]]; then
  ROOTFS_BUILD_ARGS=(--bundle "$BUNDLE" --channel "$CHANNEL")
  if [[ "$ROOTFS_FORCE_TEMP_REBUILD" -eq 1 ]] || { [[ -e "$ROOTFS_DEFAULT_PARENT" && ! -w "$ROOTFS_DEFAULT_PARENT" ]] && ! sudo -n true >/dev/null 2>&1; }; then
    ROOTFS_REBUILD_OUTPUT_DIR="${WORK_DIR}/rootfs-rebuild"
    ROOTFS_BUILD_ARGS+=(--output-dir "$ROOTFS_REBUILD_OUTPUT_DIR")
    ROOTFS_DIR="${ROOTFS_REBUILD_OUTPUT_DIR}/rootfs"
    ROOTFS_MANIFEST="${ROOTFS_REBUILD_OUTPUT_DIR}/package-manifest.txt"
  fi
  bash "${ROOT_DIR}/scripts/build-agent-edition-rootfs.sh" "${ROOTFS_BUILD_ARGS[@]}"
fi
[[ -d "$ROOTFS_DIR" ]] || { echo "missing rootfs dir: $ROOTFS_DIR" >&2; exit 1; }
[[ -f "$ROOTFS_DIR/usr/bin/cloud-init" ]] || { echo "rootfs missing cloud-init: $ROOTFS_DIR" >&2; exit 1; }

if [[ ! -f "$SOURCE_ISO" ]]; then
  curl -L --fail --retry 3 -o "$SOURCE_ISO" "$SOURCE_ISO_URL"
fi

7z x -y -o"$STAGING_DIR" "$SOURCE_ISO" >/dev/null
EFI_BOOT_IMG="${STAGING_DIR}/[BOOT]/2-Boot-NoEmul.img"
[[ -f "$EFI_BOOT_IMG" ]] || { echo "missing EFI boot image at $EFI_BOOT_IMG" >&2; exit 1; }

cp "${ROOT_DIR}/images/cloud-init/iso-live-persistent-x86_64/meta-data" "${SEED_DIR}/meta-data"
cp "${ROOT_DIR}/images/cloud-init/iso-live-persistent-x86_64/user-data" "${SEED_DIR}/user-data"
cp "${ROOT_DIR}/scripts/bootstrap-agent-edition.sh" "${LIVE_CONFIG_DIR}/scripts/bootstrap-agent-edition.sh"
cp "${ROOT_DIR}/scripts/verify-agent-edition.sh" "${LIVE_CONFIG_DIR}/scripts/verify-agent-edition.sh"
cp "${ROOT_DIR}/scripts/lib/bootstrap-common.sh" "${LIVE_CONFIG_DIR}/scripts/lib/bootstrap-common.sh"
chmod +x "${LIVE_CONFIG_DIR}/scripts/bootstrap-agent-edition.sh" "${LIVE_CONFIG_DIR}/scripts/verify-agent-edition.sh"

# Strip Ubuntu live-session hooks that assume a full stock live desktop/server image.
INITRD_EXTRACT_DIR="${WORK_DIR}/initrd-extract"
mkdir -p "$INITRD_WORK_DIR" "$INITRD_EXTRACT_DIR"
unmkinitramfs "$CASPER_DIR/initrd" "$INITRD_EXTRACT_DIR" >/dev/null 2>&1
for segment in early early2 early3 main; do
  if [[ -d "${INITRD_EXTRACT_DIR}/${segment}" ]]; then
    cp -a "${INITRD_EXTRACT_DIR}/${segment}/." "$INITRD_WORK_DIR/"
  fi
done
for hook in \
  15autologin \
  19keyboard \
  20xconfig \
  22desktop_settings \
  25adduser \
  30accessibility \
  31disable_update_notifier \
  33enable_apport_crashes \
  34disable_kde_services \
  37disable_screensaver_lubuntu \
  40install_driver_updates \
  41apt_cdrom \
  44pk_allow_ubuntu \
  45jackd2 \
  52gnome_initial_setup \
  53disable_unattended_upgrades \
  55disable_snap_refresh \
  56override_nvidia_udev_rule \
  57pollinate \
  58server_network \
  59disable_mozc_autosetup \
  60_create_intaller_logdir \
  61desktop_canary_tweaks; do
  rm -f "$INITRD_WORK_DIR/scripts/casper-bottom/$hook"
done
if [[ -f "$INITRD_WORK_DIR/scripts/casper-bottom/ORDER" ]]; then
  python3 - "$INITRD_WORK_DIR/scripts/casper-bottom/ORDER" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
removed = {
    "15autologin",
    "19keyboard",
    "20xconfig",
    "22desktop_settings",
    "25adduser",
    "30accessibility",
    "31disable_update_notifier",
    "33enable_apport_crashes",
    "34disable_kde_services",
    "37disable_screensaver_lubuntu",
    "40install_driver_updates",
    "41apt_cdrom",
    "44pk_allow_ubuntu",
    "45jackd2",
    "52gnome_initial_setup",
    "53disable_unattended_upgrades",
    "55disable_snap_refresh",
    "56override_nvidia_udev_rule",
    "57pollinate",
    "58server_network",
    "59disable_mozc_autosetup",
    "60_create_intaller_logdir",
    "61desktop_canary_tweaks",
}
lines = []
for line in path.read_text().splitlines():
    stripped = line.strip()
    if any(f"/scripts/casper-bottom/{name} " in stripped or stripped == f"/scripts/casper-bottom/{name}" for name in removed):
        continue
    lines.append(line)
path.write_text("\n".join(lines) + "\n")
PY
fi
# Repack initrd after pruning the incompatible hooks.
(
  cd "$INITRD_WORK_DIR"
  find . | cpio -o -H newc 2>/dev/null | gzip -c > "$CASPER_DIR/initrd"
)

python3 - "$BUNDLE" "$MODE" "$CHANNEL" "${SEED_DIR}/user-data" <<'PY'
from pathlib import Path
import sys
bundle, mode, channel, user_data_path = sys.argv[1:]
path = Path(user_data_path)
text = path.read_text()
text = text.replace("__BUNDLE__", bundle).replace("__MODE__", mode).replace("__CHANNEL__", channel)
path.write_text(text)
PY

ROOTFS_SEED_DIR="${ROOTFS_DIR}/var/lib/cloud/seed/nocloud"
mkdir -p "$ROOTFS_SEED_DIR"
cp "${SEED_DIR}/meta-data" "$ROOTFS_SEED_DIR/meta-data"
cp "${SEED_DIR}/user-data" "$ROOTFS_SEED_DIR/user-data"

python3 - "$STAGING_DIR" <<'PY'
from pathlib import Path
import sys

staging = Path(sys.argv[1])
entries = ("boot/grub/grub.cfg", "boot/grub/loopback.cfg", "isolinux/txt.cfg")
auto_arg_a = "autoinstall"
seed_plain = "ds=nocloud;s=/cdrom/nocloud/"
seed_escaped = "ds=nocloud\\;s=/cdrom/nocloud/"
for relative in entries:
    path = staging / relative
    if not path.exists():
        continue
    text = path.read_text()
    text = text.replace(f"{auto_arg_a} {seed_escaped} ", "")
    text = text.replace(f"{auto_arg_a} {seed_plain} ", "")
    if relative.startswith("isolinux/"):
        seed_arg = seed_plain
    else:
        seed_arg = seed_escaped
    insert = f" persistent console=tty0 console=ttyS0,115200n8 {seed_arg} ---"
    if seed_plain in text or seed_escaped in text:
        updated = text.replace(" ---", insert)
    else:
        updated = text.replace(" ---", insert)
    path.write_text(updated)
PY

cat > "${LIVE_CONFIG_DIR}/README.txt" <<EOF
freshcrate live USB lane
bundle: ${BUNDLE}
mode: ${MODE}
channel: ${CHANNEL}
rootfs: ${ROOTFS_DIR}

This ISO is designed for live USB boot with Ubuntu casper persistence.
Create a writable ext4 partition on the USB device labeled: casper-rw
EOF

# Replace the stock Ubuntu live root with the custom minimal Agent Edition rootfs.
rm -f "${CASPER_DIR}"/*.squashfs "${CASPER_DIR}"/*.squashfs.gpg
mksquashfs "$ROOTFS_DIR" "$ROOTFS_SQUASHFS" -comp xz -b 1048576 -noappend >/dev/null
ROOTFS_BYTES="$(du -sb "$ROOTFS_DIR" | awk '{print $1}')"
printf '%s\n' "$ROOTFS_BYTES" > "$ROOTFS_SIZE_FILE"
printf '%s\n' "$ROOTFS_BYTES" > "$FILESYSTEM_SIZE_FILE"
if [[ -f "$ROOTFS_MANIFEST" ]]; then
  cp "$ROOTFS_MANIFEST" "$ROOTFS_MANIFEST_FILE"
  cp "$ROOTFS_MANIFEST" "$FILESYSTEM_MANIFEST_FILE"
else
  printf '%s\n' "freshcrate-agent-edition-minimal-rootfs" > "$ROOTFS_MANIFEST_FILE"
  cp "$ROOTFS_MANIFEST_FILE" "$FILESYSTEM_MANIFEST_FILE"
fi
# Preserve the filenames casper/live init expects, but point them all at the same minimal rootfs.
cp "$ROOTFS_SQUASHFS" "$UBUNTU_SERVER_SQUASHFS"
cp "$ROOTFS_SQUASHFS" "$INSTALLER_SQUASHFS"
cp "$ROOTFS_SQUASHFS" "$INSTALLER_GENERIC_SQUASHFS"
cp "$ROOTFS_SIZE_FILE" "$UBUNTU_SERVER_SIZE_FILE"
cp "$ROOTFS_SIZE_FILE" "$INSTALLER_SIZE_FILE"
cp "$ROOTFS_SIZE_FILE" "$INSTALLER_GENERIC_SIZE_FILE"
cp "$ROOTFS_MANIFEST_FILE" "$UBUNTU_SERVER_MANIFEST_FILE"
cp "$ROOTFS_MANIFEST_FILE" "$INSTALLER_MANIFEST_FILE"
cp "$ROOTFS_MANIFEST_FILE" "$INSTALLER_GENERIC_MANIFEST_FILE"

rm -f "$FINAL_ISO"
VOL_ID="$(echo "freshcrate-live-${BUNDLE}-${CHANNEL}" | cut -c1-32)"
BOOT_TMP="${WORK_DIR}/boot-images"
mv "${STAGING_DIR}/[BOOT]" "$BOOT_TMP"

xorriso -as mkisofs \
  -V "$VOL_ID" \
  -r -joliet-long -cache-inodes \
  -partition_offset 16 \
  -appended_part_as_gpt \
  -append_partition 2 0xef "${BOOT_TMP}/2-Boot-NoEmul.img" \
  -c boot.catalog \
  -b boot/grub/i386-pc/eltorito.img \
  -no-emul-boot -boot-load-size 4 -boot-info-table \
  -eltorito-alt-boot \
  -e '--interval:appended_partition_2:all::' \
  -no-emul-boot \
  -isohybrid-gpt-basdat \
  -o "$FINAL_ISO" \
  "$STAGING_DIR" \
  >/dev/null

sha256sum "$FINAL_ISO"

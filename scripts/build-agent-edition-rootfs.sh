#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/bootstrap-common.sh
source "${ROOT_DIR}/scripts/lib/bootstrap-common.sh"
# shellcheck source=scripts/lib/rootfs-common.sh
source "${ROOT_DIR}/scripts/lib/rootfs-common.sh"

BUNDLE="solo-builder-core"
CHANNEL="stable"
OUTPUT_DIR=""
MIRROR="http://archive.ubuntu.com/ubuntu"
COMPONENTS="main universe"
ARCH="amd64"
INCLUDE_OVERLAYS=1

usage() {
  cat <<'EOF'
Usage: bash scripts/build-agent-edition-rootfs.sh [options]

Build a minimal Ubuntu 24.04 (noble) rootfs for freshcrate Agent Edition using
mmdebstrap when available, or debootstrap as a fallback.

Options:
  --bundle BUNDLE       Bundle id (default: solo-builder-core)
  --channel CHANNEL     stable|beta|nightly (default: stable)
  --output-dir DIR      Rootfs output dir (default: output/ubuntu-24.04-rootfs/<bundle>/<channel>)
  --mirror URL          Ubuntu mirror (default: http://archive.ubuntu.com/ubuntu)
  --components LIST     Apt components (default: main universe)
  --arch ARCH           Target architecture (default: amd64)
  --base-only           Install only base package tier
  -h, --help            Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle) BUNDLE="${2:-}"; shift 2 ;;
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --mirror) MIRROR="${2:-}"; shift 2 ;;
    --components) COMPONENTS="${2:-}"; shift 2 ;;
    --arch) ARCH="${2:-}"; shift 2 ;;
    --base-only) INCLUDE_OVERLAYS=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

supports_bundle "$BUNDLE" || die "unsupported bundle: $BUNDLE"
[[ "$CHANNEL" == "stable" || "$CHANNEL" == "beta" || "$CHANNEL" == "nightly" ]] || die "unsupported channel: $CHANNEL"

require_cmd python3
require_cmd awk
require_cmd sed
require_cmd tar

BUILD_TOOL=""
if command -v mmdebstrap >/dev/null 2>&1; then
  BUILD_TOOL="mmdebstrap"
elif command -v debootstrap >/dev/null 2>&1; then
  BUILD_TOOL="debootstrap"
else
  die "missing required command: mmdebstrap or debootstrap"
fi

SUDO_PREFIX=(sudo)
MMDEBSTRAP_MODE=()
if ! sudo -n true >/dev/null 2>&1; then
  SUDO_PREFIX=()
  if [[ "$BUILD_TOOL" == "mmdebstrap" ]]; then
    MMDEBSTRAP_MODE=(--mode=unshare)
  else
    die "missing sudo access for debootstrap fallback; install/use mmdebstrap or run sudo -v first"
  fi
fi

[[ -n "$COMPONENTS" ]] || die "components list cannot be empty"
COMPONENTS="$(printf '%s' "$COMPONENTS" | tr ',' ' ' | xargs)"

REL="$(rootfs_release_codename)"
OUTPUT_DIR="${OUTPUT_DIR:-${ROOT_DIR}/$(rootfs_output_dir "$BUNDLE" "$CHANNEL")}" 
ROOTFS_DIR="${OUTPUT_DIR}/rootfs"
ROOTFS_TARBALL="${OUTPUT_DIR}/rootfs.tar"
MANIFEST_PATH="${OUTPUT_DIR}/package-manifest.txt"
RECEIPT_PATH="${OUTPUT_DIR}/image-build-receipt.txt"
BOOTSTRAP_SCRIPT_DST="${ROOTFS_DIR}/opt/freshcrate/scripts"

prepare_output_dir() {
  local output_dir="$1"
  if [[ -z "${SUDO_PREFIX[*]}" && -e "$output_dir" && ! -w "$output_dir" ]]; then
    die "output dir is not writable: $output_dir (stale root-owned artifacts? run sudo -v or choose --output-dir)"
  fi
  mkdir -p "$output_dir"
}

prepare_output_dir "$OUTPUT_DIR"
if [[ -z "${SUDO_PREFIX[*]}" && -e "$ROOTFS_DIR" && ! -w "$ROOTFS_DIR" ]]; then
  die "rootfs dir is not writable: $ROOTFS_DIR (unshare-mode leftovers? choose a fresh --output-dir or rerun with sudo -v)"
fi
"${SUDO_PREFIX[@]}" rm -f "$MANIFEST_PATH" "$RECEIPT_PATH" "$ROOTFS_TARBALL"
"${SUDO_PREFIX[@]}" rm -rf "$ROOTFS_DIR"
if [[ ${#MMDEBSTRAP_MODE[@]} -eq 0 ]]; then
  mkdir -p "$ROOTFS_DIR"
fi

if [[ "$INCLUDE_OVERLAYS" -eq 1 ]]; then
  write_rootfs_package_manifest "$BUNDLE" "$MANIFEST_PATH"
else
  rootfs_base_packages > "$MANIFEST_PATH"
fi

PACKAGE_CSV="$(paste -sd, "$MANIFEST_PATH")"
log "building minimal Ubuntu 24.04 rootfs with ${BUILD_TOOL}"
log "bundle=${BUNDLE} channel=${CHANNEL} arch=${ARCH} release=${REL}"
log "components=${COMPONENTS}"
log "packages=$(tr '\n' ' ' < "$MANIFEST_PATH" | sed 's/[[:space:]]\+/ /g')"

if [[ "$BUILD_TOOL" == "mmdebstrap" ]]; then
  MM_TARGET="$ROOTFS_DIR"
  if [[ ${#MMDEBSTRAP_MODE[@]} -gt 0 ]]; then
    MM_TARGET="$ROOTFS_TARBALL"
  fi
  "${SUDO_PREFIX[@]}" mmdebstrap \
    "${MMDEBSTRAP_MODE[@]}" \
    --architectures="$ARCH" \
    --variant=minbase \
    --components="$COMPONENTS" \
    --include="$PACKAGE_CSV" \
    "$REL" \
    "$MM_TARGET" \
    "$MIRROR"
  if [[ ${#MMDEBSTRAP_MODE[@]} -gt 0 ]]; then
    mkdir -p "$ROOTFS_DIR"
    tar --exclude='./dev/*' -xf "$ROOTFS_TARBALL" -C "$ROOTFS_DIR"
  fi
else
  "${SUDO_PREFIX[@]}" debootstrap --arch="$ARCH" --variant=minbase --components="$COMPONENTS" "$REL" "$ROOTFS_DIR" "$MIRROR"
  "${SUDO_PREFIX[@]}" chroot "$ROOTFS_DIR" apt-get update
  "${SUDO_PREFIX[@]}" chroot "$ROOTFS_DIR" env DEBIAN_FRONTEND=noninteractive apt-get install -y $(tr '\n' ' ' < "$MANIFEST_PATH")
  "${SUDO_PREFIX[@]}" chroot "$ROOTFS_DIR" apt-get clean
fi

"${SUDO_PREFIX[@]}" mkdir -p "$BOOTSTRAP_SCRIPT_DST/lib" "$ROOTFS_DIR/opt/freshcrate/home" "$ROOTFS_DIR/opt/freshcrate/workspace"
"${SUDO_PREFIX[@]}" cp "${ROOT_DIR}/scripts/bootstrap-agent-edition.sh" "$BOOTSTRAP_SCRIPT_DST/bootstrap-agent-edition.sh"
"${SUDO_PREFIX[@]}" cp "${ROOT_DIR}/scripts/verify-agent-edition.sh" "$BOOTSTRAP_SCRIPT_DST/verify-agent-edition.sh"
"${SUDO_PREFIX[@]}" cp "${ROOT_DIR}/scripts/lib/bootstrap-common.sh" "$BOOTSTRAP_SCRIPT_DST/lib/bootstrap-common.sh"
if command -v uv >/dev/null 2>&1; then
  "${SUDO_PREFIX[@]}" mkdir -p "$ROOTFS_DIR/usr/local/bin"
  "${SUDO_PREFIX[@]}" cp "$(command -v uv)" "$ROOTFS_DIR/usr/local/bin/uv"
  if command -v uvx >/dev/null 2>&1; then
    "${SUDO_PREFIX[@]}" cp "$(command -v uvx)" "$ROOTFS_DIR/usr/local/bin/uvx"
  fi
fi
"${SUDO_PREFIX[@]}" chmod +x "$BOOTSTRAP_SCRIPT_DST/bootstrap-agent-edition.sh" "$BOOTSTRAP_SCRIPT_DST/verify-agent-edition.sh"
if [[ -f "$ROOTFS_DIR/usr/local/bin/uv" ]]; then
  "${SUDO_PREFIX[@]}" chmod +x "$ROOTFS_DIR/usr/local/bin/uv"
fi
if [[ -f "$ROOTFS_DIR/usr/local/bin/uvx" ]]; then
  "${SUDO_PREFIX[@]}" chmod +x "$ROOTFS_DIR/usr/local/bin/uvx"
fi

cat > "$RECEIPT_PATH" <<EOF
image_kind=ubuntu-24.04-rootfs
bundle=${BUNDLE}
channel=${CHANNEL}
release=${REL}
arch=${ARCH}
build_tool=${BUILD_TOOL}
output_dir=${OUTPUT_DIR}
rootfs_dir=${ROOTFS_DIR}
package_manifest=${MANIFEST_PATH}
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

printf '%s\n' "$ROOTFS_DIR"
printf '%s\n' "$MANIFEST_PATH"
printf '%s\n' "$RECEIPT_PATH"

#!/usr/bin/env bash
set -euo pipefail

IMAGE="railway-dev-box"
BUNDLE="solo-builder-core"
MODE="headless"
CHANNEL="stable"
VERSION="0.1.0"
REGION="us-east-1"
TARGET="ubuntu-24.04-x86_64"
ROOTFS_DIR=""

usage() {
  cat <<'EOF'
Usage: bash scripts/build-agent-edition-image.sh [--image IMAGE] [--bundle BUNDLE] [--mode MODE] [--channel CHANNEL] [--target TARGET] [--region AWS_REGION] [--rootfs-dir DIR]

Images:
  railway-dev-box | vm-qcow2-headless | aws-ami-builder
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      IMAGE="${2:-}"
      shift 2
      ;;
    --bundle)
      BUNDLE="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --channel)
      CHANNEL="${2:-}"
      shift 2
      ;;
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    --rootfs-dir)
      ROOTFS_DIR="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

case "$IMAGE" in
  railway-dev-box|vm-qcow2-headless|aws-ami-builder) ;;
  *) echo "unsupported image: $IMAGE" >&2; exit 1 ;;
esac

case "$CHANNEL" in
  stable) VERSION="0.1.0" ;;
  beta) VERSION="0.2.0-beta" ;;
  nightly) VERSION="0.3.0-nightly" ;;
  *) echo "unsupported channel: $CHANNEL" >&2; exit 1 ;;
esac

case "$TARGET" in
  ubuntu-24.04-x86_64|ubuntu-24.04-arm64) ;;
  *) echo "unsupported target: $TARGET" >&2; exit 1 ;;
esac

TEMPLATE="images/${IMAGE}.pkr.hcl"
[[ -f "$TEMPLATE" ]] || { echo "missing template: $TEMPLATE" >&2; exit 1; }

if ! command -v packer >/dev/null 2>&1; then
  echo "packer is required" >&2
  exit 1
fi

packer init "$TEMPLATE" >/dev/null

PACKER_ARGS=(
  -var "bundle=${BUNDLE}"
  -var "mode=${MODE}"
  -var "channel=${CHANNEL}"
  -var "version=${VERSION}"
  -var "target=${TARGET}"
)

if [[ "$IMAGE" == "vm-qcow2-headless" ]]; then
  DEFAULT_ROOTFS_DIR="output/ubuntu-24.04-rootfs/${BUNDLE}/${CHANNEL}/rootfs"
  if [[ -z "$ROOTFS_DIR" ]]; then
    ROOTFS_DIR="$DEFAULT_ROOTFS_DIR"
  fi

  if [[ ! -d "$ROOTFS_DIR" ]]; then
    ROOTFS_BUILD_ARGS=(--bundle "$BUNDLE" --channel "$CHANNEL")
    if [[ -z "$ROOTFS_DIR" || "$ROOTFS_DIR" == "$DEFAULT_ROOTFS_DIR" ]]; then
      DEFAULT_ROOTFS_PARENT="$(dirname "$DEFAULT_ROOTFS_DIR")"
      if ! sudo -n true >/dev/null 2>&1 && [[ -e "$DEFAULT_ROOTFS_PARENT" && ! -w "$DEFAULT_ROOTFS_PARENT" ]]; then
        ROOTFS_REBUILD_OUTPUT_DIR="$(mktemp -d)"
        ROOTFS_BUILD_ARGS+=(--output-dir "$ROOTFS_REBUILD_OUTPUT_DIR")
        ROOTFS_DIR="${ROOTFS_REBUILD_OUTPUT_DIR}/rootfs"
        echo "qcow2 lane found stale default rootfs ownership; rebuilding in temp dir ${ROOTFS_REBUILD_OUTPUT_DIR}" >&2
      fi
    fi

    echo "qcow2 lane requires minimal rootfs at $ROOTFS_DIR; building it now" >&2
    bash scripts/build-agent-edition-rootfs.sh "${ROOTFS_BUILD_ARGS[@]}"
  fi

  [[ -f "$ROOTFS_DIR/opt/freshcrate/scripts/bootstrap-agent-edition.sh" ]] || {
    echo "rootfs contract incomplete: missing bootstrap payload under $ROOTFS_DIR" >&2
    exit 1
  }

  PACKER_ARGS+=( -var "rootfs_dir=${ROOTFS_DIR}" )
fi

if [[ "$IMAGE" == "aws-ami-builder" ]]; then
  PACKER_ARGS+=( -var "region=${REGION}" )
fi

if [[ "$IMAGE" == "vm-qcow2-headless" ]]; then
  if [[ "$TARGET" == "ubuntu-24.04-arm64" ]]; then
    rm -rf "output/vm-qcow2-headless-arm64"
  else
    rm -rf "output/${IMAGE}"
  fi
fi

exec packer build "${PACKER_ARGS[@]}" "$TEMPLATE"

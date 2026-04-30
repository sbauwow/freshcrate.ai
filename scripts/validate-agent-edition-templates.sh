#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

shopt -s nullglob
files=("${ROOT_DIR}"/images/*.pkr.hcl)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
  echo "no packer templates found under images/" >&2
  exit 1
fi

if ! command -v packer >/dev/null 2>&1; then
  echo "packer is required" >&2
  exit 1
fi

TEMP_DIRS=()
VALIDATE_ROOTFS_DIR=""
cleanup() {
  if [[ ${#TEMP_DIRS[@]} -eq 0 ]]; then
    return 0
  fi
  for dir in "${TEMP_DIRS[@]}"; do
    if [[ -n "$dir" && -d "$dir" ]]; then
      rm -rf "$dir"
    fi
  done
}
trap cleanup EXIT

create_validate_rootfs_contract() {
  local temp_dir rootfs_dir
  temp_dir="$(mktemp -d)"
  TEMP_DIRS+=("$temp_dir")
  rootfs_dir="${temp_dir}/rootfs"

  mkdir -p "${rootfs_dir}/opt/freshcrate/scripts/lib"
  : > "${rootfs_dir}/opt/freshcrate/scripts/bootstrap-agent-edition.sh"
  : > "${rootfs_dir}/opt/freshcrate/scripts/verify-agent-edition.sh"
  : > "${rootfs_dir}/opt/freshcrate/scripts/lib/bootstrap-common.sh"
  : > "${temp_dir}/package-manifest.txt"
  : > "${temp_dir}/image-build-receipt.txt"

  VALIDATE_ROOTFS_DIR="$rootfs_dir"
}

for template in "${files[@]}"; do
  echo "validating ${template##${ROOT_DIR}/}"
  packer init "$template" >/dev/null
  targets=('ubuntu-24.04-x86_64')
  if [[ "${template##*/}" == "vm-qcow2-headless.pkr.hcl" ]]; then
    targets+=('ubuntu-24.04-arm64')
  fi

  for target in "${targets[@]}"; do
    echo "  target=${target}"
    PACKER_VALIDATE_ARGS=(
      -var 'bundle=solo-builder-core'
      -var 'mode=headless'
      -var 'channel=stable'
      -var 'version=0.1.0'
      -var "target=${target}"
    )

    if [[ "${template##*/}" == "aws-ami-builder.pkr.hcl" ]]; then
      PACKER_VALIDATE_ARGS+=( -var 'region=us-east-1' )
    fi

    if [[ "${template##*/}" == "vm-qcow2-headless.pkr.hcl" ]]; then
      create_validate_rootfs_contract
      PACKER_VALIDATE_ARGS+=( -var "rootfs_dir=${VALIDATE_ROOTFS_DIR}" )
    fi

    packer validate "${PACKER_VALIDATE_ARGS[@]}" "$template"
  done
done

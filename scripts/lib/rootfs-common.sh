#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ROOTFS_HELPERS_LOADED:-}" ]]; then
  ROOTFS_HELPERS_LOADED=1
fi

rootfs_release_codename() {
  printf '%s\n' noble
}

rootfs_output_dir() {
  local bundle="$1"
  local channel="$2"
  printf 'output/ubuntu-24.04-rootfs/%s/%s\n' "$bundle" "$channel"
}

rootfs_base_packages() {
  printf '%s\n' \
    apt \
    apt-utils \
    bash \
    ca-certificates \
    cloud-init \
    coreutils \
    curl \
    dbus \
    gnupg \
    iproute2 \
    kmod \
    locales \
    netplan.io \
    openssh-server \
    passwd \
    python3 \
    sudo \
    systemd \
    systemd-sysv \
    udev \
    tzdata \
    wget \
    xz-utils
}

rootfs_overlay_packages() {
  local bundle="$1"
  case "$bundle" in
    solo-builder-core|research-node|local-model-box)
      printf '%s\n' \
        fd-find \
        gh \
        git \
        jq \
        nodejs \
        npm \
        python3-pip \
        python3-venv \
        ripgrep \
        sqlite3 \
        tmux \
        zsh
      ;;
    *)
      return 1
      ;;
  esac
}

rootfs_all_packages() {
  local bundle="$1"
  {
    rootfs_base_packages
    rootfs_overlay_packages "$bundle"
  } | awk 'NF && !seen[$0]++'
}

# Write the canonical package manifest file (typically package-manifest.txt)
# for a minimal Ubuntu 24.04 Agent Edition rootfs build.
write_rootfs_package_manifest() {
  local bundle="$1"
  local output_path="$2"
  rootfs_all_packages "$bundle" > "$output_path"
}

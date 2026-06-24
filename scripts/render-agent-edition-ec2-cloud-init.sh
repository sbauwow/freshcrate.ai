#!/usr/bin/env bash
set -euo pipefail

BUNDLE="research-node"
MODE="headless"
CHANNEL="stable"
TARGET="ubuntu-24.04-x86_64"
FRESHCRATE_HOME="/opt/freshcrate/home"
WORKSPACE_DIR="/opt/freshcrate/workspace"
HOSTNAME="freshcrate-agent-edition"

usage() {
  cat <<'EOF'
Usage: bash scripts/render-agent-edition-ec2-cloud-init.sh [--bundle BUNDLE] [--mode MODE] [--channel CHANNEL] [--target TARGET] [--hostname HOSTNAME] [--freshcrate-home DIR] [--workspace-dir DIR]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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
    --hostname)
      HOSTNAME="${2:-}"
      shift 2
      ;;
    --freshcrate-home)
      FRESHCRATE_HOME="${2:-}"
      shift 2
      ;;
    --workspace-dir)
      WORKSPACE_DIR="${2:-}"
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

REPO_ROOT="$(cd -- "${BASH_SOURCE[0]%/*}/.." && pwd)"
HOSTNAME_VALUE="$HOSTNAME"
BUNDLE_VALUE="$BUNDLE"
MODE_VALUE="$MODE"
CHANNEL_VALUE="$CHANNEL"
TARGET_VALUE="$TARGET"
FRESHCRATE_HOME_VALUE="$FRESHCRATE_HOME"
WORKSPACE_DIR_VALUE="$WORKSPACE_DIR"
REPO_ROOT_VALUE="$REPO_ROOT"

HOSTNAME_VALUE="$HOSTNAME_VALUE" \
BUNDLE_VALUE="$BUNDLE_VALUE" \
MODE_VALUE="$MODE_VALUE" \
CHANNEL_VALUE="$CHANNEL_VALUE" \
TARGET_VALUE="$TARGET_VALUE" \
FRESHCRATE_HOME_VALUE="$FRESHCRATE_HOME_VALUE" \
WORKSPACE_DIR_VALUE="$WORKSPACE_DIR_VALUE" \
REPO_ROOT_VALUE="$REPO_ROOT_VALUE" \
python3 - <<'PY'
from pathlib import Path
import os

template = Path(os.environ["REPO_ROOT_VALUE"]) / "templates" / "cloud-init-ec2.yaml"
template = template.read_text()
replacements = {
    "${hostname}": os.environ["HOSTNAME_VALUE"],
    "${bundle}": os.environ["BUNDLE_VALUE"],
    "${mode}": os.environ["MODE_VALUE"],
    "${channel}": os.environ["CHANNEL_VALUE"],
    "${target}": os.environ["TARGET_VALUE"],
    "${freshcrate_home}": os.environ["FRESHCRATE_HOME_VALUE"],
    "${workspace_dir}": os.environ["WORKSPACE_DIR_VALUE"],
}
for key, value in replacements.items():
    template = template.replace(key, value)
print(template)
PY

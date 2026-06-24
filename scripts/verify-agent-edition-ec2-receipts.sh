#!/usr/bin/env bash
set -euo pipefail

HOST=""
USER_NAME="ubuntu"
IDENTITY_FILE=""
PORT="22"
BUNDLE=""

usage() {
  cat <<'EOF'
Usage: bash scripts/verify-agent-edition-ec2-receipts.sh --host HOST [--user ubuntu] [--port 22] [--identity-file PATH] [--bundle BUNDLE]

Checks the first-boot receipt emitted by templates/cloud-init-ec2.yaml.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    --user)
      USER_NAME="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --identity-file)
      IDENTITY_FILE="${2:-}"
      shift 2
      ;;
    --bundle)
      BUNDLE="${2:-}"
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

[[ -n "$HOST" ]] || { echo "--host is required" >&2; exit 1; }

SSH_ARGS=( -p "$PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null )
if [[ -n "$IDENTITY_FILE" ]]; then
  SSH_ARGS+=( -i "$IDENTITY_FILE" )
fi

REMOTE_PATH='latest=$(ls -1t /opt/freshcrate/home/receipts/ec2-firstboot-*.txt 2>/dev/null | head -n 1); if [[ -z "$latest" ]]; then echo "missing ec2 first-boot receipt" >&2; exit 1; fi; echo "$latest"; cat "$latest"'
if [[ -n "$BUNDLE" ]]; then
  REMOTE_PATH="target=/opt/freshcrate/home/receipts/ec2-firstboot-${BUNDLE}.txt; [[ -f \"\$target\" ]] || { echo \"missing receipt: \$target\" >&2; exit 1; }; echo \"\$target\"; cat \"\$target\""
fi

exec ssh "${SSH_ARGS[@]}" "${USER_NAME}@${HOST}" "bash -lc '$REMOTE_PATH'"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="${SCRIPT_DIR}/../infra/aws/ec2-agent-edition"
ACTION="apply"
VAR_FILE=""
AUTO_APPROVE="false"
TOOL=""

usage() {
  cat <<'EOF'
Usage: bash scripts/launch-agent-edition-ec2.sh [--plan|--apply|--destroy] [--var-file FILE] [--auto-approve]

Scaffolds a freshcrate Agent Edition EC2 launch around the Terraform module at:
  infra/aws/ec2-agent-edition

Examples:
  bash scripts/launch-agent-edition-ec2.sh --plan --var-file infra/aws/ec2-agent-edition/dev.auto.tfvars
  bash scripts/launch-agent-edition-ec2.sh --apply --var-file infra/aws/ec2-agent-edition/dev.auto.tfvars --auto-approve
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan)
      ACTION="plan"
      shift
      ;;
    --apply)
      ACTION="apply"
      shift
      ;;
    --destroy)
      ACTION="destroy"
      shift
      ;;
    --var-file)
      VAR_FILE="${2:-}"
      shift 2
      ;;
    --auto-approve)
      AUTO_APPROVE="true"
      shift
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

if command -v tofu >/dev/null 2>&1; then
  TOOL="tofu"
elif command -v terraform >/dev/null 2>&1; then
  TOOL="terraform"
else
  echo "terraform or tofu is required" >&2
  exit 1
fi

cd "$MODULE_DIR"
"$TOOL" init

COMMON_ARGS=()
if [[ -n "$VAR_FILE" ]]; then
  COMMON_ARGS+=( -var-file="$VAR_FILE" )
fi

case "$ACTION" in
  plan)
    exec "$TOOL" plan "${COMMON_ARGS[@]}"
    ;;
  apply)
    if [[ "$AUTO_APPROVE" == "true" ]]; then
      exec "$TOOL" apply -auto-approve "${COMMON_ARGS[@]}"
    fi
    exec "$TOOL" apply "${COMMON_ARGS[@]}"
    ;;
  destroy)
    if [[ "$AUTO_APPROVE" == "true" ]]; then
      exec "$TOOL" destroy -auto-approve "${COMMON_ARGS[@]}"
    fi
    exec "$TOOL" destroy "${COMMON_ARGS[@]}"
    ;;
  *)
    echo "unsupported action: $ACTION" >&2
    exit 1
    ;;
esac

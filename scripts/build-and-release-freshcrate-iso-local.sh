#!/usr/bin/env bash
set -euo pipefail

IMAGE="iso-autoinstall-headless"
BUNDLE="solo-builder-core"
MODE="headless"
CHANNEL="stable"
RELEASE_TAG="agent-edition-iso-latest"
OUTPUT_DIR="output/${IMAGE}"
PUBLISH=0
ZIP_ARTIFACT=1
GITHUB_ASSET_LIMIT_BYTES=2147483648
SPLIT_PART_SIZE_MB=1900

usage() {
  cat <<'EOF'
Usage: bash scripts/build-and-release-freshcrate-iso-local.sh [options]

Builds and packages the freshcrate Agent Edition ISO locally.
Optionally publishes the packaged artifact to a rolling GitHub release.

Options:
  --bundle BUNDLE          Default: solo-builder-core
  --mode MODE              Default: headless
  --channel CHANNEL        Default: stable
  --output-dir DIR         Default: output/iso-autoinstall-headless
  --publish                Upload zip + checksum + metadata to GitHub release tag agent-edition-iso-latest
  --release-tag TAG        Default: agent-edition-iso-latest
  --no-zip                 Skip .iso.zip creation
  -h, --help               Show this help

Examples:
  bash scripts/build-and-release-freshcrate-iso-local.sh
  bash scripts/build-and-release-freshcrate-iso-local.sh --publish
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle) BUNDLE="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --publish) PUBLISH=1; shift ;;
    --release-tag) RELEASE_TAG="${2:-}"; shift 2 ;;
    --no-zip) ZIP_ARTIFACT=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    return 1
  }
}

for cmd in bash curl 7z python3 sha256sum npm; do
  need_cmd "$cmd"
done

if ! command -v xorriso >/dev/null 2>&1; then
  echo "xorriso is missing." >&2
  echo "Install it with:" >&2
  echo "  sudo apt-get update && sudo apt-get install -y xorriso" >&2
  exit 1
fi

if [[ "$PUBLISH" -eq 1 ]]; then
  need_cmd gh
  gh auth status >/dev/null 2>&1 || {
    echo "gh is not authenticated. Run: gh auth login" >&2
    exit 1
  }
fi

echo "==> Running targeted ISO lane test"
npm test -- --run tests/iso-image-lane.test.ts

echo "==> Building ISO"
bash scripts/build-agent-edition-iso.sh \
  --image "$IMAGE" \
  --bundle "$BUNDLE" \
  --mode "$MODE" \
  --channel "$CHANNEL" \
  --output-dir "$OUTPUT_DIR"

echo "==> Packaging ISO"
bash scripts/package-agent-edition-image.sh \
  --image "$IMAGE" \
  --bundle "$BUNDLE" \
  --mode "$MODE" \
  --channel "$CHANNEL" \
  --output-dir "$OUTPUT_DIR"

FINAL_ISO="${OUTPUT_DIR}/freshcrate-${BUNDLE}-${CHANNEL}.iso"
CHECKSUM_FILE="${FINAL_ISO}.sha256"
METADATA_FILE="${FINAL_ISO}.json"
ZIP_FILE="${FINAL_ISO}.zip"

[[ -f "$FINAL_ISO" ]] || { echo "missing built ISO: $FINAL_ISO" >&2; exit 1; }
[[ -f "$CHECKSUM_FILE" ]] || { echo "missing checksum file: $CHECKSUM_FILE" >&2; exit 1; }
[[ -f "$METADATA_FILE" ]] || { echo "missing metadata file: $METADATA_FILE" >&2; exit 1; }

if [[ "$ZIP_ARTIFACT" -eq 1 ]]; then
  echo "==> Creating zip archive"
  python3 - "$FINAL_ISO" "$ZIP_FILE" <<'PY'
from pathlib import Path
import sys
import zipfile
src = Path(sys.argv[1])
out = Path(sys.argv[2])
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    zf.write(src, arcname=src.name)
print(out)
PY
fi

echo "==> Verifying checksum"
sha256sum -c "$CHECKSUM_FILE"

echo
echo "Built artifacts:"
echo "  ISO:      $FINAL_ISO"
[[ -f "$ZIP_FILE" ]] && echo "  ZIP:      $ZIP_FILE"
echo "  SHA256:   $CHECKSUM_FILE"
echo "  Metadata: $METADATA_FILE"

echo
echo "Quick local serve options:"
echo "  python3 -m http.server 8000 --directory $OUTPUT_DIR"
echo "  Then fetch from another machine: http://$(hostname -I | awk '{print $1}'):8000/$(basename "$FINAL_ISO")"

if [[ "$PUBLISH" -eq 1 ]]; then
  echo
  echo "==> Publishing rolling GitHub release: $RELEASE_TAG"
  gh release delete "$RELEASE_TAG" --yes --cleanup-tag || true

  RELEASE_NOTES="Rolling latest autoinstall ISO for freshcrate Agent Edition stable iso-autoinstall-headless."
  RELEASE_ASSETS=("$CHECKSUM_FILE" "$METADATA_FILE")

  if [[ -f "$ZIP_FILE" ]]; then
    ZIP_SIZE_BYTES="$(stat -c '%s' "$ZIP_FILE")"
    if (( ZIP_SIZE_BYTES < GITHUB_ASSET_LIMIT_BYTES )); then
      RELEASE_ASSETS=("$ZIP_FILE" "${RELEASE_ASSETS[@]}")
      RELEASE_NOTES+=" Release ships the zipped ISO plus checksum and metadata."
    else
      SPLIT_PREFIX="${ZIP_FILE}.part-"
      rm -f "${SPLIT_PREFIX}"*
      echo "Zip exceeds GitHub's 2 GiB per-asset limit; splitting into ${SPLIT_PART_SIZE_MB} MiB chunks"
      split -d -b "${SPLIT_PART_SIZE_MB}m" "$ZIP_FILE" "$SPLIT_PREFIX"
      REASSEMBLE_FILE="${ZIP_FILE}.reassemble.txt"
      cat > "$REASSEMBLE_FILE" <<EOF
This ISO zip exceeds GitHub's 2 GiB per-asset limit, so it is split into parts.

Reassemble it with:
  cat $(basename "$SPLIT_PREFIX")* > $(basename "$ZIP_FILE")
  sha256sum $(basename "$ZIP_FILE")
  unzip $(basename "$ZIP_FILE")
EOF
      mapfile -t SPLIT_ASSETS < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name "$(basename "$SPLIT_PREFIX")*" | sort)
      RELEASE_ASSETS=("${SPLIT_ASSETS[@]}" "$REASSEMBLE_FILE" "${RELEASE_ASSETS[@]}")
      RELEASE_NOTES+=" Release ships split zip parts because the zipped ISO exceeds GitHub's 2 GiB per-asset limit."
    fi
  else
    ISO_SIZE_BYTES="$(stat -c '%s' "$FINAL_ISO")"
    if (( ISO_SIZE_BYTES < GITHUB_ASSET_LIMIT_BYTES )); then
      RELEASE_ASSETS=("$FINAL_ISO" "${RELEASE_ASSETS[@]}")
    else
      echo "Built ISO exceeds GitHub's 2 GiB per-asset limit and no zip asset exists." >&2
      exit 1
    fi
  fi

  gh release create "$RELEASE_TAG" \
    "${RELEASE_ASSETS[@]}" \
    --title "freshcrate Agent Edition ISO (latest)" \
    --notes "$RELEASE_NOTES" \
    --latest

  echo "Published release tag: $RELEASE_TAG"
fi

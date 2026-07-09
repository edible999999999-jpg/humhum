#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_DMG="$(find "$ROOT_DIR/src-tauri/target/release/bundle/dmg" -maxdepth 1 -name "*.dmg" -print 2>/dev/null | sort | tail -n 1 || true)"
ARTIFACT_PATH="${ARTIFACT_PATH:-$DEFAULT_DMG}"

if [[ -z "${ARTIFACT_PATH}" || ! -e "${ARTIFACT_PATH}" ]]; then
  echo "No notarization artifact found."
  echo "Run npm run tauri build first, or set ARTIFACT_PATH=/path/to/HumHum.dmg."
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is required. Install Xcode or Xcode Command Line Tools."
  exit 1
fi

echo "Notarizing: ${ARTIFACT_PATH}"

if [[ -n "${NOTARYTOOL_PROFILE:-}" ]]; then
  xcrun notarytool submit "${ARTIFACT_PATH}" \
    --keychain-profile "${NOTARYTOOL_PROFILE}" \
    --wait
else
  : "${APPLE_ID:?Set APPLE_ID or NOTARYTOOL_PROFILE}"
  : "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID or NOTARYTOOL_PROFILE}"
  : "${APPLE_PASSWORD:?Set APPLE_PASSWORD app-specific password or NOTARYTOOL_PROFILE}"

  xcrun notarytool submit "${ARTIFACT_PATH}" \
    --apple-id "${APPLE_ID}" \
    --team-id "${APPLE_TEAM_ID}" \
    --password "${APPLE_PASSWORD}" \
    --wait
fi

echo "Stapling notarization ticket..."
xcrun stapler staple "${ARTIFACT_PATH}"
xcrun stapler validate "${ARTIFACT_PATH}"

echo "Checking Gatekeeper assessment..."
spctl -a -vv --type open "${ARTIFACT_PATH}"

echo "Notarized and stapled successfully: ${ARTIFACT_PATH}"

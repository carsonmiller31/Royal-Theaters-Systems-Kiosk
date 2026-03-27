#!/usr/bin/env bash
set -euo pipefail

# Automated Windows release using GitHub CLI
# - Builds the Windows installer with electron-builder
# - Generates a fresh latest.yml for auto-updates
# - Creates/updates the GitHub release and uploads assets via gh
#
# Requirements:
# - GitHub CLI authenticated (gh auth status)
# - Node/electron-builder installed (npm ci; npx electron-builder)
# - On macOS/Linux, building Windows may require wine/mono; if not available, skip build and just upload existing dist assets

REPO_OWNER="carsonmiller31"
REPO_NAME="Royal-Theaters-Systems-Kiosk"
REPO_SLUG="$REPO_OWNER/$REPO_NAME"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# Helper logging
log() { echo "[release] $*"; }
fail() { echo "[release][error] $*" >&2; exit 1; }

# Check gh login
if ! gh auth status >/dev/null 2>&1; then
  fail "GitHub CLI not authenticated. Run: gh auth login"
fi

# Read version from package.json
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
log "Version detected: $VERSION ($TAG)"

# Attempt to build Windows target if electron-builder can run.
# If build fails (e.g., missing wine), we continue to upload existing artifacts.
log "Building Windows installer (if environment supports it)..."
if command -v npx >/dev/null 2>&1; then
  if npx electron-builder --version >/dev/null 2>&1; then
    if npx electron-builder -w; then
      log "Build completed."
    else
      log "Build failed (likely missing wine/mono). Proceeding with existing artifacts in dist/."
    fi
  else
    log "electron-builder not installed. Proceeding with existing artifacts in dist/."
  fi
else
  log "npx not found. Proceeding with existing artifacts in dist/."
fi

# Determine artifact names/paths
EXE_PATH="dist/RoyalTheaters-Systems-Setup-${VERSION}.exe"
BLOCKMAP_PATH="${EXE_PATH}.blockmap"

# If expected naming not found, fallback to glob of Setup-${VERSION}.exe
if [ ! -f "$EXE_PATH" ]; then
  log "Expected EXE not found at $EXE_PATH. Searching dist/ for *Setup-${VERSION}.exe..."
  EXE_PATH_CANDIDATE=$(ls -1 dist/*Setup-${VERSION}.exe 2>/dev/null | head -n1 || true)
  if [ -n "${EXE_PATH_CANDIDATE:-}" ] && [ -f "$EXE_PATH_CANDIDATE" ]; then
    EXE_PATH="$EXE_PATH_CANDIDATE"
    BLOCKMAP_PATH="${EXE_PATH}.blockmap"
  else
    fail "Could not find a Windows installer EXE for version ${VERSION} in dist/. Build or copy the EXE first."
  fi
fi

EXE_FILE_NAME="$(basename "$EXE_PATH")"
SIZE_BYTES=$(stat -f%z "$EXE_PATH" 2>/dev/null || stat -c%s "$EXE_PATH")
SHA512=$(openssl dgst -sha512 -binary "$EXE_PATH" | openssl base64 -A)

log "EXE: $EXE_FILE_NAME"
log "Size: $SIZE_BYTES bytes"
log "SHA512: $SHA512"

# Generate latest.yml for electron-updater
LATEST_YML="dist/latest.yml"
cat > "$LATEST_YML" <<YAML
version: ${VERSION}
files:
  - url: ${EXE_FILE_NAME}
    sha512: ${SHA512}
    size: ${SIZE_BYTES}
path: ${EXE_FILE_NAME}
sha512: ${SHA512}
releaseDate: '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
YAML

log "Wrote ${LATEST_YML}:"
sed -n '1,120p' "$LATEST_YML"

# Ensure release exists
if gh release view "$TAG" --repo "$REPO_SLUG" >/dev/null 2>&1; then
  log "Release $TAG exists. Will upload assets (clobber)."
else
  log "Creating release $TAG..."
  env -u GH_TOKEN gh release create "$TAG" \
    --repo "$REPO_SLUG" \
    -t "$TAG" \
    -n "Automated release for $TAG"
fi

# Upload assets
UPLOADS=("$LATEST_YML" "$EXE_PATH")
if [ -f "$BLOCKMAP_PATH" ]; then
  UPLOADS+=("$BLOCKMAP_PATH")
fi

log "Uploading assets: ${UPLOADS[*]}"
env -u GH_TOKEN gh release upload "$TAG" "${UPLOADS[@]}" --repo "$REPO_SLUG" --clobber

log "Done. Release URL: https://github.com/${REPO_SLUG}/releases/tag/${TAG}"

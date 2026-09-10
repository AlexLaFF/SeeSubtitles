#!/bin/sh
# Build a release and refuse to hand it over unless macOS would open it on someone else's Mac.
#
# Notarization credentials never live in this repository. Put them in ~/.config/seesubtitles/notarize.env
# (or point SEESUBTITLES_NOTARIZE_ENV somewhere else) and this sources them for the build only:
#
#   APPLE_API_KEY=/Users/you/.config/seesubtitles/AuthKey_XXXXXXXXXX.p8
#   APPLE_API_KEY_ID=XXXXXXXXXX
#   APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#
# electron-builder finds the Developer ID certificate in the login keychain by itself; set CSC_NAME only
# if verify-release.js reports that it picked the wrong one.
set -e
# Best: keep the credentials in the login keychain, where no editor can overwrite them, and put only the
# profile name in the file below. Set it up once with:
#   xcrun notarytool store-credentials seesubtitles --key ~/.config/seesubtitles/AuthKey_XXXXXXXXXX.p8 \
#     --key-id XXXXXXXXXX --issuer <issuer-uuid>
# then set APPLE_KEYCHAIN_PROFILE=seesubtitles and delete the other three.
ENV_FILE="${SEESUBTITLES_NOTARIZE_ENV:-$HOME/.config/seesubtitles/notarize.env}"
if [ -f "$ENV_FILE" ]; then
  echo "· notarization credentials from $ENV_FILE"
  set -a; . "$ENV_FILE"; set +a
else
  echo "⚠ no $ENV_FILE — the build will not be notarized and verify-release.js will refuse it"
fi
npm run dist

# electron-builder notarizes and staples the .app, then builds the dmg *from* it — so the dmg itself
# carries no ticket, and someone who opens it with no network is refused even though the app inside is
# fine. The dmg has to be submitted on its own account.
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('$HERE/../package.json').version")
DMG="$HERE/../dist/See Subtitles-$VERSION-arm64.dmg"
if [ -n "$APPLE_API_KEY" ] && [ -f "$DMG" ]; then
  echo "· notarizing the dmg itself"
  xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
  xcrun stapler staple "$DMG"
fi

node "$HERE/verify-release.js"

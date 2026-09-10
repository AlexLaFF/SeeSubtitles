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
ENV_FILE="${SEESUBTITLES_NOTARIZE_ENV:-$HOME/.config/seesubtitles/notarize.env}"
if [ -f "$ENV_FILE" ]; then
  echo "· notarization credentials from $ENV_FILE"
  set -a; . "$ENV_FILE"; set +a
else
  echo "⚠ no $ENV_FILE — the build will not be notarized and verify-release.js will refuse it"
fi
npm run dist
node "$(dirname "$0")/verify-release.js"

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
# electron-builder checks API-key variables before the keychain profile. An ID and issuer left in this shared
# file for other Apple tools look like incomplete API credentials and stop its notarization before it tries the
# valid profile. Keep the profile path clean unless all three API-key variables were supplied.
if [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ] && [ -z "${APPLE_API_KEY:-}" ]; then
  unset APPLE_API_KEY_ID APPLE_API_ISSUER
fi
# electron-builder hands APPLE_KEYCHAIN_PROFILE to notarytool. Leave APPLE_KEYCHAIN unset unless the profile
# really lives in one particular keychain file: `notarytool store-credentials` keeps profiles in the
# data-protection keychain, which an explicit `--keychain <file>` excludes — naming the login keychain here made
# every build refuse notarization with "No Keychain password item found for profile".
# A version number names one set of contents, once. The updater only ever moves a copy to a *higher* number, so a
# second "0.8.1" built from other code never reaches whoever has the first — and nobody can tell the two apart
# (2026-09-21: six builds all called 0.8.1). dist/built.json says what each number was built from, written only when
# a build is RELEASABLE; the same commit may be built again (a signing step lost to the network), other code may not.
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
THIS_VERSION=$(node -p "require('$SCRIPTS/../package.json').version")
THIS_COMMIT=$(git -C "$SCRIPTS" rev-parse --short HEAD)
BUILT_FROM=$(node -e "try { process.stdout.write(String(require('$SCRIPTS/../dist/built.json')['$THIS_VERSION'] || '')) } catch { }")
if [ -n "$BUILT_FROM" ] && [ "$BUILT_FROM" != "$THIS_COMMIT" ]; then
  echo "✖ $THIS_VERSION has already been built, from $BUILT_FROM — this is $THIS_COMMIT." >&2
  echo "  Different code gets a new number: bump desktop/package.json and run this again." >&2
  exit 1
fi
# Every release first passes the release test on the server: the whole app below its windows, end to end, with real
# recordings and the real keys (e2e/run.js). A failure stops here, before anything is built or sent to Apple.
sh "$(dirname "$0")/e2e-on-server.sh"

npm run dist

# electron-builder notarizes and staples the .app, then builds the dmg *from* it — so the dmg itself
# carries no ticket, and someone who opens it with no network is refused even though the app inside is
# fine. The dmg has to be submitted on its own account.
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('$HERE/../package.json').version")
DMG="$HERE/../dist/See Subtitles-$VERSION-arm64.dmg"
if [ -f "$DMG" ]; then
  # Either way of holding the credentials works: a keychain profile (preferred — nothing on disk for an
  # editor to overwrite) or the three variables.
  if [ -n "$APPLE_KEYCHAIN_PROFILE" ]; then
    echo "· notarizing the dmg itself (keychain profile $APPLE_KEYCHAIN_PROFILE)"
    xcrun notarytool submit "$DMG" --keychain-profile "$APPLE_KEYCHAIN_PROFILE" --no-progress --wait
    xcrun stapler staple "$DMG"
  elif [ -n "$APPLE_API_KEY" ]; then
    echo "· notarizing the dmg itself"
    xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --no-progress --wait
    xcrun stapler staple "$DMG"
  else
    echo "⚠ no notarization credentials — verify-release.js will refuse this build"
  fi
fi

# Stapling changes the DMG's bytes after electron-builder writes the blockmap and update manifest.
# Refresh both so the public download and auto-updater describe the ticketed file exactly.
if [ -f "$DMG" ]; then node "$HERE/refresh-release-metadata.js" "$DMG"; fi

node "$HERE/verify-release.js"
# RELEASABLE: from now on this number means this commit
node -e "const fs = require('fs'); const f = '$HERE/../dist/built.json'; let m = {}; try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { } m['$THIS_VERSION'] = '$THIS_COMMIT'; fs.writeFileSync(f, JSON.stringify(m, null, 2));"

cat <<'CHECKLIST'

Before publishing, open the build once and check what the release test cannot see — the windows:
  1. dist/mac-arm64/See Subtitles.app opens and the account page shows you logged in
  2. Start subtitles: lines appear in the control window and on the display
  3. Settings (⌘,) opens; Keys reads "none needed"; a glossary entry saves
  4. Stop: the recording appears in Files with its MP3, subtitles and MP4
  5. Files › a recording › AI summary › PDF: the PDF opens
  6. Share to screens: the QR code opens the display page on a phone
CHECKLIST

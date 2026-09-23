#!/bin/sh
# Build the iPhone app for TestFlight and send it to App Store Connect. The phone's counterpart of
# desktop/scripts/release.sh, and like it, reaching Apple with the App Store Connect API key that notarize.env
# names — the same key that notarizes the Mac app. The archive registers the app's identifiers and makes its
# profiles on the account through it; the upload and the confirmation go out through it too.
#
#   sh ios/scripts/testflight.sh            # test, archive, upload
#   sh ios/scripts/testflight.sh archive    # only build the archive
#   sh ios/scripts/testflight.sh upload     # send the last archive
#   SKIP_E2E=1 sh ios/scripts/testflight.sh # when `npm run e2e:ios` has just passed on this very tree
#
# The App Store Connect record ("See Subtitles", bundle com.algernonlabs.seesubtitles) is made once by hand at
# https://appstoreconnect.apple.com/apps — the upload names it when it is missing.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Xcode's own sign-in reaches developer.apple.com, which from this Mac often does not answer in time; an App Store
# Connect API key goes to appstoreconnect.apple.com, which does. So when ~/.config/seesubtitles/notarize.env names
# one (APPLE_API_KEY_ID and APPLE_API_ISSUER — the names desktop/scripts/release.sh documents; APPLE_API_KEY is the
# .p8, looked for beside the file when unset), every call to Apple below uses it instead of the Xcode account. The
# key needs the Developer role or above to upload a build.
ENV_FILE="${SEESUBTITLES_NOTARIZE_ENV:-$HOME/.config/seesubtitles/notarize.env}"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }
AUTH=""
if [ -n "$APPLE_API_KEY_ID" ] && [ -n "$APPLE_API_ISSUER" ]; then
  APPLE_API_KEY="${APPLE_API_KEY:-$(dirname "$ENV_FILE")/AuthKey_$APPLE_API_KEY_ID.p8}"
  [ -f "$APPLE_API_KEY" ] || { echo "✖ APPLE_API_KEY_ID is set but there is no key at $APPLE_API_KEY" >&2; exit 1; }
  AUTH="-authenticationKeyPath $APPLE_API_KEY -authenticationKeyID $APPLE_API_KEY_ID -authenticationKeyIssuerID $APPLE_API_ISSUER"
  echo "· App Store Connect through API key $APPLE_API_KEY_ID"
else
  echo "· App Store Connect through the Apple ID signed in to Xcode (set APPLE_API_KEY_ID and APPLE_API_ISSUER in $ENV_FILE to use a key instead)"
fi
OUT="$ROOT/ios/build/testflight"
ARCHIVE="$OUT/SeeSubtitles.xcarchive"
STEP="${1:-all}"

# A version number names one set of contents, once (CLAUDE.md). The marketing version is the project's; the build
# number is the count of commits behind HEAD, so every build says which commit it is and App Store Connect never
# sees the same number twice for different code. A tree with the phone's inputs changed is not a commit: refuse.
DIRTY=$(git -C "$ROOT" status --porcelain -- ios core web | grep -v '^?? ios/build/' || true)
if [ -n "$DIRTY" ] && [ "$STEP" != upload ]; then # `upload` sends what was archived; the tree since is beside the point
  echo "✖ uncommitted changes under ios/, core/ or web/ — the phone is built from these; commit first:" >&2
  echo "$DIRTY" >&2
  exit 1
fi
BUILD=$(git -C "$ROOT" rev-list --count HEAD)
VERSION=$(sed -n 's/.*MARKETING_VERSION = \([0-9.]*\);/\1/p' "$ROOT/ios/SeeSubtitles.xcodeproj/project.pbxproj" | head -1)
COMMIT=$(git -C "$ROOT" rev-parse --short HEAD)

if [ "$STEP" = all ] || [ "$STEP" = archive ]; then
  if [ -z "$SKIP_E2E" ]; then
    # Never ship a build the release test rejects: unit tests, the networking code against the real server, and the
    # app driven in the Simulator (ios/e2e/run.mjs). Five minutes, no keys, no cost.
    (cd "$ROOT" && npm run e2e:ios)
  fi
  echo "── archiving See Subtitles $VERSION ($BUILD) from $COMMIT"
  rm -rf "$ARCHIVE"
  mkdir -p "$OUT"
  xcodebuild -project "$ROOT/ios/SeeSubtitles.xcodeproj" -scheme SeeSubtitles -configuration Release \
    -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -derivedDataPath "$OUT/DerivedData" \
    -allowProvisioningUpdates $AUTH CURRENT_PROJECT_VERSION="$BUILD" archive 2>&1 | tee "$OUT/archive.log" \
    | grep -E 'error:|warning: .*(sign|provision)|Registering|Provisioning profile|ARCHIVE (SUCCEEDED|FAILED)' || true
  grep -q 'ARCHIVE SUCCEEDED' "$OUT/archive.log" || { echo "✖ the archive failed — $OUT/archive.log" >&2; exit 1; }
fi

if [ "$STEP" = all ] || [ "$STEP" = upload ]; then
  [ -d "$ARCHIVE" ] || { echo "✖ no archive at $ARCHIVE — run the archive step first" >&2; exit 1; }
  [ -n "$AUTH" ] || { echo "✖ uploading needs the API key: set APPLE_API_KEY_ID and APPLE_API_ISSUER in $ENV_FILE" >&2; exit 1; }
  BUILD=$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIVE/Info.plist")
  # The archive is development-signed. export-ipa.sh signs it for the App Store — the profiles from App Store
  # Connect, the distribution certificate — and zips the .ipa; `xcodebuild -exportArchive` did the same until it
  # hung twice on this Mac (Xcode 27.0's App Store helper). Two steps rather than one upload, so an upload that
  # dies on the network leaves the .ipa to send again for nothing.
  echo "── exporting build $BUILD for the App Store"
  sh "$ROOT/ios/scripts/export-ipa.sh" "$ARCHIVE" "$OUT/export"
  IPA=$(ls "$OUT"/export/*.ipa | head -1)

  echo "── uploading to App Store Connect"
  # altool finds the key by its id in ~/.appstoreconnect/private_keys (Apple's convention, the journal project's too).
  mkdir -p "$HOME/.appstoreconnect/private_keys"
  [ -e "$HOME/.appstoreconnect/private_keys/AuthKey_$APPLE_API_KEY_ID.p8" ] || ln -s "$APPLE_API_KEY" "$HOME/.appstoreconnect/private_keys/AuthKey_$APPLE_API_KEY_ID.p8"
  # altool on this Mac is unreliable in two ways, both worth another go: it crashes at start now and then (a
  # Foundation URL-parsing fault inside ContentDelivery's own initialisation — altool-*.ips), and when the link
  # drops mid-upload it gives up and then spends half an hour collecting diagnostics. So: up to six tries, each
  # allowed eight minutes — a good one takes about one for this .ipa — and killed past that.
  #
  # Apple's Transporter app (Mac App Store, free) carries its own uploader, which is used instead whenever it is
  # installed: it does not go through ContentDelivery at all, and on 2026-09-22 it sent build 153 at the first try
  # after altool had failed six times in a row. The same key, found the same way (~/.appstoreconnect/private_keys).
  TRANSPORTER=/Applications/Transporter.app/Contents/itms/bin/iTMSTransporter
  upload_once() {
    if [ -x "$TRANSPORTER" ]; then
      "$TRANSPORTER" -m upload -assetFile "$IPA" -apiKey "$APPLE_API_KEY_ID" -apiIssuer "$APPLE_API_ISSUER" -v informational > "$OUT/upload.log" 2>&1
    else
      xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER" > "$OUT/upload.log" 2>&1
    fi
  }
  [ -x "$TRANSPORTER" ] && echo "   with Transporter" || echo "   with altool (install Transporter from the Mac App Store for a sturdier upload)"
  # Twenty minutes an attempt: Transporter took two on a good link and had not finished in eight on a bad one.
  # Every kill ends in `|| true` — `set -e` and a pkill that matches nothing ended the script mid-retry once.
  n=0
  while :; do
    n=$((n + 1))
    upload_once &
    pid=$!; waited=0
    while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 1200 ]; do sleep 5; waited=$((waited + 5)); done
    if kill -0 "$pid" 2>/dev/null; then
      pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true
      pkill -f 'log stream --predicate process contains "altool"' 2>/dev/null || true
      echo "· upload attempt $n: no answer in twenty minutes";
    elif grep -q "UPLOAD SUCCEEDED\|No errors uploading\|uploaded successfully" "$OUT/upload.log"; then break
    else echo "· upload attempt $n failed: $(grep -iE 'error' "$OUT/upload.log" | sed -E 's/UserInfo=.*//' | head -1 | cut -c1-160)"; fi
    [ "$n" -ge 4 ] && { echo "✖ the upload failed four times — $OUT/upload.log; the .ipa is kept, run \`upload\` again" >&2; exit 1; }
    sleep 10
  done
  # Confirmed with App Store Connect itself rather than trusted from the log — Xcode's Organizer never shows an
  # upload it did not make.
  echo "── confirming with App Store Connect"
  node "$ROOT/ios/scripts/asc.mjs" build com.algernonlabs.seesubtitles "$BUILD" || true
  echo "✓ See Subtitles $VERSION ($BUILD) is with App Store Connect. It appears under TestFlight once Apple has"
  echo "  processed it (usually 10–30 minutes, an email says when); add it to a tester group there."
  # The archive stays (`upload` re-runs from it); the quarter-gigabyte of DerivedData behind it has no second use.
  rm -rf "$OUT/DerivedData"
fi

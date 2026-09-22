#!/bin/sh
# Build the iPhone app for TestFlight and send it to App Store Connect. The phone's counterpart of
# desktop/scripts/release.sh, and like it, run from the Mac with the Apple ID of team 6DZ5Z54SPQ signed in to
# Xcode (Xcode › Settings › Accounts): the archive lets Xcode register the app's identifiers and make its
# profiles on the account, and the upload goes out under the same login, so nothing here needs a key on disk.
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
OUT="$ROOT/ios/build/testflight"
ARCHIVE="$OUT/SeeSubtitles.xcarchive"
STEP="${1:-all}"

# A version number names one set of contents, once (CLAUDE.md). The marketing version is the project's; the build
# number is the count of commits behind HEAD, so every build says which commit it is and App Store Connect never
# sees the same number twice for different code. A tree with the phone's inputs changed is not a commit: refuse.
DIRTY=$(git -C "$ROOT" status --porcelain -- ios core web | grep -v '^?? ios/build/' || true)
if [ -n "$DIRTY" ]; then
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
    -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" archive 2>&1 | tee "$OUT/archive.log" \
    | grep -E 'error:|warning: .*(sign|provision)|Registering|Provisioning profile|ARCHIVE (SUCCEEDED|FAILED)' || true
  grep -q 'ARCHIVE SUCCEEDED' "$OUT/archive.log" || { echo "✖ the archive failed — $OUT/archive.log" >&2; exit 1; }
fi

if [ "$STEP" = all ] || [ "$STEP" = upload ]; then
  [ -d "$ARCHIVE" ] || { echo "✖ no archive at $ARCHIVE — run the archive step first" >&2; exit 1; }
  cat > "$OUT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>6DZ5Z54SPQ</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
EOF
  echo "── uploading $(basename "$ARCHIVE") to App Store Connect"
  # Apple's upload servers are slow to answer from here: three tries before giving up, the archive kept either way.
  n=0
  until xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OUT/ExportOptions.plist" \
      -exportPath "$OUT/export" -allowProvisioningUpdates 2>&1 | tee "$OUT/upload.log" | grep -E 'error:|Upload|EXPORT (SUCCEEDED|FAILED)'; do
    n=$((n + 1)); [ "$n" -ge 3 ] && break
    echo "· upload attempt $n failed, trying again"
  done
  grep -q 'EXPORT SUCCEEDED' "$OUT/upload.log" || { echo "✖ the upload failed — $OUT/upload.log" >&2; exit 1; }
  echo "✓ See Subtitles $VERSION ($BUILD) is with App Store Connect. It appears under TestFlight once Apple has"
  echo "  processed it (usually 10–30 minutes, an email says when); add it to a tester group there."
fi

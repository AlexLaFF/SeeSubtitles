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
    -allowProvisioningUpdates $AUTH CURRENT_PROJECT_VERSION="$BUILD" archive 2>&1 | tee "$OUT/archive.log" \
    | grep -E 'error:|warning: .*(sign|provision)|Registering|Provisioning profile|ARCHIVE (SUCCEEDED|FAILED)' || true
  grep -q 'ARCHIVE SUCCEEDED' "$OUT/archive.log" || { echo "✖ the archive failed — $OUT/archive.log" >&2; exit 1; }
fi

if [ "$STEP" = all ] || [ "$STEP" = upload ]; then
  [ -d "$ARCHIVE" ] || { echo "✖ no archive at $ARCHIVE — run the archive step first" >&2; exit 1; }
  [ -n "$AUTH" ] || { echo "✖ uploading needs the API key: set APPLE_API_KEY_ID and APPLE_API_ISSUER in $ENV_FILE" >&2; exit 1; }
  BUILD=$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIVE/Info.plist")
  # The archive is development-signed; this re-signs it for the App Store into an .ipa. Two steps rather than
  # xcodebuild's own upload, so an upload that dies on the network leaves the .ipa to send again for nothing.
  echo "── exporting build $BUILD for the App Store"
  cat > "$OUT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>6DZ5Z54SPQ</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
EOF
  rm -rf "$OUT/export"
  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OUT/ExportOptions.plist" \
    -exportPath "$OUT/export" -allowProvisioningUpdates $AUTH > "$OUT/export.log" 2>&1 || true
  grep -E 'error:|EXPORT (SUCCEEDED|FAILED)' "$OUT/export.log" | sort -u
  IPA=$(ls "$OUT"/export/*.ipa 2>/dev/null | head -1 || true)
  if [ ! -f "$IPA" ]; then
    # The two failures everyone meets first, named, because Apple's lines for them do not say what to do.
    if grep -q "Cloud signing permission error" "$OUT/export.log"; then
      echo "✖ the key may not make provisioning profiles. A key with the Developer role uploads builds but cannot" >&2
      echo "  create the App Store profiles the export needs. Make one with the App Manager role at" >&2
      echo "  https://appstoreconnect.apple.com/access/integrations/api (+, name it, App Manager, Generate, Download)," >&2
      echo "  put the .p8 beside $ENV_FILE and set APPLE_API_KEY_ID to its id." >&2
    elif ! security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Distribution"; then
      echo "✖ no Apple Distribution certificate on this Mac: Xcode › Settings › Accounts › Manage Certificates › + › Apple Distribution" >&2
    else
      echo "✖ no .ipa was exported — $OUT/export.log" >&2
    fi
    exit 1
  fi
  echo "   $(basename "$IPA") · $(du -h "$IPA" | cut -f1)"

  echo "── uploading to App Store Connect"
  n=0
  until xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER" \
      > "$OUT/upload.log" 2>&1 && grep -q "UPLOAD SUCCEEDED\|No errors uploading" "$OUT/upload.log"; do
    n=$((n + 1))
    grep -iE "error|warn" "$OUT/upload.log" | head -3
    [ "$n" -ge 3 ] && { echo "✖ the upload failed three times — $OUT/upload.log; the .ipa is kept, run \`upload\` again" >&2; exit 1; }
    echo "· upload attempt $n failed, trying again"
  done
  # Confirmed with App Store Connect itself rather than trusted from the log — Xcode's Organizer never shows an
  # upload it did not make. The API is asked with a short-lived token signed by the same key (node, no packages).
  echo "── confirming with App Store Connect"
  APPLE_API_KEY="$APPLE_API_KEY" node - "$APPLE_API_KEY_ID" "$APPLE_API_ISSUER" "$BUILD" <<'NODE' || echo "   (not confirmed yet — Apple may still be processing; check TestFlight)"
const { createSign, createPrivateKey } = require('node:crypto');
const [keyId, issuer, build] = process.argv.slice(2);
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' }), body = b64({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
const key = createPrivateKey(require('node:fs').readFileSync(process.env.APPLE_API_KEY));
const sig = createSign('SHA256').update(`${head}.${body}`).sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const token = `${head}.${body}.${sig}`;
const get = async (path) => {
  const r = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
(async () => {
  const apps = await get('apps?filter[bundleId]=com.algernonlabs.seesubtitles');
  if (!apps.data.length) { console.log('   App Store Connect has no app record for com.algernonlabs.seesubtitles yet — make it at https://appstoreconnect.apple.com/apps'); process.exit(1); }
  // The builds list lags behind Apple by minutes; the prerelease version's own builds show a build as soon as it arrives.
  for (let i = 0; i < 10; i++) {
    const v = await get(`preReleaseVersions?filter[app]=${apps.data[0].id}&limit=3&include=builds`);
    const hit = (v.included || []).find((b) => b.type === 'builds' && b.attributes.version === build);
    if (hit) { console.log(`   Apple has build ${build}: ${hit.attributes.processingState}`); return; }
    await new Promise((r) => setTimeout(r, 20000));
  }
  console.log(`   build ${build} is not listed yet — still on its way; check TestFlight in a few minutes`); process.exit(1);
})().catch((e) => { console.log(`   could not ask App Store Connect: ${e.message}`); process.exit(1); });
NODE
  echo "✓ See Subtitles $VERSION ($BUILD) is with App Store Connect. It appears under TestFlight once Apple has"
  echo "  processed it (usually 10–30 minutes, an email says when); add it to a tester group there."
fi

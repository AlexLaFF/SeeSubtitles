#!/bin/sh
# An App Store .ipa from an archive, signed here rather than by `xcodebuild -exportArchive` — which on this Mac sat for
# ten minutes twice (Xcode 27.0's App Store helper, once crashed, once stuck before its first request). The same steps,
# done plainly: the App Store profiles for the app and its widget extension from App Store Connect (asc.mjs makes
# them when they do not exist), the archive's development signature replaced by a distribution one carrying the
# entitlements each profile grants, and the result zipped as Payload/.
#
#   sh ios/scripts/export-ipa.sh <archive.xcarchive> <out dir>     → <out dir>/See Subtitles.ipa
set -e
ARCHIVE="$1"; OUT="$2"
[ -d "$ARCHIVE" ] && [ -n "$OUT" ] || { echo "usage: export-ipa.sh <archive.xcarchive> <out dir>" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
APP=$(ls -d "$ARCHIVE"/Products/Applications/*.app | head -1)
TEAM=$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:Team' "$ARCHIVE/Info.plist")
IDENTITY=$(security find-identity -v -p codesigning | sed -n "s/.*\"\(Apple Distribution: .*($TEAM)\)\".*/\1/p" | head -1)
[ -n "$IDENTITY" ] || { echo "✖ no Apple Distribution certificate for team $TEAM on this Mac: Xcode › Settings › Accounts › Manage Certificates › + › Apple Distribution" >&2; exit 1; }

mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd); PROFILES="$(dirname "$OUT")/profiles"
rm -rf "$OUT"; mkdir -p "$OUT/Payload" "$PROFILES"
cp -R "$APP" "$OUT/Payload/"
APP="$OUT/Payload/$(basename "$APP")"
APP_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
IDS="$APP_ID" # the app's name has a space in it, so paths are never word-split: the extensions are found by glob, twice
for x in "$APP"/PlugIns/*.appex; do [ -d "$x" ] && IDS="$IDS $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$x/Info.plist")"; done

# The profiles are kept beside the archive and asked for only when one is missing: they last a year, and the link
# to Apple from here drops enough requests that a lookup which is not needed is a lookup that may fail.
missing=""
for id in $IDS; do
  profile="$PROFILES/$id.mobileprovision"
  # Enabling Sign in with Apple invalidated the old app profile. A cached copy can still be on this Mac:
  # never sign a new archive with it if it lacks the entitlement the archive now requests.
  if [ "$id" = "$APP_ID" ] && [ -f "$profile" ] && ! openssl cms -verify -noverify -inform DER -in "$profile" 2>/dev/null | grep -q 'com.apple.developer.applesignin'; then
    rm -f "$profile"
  fi
  [ -f "$profile" ] || missing="$missing $id"
done
if [ -n "$missing" ]; then
  echo "── App Store profiles for:$missing"
  node "$HERE/asc.mjs" profiles "$PROFILES" $missing
else
  echo "── App Store profiles on hand for: $IDS"
fi

# Signs one bundle: its profile goes in as embedded.mobileprovision, and it is signed with the entitlements the
# archive gave it — the app's own (its associated domain, not the profile's wildcard) — with get-task-allow off,
# which is the one thing a distribution signature changes.
sign() {
  bundle="$1"; id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$bundle/Info.plist")
  cp "$PROFILES/$id.mobileprovision" "$bundle/embedded.mobileprovision"
  codesign -d --entitlements :- "$bundle" > "$PROFILES/$id.entitlements" 2>/dev/null
  /usr/libexec/PlistBuddy -c 'Set :get-task-allow false' "$PROFILES/$id.entitlements" 2>/dev/null || /usr/libexec/PlistBuddy -c 'Add :get-task-allow bool false' "$PROFILES/$id.entitlements"
  rm -rf "$bundle/_CodeSignature"
  codesign --force --sign "$IDENTITY" --entitlements "$PROFILES/$id.entitlements" --timestamp=none "$bundle"
  echo "   signed $(basename "$bundle") as $id"
}
for x in "$APP"/PlugIns/*.appex; do [ -d "$x" ] && sign "$x"; done
sign "$APP"
codesign --verify --deep --strict "$APP"

IPA="$OUT/$(basename "$APP" .app).ipa"
(cd "$OUT" && zip -qry "$IPA" Payload)
echo "── $IPA · $(du -h "$IPA" | cut -f1)"

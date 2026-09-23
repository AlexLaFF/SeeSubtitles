#!/bin/sh
# Advertise an externally approved TestFlight build to the phone's quiet launch check.
# Run after assigning the build to the external group and Apple has approved it:
#   sh ios/scripts/publish-testflight-update.sh 189
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="${1:-}"
case "$BUILD" in ''|*[!0-9]*) echo 'pass the numeric TestFlight build number' >&2; exit 2;; esac
ENV_FILE="${SEESUBTITLES_NOTARIZE_ENV:-$HOME/.config/seesubtitles/notarize.env}"
[ -f "$ENV_FILE" ] || { echo 'App Store Connect credentials not found' >&2; exit 2; }
set -a; . "$ENV_FILE"; set +a
ASC="$ROOT/ios/scripts/asc.mjs"
APP_ID="${TESTFLIGHT_APP_ID:-6814752765}"
GROUP_ID="${TESTFLIGHT_GROUP_ID:-be5ca16d-23d8-4774-86c3-efc512e49bca}"
ID=$(node "$ASC" GET "preReleaseVersions?filter[app]=$APP_ID&limit=3&include=builds" \
  | jq -r --arg build "$BUILD" '.included[]? | select(.type == "builds" and .attributes.version == $build) | .id' | head -1)
[ -n "$ID" ] || { echo "Build $BUILD is not in App Store Connect" >&2; exit 1; }
STATE=$(node "$ASC" GET "builds/$ID/buildBetaDetail" | jq -r '.data.attributes.externalBuildState')
[ "$STATE" = IN_BETA_TESTING ] || { echo "Build $BUILD is not approved for external TestFlight ($STATE)" >&2; exit 1; }
node "$ASC" GET "betaGroups/$GROUP_ID/builds?limit=100" \
  | jq -e --arg id "$ID" 'any(.data[]; .id == $id)' >/dev/null \
  || { echo "Build $BUILD is not in the external tester group" >&2; exit 1; }
VERSION=$(sed -n 's/.*MARKETING_VERSION = \([0-9.]*\);/\1/p' "$ROOT/ios/SeeSubtitles.xcodeproj/project.pbxproj" | head -1)
[ -n "$VERSION" ] || { echo 'Marketing version not found' >&2; exit 1; }
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
printf '{"version":"%s","build":%s,"channel":"testflight","url":"https://apps.apple.com/app/testflight/id899247664"}\n' "$VERSION" "$BUILD" > "$TMP"
scp -q "$TMP" subtitle-hk:latest-ios-staged.json
ssh subtitle-hk 'set -e; sudo docker cp latest-ios-staged.json deploy-app-1:/data/updates/latest-ios.json.next; sudo docker exec deploy-app-1 mv /data/updates/latest-ios.json.next /data/updates/latest-ios.json; rm latest-ios-staged.json'
echo "Published iOS build $BUILD to /api/ios/version"

#!/bin/sh
# The phone's core against real recognition, real translation and a real summary — the iOS counterpart of
# `npm run e2e`, and like it a run that spends a little Tencent time (about ¥0.3).
#
# The keys exist only on the server and stay there. So this ships the committed code to the server, starts a
# throwaway copy of it in the test image beside the running service — its own database, its own port bound to the
# server's loopback, the server's own deploy/.env, capped at one core and 900 MB — and reaches it from this Mac
# through an ssh tunnel. EndToEndTests.swift then runs here, with one of the private recordings in ~/e2e-fixtures
# standing in for the room; that recording is copied to a temporary folder on this Mac and deleted afterwards.
# Nothing is deployed, the live service's database is not touched, and it will not start while a talk is running.
# The accounts are made for the run (accounts.cjs) with a password made up on the spot, and vanish with the container.
#
#   sh ios/e2e/real-on-server.sh
set -eu
HOST="${SEESUBTITLES_SSH:-subtitle-hk}"
REMOTE_PORT=8099
LOCAL_PORT=18099
NAME=seesubtitles-ios-e2e
cd "$(dirname "$0")/../.."
# One connection, reused by every command below: a link to Hong Kong that resets one connection in five should be
# asked for as few as possible. Keepalives, so a connection that dies without a word is given up on, not waited for.
CTL=$(mktemp -d)
SSHOPTS="-o ControlMaster=auto -o ControlPath=$CTL/%C -o ControlPersist=300 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o ConnectTimeout=20"
ssh() { command ssh $SSHOPTS "$@"; }
retry() { for attempt in 1 2 3; do "$@" && return 0; echo "  · the connection dropped (attempt $attempt) — trying again" >&2; sleep 5; done; return 1; }

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "✖ uncommitted changes: this runs the committed code, so commit first" >&2
  exit 1
fi
echo "▶ iOS end-to-end with real keys, for $(git rev-parse --short HEAD), on $HOST"

retry ssh "$HOST" true
TALKS=$(ssh "$HOST" 'sh ~/SeeSubtitles/deploy/talks.sh 2>/dev/null' || echo unknown)
case "${TALKS%% *}" in
  0) ;;
  unknown|'') echo "· could not ask the server whether a talk is running — going ahead" ;;
  *) echo "✖ the server is carrying a talk right now ($TALKS) — run this once it is over" >&2; exit 1 ;;
esac

LOCAL=$(mktemp -d)
chmod 700 "$LOCAL"
SOCKET="$LOCAL/tunnel"
cleanup() {
  command ssh -S "$SOCKET" -O exit "$HOST" 2>/dev/null || true
  ssh "$HOST" "docker rm -f $NAME >/dev/null 2>&1; rm -rf ~/ios-e2e-src" 2>/dev/null || true
  command ssh -o ControlPath="$CTL/%C" -O exit "$HOST" 2>/dev/null || true
  rm -rf "$LOCAL" "$CTL"
}
trap cleanup EXIT INT TERM

ship() { git archive --format=tar HEAD | ssh "$HOST" 'rm -rf ~/ios-e2e-src && mkdir -p ~/ios-e2e-src && tar -x -C ~/ios-e2e-src'; }
retry ship
ssh "$HOST" 'cd ~/ios-e2e-src && docker build -q -t seesubtitles-e2e -f e2e/Dockerfile . >/dev/null && echo "  test image built"'

PASSWORD=$(openssl rand -hex 12)
# -e after --env-file wins: this copy gets its own port, data and address, asks nobody for anything by webhook or
# mail, and keeps the real keys, the real edge and the real models.
ssh "$HOST" "docker rm -f $NAME >/dev/null 2>&1; docker run -d --rm --name $NAME --cpus 1 --memory 900m --env-file ~/SeeSubtitles/deploy/.env \
  -e PORT=$REMOTE_PORT -e HOST=0.0.0.0 -e DATA_DIR=/tmp/data -e BASE_URL=http://127.0.0.1:$LOCAL_PORT -e SIGNUP_MODE=closed -e REQUEST_WEBHOOK_URL= -e SMTP_HOST= \
  -e TENCENT_WS_URL= -e TOKENHUB_BASE_URL= -e SUMMARY_EFFORT=low -e E2E_PASSWORD=$PASSWORD -p 127.0.0.1:$REMOTE_PORT:$REMOTE_PORT -v ~/ios-e2e-src/ios/e2e:/ios-e2e:ro \
  seesubtitles-e2e sh -c 'node /ios-e2e/accounts.cjs /app/server && exec node server/server.js' >/dev/null && echo '  throwaway server started'"

# the recording that stands in for the room: the one the Mac's release test calls its baseline
CLIP=$(ssh "$HOST" "node -e \"const m=require(process.env.HOME+'/e2e-fixtures/manifest.json'); const c=m.clips.baseline||Object.values(m.clips)[0]; console.log(c.file)\"")
retry command scp -q $SSHOPTS "$HOST:e2e-fixtures/$CLIP" "$LOCAL/room.wav"
echo "  recording: $CLIP ($(du -h "$LOCAL/room.wav" | cut -f1))"

command ssh -M -S "$SOCKET" -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -L "$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" "$HOST"
for i in $(seq 1 40); do
  if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$LOCAL_PORT/healthz"; then break; fi
  sleep 1
done
curl -s --max-time 5 "http://127.0.0.1:$LOCAL_PORT/healthz" >/dev/null || { echo "✖ the throwaway server did not answer through the tunnel" >&2; ssh "$HOST" "docker logs --tail 20 $NAME" >&2; exit 1; }
echo "  reachable at http://127.0.0.1:$LOCAL_PORT"

set +e
( cd ios/Packages/SubtitlesCore && E2E_SERVER="http://127.0.0.1:$LOCAL_PORT" E2E_PASSWORD="$PASSWORD" E2E_AUDIO="$LOCAL/room.wav" \
    E2E_OWNER=owner@e2e.test E2E_BUSINESS=business@e2e.test E2E_HOBBY=hobby@e2e.test E2E_SPENT=spent@e2e.test \
    swift test --filter EndToEndTests > "$LOCAL/swift.txt" 2>&1 )
RESULT=$?
set -e
sed -e 's/\x1b\[[0-9;]*m//g' "$LOCAL/swift.txt" | grep -E "✔|✘|↳ |recorded an issue|error:|Test run|skipped" || true
echo "── what the server saw"
ssh "$HOST" "docker logs $NAME 2>&1 | grep -E 'live:|summary for|job |STAND-INS|translation backend' | tail -25" || true

if [ "$RESULT" -ne 0 ]; then echo "✖ the iOS end-to-end run with real keys failed" >&2; exit 1; fi
echo "✔ the iOS end-to-end run with real keys passed"

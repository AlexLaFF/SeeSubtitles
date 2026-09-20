#!/bin/sh
# Run the release test (e2e/run.js) on the server, against the exact commit being released.
#
# The tests need the real Tencent and TokenHub keys, which exist only on the server, so this ships the committed
# code there, builds a throwaway test image beside the running service, and runs it with the server's own
# deploy/.env and the private recordings in ~/e2e-fixtures. Nothing is deployed, nothing touches the live
# service's database, and the keys never leave the machine they are on. It will not start while a talk is running.
#
#   npm run e2e
set -eu
HOST="${SEESUBTITLES_SSH:-subtitle-hk}"
cd "$(dirname "$0")/../.."
# A connection to Hong Kong that dies without a word would otherwise leave this waiting for ever — it did, on
# 20 September, for a quarter of an hour on an image that was never being built. Ask every 15 s; give up after two minutes of silence.
# One connection reused by every command: a link that resets one connection in five should be asked for few.
CTL=$(mktemp -d /tmp/ss.XXXXXX) # short on purpose: a socket's path may not pass 104 bytes, and macOS's own temporary folder nearly does by itself
trap 'command ssh -o ControlPath="$CTL/c" -O exit "$HOST" 2>/dev/null; rm -rf "$CTL"' EXIT
ssh() { command ssh -o ControlMaster=auto -o ControlPath="$CTL/c" -o ControlPersist=300 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o ConnectTimeout=20 "$@"; }

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "✖ uncommitted changes: the release test runs the committed code, so commit first" >&2
  exit 1
fi
echo "▶ release test for $(git rev-parse --short HEAD) on $HOST"

# A talk in progress would share the server's two cores with the test: wait for it to end instead.
TALKS=$(ssh "$HOST" 'sh ~/SeeSubtitles/deploy/talks.sh 2>/dev/null' || echo unknown)
case "${TALKS%% *}" in
  0) ;;
  unknown|'') echo "· could not ask the server whether a talk is running — going ahead" ;;
  *) echo "✖ the server is carrying a talk right now ($TALKS) — run the release test once it is over" >&2; exit 1 ;;
esac

git archive --format=tar HEAD | ssh "$HOST" 'rm -rf ~/e2e-src && mkdir -p ~/e2e-src && tar -x -C ~/e2e-src'
ssh "$HOST" 'docker image prune -f >/dev/null; cd ~/e2e-src && docker build -q -t seesubtitles-e2e -f e2e/Dockerfile . >/dev/null && echo "  test image built"'
# --cpus / --memory keep the running service responsive; --env-file is the server's own key file; the recordings are
# read-only; /out receives the one recording the Mac step below renders.
ssh "$HOST" 'rm -rf ~/e2e-out && mkdir -p ~/e2e-out'
set +e
ssh "$HOST" 'docker run --rm --cpus 1 --memory 900m --env-file ~/SeeSubtitles/deploy/.env -v ~/e2e-fixtures:/fixtures:ro -v ~/e2e-out:/out seesubtitles-e2e node e2e/run.js --fixtures /fixtures --out /out'
SERVER=$?

# The app's MP4 renderer is macOS-only, so the recording the server run just made is rendered here, as the app would.
LOCAL=$(mktemp -d)
scp -q -o ControlPath="$CTL/c" -o ConnectTimeout=20 "$HOST:e2e-out/*" "$LOCAL/" 2>/dev/null
ssh "$HOST" 'rm -rf ~/e2e-out'
node e2e/mac.js "$LOCAL"
MAC=$?
rm -rf "$LOCAL"
set -e

if [ "$SERVER" -ne 0 ] || [ "$MAC" -ne 0 ]; then
  echo "✖ the release test failed — nothing will be built" >&2
  exit 1
fi
echo "✔ the release test passed"

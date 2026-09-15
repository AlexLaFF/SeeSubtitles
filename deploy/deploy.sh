#!/bin/sh
# Update the running server to what is on GitHub — but not while it is carrying a talk, because the restart
# would cut every one of them off (server/lib/live-proxy.js). Runs on the server, from the deployed checkout:
#
#   npm run deploy              (from the Mac: ssh subtitle-hk, then this)
#   npm run deploy -- --force   restart anyway, talks or not
set -eu
cd "$(dirname "$0")/.."
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

TALKS=$(sh deploy/talks.sh)
case "${TALKS%% *}" in
  0) ;;
  unknown)
    echo "· could not ask the running server whether a talk is on (is it up?)"
    [ "$FORCE" = 1 ] || { echo "✖ not deploying blind — check it, or re-run with --force" >&2; exit 1; } ;;
  *)
    echo "✖ the server is carrying a talk right now: $TALKS"
    [ "$FORCE" = 1 ] || { echo "  deploying now would cut it off — wait for it to end, or re-run with --force" >&2; exit 1; }
    echo "  --force: deploying anyway" ;;
esac

BEFORE=$(git rev-parse --short HEAD)
git pull --ff-only
AFTER=$(git rev-parse --short HEAD)
echo "▶ $BEFORE → $AFTER"
sudo docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build 2>&1 | grep -E "Container|Built|error" || true
for i in $(seq 1 45); do
  curl -sf -o /dev/null https://seesubtitles.com/healthz && { echo "✔ $AFTER is up and answering"; exit 0; }
  sleep 2
done
echo "✖ the server has not answered in 90 s — look at: docker logs --since 5m deploy-app-1" >&2
exit 1

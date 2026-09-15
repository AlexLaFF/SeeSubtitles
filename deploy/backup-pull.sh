#!/bin/sh
# Pull the server's nightly backups (deploy/backup.sh) to this Mac, so a copy exists somewhere other than the
# server. Run daily by the launchd job that deploy/backup-install.sh installs; keeps KEEP_DAYS days locally.
#
#   npm run backup:pull          → ~/Backups/SeeSubtitles/<date>/platform.sqlite + data.tgz
set -eu
HOST="${SEESUBTITLES_SSH:-subtitle-hk}"
DEST="${SEESUBTITLES_BACKUPS:-$HOME/Backups/SeeSubtitles}"
KEEP_DAYS="${KEEP_DAYS:-30}"
mkdir -p "$DEST"
chmod 700 "$DEST"
/usr/bin/rsync -a -e "/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=20" --exclude backup.log "$HOST:backups/" "$DEST/"
find "$DEST" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
NEWEST=$(find "$DEST" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)
echo "$(date '+%F %T') ✔ $(find "$DEST" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ') days of backups in $DEST, newest $(basename "$NEWEST") ($(du -sh "$NEWEST" | cut -f1))"

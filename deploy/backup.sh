#!/bin/sh
# A copy of everything the server keeps, made while it runs. The database is copied as one consistent snapshot
# (VACUUM INTO — safe beside the WAL the running server is writing), and the jobs and sessions folders as one
# archive. Published builds are left out: they are on GitHub. Each day's copy lives in ~/backups/<date> for
# KEEP_DAYS days; the Mac pulls them nightly (deploy/backup-pull.sh), so a copy exists off this machine.
#
#   sh deploy/backup.sh          → ~/backups/2026-09-15/platform.sqlite + data.tgz
#   crontab: 30 3 * * * sh $HOME/SeeSubtitles/deploy/backup.sh >> $HOME/backups/backup.log 2>&1
set -eu
APP="${APP:-deploy-app-1}"
DEST="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
OUT="$DEST/$(date +%F)"
mkdir -p "$OUT"
chmod 700 "$DEST" "$OUT"

# the database: a snapshot of the live file, then opened read-only and counted, so a broken copy is never kept
docker exec "$APP" node -e '
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
fs.rmSync("/tmp/backup.sqlite", { force: true });
const db = new DatabaseSync("/data/platform.sqlite");
db.exec("VACUUM INTO \x27/tmp/backup.sqlite\x27");
db.close();
const copy = new DatabaseSync("/tmp/backup.sqlite", { readOnly: true });
const n = (t) => copy.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
if (copy.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") { console.error("the copy failed its integrity check"); process.exit(1); }
console.log(`database: ${n("users")} accounts, ${n("jobs")} jobs, ${n("glossary")} glossaries, ${n("usage")} usage rows`);
copy.close();'
docker cp "$APP:/tmp/backup.sqlite" "$OUT/platform.sqlite" >/dev/null
docker exec "$APP" rm -f /tmp/backup.sqlite

# everything else in /data except the builds and the live database files
docker exec "$APP" sh -c 'cd /data && tar -czf /tmp/backup.tgz --exclude=./updates --exclude="./platform.sqlite*" .'
docker cp "$APP:/tmp/backup.tgz" "$OUT/data.tgz" >/dev/null
docker exec "$APP" rm -f /tmp/backup.tgz
chmod 600 "$OUT"/*

find "$DEST" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "$(date '+%F %T') ✔ $OUT ($(du -sh "$OUT" | cut -f1); $(find "$DEST" -mindepth 1 -maxdepth 1 -type d | wc -l) days kept)"

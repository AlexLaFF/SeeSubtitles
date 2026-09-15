#!/bin/sh
# Install the nightly pull on this Mac: a launchd job that runs deploy/backup-pull.sh at 04:30 every day (an hour
# after the server has made its copy). If the Mac is asleep at 04:30, launchd runs it when the Mac wakes. Run again
# after moving the repository; run `launchctl bootout gui/$(id -u)/com.seesubtitles.backup` to remove it.
#
#   npm run backup:install
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL=com.seesubtitles.backup
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/seesubtitles-backup.log"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$REPO/deploy/backup-pull.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✔ $LABEL installed: pulls to ~/Backups/SeeSubtitles at 04:30 daily, log in $LOG"

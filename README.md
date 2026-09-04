# Subtitle platform

Live Cantonese → Mandarin subtitles for venue screens, remote displays in any browser, and
upload-a-video subtitling — built on Tencent Cloud speech services. Successor of the localhost tool in
`cantoneseTranscription`; the pipeline modules are the same, packaged for the team.

```
core/      shared pipeline: Tencent signing, streaming translator, 48→16 kHz decimator, transcript, MP3+SRT recorder
web/       pages: display, control, playback (desktop) · login, dashboard, job editor, /d/<code> remote display (hosted)
desktop/   macOS app (Electron): mic → Tencent 实时语音翻译 → Display / transparent Overlay windows, recording, cloud mirror
server/    hosted server: login, live-session mirror, upload → 录音文件识别 → cues → 机器翻译 → SRT/VTT/MP4, cue editor
deploy/    docker-compose + Caddy for Tencent Cloud (HK) or any Linux box
```

Requirements: Node 24 (`.nvmrc`), and for the desktop app Xcode command line tools (`swiftc`) to build the
native audio helpers once. `npm install` at the root installs every workspace.

## Desktop app (conference use)

```bash
npm install                             # behind a VPN: ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run build:helpers -w desktop        # compiles helpers/*.swift and bundles static ffmpeg/ffprobe into resources/bin
npm start -w desktop                    # run from source
npm run dist -w desktop                 # DMG in desktop/dist (unsigned unless a Developer ID certificate is installed)
```

First launch opens **Settings** (⌘,): enter the Tencent APPID / SecretId / SecretKey (stored encrypted with
the macOS Keychain), choose the recordings folder (default `~/Movies/Subtitles`). Windows: **Control** (⌘1),
**Display** (⌘2), **Overlay** (⌘3, transparent, always on top, placeable on any display including
BetterDisplay virtual screens). ⇧⌘R starts/stops the MP3 + SRT recording; the MP4 with burned-in subtitles
is produced when it stops. **Demo mode** (Subtitles menu) runs scripted sentences without a mic or keys.

**Publish to cloud** (Control window): after logging in to the hosted server in Settings → Cloud, the
transcript and look settings are mirrored to a live session; the share link `https://<host>/d/<code>`
shows the subtitles in any browser (venue screens, phones). Audio never leaves the laptop; if the server is
unreachable the local display and recording are unaffected.

Distribution: to ship a DMG that opens without right-click → Open, create a *Developer ID Application*
certificate in the Apple developer portal and set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
for notarization (electron-builder picks them up).

## Hosted server (remote displays + upload subtitling)

```bash
cp deploy/.env.example deploy/.env      # DOMAIN + TENCENT_* keys
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml exec app node server/cli.js add-user you@example.com
```

Caddy obtains the TLS certificate for `DOMAIN` automatically. Data (SQLite, uploads, session logs) lives in
the `subs-data` volume; back it up with `docker run --rm -v subs-data:/data -v $PWD:/out alpine tar czf /out/subs-data.tgz /data`.

Locally: `DATA_DIR=./data node server/server.js` (port 8080). For MP4 burn-in on macOS point `FFMPEG` at an
ffmpeg with libass, e.g. `FFMPEG=desktop/resources/bin/ffmpeg`.

Tencent services that must be activated on the account: 实时语音翻译 (live), 录音文件识别 (uploads),
机器翻译 TMT (translation of uploads). `npm run probe:batch -- clip.mp3` proves the last two work.

Upload pipeline: ffmpeg extracts 16 kHz mono audio → `CreateRecTask` (engine by spoken language, word
timestamps) → cues of ≤ 22 CJK / 44 Latin characters split at punctuation → `TextTranslateBatch` → SRT, VTT,
TXT (original, translated, bilingual). The job page plays the video with the cues, lets you edit text and
timing (nudge, merge, delete, shift all), regenerates the files on save, and renders an MP4 with burned-in
subtitles on demand. Audio files longer than a few minutes are fetched by Tencent from
`BASE_URL/media/<token>.mp3`, so the server must be reachable from the internet.

## Tests

`npm test` runs the core unit tests (signing, translator against a mock WebSocket, decimator, recorder).

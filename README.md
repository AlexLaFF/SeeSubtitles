# transcriptionApp

Live Cantonese → Mandarin subtitles for venue screens, remote displays in any browser, and
upload-a-video subtitling — built on Tencent Cloud speech services. Successor of the localhost tool in
`cantoneseTranscription`; the pipeline modules are the same, packaged for the team.

```
core/      shared pipeline: Tencent signing, streaming translator, 48→16 kHz decimator, transcript, MP3+SRT recorder
web/       pages: display, control, playback (desktop) · login, dashboard, job editor, /d/<code> remote display (hosted)
desktop/   macOS app (Electron): mic → Tencent 实时语音翻译 → Display / transparent Overlay windows, recording, cloud mirror
server/    hosted server: login, live-session mirror, upload → 录音文件识别 → sentences → 混元翻译 → cues → SRT/VTT/MP4, cue editor
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

## Local-tool update sync (0.2.0)

Ported the local-tool commits after `3cff4b8`, through `2be9fbc` (September 7, 2026):

- AI learning summaries with the latest concise synthesis prompt, progress, Markdown viewing,
  clickable recording timestamps, and formatted A4 PDF export. Add the Anthropic key in
  **Settings → AI summaries**; model, language and effort are editable there. PDFs use the app's
  bundled Chromium, including the app's authenticated local connection.
- Chinese recording-set filenames with legacy recordings still discoverable and playable.
  New audio, subtitles, MP4, summaries and PDFs follow the same naming scheme. Existing files
  are not renamed automatically. Optional migration previews changes before applying them:
  `npm run rename-recordings -w desktop -- /absolute/recordings/folder` (add `--apply` to rename).
- A **字幕** menu-bar item to open controls, fill any display, reload/close the overlay, or quit.
  The overlay does not take keyboard focus from the presentation; the main app keeps its Dock entry
  for Control and Settings. Closing it keeps capture and recording running.
- Overlay registration survives pipeline restart; the selected display is highlighted; Close controls
  and the hidden audience-screen hint match the local tool. Because the app owns the overlay and
  server in one process, it does not need the standalone overlay's server-loss quit timer.
- Applying a preset refreshes the initiating browser's controls. Microphone capture ignores unrelated
  audio-device changes, and Tencent connection retries avoid previously failing edges.
- MP4 exports carry no embedded subtitle tracks (players would draw a second copy of the burned-in
  text); the stacked subtitles fill the frame and dissolve at the top edge like the live display.
  Plain-text downloads (original / translation, text only) for the live transcript and every recording.
- Recognition tuning in the Input group, applied at the next connection through a graceful rotation:
  hotwords (`词|权重`, one per line, up to 128), pause that ends a sentence (500–2000 ms), forced split
  (5–90 s), filler-word filter, noise threshold. Measured on Cantonese: shorter sentences translate more
  literally and finalize sooner, longer ones read more fluently but get paraphrased. Values that are not
  URL-safe are signed raw and sent URL-encoded, as the API requires.
- Behind a VPN the mainland edge is found through Chinese DoH resolvers queried with a mainland
  client-subnet hint, with a known-good Guangzhou edge as the last resort.

The original localhost checkout, credentials, recordings and running processes are not modified.
Cloud mirroring and the hosted upload workflow remain available. Summary generation is for desktop
recordings, matching the local tool; it is not yet part of hosted upload jobs.

### Lightweight web-only test

Use Node 24. In a terminal at the app repository, create a test account and start the web server:

```bash
export DATA_DIR=/private/tmp/subtitle-web-preview
node server/cli.js add-user preview@local.test
HOST=127.0.0.1 PORT=18081 FFMPEG="$PWD/desktop/resources/bin/ffmpeg" FFPROBE="$PWD/desktop/resources/bin/ffprobe" node server/server.js
```

Open `http://127.0.0.1:18081` and use the password printed by the account command. No Electron window
or cloud deployment is required. Start with a 30–60 second clip and **no translation**, then edit cues
and export SRT/VTT/MP4. Actual transcription uses Tencent credentials from the app repo's `.env`;
translation additionally requires TMT. Long uploads need a publicly reachable backend. Stop this
preview with Ctrl-C; its files are isolated under `DATA_DIR`.

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

Tencent services used: 实时语音翻译 (live), 录音文件识别 (uploads; CAM policy `QcloudASRFullAccess`), and
混元翻译 for translating uploads. Translation runs on **TokenHub** (大模型服务平台, `TOKENHUB_API_KEY` from
console.cloud.tencent.com/tokenhub/apikey, models `hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite`, 0.5 / 2 元 per
million tokens). Without a TokenHub key the server falls back to the standalone Hunyuan API with the TC3 keys
(`QcloudHunYuanFullAccess`, `hunyuan-translation`), which Tencent shuts down on 2026-09-30. The older 机器翻译
(TMT) product is not used. `npm run probe:batch -- --translate-only` checks the translation key;
`npm run probe:batch -- clip.mp3` runs recognition + translation end to end.

Upload pipeline: ffmpeg extracts 16 kHz mono audio → `CreateRecTask` (engine by spoken language, word
timestamps) → each recognised sentence is translated whole (Cantonese is sent as `yue`, its own language in
混元翻译; several sentences per request, redone one by one if the line count comes back different) → cues of
≤ 22 CJK / 44 Latin characters split at punctuation, with the sentence's translation shared over its cues in
proportion to their length → SRT, VTT, TXT (original, translated, bilingual). The job page plays the video with the cues, lets you edit text and
timing (nudge, merge, delete, shift all), regenerates the files on save, and renders an MP4 with burned-in
subtitles on demand. Audio files longer than a few minutes are fetched by Tencent from
`BASE_URL/media/<token>.mp3`, so the server must be reachable from the internet.

## Tests

`npm test` runs the core unit tests (signing, translator against a mock WebSocket, decimator, recorder).

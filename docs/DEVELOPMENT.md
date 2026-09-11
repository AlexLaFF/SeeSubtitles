# Development

Working on See Subtitles from source: what you need, how to run it, how it is laid out, and how a
release is cut.

## Requirements

- **Node 24** (see `.nvmrc`).
- **macOS with Xcode command line tools** for the desktop app — `swiftc` builds the native audio
  helpers once.
- `npm install` at the repository root installs every workspace.

## Run the desktop app

```bash
npm install                        # behind a VPN: ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run build:helpers -w desktop   # compiles helpers/*.swift, bundles static ffmpeg/ffprobe into resources/bin
npm start -w desktop               # run from source
npm run dist -w desktop            # DMG in desktop/dist
```

Running from source prints a **dev control URL** (`dev: control page http://127.0.0.1:<port>/control?token=…`).
Open it in a browser to drive the same UI the app window shows — the fastest way to check a change
without clicking through the app.

Two switches make the pipeline testable without a microphone or a speaker:

- `demo: true` in the config plays scripted sentences and never contacts Tencent.
- `audioFile: /path/to/16k-mono.wav` loops a real recording through the real pipeline. Produce one with
  `ffmpeg -i talk.mp3 -ac 1 -ar 16000 -c:a pcm_s16le talk-16k.wav`.

Electron honours `--user-data-dir`, so you can run a throwaway profile against a scratch server without
touching your own configuration:

```bash
npx electron . --user-data-dir=/tmp/scratch-profile
```

## Run the server

```bash
DATA_DIR=./data node server/server.js     # port 8080
```

For MP4 burn-in on macOS point `FFMPEG` at an ffmpeg built with libass, e.g.
`FFMPEG=desktop/resources/bin/ffmpeg`.

### Web-only preview

The whole hosted side runs without Electron. Create an account and start the server:

```bash
export DATA_DIR=/private/tmp/subtitle-web-preview
node server/cli.js add-user preview@local.test
HOST=127.0.0.1 PORT=18081 FFMPEG="$PWD/desktop/resources/bin/ffmpeg" FFPROBE="$PWD/desktop/resources/bin/ffprobe" node server/server.js
```

Open `http://127.0.0.1:18081` and log in with the password the account command printed. Start with a
30–60 second clip and no translation, then edit cues and export SRT/VTT/MP4. Real transcription needs
Tencent credentials (see [SELF-HOSTING.md](SELF-HOSTING.md)). Long uploads need a backend Tencent can
reach from the internet. Everything the preview writes stays under `DATA_DIR`.

## Repository layout

| Path | What lives there |
|---|---|
| `core/` | The shared pipeline: Tencent request signing, the streaming translator, the 48→16 kHz decimator, the transcript model, the MP3 + SRT recorder, recording-file naming |
| `desktop/` | The macOS app (Electron): capture → Tencent → Display and Overlay windows, recording, MP4 export, AI summaries, the cloud link |
| `server/` | The hosted server: accounts, the live-session mirror, upload jobs, the cue editor, plans and quotas |
| `web/` | Every page, shared by both: the app shell, display, attendee view, account, job editor, and the public website |
| `deploy/` | docker-compose and Caddy for any Linux box |
| `design/` | Design tokens, icons and the canvas sources behind the interface |

## Tests

```bash
npm test --workspaces
```

Three suites run: `core` (signing, the translator against a mock WebSocket, the decimator, the
recorder), `server` (accounts, plans and quotas, two-factor authentication, exports, usage) and
`desktop` (the local server, cue handling, updates, packaging, string catalogue).

Two of them guard rules that are easy to break by accident:

- **`desktop/test/i18n.test.js`** — every string the interface uses must exist in both English and
  Simplified Chinese in `web/locales.js`, with matching placeholders. A half-translated screen fails
  the build.
- **`desktop/test/packaging.test.js`** — desktop code must reach the shared pipeline through
  `@subs/core/…`, never a relative path. A relative require resolves when you run from source and
  throws `Cannot find module` inside the packaged `app.asar`, which no source-run test can see.

## Releasing the desktop app

1. Bump `version` in `desktop/package.json`.
2. `npm run dist -w desktop` — produces the DMG, the zip, both blockmaps and `latest-mac.yml`.
3. **Verify the packaged bundle, not just the tests.** Extract the archive and load anything you
   changed the way the packaged app will:

   ```bash
   npx @electron/asar extract "desktop/dist/mac-arm64/See Subtitles.app/Contents/Resources/app.asar" /tmp/asarcheck
   node -e "require('/tmp/asarcheck/lib/your-module.js')"
   ```

4. Publish all five files into the server's update directory (`<DATA_DIR>/updates`) and remove the
   previous version's. `/api/desktop/version` then reports the newest build, and the app offers it on
   launch, every six hours, and from **Subtitles → Check for Updates…**.

To ship a DMG that opens without right-click → Open, create a *Developer ID Application* certificate
in the Apple developer portal and set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`;
electron-builder picks them up and notarizes the build.

## Conventions

- Every user-facing string goes through the catalogue in `web/locales.js` (`t()` / `data-i18n`).
- Chinese is **Simplified only**.
- Interface colours come from the design tokens (`var(--bg)`, `--surface`, `--fg`, `--accent`…), never
  hard-coded values.

## The release test

`npm run e2e` runs `e2e/run.js` — the whole app below its windows, end to end, with real recordings, real Tencent
and real TokenHub. `npm run release -w desktop` runs it first and stops if anything fails, before a build is made or
sent to Apple.

**Where it runs.** On the server, because that is where the keys are and they never leave it.
`desktop/scripts/e2e-on-server.sh` ships the committed code there, builds a throwaway image from `e2e/Dockerfile`
beside the running service (capped at one core and 900 MB, so the service keeps its headroom) and runs it with the
server's own `deploy/.env`. Inside, the test starts its own copy of the server — its own database and port, nothing
shared with the live service — and makes throwaway accounts in it that disappear with the container. It refuses to
start with uncommitted changes, or while the server has carried a talk in the last 15 minutes.

**What it checks.** It drives the app's own core (`desktop/local-server.js`, `desktop/cloud.js`, the queues in
`desktop/lib`) against that server the way the Mac app does, with a recording standing in for the microphone:

- accounts: login, a wrong password, two-factor on, demanded and off; teams; account requests
- plans: what a Hobbyist plan may not do it cannot do, and a spent plan cannot start a talk
- live: an ordinary account through the relay — counted to the second, not reported twice by the app, and seen on a
  shared screen; the owner straight to Tencent on a signed connection, holding no key, with the glossary actually heard
- what a talk leaves behind: MP3, subtitles in both languages, plain text, the manifest, the burnt-in MP4, an AI summary
- uploads: a recording uploaded from the app comes back as subtitles and is imported as a recording
- languages, the update feed and every page; and last, that neither key appears in any response or any file written

Subtitles are checked for Traditional characters, source lines for Cantonese ones.

**The recordings.** Real talks, kept on the server in `~/e2e-fixtures` (owner-only permissions) with a
`manifest.json` saying what each must contain — the glossary terms it must be heard to say, the fewest subtitles it
may produce. They are never committed: this repository is public. To add one, cut it to 16 kHz mono WAV, copy it
there and describe it in the manifest.

**What it costs.** About ten minutes and ¥0.5 of Tencent time a run.

**What it cannot see.** The windows. release.sh prints a short checklist at the end — menus, Settings, printing the
PDF, the QR code, a real microphone — to walk before publishing.

**Adding a check.** A `check('area: what must be true', async () => …)` in `e2e/run.js`, using the throwaway server
(`server.base`), an app instance from `openApp`, and `must(condition, 'what went wrong')`.

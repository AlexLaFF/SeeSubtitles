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

- accounts: login, a wrong password, two-factor on, demanded and off; changing the password (and the other devices
  it signs out); the device list, signing one device out and signing out all the others; teams, with a new member
  setting a password from the reset link; account requests
- glossary: a list saved on one Mac reaches the account's other devices, is tidied by the server, and a team shares
  its owner's list
- plans: what a Hobbyist plan may not do it cannot do, and a spent plan cannot start a talk
- live: an ordinary account through the relay — counted to the second, not reported twice by the app, and seen on a
  shared screen; the owner straight to Tencent on a signed connection, holding no key, with the glossary actually heard
- what a talk leaves behind: MP3, subtitles in both languages, plain text, the manifest, an AI summary; and the
  server's burnt-in MP4 for an uploaded file
- uploads: a recording uploaded from the app comes back as subtitles and is imported as a recording
- regenerate: the app's re-subtitle queue makes that recording's subtitles again in another language from the file
  the server already has — no second job, no file time charged, the old subtitles kept to the byte as a version on
  the Mac (`旧版本`) and on the server (`versions/1`, still downloadable, the MP4 made from them among its files)
- languages, the update feed and every page; and last, that neither key appears in any response or any file written

Subtitles are checked for Traditional characters, source lines for Cantonese ones.

**One part runs on the Mac.** The app draws the subtitles of its own MP4 with a native macOS renderer
(`helpers/render-subs.swift`) that the Linux image cannot run, so the server run hands back one recording it made and
`e2e/mac.js` renders it with the app's own `Mp4Queue` and checks the video. That step needs no keys.

**The recordings.** Real talks, kept on the server in `~/e2e-fixtures` (owner-only permissions) with a
`manifest.json` saying what each must contain — the glossary terms it must be heard to say, the fewest subtitles it
may produce. They are never committed: this repository is public. To add one, cut it to 16 kHz mono WAV, copy it
there and describe it in the manifest.

**What it costs.** About two and a half minutes and ¥0.3 of Tencent time a run, plus a few minutes the first time
the test image is built.

**What it cannot see.** The windows. release.sh prints a short checklist at the end — menus, Settings, printing the
PDF, the QR code, a real microphone — to walk before publishing.

**Adding a check.** A `check('area: what must be true', async () => …)` in `e2e/run.js`, using the throwaway server
(`server.base`), an app instance from `openApp`, and `must(condition, 'what went wrong')`.

## The iOS app

`ios/` is built with Xcode, not npm: see [IOS.md](IOS.md) §6 for the build and the launch arguments. `npm test` still
guards it: core/test/ios-sync.test.js fails when a file the phone mirrors has changed, when its languages are out of
date, or when it names a string the catalogue lacks. CLAUDE.md says what to do about each.

### The iOS release test

`npm run e2e:ios` runs `ios/e2e/run.mjs`: everything about the phone app that can be checked without a person
holding one. Three stages, about five minutes, **no keys and no cost** — nothing in it reaches Tencent or TokenHub.

1. **Unit** — `swift test` in ios/Packages/SubtitlesCore. The relay client against a scripted socket; the recorder,
   silence padding and crash recovery; the MP4 export (tracks, duration, a rendered frame, and a minute of talk in
   seconds, which is what catches a writer stall); re-subtitling against a stub server, failures included; the
   speech queue replaying the decisions web/speak.js made; the decimator giving core/decimator.js's samples.
2. **Core end to end** — EndToEndTests.swift: the phone's real networking code (APIClient, RelayClient, TalkSession,
   Recorder, URLSession) against **the real server**. `ios/e2e/harness.mjs` starts server/server.js on this Mac with a
   throwaway database and stand-ins for Tencent's recogniser and TokenHub (`TENCENT_WS_URL`, `TOKENHUB_BASE_URL` —
   the server warns loudly when either is set), so the relay, accounts, plans, metering, the summaries endpoint and
   share sessions are the code that ships. Accounts, two-factor, devices and signing one out, the glossary across
   devices, what each plan refuses (`plan_summaries`, `plan_quota`, `plan_talks`), a whole talk through the relay with
   a file as the microphone and what it leaves on disk, that the server charged about as many seconds as the talk
   lasted, a summary asked with the shared prompt and the server's own key, joining a talk a Mac is hosting, and
   that no key value appears in anything the phone received or wrote.
3. **UI** — SeeSubtitlesUITests, the built app driven in the Simulator. In demo mode: the login card, first run, a
   talk, Text, Listen, Reply, the ended card, the recording's three tabs, a summary, an MP4 made on the device,
   rename, delete, Settings, and the interface in Chinese. Signed in to the harness's server: a wrong password,
   login, a talk through the relay, the account and its devices, joining a hosted talk, logging out.

Each stage gets a server of its own, because the server allows twenty sign-ins a quarter of an hour from one address
and a test run should not need that loosened. `node ios/e2e/run.mjs core` or `ui` runs one half.

**To TestFlight: `sh ios/scripts/testflight.sh`** — the release test, an App Store archive, the export to an .ipa,
the upload, and a confirmation from App Store Connect that the build arrived. Apple is reached with the App Store
Connect API key named in `~/.config/seesubtitles/notarize.env` (`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`; the .p8
beside it) — the same key that notarizes the Mac app — never the Apple ID signed in to Xcode, whose sign-in goes
through developer.apple.com and fails from Alex's Mac ("No Accounts with App Store Connect Access", the journal
project's experience too). The build number is the commit count, so a build always says which commit it is and no
number is ever reused for different code; it refuses a tree with uncommitted changes under ios/, core/ or web/.
The App Store Connect record is made once by hand. `archive` and `upload` run one half each; a failed upload keeps
the .ipa, so `upload` again costs nothing.

**With real keys: `npm run e2e:ios:real`** (ios/e2e/real-on-server.sh). Stage 2 again, against real recognition,
real translation, a real summary and real whole-file recognition — the phone's counterpart of `npm run e2e`, at about
the same ¥0.3. The keys exist only on the server, so the script ships the committed code there, starts a throwaway
copy of the server in the test image beside the running service (its own database, a port bound to the server's
loopback, capped at one core and 900 MB), and reaches it from this Mac through an ssh tunnel; one of the private
recordings in `~/e2e-fixtures` stands in for the room and is deleted from this Mac afterwards. Nothing is deployed and
the live service is not touched. The two tests that need the local harness's control plane — two-factor and joining a
hosted talk — skip themselves; re-subtitling, which the stand-ins cannot do, runs only here. It refuses to start with
uncommitted changes or while the server is carrying a talk. The Mac's `npm run e2e` also checks `/api/summaries`
with the real TokenHub.

Both real-keys scripts share one ssh connection, keep it alive, and run their work on the server's own clock: from
a laptop the link to Hong Kong resets connections and dies silently often enough that a run attached to it was lost
twice on 20 September.

**What it cannot see**, printed as a checklist at the end of a passing run: a real microphone in a real room,
AirPods, a phone call arriving mid-talk, the camera reading a QR code, a real lock screen, iPad, and how the voice
sounds.

**When a UI test fails**, Xcode keeps a screen recording of it: `xcrun xcresulttool export attachments --path
ios/build/Logs/Test/<newest>.xcresult --output-path <dir>`, then look at the last seconds of the `.mp4`.

# See Subtitles for iPhone and iPad

The specification for the iOS app: what it is, every screen and state, how it is built, what the server gains, and
the order of work. Direction agreed with Alex on 2026-09-15. Terms used below: a **talk** is one run of live
subtitles, whether or not it is recorded; a **recording** is a talk's files in the Library; a **joined talk** is
someone else's talk followed through their share code.

## 1 · What it is

The Mac at the front of the room turns a talk into subtitles for everyone. The phone is the device in one person's
hand. So the iOS app does two jobs, and one more that costs almost nothing:

- **Listen.** A live transcript reader for the person who cannot hear the room well, or does not speak its
  language. Large scrolling text, translation and original, on a phone lying on the table or held up.
- **Record.** A lecture and meeting recorder that keeps running with the screen locked and ends with the audio,
  subtitles in both languages, a transcript and an AI summary, all in a Library on the phone.
- **Join.** Scan the QR code a Mac is showing and follow that talk natively, keeping the transcript afterwards.

Listen and Record are one pipeline, exactly the Mac's: audio streams to the relay, finished sentences come back,
and a recording is written locally at the same time if asked. They differ in which view the user starts from.

**Not in the app, on purpose:** the Display window, the Overlay, hosting a share link or QR code, and the printable
poster. Those exist for the machine that drives a screen. **Kept:** MP4 export with burned-in subtitles, because a
subtitled video is the most shareable form of a recording.

**Same account, same plan.** The phone logs in with the account opened at seesubtitles.com and draws on the same
monthly hours. The plan's cap on simultaneous talks applies across devices: a Hobbyist cannot run the Mac and the
phone at once. Nothing is sold inside the app; there is no sign-up in it either, as on the Mac.

**Who it is for, without saying so.** The reader is designed around what a deaf or hard-of-hearing person needs in
a conversation or a class: text that stays readable, a way to look back without losing the thread, a haptic when
something new arrives, and a way to answer. Marketing describes it as a transcript reader and lecture recorder; the
design carries the accessibility.

## 2 · Screens

Three tabs: **Live**, **Library**, **Settings**. A logged-out app shows only the login card, as on the Mac; the
tabs appear after login. iPhone and iPad share one adaptive layout on iOS 17 and later; iPad gets a two-column
Library and a wider reader, not different screens.

### 2.1 · First run

1. **Log in.** Email, password, and a second step for the 6-digit code when the account has two-factor turned on.
   Errors in the catalogue's words: wrong password, rate limited, code not right. No sign-up link; a line says
   accounts are opened at seesubtitles.com.
2. **Microphone.** One screen that says why, then the system prompt. Refused → the Live tab shows how to allow it
   in Settings; Join and the Library still work.
3. **Languages.** Spoken language and subtitle language, the same pairs the Mac offers (core/schema.js
   `LIVE_PAIRS`); choosing a spoken language narrows the other list. Defaults 粤语 → 普通话.
4. **Done.** Lands on Live, idle.

### 2.2 · Live

The primary screen. Top: the language pair as one tappable line ("粤语 → 普通话") that opens the pair picker.
Middle: the transcript. Bottom: one bar.

**Idle.** An empty stage with one filled button, **Start**, and two quiet toggles beside it: **Record** (on by
default, remembered) and **Text**. A small **Join a talk** link sits under the button. The status line reads
"ready" with a green dot, or the reason it is not: no microphone permission, offline, hours used up.

**Listening.** Sentences arrive at the bottom and the view follows them. Each sentence is the stack from the
design language: translation in `fg` at the reader size, original one step smaller in `fg-3` underneath (or only
one of them, per the Text setting). The current partial sentence renders in `fg-2` until it finalizes. The bar
holds **Stop**, the recording indicator (red dot, elapsed time) and **Text**. The screen stays awake.

**Looking back.** Scrolling up stops the following; a **Jump to latest** pill appears at the bottom with the count
of new sentences. Tapping it or a new Start resumes following. The whole transcript of the talk is kept in the
view, not just the last twenty lines as on the projector.

**Reply.** A speech-bubble button in the bar opens a text field; what is typed shows full-screen in the largest
type that fits, to hand the phone across or hold it up. Recent replies are kept for the talk so a phrase can be
shown again with one tap. Replies are stored with the transcript, marked as the user's own line.

**Held up.** Rotating to landscape gives the same transcript at a larger size with the bar hidden; a tap shows it.

**Haptics.** Optional, on by default: a light tap when a sentence finalizes, a double tap when the connection is
lost or refused. Lets the reader look at the speaker and feel when to look down.

**Recording.** With Record on, Start also starts writing audio locally. The status line reads "listening ·
recording 12:41". A Live Activity appears on the lock screen and in the Dynamic Island with the elapsed time and
the sentence being spoken — it grows a few words at a time, at most every three seconds (the system rations an
activity's changes), the settled sentence following within a second; a sentence too long for its lines loses its
beginning, never its end — and a Stop control. Recording continues with the screen locked and the app in the
background.

**Interrupted.** A phone call or Siri pauses capture; the status reads "paused · call" and the recording pads the
gap with silence so timestamps stay aligned, as core/recorder.js does. Capture resumes when the interruption
ends. Route changes (AirPods removed, a wired microphone unplugged) are followed without stopping the talk.

**Reconnecting.** When the relay drops, subtitles pause and the status reads "reconnecting" with an amber dot,
while the recording continues. The client retries with the same backoff as core/remote-stream.js and keeps up to a
second of audio for the reconnect. Once back, the status returns to listening. A gap in subtitles is filled later
by cloud re-subtitling from the Library.

**Refused.** The relay's `plan_talks` and `plan_quota` errors, and `bad_language`, show as a sentence from the
catalogue in the status line, with what to do: stop the other talk, wait for next month, pick another pair. The
app does not retry `plan_talks`.

**Ended.** Stop shows a card: duration, sentence count, and if recorded a button to open the recording in the
Library, with **Summary** as the second action when the plan has summaries. Without recording the transcript is
still kept in the Library as a transcript-only item, so a reader can look back later.

**Text sheet.** Size (a slider tied to Dynamic Type, reaching the accessibility sizes), show mode (translation,
both, original), weight, high contrast (pure black stage, pure white text, no fades), and line spacing. Applied
live. The same sheet serves the Library reader and joined talks.

### 2.3 · Join a talk

Reached from Live or by opening a `seesubtitles.com/d/<code>` link, which the app registers as a universal link
so scanning the Mac's QR code with the Camera opens the app directly. Inside the app, **Scan** opens the camera,
and a code can be typed. The reader is the Live screen without the bar: no microphone, no recording, the host's
language pair shown at the top and the attendee's own choice of translation, original or both. Status follows
the host: live, paused, ended. On end the transcript is saved to the Library as a joined talk with the host's
session name and the date. Joining needs no account: a joined talk works logged out, exactly as the web attendee
page does, and the login card gives way to it.

### 2.4 · Library

A list of the phone's recordings, newest first, with a search field. Each row is the stack: the name on top
("9月5号14点33分" as the Mac names it, renamable), and underneath "粤语 → 中文 · 47:12 · 5 Sep" with small badges
for summary, MP4, re-subtitled, and joined. Swipe for share and delete; long press for the same plus rename; inside
a recording, a tap on its title renames it too, as a click on the title does on the Mac (web/files.js). A
footer shows space used and a link to Settings › Storage. On iPad the list is the sidebar and the recording opens
beside it.

Empty state: one sentence and the Start button.

Japanese files are recognised at Alibaba 百炼 since 2026-09-22 (server/lib/dashscope.js): a server change, so the
phone's re-subtitling gets it with nothing to port.

Files added for subtitling (the Mac's "Add file…", the web's upload) are not listed here — the Library is the
phone's own recordings — so deleting one from the list, and the sheet that asks a file's languages and whether to
send a whole video or only its audio, are the Mac's alone. Re-subtitling on the phone still uses the recording's
own languages without asking and keeps the talk's subtitles as `.live.srt` only: choosing other languages, the
server making them again from the file it already has (`POST /api/jobs/<id>/regenerate`), and the `旧版本` folder
of earlier versions (desktop/lib/resubtitle.js) are not on the phone yet — it gets them when its Recording page
gets a languages row, since the server half is already there. The Mac's **Try again** line beside every failure
(desktop: web/files.js `failure()`) has no counterpart to add on the phone: a failed re-subtitle, MP4 or summary
shows its reason in a row of its own (RecordingView `work`) and the action's button stays where it was, so pressing
it again is the retry. The phone's only upload is re-subtitling, and it gains what the server gained on
2026-09-21: an upload may take longer than five minutes. Carrying a broken upload on from what the server has
(`received`, then `PUT …/upload?offset=`) is done by the Mac and the web page, not yet by the phone: its upload is
a recording's m4a, tens of megabytes, begun again if it breaks — port it from desktop/lib/uploads.js if that ever
proves too much on a mobile connection.

The Mac Files list shows all local history and labels imported jobs as added files. The phone stores its own
recordings in a separate Library and has no imported jobs, so this needs no Swift change.

### 2.5 · Recording

Player at the top: play/pause, a scrubber, ±15 s, speed. Below, three segments:

- **Transcript.** The sentences with timestamps in the mono hint style. The playing sentence is highlighted and
  the list follows playback; tapping a sentence seeks to it. Show mode and size from the Text sheet. Search within
  the transcript. Replies made during the talk appear inline, marked.
- **Summary.** The AI summary rendered from Markdown with clickable timestamps that seek the player. Empty state
  is one button, **Summarise**, greyed with "not in the Hobbyist plan" when the plan lacks it. Generation streams
  in; a progress line shows it is running; the result is saved beside the recording. **Summarise again** replaces
  it after confirmation.
- **Files.** The recording's files, each with size and a share button: audio, the two SRTs, transcript text,
  summary Markdown and PDF, and the MP4 once made. Actions: **Re-subtitle** (cloud, uses file hours, shows the
  job's progress, keeps the live subtitles as `.live.` sidecars as the Mac does), **Make MP4** (portrait 1080×1920
  by default, landscape optional; runs on the device with progress; a long recording is warned about), **Save to
  Files** (the whole set to a folder the user picks), **Rename**, **Delete** (after confirmation; nothing else on
  the device holds a copy).

A transcript-only item and a joined talk show the same screen without the player and without Make MP4 or
Re-subtitle.

### 2.6 · Settings

In the iOS style, grouped:

- **Account.** Email, plan name, this month's live and file hours as the tiles the Mac uses, the talk limit, the
  team name if any. **Devices** lists signed-in sessions with sign-out per device and everywhere, from
  `/api/account/tokens`. **Change password.** **Two-factor** shows on/off and points to the website to change it.
  **Log out.**
- **Recognition.** Spoken and subtitle language (the same picker), **Glossary** (the account's, synced with the
  Mac and the web, edited here as a list of term and weight), translation model, pause that ends a sentence, force
  a split after, filter filler words, noise threshold. Applied at the next connection, as on the Mac.
- **Text.** The Text sheet's settings, plus haptics on/off and keep-screen-awake.
- **Recording.** Record when starting (default on), audio quality (64 / 96 / 128 kb/s AAC), make MP4 automatically
  when a talk ends (default off), MP4 orientation, and **Storage**: total used, keep recordings on this device
  only (default) or also in iCloud Drive.
- **App.** Language of the interface (system / English / 简体中文), appearance (system / dark / light), demo
  mode (plays a bundled recording through the whole pipeline without an account, as the Mac's Demo Mode does,
  and is what App Review uses), version, licences, links to the guide and to seesubtitles.com.

## 3 · Rules the app keeps

- **Recording never depends on the network.** It starts before the relay connects and continues through every
  disconnect. A crash or a dead battery loses at most the last few seconds.
- **The account is the door.** Logged out, only the login card and a joined talk exist.
- **Hours are the server's count.** The app shows the month's usage from `/api/me` and stops when the relay says
  so; it never estimates its way past a limit.
- **Detailed usage is shared by the server.** Phone talks, uploaded files and summaries enter the same per-account
  mode/model ledger as Mac activity. Settings shows the plan-hour tiles and a monthly breakdown of audio, calls and
  tokens; an administrator can select another account. The website reads the same ledger.
- **Every string is in the catalogue.** Simplified Chinese only.
- **Audio goes to the relay only.** The phone never receives a Tencent or TokenHub key and never contacts either
  service directly; summaries go through the server's endpoint.
- **Nothing leaves the phone unasked.** Recordings stay on the device unless the user re-subtitles (uploads the
  audio to the server for the job, deleted with the job), summarises (sends the transcript text), or turns iCloud
  Drive on.
- **Legible before pretty.** Body text never below 15 pt, the reader never below the user's Dynamic Type size,
  every control labelled for VoiceOver, every state a word beside the dot and not a colour alone.

## 4 · How it is built

### 4.1 · Stack and layout

Native Swift 6 and SwiftUI, iOS 17 and later, iPhone and iPad, one target. Xcode project under `ios/` in this
repository, with two local Swift packages:

```
ios/
  SeeSubtitles.xcodeproj
  App/                     the SwiftUI app: scenes, screens, view models
  Shared/, Widgets/        the Live Activity: its attributes, and the widget extension that draws it
  Packages/
    SubtitlesCore/         no UI: relay client, audio sources, decimator, recorder, library, cues, names, API client;
                           its Tests/ are the unit tests
    SubtitlesDesign/       the Marquee tokens as Swift: colours, type, spacing; the stack row; status dot
  Resources/               Localizable.xcstrings and InfoPlist.xcstrings, both generated from web/locales.js
  Config/                  Info.plist, entitlements
  UITests/                 drive the built app in the Simulator, a file as the microphone
  e2e/                     the release test (npm run e2e:ios) and its server harness
  scripts/
    export-strings.mjs     web/locales.js → the .xcstrings (an Xcode build phase; strings.mjs is the shared part)
    check-strings.mjs      every L("key") in Swift exists in the catalogue, and every ios.* key is used
    export-schema.mjs      core/schema.js → the languages, pipelines and tuning the app offers; the decimator fixture
    ports.mjs              the Mac originals each Swift port follows, and whether one has changed since (--check / --accept)
    testflight.sh          the release test, an archive, the export (export-ipa.sh, asc.mjs) and the upload
    make-icon.swift        draws the app icon from the mark's geometry (design/canvas/icons.mjs) — by hand, once
```

Bundle id `com.algernonlabs.seesubtitles`, next to the Mac's. Versioning starts at 1.0 on its own line; the Mac's
`/api/desktop/version` is not used, the App Store updates the app.

### 4.2 · Audio

`AVAudioSession` in the `.record` category with `.allowBluetooth` and `.defaultToSpeaker`, the `audio` background
mode, and `AVAudioEngine` tapping the input at the hardware rate. A Swift port of core/decimator.js (same 63-tap
FIR, same cutoff) resamples to 16 kHz mono 16-bit, so the relay receives byte-identical audio to the Mac's; a
rate the FIR's integer factor cannot reach falls back to `AVAudioConverter`. Chunks of 200 ms (6,400 bytes) go to
the relay and to the recorder. Interruptions and route changes are handled by the session's notifications, with
the silence-padding rule from core/recorder.js so the recording stays aligned with wall-clock time.

The Live tab supports an external microphone through the Lightning/USB-C port or Bluetooth, chosen in the system
route picker; the phone on the table with its own microphone is the expected case and is tuned for.

### 4.3 · Relay client

One `URLSessionWebSocketTask` to `/api/desktop/live` with the bearer token, speaking the protocol in
server/lib/live-proxy.js. The languages, the pipeline (`split`, the default since 0.8.0) and the tuning that is
fixed when a connection is made travel in the query string. Each audio frame is eight bytes of capture time (a
big-endian double, milliseconds on the phone's clock) followed by 200 ms of PCM, so cue times are the phone's and
never drift by the network delay. A `settings` message changes tuning mid-talk and `stop` ends it; `ready`,
`result`, `status`, `log` and `error` come back. Backoff, keepalive, the one-second queue while
reconnecting and the no-retry on a plan refusal are ported from core/remote-stream.js and tested against a
stand-in relay that speaks the same frames.

**The phone is always relayed.** The direct route to Tencent exists only for the owner's account and only on the
combined pipeline; the split pipeline translates on the server for everyone. Porting Tencent's own frame format
for one account on a pipeline the app no longer opens on is not worth its weight, so the iOS app has no direct
route. The cost is the owner's alone: a talk on their phone does not survive a server restart, which
`npm run deploy` already refuses while a talk runs.

### 4.4 · Recorder and files

While a talk runs the audio is written as a raw AAC stream (ADTS, `录音.part.aac`), hardware encoded: frames one
after another with no index to finish, so a file cut short by a crash, a dead battery or a force-quit plays up to
the last frame written. When the talk stops the stream is wrapped into `录音.m4a` without encoding it again, which
takes a moment even for an hour; a stream left behind by a talk that never stopped is wrapped at the next launch
and the recording is marked recovered. (A plain m4a would not do: it is unplayable until it is closed.) AAC rather
than the Mac's MP3 is the one deliberate difference: iOS has no MP3 encoder, and bundling one would mean carrying
LAME, as the Mac does inside its own ffmpeg build (LGPL; THIRD-PARTY.md). The server's upload jobs already accept any container ffmpeg reads, so re-subtitling and the web app
open the file unchanged. core/names.js knows the `.m4a` suffix, so a recording's files keep the same Chinese base
name on both platforms.

Each recording is a folder in the app's Documents directory (so the Files app shows it and iCloud Drive can
mirror it): the audio, the two SRTs, the manifest, the transcript as the reader saw it (replies included), the
summary, the MP4. The folders are the truth and the Library is a scan of them; there is no database and no
third-party code. Renaming a recording changes its title in the manifest, never its files. The Mac's `.live.`
sidecar rule for re-subtitled recordings is kept.

### 4.5 · MP4 export

A port of desktop/helpers/render-subs.swift's drawing (Core Text, bottom-anchored stack, current cue bright) into
a frame source for `AVAssetWriter`: the recording's audio plus H.264 video at 15 fps, hardware encoded, 1080×1920
portrait or 1920×1080 landscape. Runs while the app is in the foreground with a progress bar; a `BGProcessingTask`
finishes one started at the end of a talk if the user leaves. Nothing goes to the server.

### 4.6 · Summaries

A server endpoint, `POST /api/summaries`, takes the transcript cues and the languages and streams back the
Markdown, with the prompt in core/summary.js and the conversation with the model in server/lib/summaries.js, so
the two apps share one implementation. The phone renders Markdown natively and makes the PDF with
`UIGraphicsPDFRenderer`. **Since the Mac's 0.8.4 both apps use it**: the Mac sends its chosen model and effort with
the request (`model`, `effort`; core/summary.js `SUMMARY_MODELS`) and the phone sends neither, so it gets the
server's defaults — a model row in the phone's Settings would be a small addition, nothing on the server. The
older Mac route through an Anthropic SDK proxy (`/api/desktop/tokenhub`) goes in the next server change after
0.8.4 has reached the Macs. Also Mac-only in 0.8.4, with nothing for the phone: its ffmpeg is now the app's own
LGPL build (the phone has no ffmpeg — AAC and AVFoundation), and its MP4 export uses the hardware encoder alone, as
the phone's always has.

### 4.7 · Joined talks

`EventSource`-style streaming over `URLSession` to the session's SSE feed, the same events web/live.js consumes.
Universal links for `seesubtitles.com/d/<code>` need an `apple-app-site-association` file served by the server.

### 4.8 · Strings, design, accessibility

`export-strings.mjs` writes the catalogue to `Localizable.xcstrings` and runs in the Xcode build; `check-strings.mjs`
fails the build for a key the Swift code uses that the catalogue lacks. The catalogue stays the only place a
string is written, so an iOS string is added to web/locales.js like any other.

`SubtitlesDesign` carries design/tokens/marquee.css as Swift: the three surfaces, `fg` tiers, the yellow accent in
its three places, the status hues, and the type tiers scaled for touch (view title 28, section 17, body 17,
secondary 15, hint 13, all through Dynamic Type). Every screen is drawn on the design canvas before it is coded,
as the Mac's were, and the canvas gains an **iOS** page.

VoiceOver reads each sentence as one element with the translation first; the status line is a live region;
haptics use `CoreHaptics` patterns; the reader honours Reduce Motion and Increase Contrast.

### 4.9 · Testing and release

Unit tests for the decimator (against the JS output on the same input), the SRT writer, the relay client against
the server's mock relay, names and the manifest. UI tests run the app on the simulator with a recording as the
microphone (the Mac's `audioFile` idea) against the hosted server on a test account, through login, a talk,
recording, summary and MP4, and check the files. This is the iOS half of the release test; `npm run e2e` stays the
Mac's.

Builds through Xcode with automatic signing under the existing Apple Developer team, uploaded to TestFlight for
Alex and early users, then App Review. Review needs a demo account or the demo mode, an explanation of the audio
background mode (live captioning and recording), and a privacy nutrition label: audio is processed by a
third-party speech service, recordings stay on the device, the account email is the only identifier. Terms of
service and a privacy policy on the site, from the backlog, become required here.

## 5 · What the server gains

- `POST /api/summaries` and server/lib/summaries.js (from desktop/lib/summary.js), gated by the plan's
  `summaries` as the TokenHub proxy is today.
- `/.well-known/apple-app-site-association` for universal links.
- `.m4a` in core/names.js and in whatever the web app lists.
- The relay's refusal messages get catalogue keys so both apps show them in the interface language (already in
  the backlog).
- The team page lists an account's iOS devices like its Mac ones; `/api/account/tokens` labels already carry the
  user agent.

Nothing changes for hours, plans, the talk cap, the glossary, upload jobs or the attendee feed.

## 6 · Order of work, and where it stands

Sized for one person with Claude; each phase leaves something that runs. State on 2026-09-20:

| | phase | state |
|---|---|---|
| 1 | **Server and catalogue** | done: `/api/summaries` (tested), the universal-link file, `.m4a` names, string and schema export. Not yet deployed to the hosted server. |
| 2 | **Design** | done: 29 screens and states in design/canvas/ios-screens.mjs, plus three tentative ones (§8). Not yet on the published canvas — the canvas tool is Alex's to run. |
| 3 | **Core package** | done: 35 tests. The decimator matches the Mac's sample for sample; a recording survives the app dying mid-talk. |
| 4 | **Live** | done and run in the simulator: login, first run, every Live state, recording, Text, Reply, held up, the Live Activity with Stop on the lock screen. |
| 5 | **Library and Recording** | done and run: Library, player, transcript, summary with PDF, files, MP4 made on the device, Save to Files. Re-subtitling is tested against a stub of the server's job API, not yet against real recognition. iCloud Drive is not done. |
| 6 | **Join and Settings** | done and tested against the real server: typed code, the joined-talk reader, the account and its devices, every Settings group, demo mode. Scanning a code needs a real camera. |
| 7 | **Release** | the release test is done (`npm run e2e:ios`: unit, the core against the real server, the app in the Simulator — docs/DEVELOPMENT.md). Real keys: `npm run e2e:ios:real` passed 2026-09-20. **TestFlight: build 1.0 (145) uploaded 2026-09-22** with `sh ios/scripts/testflight.sh` (the same setup as the journal project: the App Store Connect API key, `altool`, confirmed through the API; the export is ours because Xcode's hung — docs/DEVELOPMENT.md). Not started: a real iPhone in a real room, iPad, App Review. |

To build and run: `xcodebuild -project ios/SeeSubtitles.xcodeproj -scheme SeeSubtitles -destination 'platform=iOS
Simulator,name=iPhone 17 Pro' build`, or open the project in Xcode. `-demo YES -firstRunDone YES` as launch
arguments runs a whole talk with no account; `-SubtitlesServer http://127.0.0.1:8080` points the app at a local
server and `-SubtitlesAudioFile <path>` speaks a recording into it instead of the microphone. `swift test` in
ios/Packages/SubtitlesCore runs the core's tests on the Mac, no simulator needed.

## 7 · Open items

- **Mainland China storefront.** Listing there needs an ICP filing, which needs a mainland-hosted server and a
  filer; a paid service is expected to file as a company. The app ships to the Hong Kong and other storefronts
  first. Decide together with the company and payments questions in docs/BACKLOG.md.
- **Terms and privacy policy** must exist before submission; the backlog already lists them.
- **iCloud Drive** mirroring of recordings was to be the only sync in v1 and is not built: it needs an iCloud
  container on the developer account. Recordings already appear in the Files app under See Subtitles. Syncing
  recordings between the Mac and the phone through the server is a later phase and a storage-cost question.
- **The interface's serif** is the system's (New York italic), not Instrument Serif: no font to bundle, and Dynamic
  Type works. Swap it in SubtitlesDesign/Tokens.swift if the wordmark should match the Mac's exactly.
- **Speaker labels** and **on-device recognition** are not in v1, as on the Mac.

## 8 · The translation, spoken

What a delegate hears in an interpreter's headphones at a summit — the talk in your own language, as sound, a few
seconds behind the speaker — made from the subtitles that already exist. **It costs nothing beyond them:** the
voices are the system's own, on the device that is listening, and what they read is the translation the talk has
already paid for. Built on 2026-09-20 in three places, by one set of rules:

- **The phone, on your own talk.** A headphones button in Live's bar opens Listen: a switch, the voice, the speed.
  The audio session plays and records at once with Bluetooth for output only (A2DP), so AirPods play the voice
  while the phone's own microphone keeps listening to the room. Headphones only: through the speaker the phone
  would hear itself and subtitle its own voice, so nothing is spoken until headphones are in, and it stops
  mid-word when they come out.
- **The phone, on a joined talk.** The same button. There is no microphone open, so any output is allowed.
- **The Mac.** "Spoken translation" under Live › Where it shows speaks through the Mac's own output, for whoever
  wears headphones plugged into it; it is off whenever the app starts, because a Mac at the front of a room is
  usually wired to the hall's speakers. And **Listen on the attendee page** — every phone that scanned the code —
  which is the summit case proper: each listener's own device reads the talk to them.

**The rules** (web/speak.js `Queue`; ios SpeechQueue.swift mirrors it and replays scenarios the JavaScript
generates, so the two cannot drift): only settled sentences, because a draft is rewritten and sound cannot be;
never the past; one sentence waiting means speak faster, more than two means drop the oldest and say the newest,
because a gap is heard once and drift never ends; and nothing at all when the subtitles are the words as spoken.

**How far behind, and how good.** Measured on this pipeline (docs/LIVE-PIPELINE-MEASUREMENTS.md): a line settles
about 0.8 s after the speaker pauses, and the first word of a line waits up to 7.3 s (90th percentile) because a
line can run 6 s before it is cut. A system voice adds 0.1–0.3 s. So a listener is **3–5 s behind the speaker's
words on average and 8 s at worst**; a human simultaneous interpreter runs 2–4 s behind. Every machine
interpreter of this kind has this design (Wordly, KUDO AI, Interprefy AI). The enhanced system voices are clear
and flat: fine for following a talk, tiring over an hour. Errors are harder to forgive by ear than by eye, so the
glossary matters more here than anywhere, and the subtitles stay on screen as the way to check.

**What only ears can judge,** and no test here does: whether 1.1× is the right resting speed, whether the speed-up
is comfortable, and which voices are pleasant. The mapping from "1.3×" to the system's scale is a judgement
(SystemVoice.utteranceRate) to tune after listening in a real room.

**Not built.** Each listener choosing *their own* language: a talk has one subtitle language, so everyone hears
that one. Translating a talk into several at once is server work (a translation per sentence per language, shared
by everyone who picked it; `hy-mt2-pro` allows 60 requests a minute and one talk already makes 45, so extra
languages would go to `hy-mt2-plus`) — about two weeks, and the first thing here that would cost money, though
little. Cloud voices (Tencent 语音合成) would sound far more natural and are billed per character: a price check
and a quoted test before anything is built on them.

### Multilingual live mode

The phone gets multilingual source selection alongside the desktop: choose Multilingual as the spoken language.
`Preferences` selects the `mixed` relay and uses targets from the exported schema. Recognition and translation
stay on the server, so the phone needs no provider protocol or API key. Existing single-language selections still
use the default split pipeline. See [MULTILINGUAL-LIVE.md](MULTILINGUAL-LIVE.md) for supported sources and limits.

The September 23 recognizer selection changed the mixed relay from Gummy to Fun-ASR after a rolling-caption comparison.
Both Mac and iOS use this server-side choice; the phone needs no additional provider code or schema fields.

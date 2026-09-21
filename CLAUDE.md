# Working rules for this repository

## How the Tencent and TokenHub keys are kept

No app ever receives either key; both live only in the server's `deploy/.env`. Everyone's audio goes through the
server (`/api/desktop/live`, server/lib/live-proxy.js), which counts the seconds as they pass. An account with
`directLive` (server/lib/plans.js — the owner's) sends its audio straight to Tencent instead, on connections the server
signs (`/api/desktop/live-url`), so a talk in progress survives a server restart; the route is chosen by who the
account is, never by what failed (core/route-stream.js). **The direct route exists only on the combined pipeline**
(实时语音翻译): the split one translates with the TokenHub key, which no app holds, so its translation happens on the
server and every account is relayed. STS is impossible here — the speech WebSocket has no parameter
for a session token. Alex declined keeping a key on their own Mac, even as an outage backup.

Builds up to 0.6.9 downloaded and stored both keys, so both were replaced on 2026-09-15 and the old ones deleted —
which lifted the blocker on accounts for other people. Opening sign-up is still Alex's decision: `SIGNUP_MODE` stays
`closed` until they say otherwise. To replace the keys again: create the new ones in the console, run
`ssh -t subtitle-hk bash rotate-keys.sh` (a copy of deploy/rotate-keys.sh; it tests new keys with Tencent and TokenHub
before writing them), run `npm run e2e`, and only then delete the old keys.

## Which live pipeline runs

Since 0.8.0 the app opens on the **split pipeline**: 实时语音识别 `16k_zh_large` (or the engine for the spoken
language) with the talk's hotwords, and our own 混元翻译 call — `hy-mt2-pro` with the previous two lines as context,
for both the rolling draft and the final line. One model for both: mixing a fast draft with a better final doubles how
often a line the audience has already read is rewritten. A pause of 700 ms ends a line and nothing runs past 6 s. Subtitles in the language being spoken (普通话 → 简体中文)
skip the translator altogether: the words are the subtitle, so the line settles as recognition ends.
`core/split-stream.js`, chosen by the `pipeline` setting (`split` | `combined`), which the relay also honours.
Tencent's own 实时语音翻译 is still there as `combined`, and the relay uses it when the server has no TokenHub key;
a TokenHub outage during a talk does not switch to it — lines keep their draft, or show the words alone.
`hy-mt2-pro` takes 60 requests a minute on the account and one talk makes about 45: when TokenHub answers 429, that
line and every call for the next 20 s go to `hy-mt2-plus`, then pro again (live and file jobs alike). Why, with
numbers: docs/LIVE-PIPELINE-MEASUREMENTS.md. Recordings and exports were already on `hy-mt2-pro`.

**Tencent is reached through its Guangzhou edge** (`TENCENT_EDGE`, default `cn`, server/lib/live-proxy.js). From the Hong
Kong server ordinary DNS answers with Singapore, and 实时语音识别 reached there is billed 跨境 — ¥11.00 an hour for
`16k_zh_large` against ¥4.80 (the September bill). Tencent bills 跨境 when the service is for users outside the
mainland; Alex's talks and users are all in mainland China (2026-09-17), so mainland is the right rate. Should users
outside the mainland ever sign up, they are 跨境 by Tencent's definition and must not be pinned — record a region at
sign-up and choose the edge from it. Read the bill with `node deploy/billing.js`.

**TokenHub must be on postpaid billing** (console › 在线推理 › 开启后付费). Its free package is one million tokens per
model; `hy-mt2-pro`'s ran out on 2026-09-17 and it refused every call until billing was switched on. Translation
steps down pro → plus → lite when a model is refused, but those share the same free package.

## The iOS app follows the Mac app

`ios/` is See Subtitles for iPhone and iPad (docs/IOS.md): native Swift, the same account, server and relay. **A
change to the Mac app or the server is not finished until the phone has been considered**, and three checks in
`npm test` (core/test/ios-sync.test.js) — so in every Mac release — say when it has not been:

- **Ported code.** Some Swift is the same behaviour written again: the relay client, recorder, decimator, names,
  transcript, the MP4 look, the design tokens. `ios/scripts/ports.mjs` lists each original with what its port must
  keep true, and fails when an original has changed since. Update the Swift (or decide the change does not concern
  the phone), run `swift test` in ios/Packages/SubtitlesCore, then `node ios/scripts/ports.mjs --accept`.
- **Shared by export.** Languages, pipelines, models and tuning ranges come from core/schema.js
  (`node ios/scripts/export-schema.mjs`); strings from web/locales.js (`ios.*` keys, `L("key")` in Swift,
  `node ios/scripts/check-strings.mjs`). Never type either out a second time in Swift.
- **Shared by the server.** Anything both apps need that can live on the server does: summaries are
  `/api/summaries` with the prompt in core/summary.js, used by the Mac too. Prefer this to a port.

**Before an iOS build goes to TestFlight: `npm run e2e:ios`** (ios/e2e/run.mjs — unit tests, the phone's networking
code against the real server with stand-ins for Tencent and TokenHub, and the app driven in the Simulator; five
minutes, no keys, no cost; docs/DEVELOPMENT.md), then walk the checklist it prints on a real iPhone. Never ship a
build it rejects. `npm run e2e:ios:real` runs the core against real keys on a throwaway copy of the server (about
¥0.3, nothing deployed): quote it first.

A new Mac feature gets a line in docs/IOS.md saying whether the phone gets it, and why not if not (the Display
window, the Overlay and hosting a share link are the Mac's alone). The phone is always relayed — it has no direct
route to Tencent — and it records AAC, written as a raw stream and wrapped into m4a when the talk stops, because a
plain m4a is unplayable after a crash. Build with `xcodebuild -project ios/SeeSubtitles.xcodeproj -scheme
SeeSubtitles`; demo mode (`-demo YES`) runs a whole talk with no account or network.

## Other standing rules

- Simplified Chinese only in every user-facing string; never Traditional.
- The repository is **public** (AlexLaFF/SeeSubtitles, since 2026-09-10). Never force-push or rewrite history —
  clones and forks exist now, so a rewrite cannot recall anything and only breaks other people's checkouts.
  Never change visibility without an explicit instruction.
- Never print `.env` values or keys; refer to them by name.
- Every string goes through the catalog in `web/locales.js` (`t()` / `data-i18n`); `desktop/test/i18n.test.js` checks it.
- The account is the door in the desktop app: a logged-out app shows only the login card; do not add a login form to Settings.
- **Deploy with `npm run deploy`** (deploy/deploy.sh on the server). A restart cuts off every talk the relay is
  carrying (server/lib/live-proxy.js) — recordings are untouched, they never involve the network — so the script
  refuses while one is running (deploy/talks.sh asks the server) and `npm run deploy -- --force` overrides it.
- **Backups:** the server copies its database (consistent snapshot) and data folders to `~/backups/<date>` at 03:30
  daily (deploy/backup.sh, cron, 7 days kept); Alex's Mac pulls them to `~/Backups/SeeSubtitles` at 04:30
  (deploy/backup-pull.sh via launchd, 30 days). Restore steps are in docs/SELF-HOSTING.md.
- **Each plan caps how many talks run at once** (server/lib/plans.js `talks`: Hobbyist 1, Business 3, Enterprise 10
  across the team, pay-as-you-go 1, administrators unlimited); the relay refuses the next one with `plan_talks`.
- **A version number names one set of contents, once.** Any change to what goes into the app after a build of that
  number exists — even one only Alex has tried — gets a new number before it is built again; never rebuild a number
  with different code. The updater only moves a copy to a higher number, so a second "0.8.1" never reaches whoever
  has the first, and the two cannot be told apart (2026-09-21: six different builds were all 0.8.1; it shipped as
  0.8.2). release.sh enforces it through `desktop/dist/built.json`; the same commit may be built again.
- Release: bump `desktop/package.json`, then `npm run release -w desktop` — it first runs the release test on the server (`npm run e2e`:
  the whole app below its windows, end to end, with real recordings and the real keys; see docs/DEVELOPMENT.md), then
  builds, notarizes with the keychain profile named in `~/.config/seesubtitles/notarize.env`, and refuses the build
  unless Gatekeeper accepts it. **Never publish a build the release test or `verify-release.js` rejects**, and walk
  the window checklist release.sh prints before publishing: every release up to 0.6.7 was signed with a development certificate and notarized
  never, so it opened only on Macs registered to the team. Then copy the DMG to `~/Downloads`, publish the four files
  plus `latest-mac.yml` into the server's `/data/updates`, remove the previous version's files.

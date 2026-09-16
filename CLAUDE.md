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
often a line the audience has already read is rewritten. A pause of 700 ms ends a line and nothing runs past 6 s.
`core/split-stream.js`, chosen by the `pipeline` setting (`split` | `combined`), which the relay also honours.
Tencent's own 实时语音翻译 is still there as `combined`, and is the fallback if TokenHub is unreachable. Why, with
numbers: docs/LIVE-PIPELINE-MEASUREMENTS.md. Recordings and exports were already on `hy-mt2-pro`.

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
- Release: bump `desktop/package.json`, then `npm run release -w desktop` — it first runs the release test on the server (`npm run e2e`:
  the whole app below its windows, end to end, with real recordings and the real keys; see docs/DEVELOPMENT.md), then
  builds, notarizes with the keychain profile named in `~/.config/seesubtitles/notarize.env`, and refuses the build
  unless Gatekeeper accepts it. **Never publish a build the release test or `verify-release.js` rejects**, and walk
  the window checklist release.sh prints before publishing: every release up to 0.6.7 was signed with a development certificate and notarized
  never, so it opened only on Macs registered to the team. Then copy the DMG to `~/Downloads`, publish the four files
  plus `latest-mac.yml` into the server's `/data/updates`, remove the previous version's files.

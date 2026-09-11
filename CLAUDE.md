# Working rules for this repository

## Blocker before any account other than the owner's exists

**Do not enable sign-up, create accounts for other people, or hand out invite codes until the server's Tencent
key and its TokenHub key have been rotated.** The server stopped handing out keys on 2026-09-12 (0.7.0's code,
deployed that day), but builds up to 0.6.9 downloaded both and stored copies on the machine, and a copy stays
valid until the key is replaced. `SIGNUP_MODE` stays `closed` and `account.addMember` / invites stay unused for
outsiders until then. Decided by Alex on 2026-09-10.

What replaced it (2026-09-12): no app receives a key. Everyone's audio goes through the server
(`/api/desktop/live`, server/lib/live-proxy.js), which holds the key and counts the seconds as they pass. An
account with `directLive` (server/lib/plans.js — the owner's) sends its audio straight to Tencent instead, on
connections the server signs (`/api/desktop/live-url`), so a talk in progress survives a server restart; the
route is chosen by who the account is, never by what failed (core/route-stream.js). STS is impossible here —
the speech WebSocket has no parameter for a session token. Builds up to 0.6.9 downloaded and stored the key,
which is why it has to be rotated rather than merely no longer sent. Once both are rotated, delete this paragraph.

## Other standing rules

- Simplified Chinese only in every user-facing string; never Traditional.
- The repository is **public** (AlexLaFF/SeeSubtitles, since 2026-09-10). Never force-push or rewrite history —
  clones and forks exist now, so a rewrite cannot recall anything and only breaks other people's checkouts.
  Never change visibility without an explicit instruction.
- Never print `.env` values or keys; refer to them by name.
- Every string goes through the catalog in `web/locales.js` (`t()` / `data-i18n`); `desktop/test/i18n.test.js` checks it.
- The account is the door in the desktop app: a logged-out app shows only the login card; do not add a login form to Settings.
- **Deploying interrupts every live talk** now that the server carries the audio (server/lib/live-proxy.js).
  `docker compose up -d --build` restarts the container and every room loses its subtitles until the app
  reconnects — recordings are untouched, since they never involve the network. Do not deploy during an event.
- Release: bump `desktop/package.json`, then `npm run release -w desktop` — it first runs the release test on the server (`npm run e2e`:
  the whole app below its windows, end to end, with real recordings and the real keys; see docs/DEVELOPMENT.md), then
  builds, notarizes with the keychain profile named in `~/.config/seesubtitles/notarize.env`, and refuses the build
  unless Gatekeeper accepts it. **Never publish a build the release test or `verify-release.js` rejects**, and walk
  the window checklist release.sh prints before publishing: every release up to 0.6.7 was signed with a development certificate and notarized
  never, so it opened only on Macs registered to the team. Then copy the DMG to `~/Downloads`, publish the four files
  plus `latest-mac.yml` into the server's `/data/updates`, remove the previous version's files.

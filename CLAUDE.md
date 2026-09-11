# Working rules for this repository

## Blocker before any account other than the owner's exists

**Do not enable sign-up, create accounts for other people, or hand out invite codes until the server running
0.7.0's code is deployed and the `cantonese-subtitles` Tencent key has been rotated.** Until that deploy the
running server still has `/api/desktop/credentials`, which gives every logged-in app the permanent key of that
sub-user, so any account holder could extract it from their Mac and run Tencent's speech APIs on the owner's
bill. `SIGNUP_MODE` stays `closed` and `account.addMember` / invites stay unused for outsiders until then. Decided
by Alex on 2026-09-10.

What replaced it (2026-09-12): no app receives a key. Everyone's audio goes through the server
(`/api/desktop/live`, server/lib/live-proxy.js), which holds the key and counts the seconds as they pass. An
account with `directLive` (server/lib/plans.js — the owner's) sends its audio straight to Tencent instead, on
connections the server signs (`/api/desktop/live-url`), so a talk in progress survives a server restart; the
route is chosen by who the account is, never by what failed (core/route-stream.js). STS is impossible here —
the speech WebSocket has no parameter for a session token. Builds up to 0.6.9 downloaded and stored the key,
which is why it has to be rotated rather than merely no longer sent. Once deployed and rotated, delete this
paragraph.

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
- Release: bump `desktop/package.json`, then `npm run release -w desktop` — it builds, notarizes with the credentials
  in `~/.config/seesubtitles/notarize.env`, and refuses the build unless Gatekeeper accepts it. **Never publish a build
  `verify-release.js` rejects**: every release up to 0.6.7 was signed with a development certificate and notarized
  never, so it opened only on Macs registered to the team. Then copy the DMG to `~/Downloads`, publish the four files
  plus `latest-mac.yml` into the server's `/data/updates`, remove the previous version's files.

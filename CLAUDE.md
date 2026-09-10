# Working rules for this repository

## Blocker before any account other than the owner's exists

**Do not enable sign-up, create accounts for other people, or hand out invite codes until
`/api/desktop/credentials` is gone.** That endpoint (server/server.js) gives every logged-in app the permanent key
of the `cantonese-subtitles` Tencent sub-user, so any account holder could extract it from their Mac and run
Tencent's speech APIs on the owner's bill. `SIGNUP_MODE` stays `closed` and `account.addMember` / invites stay
unused for outsiders until it is removed. Decided by Alex on 2026-09-10.

The replacement is built and tested (2026-09-11). **STS turned out to be impossible, not merely awkward**: the
speech WebSocket authenticates with a secretid and an HMAC-SHA1 signature over the query string and has no
parameter to carry a session token, so temporary credentials cannot be used at all — the `X-TC-Token` header
belongs to the TC3 HTTP APIs, which already run server-side. Instead the server signs each connection and returns
only the finished `wss://` URL (`/api/desktop/live-url`, two-minute expiry), and proxies TokenHub for summaries;
the app opens the URL directly, so nothing is proxied and the audio path is untouched. What is left before the
blocker lifts: ship a build ≥ 0.6.9, confirm nothing older is installed, then delete the endpoint and this
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

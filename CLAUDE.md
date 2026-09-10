# Working rules for this repository

## Blocker before any account other than the owner's exists

**Do not enable sign-up, create accounts for other people, or hand out invite codes until the desktop app stops
receiving long-lived Tencent keys.** Today `/api/desktop/credentials` (server/server.js) gives every logged-in app
the permanent key of the `cantonese-subtitles` Tencent sub-user. Any account holder could extract it from their Mac
and run Tencent's speech APIs on the owner's bill, and the live-hour quota (server/lib/plans.js) is enforced by the
app itself, so it can be bypassed. Required first: temporary credentials from Tencent STS (a CAM role the server
assumes, keys scoped to speech translation, ~30-minute lifetime, refreshed mid-stream) or the server proxying the
audio stream. `SIGNUP_MODE` stays `closed` and `account.addMember` / invites stay unused for outsiders until then.
Decided by Alex on 2026-09-10.

## Other standing rules

- Simplified Chinese only in every user-facing string; never Traditional.
- The repository is **public** (AlexLaFF/SeeSubtitles, since 2026-09-10). Never force-push or rewrite history —
  clones and forks exist now, so a rewrite cannot recall anything and only breaks other people's checkouts.
  Never change visibility without an explicit instruction.
- Never print `.env` values or keys; refer to them by name.
- Every string goes through the catalog in `web/locales.js` (`t()` / `data-i18n`); `desktop/test/i18n.test.js` checks it.
- The account is the door in the desktop app: a logged-out app shows only the login card; do not add a login form to Settings.
- Release: bump `desktop/package.json`, `npm run dist -w desktop`, copy the DMG to `~/Downloads`, publish the four files
  plus `latest-mac.yml` into the server's `/data/updates`, remove the previous version's files.

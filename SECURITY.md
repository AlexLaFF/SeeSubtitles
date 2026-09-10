# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

- Preferred: [open a private advisory](https://github.com/AlexLaFF/SeeSubtitles/security/advisories/new)
  on this repository ("Report a vulnerability" under the Security tab).
- Or email **alex@seesubtitles.com**.

Include what you did, what happened, and the affected component (`core/`, `web/`, `desktop/`, `server/`).
Proof-of-concept code is welcome. Please do not test against seesubtitles.com — run the server locally
(see the README) and report against that.

Expect a reply within a week. Once a fix ships you are credited in the release notes unless you would
rather not be.

## Scope

The desktop app, the hosted server and the pages under `web/` are in scope. Tencent Cloud and the other
upstream services are not: report those to their own vendors.

Only the current release (`desktop/package.json`) receives fixes. There are no maintained older branches.

## Known design limits

These are understood and deliberate; they do not need reporting.

- **`/api/desktop/credentials` still exists for older builds.** It hands a logged-in app the server's
  permanent Tencent key, and anyone with an account can extract it from their own machine and spend the
  server owner's quota. This is why `SIGNUP_MODE` defaults to `closed`. Builds from 0.6.9 do not call it:
  the server signs each WebSocket connection instead (`/api/desktop/live-url`) and the app never receives
  a key. The endpoint goes away once no installed build needs it — until then, treat a server with open
  sign-up as a server whose key is public.
- **Signed live URLs are bearer credentials for one connection.** Each is valid for two minutes to *open*
  one stream and carries no key. `expired` gates the handshake only and never cuts an established stream
  (measured: `server/probe-signature.js`), so the window can be short without shortening a talk. The app
  keeps two or three in memory, never on disk.
- **File quotas are enforced by the app**, so an account holder can bypass them. Live quotas are checked by
  the server every time it signs a connection — twice an hour, since rotation is every 30 minutes — so they
  hold for builds that no longer carry a key.
- **Two-factor authentication is optional, not enforced.** Accounts can turn on TOTP under
  Account › Security, with ten one-time recovery codes. A server that hands out Tencent keys should
  have it on for every account. There is no hardware-key (WebAuthn) support yet.
- **A second factor guards login, not a session.** Bearer tokens last 90 days, so a token already
  issued to a machine keeps working, and `/api/desktop/credentials` still answers it. Two-factor
  raises the cost of taking over an account; it does not protect the keys already on a logged-in Mac.
- **Losing the phone and the recovery codes means the account is stuck.** A password-reset link does
  not clear TOTP by design, so whoever runs the server has to clear `users.totp_secret` for that
  account by hand.

## Running your own server

Keep `deploy/.env` out of version control (`.gitignore` covers it), give the Tencent sub-user only the
speech permissions it needs, and put the server behind HTTPS — `deploy/Caddyfile` does this
automatically.

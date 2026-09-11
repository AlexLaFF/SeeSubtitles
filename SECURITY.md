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

- **Builds up to 0.6.9 downloaded the server's Tencent key.** From 0.7.0 the server has no endpoint that
  hands it out and the app never receives one: audio goes through the server, which holds the key and counts
  the seconds (`server/lib/live-proxy.js`), or, for an account trusted with `directLive`, straight to Tencent
  on a connection the server signs. A copy stored by an older build stays valid until the key is rotated, so
  rotate it once those builds are gone — until then, treat that key as one that has left the server.
- **Signed live URLs are bearer credentials for one connection**, and only an account trusted with
  `directLive` is given them. Each is valid for two minutes to *open* one stream and carries no key. `expired` gates the handshake only and never cuts an established stream
  (measured: `server/probe-signature.js`), so the window can be short without shortening a talk. The app
  keeps two or three in memory, never on disk.
- **Live hours are counted by the server, except on a direct route.** Audio through the server is metered as
  it passes, so a modified client cannot under-report it, and a spent plan closes the talk. A `directLive`
  account's direct connection is not carried by the server, so its hours are whatever the app reports — which
  is why that flag belongs to the operator, whose account has no limit to enforce, and is never a plan feature.
  File quotas are still enforced by the app.
- **A signed URL's two-minute expiry protects a leaked URL, not a leaked account.** Anyone who can still
  authenticate can ask for another one at any time; that is what an account is for. What bounds them is the
  quota above, and the rate limit.
- **Two-factor authentication is optional, not enforced.** Accounts can turn on TOTP under
  Account › Security, with ten one-time recovery codes. Turn it on for every account trusted with
  `directLive`. There is no hardware-key (WebAuthn) support yet.
- **A second factor guards login, not a session.** Bearer tokens last 90 days, so a token already
  issued to a machine keeps working. Two-factor raises the cost of taking over an account, not of using
  a Mac that is already logged in.
- **Losing the phone and the recovery codes means the account is stuck.** A password-reset link does
  not clear TOTP by design, so whoever runs the server has to clear `users.totp_secret` for that
  account by hand.

## Running your own server

Keep `deploy/.env` out of version control (`.gitignore` covers it), give the Tencent sub-user only the
speech permissions it needs, and put the server behind HTTPS — `deploy/Caddyfile` does this
automatically.

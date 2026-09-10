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

- **The desktop app holds usable Tencent credentials.** After login the app fetches keys from
  `/api/desktop/credentials` and stores them with Electron `safeStorage`. Anyone with an account on a
  server can extract them from their own machine and use that server owner's Tencent quota. This is why
  `SIGNUP_MODE` defaults to `closed`. Do not open sign-up on a server whose keys you care about until
  the app receives short-lived credentials instead.
- **Plan quotas are enforced by the app**, so an account holder can bypass them. Treat them as guidance
  for cooperating users, not as a security control.
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

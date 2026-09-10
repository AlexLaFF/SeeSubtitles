# Self-hosting the server

The hosted side gives the desktop app its share links and cloud re-subtitling, and it is also a
complete web app on its own: upload a video or audio file, get subtitles, edit the cues, export.

> **Read [SECURITY.md](../SECURITY.md) before you open an account for anyone else.** After login the
> desktop app is handed the server's Tencent credentials, so every account holder can use your speech
> quota. `SIGNUP_MODE` defaults to `closed` for that reason.

## Quick start

```bash
cp deploy/.env.example deploy/.env      # fill in DOMAIN and the TENCENT_* keys
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml exec app node server/cli.js add-user you@example.com
```

Caddy obtains the TLS certificate for `DOMAIN` automatically. The command prints the new account's
password; the server never sends mail.

## Accounts

`SIGNUP_MODE` decides who can create one:

| Value | Behaviour |
|---|---|
| `closed` (default) | Only `cli.js add-user` creates accounts |
| `invite` | A sign-up form appears, and needs a code from `cli.js add-invite` or the Account page |
| `open` | Anyone can sign up — see the security warning above |

Everyone sees only their own jobs and live sessions. `cli.js set-role <email> admin` marks an
administrator: their **Account** page (`/account`) gains a Team section with members, invite codes,
password reset links (`/reset/<token>`, valid 24 hours, single use, handed over by you) and the
account requests that arrive from the website form. Every account has the password change, the
signed-in devices, two-factor authentication, the glossary shared with the desktop app, and usage
tiles. Login and sign-up are rate-limited per IP and per email address.

Logged-out visitors to `/` get the website (`web/site.html`). `/poster?url=…` prints an A4 QR poster
for a share link.

## Plans and quotas

`server/lib/plans.js` holds the plans and their monthly hours. `cli.js set-plan <email> <plan>`
assigns one; administrators have no limits. Quotas are **cooperative** — the desktop app reports live
seconds and pauses itself at the limit — so treat them as guidance for people you trust, not as a
control. Server-side work (uploads, re-subtitling, summaries, MP4) is metered by the server itself.

## Tencent services

| Service | Used for | CAM policy |
|---|---|---|
| 实时语音翻译 | Live subtitles from the desktop app | speech translation |
| 录音文件识别 | Uploads and cloud re-subtitling | `QcloudASRFullAccess` |
| TokenHub 混元翻译 | Translating recognised sentences | TokenHub API key |

Translation runs on **TokenHub** (大模型服务平台): set `TOKENHUB_API_KEY` from
console.cloud.tencent.com/tokenhub/apikey and pick a model with `TRANSLATION_MODEL`
(`hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite`). The same key powers AI summaries. Without it the
server falls back to the standalone Hunyuan API using the TC3 keys, which Tencent retires on
2026-09-30. The older 机器翻译 (TMT) product is not used.

`npm run probe:batch -- --translate-only` checks the translation key; `npm run probe:batch -- clip.mp3`
runs recognition and translation end to end.

### Usage and billing tiles

The dashboard shows the month's Tencent usage through `asr:GetUsageByDate`, which the ASR policy
already allows. With `TENCENT_PACK=<hours>h@<purchase date>` it also shows what is left of a
实时语音翻译 resource pack — Tencent has no API for a pack's remaining quota, so the pack size comes
from you. `TENCENT_BILLING_SECRET_ID` / `TENCENT_BILLING_SECRET_KEY`, a **separate** key with
`billing:DescribeAccountBalance` (preset `QcloudFinanceBillReadOnlyAccess`), adds the account balance.
Keep it off the main key — that one is handed to desktop apps.

## Other settings

| Variable | Purpose |
|---|---|
| `DOMAIN`, `BASE_URL` | Public hostname; Tencent fetches long uploads from `BASE_URL/media/<token>.mp3`, so the server must be reachable |
| `MAX_UPLOAD_GB` | Upload ceiling (default 8) |
| `ADMIN_EMAIL` | The account promoted to administrator at first start |
| `REQUEST_WEBHOOK_URL` | Discord or Slack webhook posted to when the website form receives an account request |
| `SMTP_*`, `MAIL_FROM`, `NOTIFY_EMAIL` | Optional mail for account-request notifications |

## Data and backup

Everything — SQLite, uploads, session logs, published desktop builds — lives in the `subs-data`
volume:

```bash
docker run --rm -v subs-data:/data -v $PWD:/out alpine tar czf /out/subs-data.tgz /data
```

## How an upload becomes subtitles

1. ffmpeg extracts 16 kHz mono audio.
2. `CreateRecTask` recognises it (engine chosen by spoken language, with word timestamps).
3. Each recognised sentence is translated whole — Cantonese is sent as `yue`, its own language in
   混元翻译. Several sentences go per request and are redone one by one if the line count comes back
   different.
4. Cues are split at punctuation to at most 22 CJK or 44 Latin characters, and the sentence's
   translation is shared across its cues in proportion to their length.
5. SRT, VTT and plain text are written for the original, the translation and both together.

The job page plays the media against the cues, lets you edit text and timing (nudge, merge, delete,
shift all), regenerates the files on save, and renders an MP4 with burned-in subtitles on demand.

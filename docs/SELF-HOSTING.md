# Self-hosting the server

The hosted side gives the desktop app its share links and cloud re-subtitling, and it is also a
complete web app on its own: upload a video or audio file, get subtitles, edit the cues, export.

> **Read [SECURITY.md](../SECURITY.md) before you open an account for anyone else.** No app is ever given
> your Tencent or TokenHub key, but every account holder spends your speech quota through the server, within
> their plan's hours — so decide who gets one. `SIGNUP_MODE` defaults to `closed`. If you ever ran a desktop
> build older than 0.7.0 against your server, it stored your keys: replace them with `deploy/rotate-keys.sh`.

## Operations

**Deploying.** `npm run deploy` from a Mac with the `subtitle-hk` SSH alias, or `sh deploy/deploy.sh` on the server:
pulls the commit on GitHub, rebuilds and restarts. A restart cuts off every talk the server is carrying, so it first
asks the running server (`deploy/talks.sh`) and refuses while one is on; `--force` overrides that.

**Backups.** `deploy/backup.sh` runs from cron at 03:30 and writes `~/backups/<date>/platform.sqlite` (a consistent
snapshot of the database, integrity-checked before it is kept) and `data.tgz` (original uploads, edited subtitle
cues and versions, recognition results, text exports, and live session logs). Rendered MP4s, extracted audio when
the original upload is present, incomplete uploads, and copies of published builds are left out. Original video
uploads are omitted: their extracted audio stays in the backup, but the original picture cannot be recreated or
used to render subtitles over the video after a restore. A restored job can still make audio-only subtitles from
that sound. Setting `BACKUP_VIDEO_UPLOADS=1` keeps original videos too. Seven days are kept. A Mac pulls them
nightly with
`deploy/backup-pull.sh` (installed as a launchd job by `npm run backup:install`), keeping thirty days in
`~/Backups/SeeSubtitles`. Run `npm run backup:pull` any time for a copy now.
To apply the smaller policy to older copies, inspect with `python3 deploy/repack-backups.py ~/backups --dry-run`,
then use `--apply`; do the same for `~/Backups/SeeSubtitles` on the Mac. Each replacement is checked before it
takes the old archive's place.

**Restoring.** With the app stopped, put a day's files back into the data volume, then start it:

```bash
cd ~/SeeSubtitles && sudo docker compose -f deploy/docker-compose.yml --env-file deploy/.env stop app
docker run --rm -v deploy_subs-data:/data -v ~/backups/2026-09-15:/b alpine sh -c 'rm -f /data/platform.sqlite* && cp /b/platform.sqlite /data/ && tar -C /data -xzf /b/data.tgz'
sudo docker compose -f deploy/docker-compose.yml --env-file deploy/.env start app
```

The published builds come back by copying them from the GitHub release into `/data/updates`.

**Replacing the keys.** `ssh -t subtitle-hk bash rotate-keys.sh` (a copy of `deploy/rotate-keys.sh` lives in the
home directory on the server): it asks for each new value with the secret halves hidden, tries them with Tencent and
TokenHub before writing anything, restarts the app and confirms it is running on them. Then run the release test,
and only then delete the old keys in the consoles.

## Quick start

```bash
cp deploy/.env.example deploy/.env      # fill in DOMAIN and the TENCENT_* keys
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml exec app node server/cli.js add-user you@example.com
```

Caddy obtains the TLS certificate for `DOMAIN` automatically. The command prints the new account's
password; the server never sends mail.

## Accounts

`SIGNUP_MODE` decides who can create an account with an email and password. `APPLE_SIGNUP_MODE` separately allows verified Apple sign-up when set to `open`:

| Value | Behaviour |
|---|---|
| `closed` (default) | Only `cli.js add-user` creates password accounts |
| `invite` | A sign-up form appears, and needs a code from `cli.js add-invite` or the Account page |
| `open` | Anyone can sign up — see the security warning above |

Everyone sees only their own jobs and live sessions. `cli.js set-role <email> admin` marks an
administrator: their **Account** page (`/account`) gains a Team section with members, invite codes,
account setup links (`/reset/<token>`, valid 24 hours, single use, handed over by you) that let an invited person choose Apple or a password, and the
account requests that arrive from the website form. Every account has the password change, the
signed-in devices, two-factor authentication, the glossary shared with the desktop app, and usage
tiles. `cli.js add-user <email> --apple-only` creates an invited account without a password. Apple can connect automatically when it shares that email; a setup link is needed when Apple hides it or uses a different email. Set `APPLE_SIGNUP_MODE=open` to let new people create accounts directly with Apple, including when they hide their email. This does not open password sign-up (`SIGNUP_MODE`). An Apple-only account can add a password later by confirming with Apple. Login and sign-up are rate-limited per IP and per email address.

Logged-out visitors to `/` get the website (`web/site.html`). `/poster?url=…` prints an A4 QR poster
for a share link.

## Plans and quotas

`server/lib/plans.js` holds the plans and their monthly hours. `cli.js set-plan <email> <plan>`
assigns one; administrators have no limits. Live hours are **metered by the server**: every app's audio
goes through it (`server/lib/live-proxy.js`), it counts the seconds as they pass and refuses the next
talk when the month is spent, and each plan caps how many talks run at once. Server-side work (uploads,
re-subtitling, summaries, MP4) is metered the same way. The one exception is an account marked
`directLive` in plans.js: its audio goes straight to Tencent on connections the server signs, so its
hours are reported by the app — give that only to the account that pays the Tencent bill.

## Tencent services

| Service | Used for | CAM policy |
|---|---|---|
| 实时语音识别 | Live subtitles, the default (`split`) pipeline: recognition, relayed through this server | `QcloudASRFullAccess` |
| 实时语音翻译 | Live subtitles on the `combined` pipeline (Tencent recognises and translates in one stream) | speech translation |
| 录音文件识别 | Uploads and cloud re-subtitling | `QcloudASRFullAccess` |
| TokenHub 混元翻译 | Translating recognised sentences, live and for uploads; the AI summaries (DeepSeek and others through the same key) | TokenHub API key |

Translation runs on **TokenHub** (大模型服务平台): set `TOKENHUB_API_KEY` from
console.cloud.tencent.com/tokenhub/apikey and pick a model with `TRANSLATION_MODEL`
(`hy-mt2-pro` / `hy-mt2-plus` / `hy-mt2-lite`), and switch the key to postpaid billing in the console
(在线推理 › 开启后付费) — the free package runs out. The same key writes the AI summaries. Without it the
relay falls back to the `combined` pipeline and uploads to the standalone Hunyuan API with the TC3 keys,
which Tencent retires on 2026-09-30. Tencent is reached through its Guangzhou edge (`TENCENT_EDGE`, below).

An uploaded file is translated **whole** instead: `FILE_TRANSLATION_MODEL` (default `deepseek-v4-flash`, on the
same TokenHub key) reads it in windows of 120 sentences, each with the 30 before it and their translations, so
names and terms hold across a film; `TRANSLATION_MODEL` covers the language pairs it is not asked for and any
window it gets wrong. `FILE_TRANSLATION_MODEL=off` translates uploads sentence by sentence as live talks are.

`npm run probe:batch -- --translate-only` checks the translation key; `npm run probe:batch -- clip.mp3`
runs recognition and translation end to end.

### Usage and billing tiles

The dashboard shows the month's Tencent usage through `asr:GetUsageByDate`, which the ASR policy
already allows. With `TENCENT_PACK=<hours>h@<purchase date>` it also shows what is left of a
实时语音翻译 resource pack — Tencent has no API for a pack's remaining quota, so the pack size comes
from you. `TENCENT_BILLING_SECRET_ID` / `TENCENT_BILLING_SECRET_KEY`, a **separate** key with
`billing:DescribeAccountBalance` (preset `QcloudFinanceBillReadOnlyAccess`), adds the account balance.
Keep it off the speech key: one key, one job, so a leak of either costs less.

The account page also groups usage by user, live mode, provider and model from the time the detailed ledger was
installed. It records relay audio seconds, completed file recognition, successful translation calls and summary
tokens; administrators can select any account. `/api/usage/detail?month=YYYY-MM` returns the signed-in account's
breakdown, and `/api/team/usage?userId=<id>&month=YYYY-MM` is administrator-only. These are usage units, not
settled charges: provider billing can lag, round, include prepaid packs, or differ from audio sent to the relay.

## Other settings

| Variable | Purpose |
|---|---|
| `DOMAIN`, `BASE_URL` | Public hostname; Tencent fetches long uploads from `BASE_URL/media/<token>.mp3`, so the server must be reachable |
| `TENCENT_EDGE` | Which Tencent edge live audio goes to: `cn` (Guangzhou, the default — the mainland rate, right while the people speaking are in mainland China), `auto`, or `system` (from a server abroad an overseas edge, billed 跨境 at about twice the price) |
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

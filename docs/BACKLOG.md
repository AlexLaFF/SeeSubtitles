# Backlog

Things worth doing that nothing is waiting on. Pick from here when there is time; strike through what is done.
Sized as a rough day count for one person.

## Decisions waiting

- **Which live pipeline.** The findings are in `docs/LIVE-PIPELINE-MEASUREMENTS.md`: the split pipeline
  (`16k_zh_large` + hotwords, then `hy-mt2-lite`, translating while the sentence is spoken) matches the current one
  on recognition. Whether it also settles lines sooner is **not established** — each talk was played once, and both
  arms were timed from their own service's sentence end rather than from the audio, so the table may be comparing
  the two VADs. Re-run it before deciding anything on speed:
  `npm run probe:ab -- <four talks> --repeat 3 --arms arms.json --out shootout` (about two hours; the report splits
  each arm's spread into run-to-run and talk-to-talk, times both arms off the recording, and records which edge each
  pass landed on). Also open: Alex's verdict from the four side-by-side review videos, and the cost of
  `16k_zh_large` — the daily settlement for 10–11 September says whether it bills as a 大模型 SKU. The raw data,
  clips and scripts are kept privately on Alex's Mac (not in this repository, since they include talk audio).
  Once decided: build the split pipeline for the languages 实时语音翻译 refuses first, and for
  Cantonese → Mandarin only if the verdict and the cost say so. *A decision, then several days.*

## Before many outside users

- **An alert when the server is down.** Nothing tells anyone. A free uptime monitor (UptimeRobot, Better Stack)
  watching `https://seesubtitles.com/healthz` every minute, mailing Alex, would. Needs an account on that service —
  Alex's to open. *0.5 day.*
- **Email from the server.** Without `SMTP_*` in `deploy/.env` there are no password-reset emails: a user who forgets
  their password asks Alex, who sends a reset link by hand from the Team page. Fine for a handful of users, not
  for many. Needs a mailbox to send from (Tencent Enterprise Mail, Mailgun, …). *0.5 day.*
- **Terms of service and a privacy policy on the site.** The service stores people's talk audio and sends it to
  Tencent; many users are in mainland China, whose Personal Information Protection Law (PIPL) is strict. A lawyer's
  question more than a code one; the pages themselves are an hour. *Legal advice needed.*
- **Payments.** Plans are set by hand (`cli.js` / the Team page) and nothing is billed. See the notes in memory on
  Stripe / Paddle for a PRC-ID founder. *Several days, plus the business decision.*
- **Measure how many talks the server can carry.** The relay has never been loaded beyond the release test's two.
  Play the test recordings through N relay connections at once (server/probe-ab.js can be adapted) and watch CPU,
  memory and subtitle delay; find the N where delay grows. The box has two cores. *0.5 day.*

## Robustness

- **A second, off-site backup location.** Backups now go server → Alex's Mac nightly. A third copy in Tencent COS
  (a bucket in another region, written by a key that can only write to that bucket) would survive both being lost
  at once. Needs a bucket and a scoped key from the console. *0.5 day.*
- **Lighthouse automatic snapshots.** The console can snapshot the whole box on a schedule; a whole-box restore is
  faster than rebuilding from backups. Console setting, Alex's to turn on. *Minutes.*
- **The app should say why a talk was refused.** When the relay refuses a talk (`plan_talks`, `plan_quota`) the app
  logs the server's English sentence. A line in the control window, from the catalogue, would be clearer. Ships
  with the next app release, together with the no-retry for `plan_talks` already in `core/remote-stream.js`.
  *0.5 day.*

## Tidy-ups

- **Decide about the `cantoneseTranscription` key.** A separate Tencent sub-user's key in that project's `.env`
  (private repo, never committed). Low risk; delete it in the console if that project is finished. *Minutes.*
- **The desktop app's Account page could show the talk limit** (`/api/me` → `plan.limits.talks` already carries
  it). *Minutes.*

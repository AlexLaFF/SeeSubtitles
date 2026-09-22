# Backlog

Things worth doing that nothing is waiting on. Pick from here when there is time; strike through what is done.
Sized as a rough day count for one person.

## Decisions waiting

- **Which live pipeline.** Decided and shipped: the split pipeline, the default since 0.8.0; the
  findings are in `docs/LIVE-PIPELINE-MEASUREMENTS.md`. Tuned the same way (pause 700 ms, cap 6 s) both pipelines
  hear the same words and break lines at the same moments; with `hy-mt2-pro` and context the split one was preferred
  in blind judging and rewrites less of what the audience has read. **Speed, settled 18 September:** both services report the
  same sentence ends; 实时语音翻译's speed swings with Tencent's load (fast connections settle about 250 ms before the
  split pipeline, slow ones 0.4–1.7 s after), while the split pipeline's ~750 ms is pro's own translation time, with
  no free way to shorten it (see the measurements doc). Also open: pro is limited to 60 requests a minute (about one talk); the bill for
  18 September shows whether the Guangzhou edge bills as mainland use; a region at sign-up before anyone outside
  the mainland is let in. The raw data, clips and scripts are kept privately on Alex's Mac (they include talk
  audio). *Deploy and release, then several days.*

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

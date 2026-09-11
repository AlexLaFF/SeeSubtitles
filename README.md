<div align="center">
  <img src="desktop/build/icon.png" alt="See Subtitles" width="88">
  <h1>See Subtitles</h1>
  <p><strong>Live Cantonese → Mandarin subtitles for everyone in the room.</strong></p>
  <p>
    <img alt="platform: macOS" src="https://img.shields.io/badge/app-macOS%2013%2B%20·%20Apple%20silicon-1c1a16">
    <img alt="server: Docker" src="https://img.shields.io/badge/server-Docker%20%2B%20Caddy-1c1a16">
    <img alt="licence: MIT" src="https://img.shields.io/badge/licence-MIT-f5c518">
  </p>
</div>

---

A Mac at the front of the room turns a Cantonese talk into Mandarin subtitles as it is spoken — on the
venue screen, over the slides, and on every phone that scans a code. When the talk ends the recording,
the full subtitles and a summary are already waiting.

It was built for real conferences, classrooms and meetings in Hong Kong and Guangdong, where following
the words is the difference between attending and taking part.

## Get the app

**1 · Ask for an account.** There is no self-service sign-up, by design — a server hands its Tencent speech
credentials to every app that logs in, so accounts are opened by hand ([why](SECURITY.md)). The form is on
the front page of **[seesubtitles.com](https://seesubtitles.com)**: say what you will subtitle, and you get
an email back.

**2 · Download.** The **Download for Mac** button on that page always points at the current build. macOS 13
or later, Apple silicon. The app updates itself from then on.

**3 · Open it and log in.** The app shows only a login card until you sign in with the address the account
was opened for; everything else is behind that. Then pick a microphone, pick your two languages, and press
**Start subtitles**.

Subtitling a video or audio file needs no download at all — log in at
[seesubtitles.com](https://seesubtitles.com) and drop the file into the web app.

## What it does

**In the room.** A microphone on the speaker. Audio streams to Tencent 实时语音翻译 and each sentence
comes back translated as it finishes. Show it in a Display window on the projector, a transparent
Overlay over your slides on any screen, or a share link and QR code that puts the subtitles on every
phone — where each attendee picks translation, original or both, at their own text size.

**Afterwards.** Recording never touches the network, so a dropped connection pauses subtitles but
never the recording. When it stops you have an MP3, SRT subtitles in both languages, an MP4 with the
text burned in, and an AI summary with clickable timestamps as Markdown or a printable PDF. Cloud
re-subtitling can run the whole recording through again in one pass to fill anything the live
connection missed.

**Files, too.** Drop a video or audio file into the web app and get subtitles in minutes: edit the
cues, fix the timing, export SRT, VTT, plain text or a burned-in MP4.

## How it works

```
microphone ─► 48→16 kHz ─► Tencent 实时语音翻译 ─► sentence + translation
                                                        │
                        ┌───────────────────────────────┼───────────────────────────┐
                        ▼                               ▼                           ▼
                 Display window                  local recording              hosted mirror
                 Overlay on slides               MP3 · SRT · MP4              share link · QR
                                                 AI summary · PDF             every phone
```

The Mac does the capture, the display and the recording. The hosted server exists for the things a
laptop cannot do alone: the share link phones connect to, subtitling uploaded files, and re-running a
recording through whole-file recognition.

## Running it yourself

**Every screen, explained.** What the app does once you are in it: [docs/USING-THE-APP.md](docs/USING-THE-APP.md).

**Your own server.** A Docker Compose stack with automatic HTTPS; you supply Tencent Cloud credentials.
→ **[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)**

**From source.** Node 24, one `npm install`, and the app runs from the repository. →
**[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**

```bash
npm install
npm run build:helpers -w desktop
npm start -w desktop
```

## Layout

| Path | |
|---|---|
| `core/` | The shared pipeline — Tencent signing, the streaming translator, the decimator, the recorder |
| `desktop/` | The macOS app: capture, Display and Overlay windows, recording, MP4, summaries |
| `server/` | The hosted side: accounts, the live mirror, upload jobs, the cue editor |
| `web/` | Every page, shared by both — app shell, display, attendee view, account, website |
| `deploy/` | docker-compose and Caddy |
| `design/` | Design tokens, icons and the canvas sources behind the interface |

## Status and limits

Honest about what this is: a working product run by one person, not a managed service.

- **macOS 13+ on Apple silicon** for the app. The web side runs in any browser.
- **Cantonese → Mandarin is what it is tuned for**, and what it has been run at real events. The other
  pairs work but have had far less use in a room. See [Languages](#languages).
- **No app receives the Tencent key from 0.7.0.** Audio goes through the server, which holds the key and
  counts the hours; only the operator's own account connects straight to Tencent, on connections the server
  signs. Builds up to 0.6.9 downloaded the key, so `SIGNUP_MODE` stays `closed` until the server running
  0.7.0 is deployed and the key rotated — see [SECURITY.md](SECURITY.md).
- **File quotas are enforced by the app**, so they guide cooperating users rather than restrict anyone.
  Live hours are counted by the server as the audio passes through it.
- The interface is English and Simplified Chinese; every string lives in one catalogue and a test
  fails the build if a screen is only half translated.

## Languages

These lists are what the Tencent services answered when every language and pair was tried against a live
account, not what the documentation advertises — the two disagree. `npm run probe:languages` runs the same
check against your own keys and prints tables in this shape.

**Live, in the room — 9 spoken languages, 46 pairs.** 实时语音翻译 refuses anything else at the handshake
with `6001 参数不合法(not support this lang pair)`, so the app only offers what will connect: choosing a
spoken language narrows the subtitle language to the column beside it.

| Spoken | Subtitles can be |
|---|---|
| 粤语 Cantonese | Mandarin · English · Japanese · Korean · Cantonese |
| 日本語 Japanese | Mandarin · English · Japanese · Korean · Cantonese |
| 한국어 Korean | Mandarin · English · Japanese · Korean · Cantonese |
| 普通话 Mandarin | the five above · Indonesian · Thai |
| English | the five above · Indonesian · Thai |
| 中英混合 Mandarin + English | the seven above · itself (each language becomes the other) |
| Bahasa Indonesia | Mandarin · English · Indonesian |
| ไทย Thai | Mandarin · English · Thai |
| Русский Russian | Mandarin · English · Russian |

**Uploaded files — 17 spoken languages into 31 subtitle languages.** Recognition uses 录音文件识别, so the
list is different: Cantonese, Mandarin (plus a large model covering Mandarin, Cantonese, English and 28
dialects, a Traditional Chinese engine and a mixed Mandarin/English/Cantonese one), English, Japanese,
Korean, Vietnamese, Thai, Indonesian, Malay, Filipino, Spanish, Portuguese, French, German, Turkish,
Arabic and Hindi, or an automatic multi-language engine.

Translation is 混元翻译, which reaches 31 languages including Cantonese, both Chinese scripts, Italian,
Dutch, Polish, Czech, Russian, Ukrainian, Hebrew, Persian, Urdu, Bengali, Tibetan, Uyghur and Mongolian.

**Russian is live-only.** There is no Russian recognition engine for files, so a Russian talk can be
subtitled as it happens but not re-subtitled from its recording afterwards.

## Documentation

- [docs/USING-THE-APP.md](docs/USING-THE-APP.md) — the app in use: Live, Files, re-subtitling, summaries, 2FA
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — build, run, test, release
- [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) — deploy the server, accounts, Tencent keys, backups
- [docs/HISTORY.md](docs/HISTORY.md) — where the pipeline came from and why parts are shaped as they are
- [SECURITY.md](SECURITY.md) — reporting a vulnerability, and the known design limits

## Licence

MIT — see [LICENSE](LICENSE). Bundled Instrument Sans and Instrument Serif are used under the SIL Open
Font License; their licences sit beside the fonts in `web/fonts/`.

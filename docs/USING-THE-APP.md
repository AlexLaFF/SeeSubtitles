# Using the app

The window has a sidebar with three places: **Live** for a talk happening now, **Files** for
recordings and anything you add, and **Settings**.

## First launch

Three cards, once:

1. **Log in.** The app then fetches its Tencent keys from the server, so no keys are ever typed.
2. **Pick the microphone**, with a live level meter.
3. **Choose the languages.**

After that a login goes straight to Live. The account is the door: logged out, the app shows only the
login card.

## Live

Arranged in the order you actually set up a talk.

**1 · Source.** Microphone, spoken and subtitle language, and the **Glossary** — names, places and
terms the recogniser should favour. The glossary is kept with your account, shared with the web app,
and applied at the next connection.

**2 · Look.** Font, size, weight, colour, shadow, alignment, line spacing, how many lines stay on
screen, and whether the top edge fades. Presets save a whole look; applying one updates every open
window.

**3 · Where it shows.**
- **Display window** (⌘3) for the projector.
- **Overlay window** (⌘4) — transparent, over your slides, placeable on any screen including virtual
  ones such as BetterDisplay. It never takes keyboard focus from the presentation, and closing it
  leaves capture and recording running.
- **Share link** for phones, with a QR code and a printable A4 poster. Attendees choose translation,
  original or both, and their own text size. Audio never leaves the Mac — only finished lines are
  mirrored.

**4 · Recording** (⇧⌘R). Written locally as the talk runs, so a lost connection pauses subtitles but
never the recording. When MP4 auto-export is on, the burned-in video is produced as soon as you stop.

The menu bar mirrors all of it: **File › Add File…** (⌘O), **View › Live / Files** (⌘1 / ⌘2), the
Display and Overlay windows, and Demo Mode. A **字幕** menu-bar item opens the controls, fills any
display, reloads or closes the overlay, or quits.

## Files

Every recording from Live, plus anything added with **+ Add file…**, each with playback, editable
subtitles, exports and actions.

- **Open** plays the recording against its cues, where you can edit text and timing.
- **Download** gives the MP3, the SRT in either language, plain text, the MP4 or a zip of the lot.
- **Actions** covers renaming, the AI summary, the MP4 export, cloud re-subtitling and deleting.

Files you add are uploaded, subtitled in the cloud, and then brought down into your recordings folder,
so an added file ends up behaving exactly like one you recorded.

### Cloud re-subtitling

**Files › a recording › Actions › Re-subtitle** uploads the recording's MP3 to the server as a job
(whole-file 录音文件识别 plus translation) and replaces the live subtitles with the complete set. It
fills the gaps a dropped connection leaves and generally reads better, because whole sentences are
translated with more context than a live stream allows.

The live versions are never thrown away — they are kept beside the new ones:

| Kept as | Was |
|---|---|
| `…中文字幕.zh.live.srt` | the live Mandarin subtitles |
| `…粤语字幕.yue.live.srt` | the live Cantonese subtitles |
| `…录音＋字幕.live.mp4` | the MP4 rendered from them |

With MP4 auto-export on, a fresh MP4 is rendered from the new subtitles automatically.

## AI summaries

A concise summary of the talk with clickable timestamps, as Markdown or a printable A4 PDF. It runs
on the summary key the server hands to logged-in apps, so nothing is typed and no VPN is needed in
mainland China. Effort maps to the model's thinking budget — at the highest setting a five-minute talk
can take a few minutes to come back.

## Recording files

Recordings are named in Chinese, and every file of one recording shares a base:

```
9月5号14点33分录音.mp3            the audio
9月5号14点33分中文字幕.zh.srt      Mandarin subtitles
9月5号14点33分粤语字幕.yue.srt     Cantonese subtitles
9月5号14点33分录音＋字幕.mp4       video with burned-in subtitles
9月5号14点33分AI总结.md / .pdf     the summary
```

Older `2026-09-05_14-33-05` recordings stay discoverable and playable, and nothing is renamed behind
your back. To migrate them, preview first and then apply:

```bash
npm run rename-recordings -w desktop -- /absolute/recordings/folder
npm run rename-recordings -w desktop -- /absolute/recordings/folder --apply
```

## Two-factor authentication

**Account › Security** on the web turns on a code from your password manager or authenticator app,
asked for after the password at every new login, with ten one-time recovery codes shown once. Keep
them somewhere safe: a password reset deliberately does not clear two-factor authentication, so losing
both the phone and the codes means an administrator has to clear it by hand.

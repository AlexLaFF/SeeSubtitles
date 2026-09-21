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

Adding a file asks first what it is, because a file is in its own languages and not in whatever Live happens to
be set to: the **spoken language**, the language the **subtitles** should be in (or none: the spoken language
only), and for a video how much of it to send. The sheet starts from the last file's answers — Live's pair the
first time. **Only the audio** is a small fraction of the size and gives the
same subtitles — the app takes the sound out of the video as it is, without re-encoding it where it can.
**The whole video** is needed only for an MP4 with the subtitles over the picture, made on seesubtitles.com.

An upload that loses its connection carries on from what the server already has, not from the beginning: the
row says "waiting for the connection…" within a few seconds of nothing going out — a connection that has died
seldom says so itself — and after twenty seconds of that the app drops it and carries on over a new one. One the app was closed in the middle of carries on when the app
opens again, as long as the file is still where it was and unchanged. A row that says "upload interrupted" is
waiting for the app (or browser tab) that was sending it; **Delete…** removes it, and the server drops what
arrived of an upload nobody has come back to for a day.

### When something fails: Try again

Whatever takes a while can fail — an upload, a job on the server, a re-subtitle, an MP4, an AI summary — and none
of them is a dead end. The failure is said where it happened (the file's row, and the recording's own page) with a
**Try again** button beside it:

- a re-subtitle is asked for again in the same languages, without the sheet; if the server had finished and only the
  fetching failed, the subtitles are fetched rather than made a third time
- an MP4 or an AI summary is simply made again
- a job that failed on the server is run again there — what was heard is kept, so nothing is recognised twice
- an upload the server has part of carries on from there. If this app no longer knows where the file is (it was begun
  by an older version, or on another Mac), it asks for the file and checks it is the same one before sending the rest
- an upload that failed before it began (no sound in the video, the server not there) is added again as it was asked for

Before it gives up, the app has already tried by itself: a connection that goes quiet is replaced after twenty
seconds, and a re-subtitle waits out five minutes of the server being unreachable.

### Cloud re-subtitling, and making subtitles again in other languages

**Files › a recording › Actions › Re-subtitle** asks for the spoken and subtitle languages — starting from the
ones the recording is in — and makes the subtitles again from the whole file (录音文件识别 plus translation).
It is also how a file added in the wrong languages is put right. When seesubtitles.com still has the file (it was
added from there, or re-subtitled before) nothing is uploaded again, and changing only the subtitle language
does not recognise the speech again, so it uses no file hours.

**Nothing made before is lost.** The talk's own subtitles stay beside the recording as `.live.srt`, as they
always have. Anything made since — an earlier re-subtitle, the subtitles an added file arrived with, edits made
to them, the MP4 rendered from them, and a copy of the AI summary — moves into the recording's `旧版本` folder,
one numbered folder per version named for its languages (`1 英文→中文`). The recording's page lists them under
Files; renaming or deleting the recording takes the folder along. On seesubtitles.com a job's page has the same
control ("Make the subtitles again") and lists its versions with every file they held.

The first re-subtitle of a live recording replaces the live subtitles with the complete set. It
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

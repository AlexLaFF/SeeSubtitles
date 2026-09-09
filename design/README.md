# See Subtitles · design language

**Decision: A · Marquee**, with the red on-air dot in the corner of the mark. The other two directions are kept
below for reference. The visual version is the design canvas at
https://claude.ai/code/artifact/8cbcf5be-eb16-4d47-b1d0-fcdbc17ca31a (four pages: App, Web, Brand, Considered); this folder
holds the same content in a form the code can use: token stylesheets, icon SVGs, the rendered artboards, and
the generator that produces the canvas.

```
design/tokens/marquee.css      the chosen tokens: every colour, font and size as custom properties, both appearances
design/tokens/{daylight,signal}.css   the directions not chosen, for reference
design/icons/app-marquee.svg   the app icon (1024 with the macOS margin); tray-stack.svg is the menu-bar template
design/canvas/                 the generator (node build.mjs) and the rendered artboards, openable in any browser
```

## Screens in the canvas

**App (desktop, Marquee).** Exists today, redrawn: Live · Files · Recording (playback, cues, files, summary tab)
· Settings · Display window with its control panel · Overlay on slides with the 字幕 menu-bar item · QR sheet.
New: First run (log in, microphone, languages) · Glossary manager · States (not logged in, refused, reconnecting,
paused, demo, empty, update) · Printable QR poster (A4).

**Web (seesubtitles.com, Marquee).** Home for desktop and phone · Log in (exists) · Create account · Password
reset (three steps) · Overview (today's dashboard, with usage) · Job editor (exists) · Learning summary (exists)
· Account and team (new) · Attendee page (exists) with its controls sheet and ended state (new).

**Brand.** Marquee brand board · final app icon at every size · principles · gap analysis against Wordly,
Interprefy, Otter and Ava.

Where each new screen comes from: Wordly and Interprefy hand organisers signage and a shareable glossary and give
attendees a language picker; Wordly's portal shows upcoming sessions, balance and reports; Otter has custom
vocabulary, workspaces and shared minute pools; Ava gives attendees text size and a high-contrast mode. First
run, password reset and drawn-once states are what every mature app has. Deliberately not added: speaker labels
(the live pipeline has none), audio translation for attendees (audio stays in the room), meeting-platform
integrations, folders and tags.

## What the app is for, and what that asks of the design

The app exists so that anyone can use subtitles as an assist, in any room: a hall, a meeting, a video on a
laptop. Four consequences:

- **The subtitles are the show.** The operator's window is calm and mostly monochrome so the stage preview,
  the status and the one thing to do next stand out.
- **Legible before pretty.** Body text never below 13 px, secondary text never below 12, contrast that holds
  up on a projector-lit laptop at the back of a room.
- **Setup is a sequence.** Source, look, where it shows, recording: numbered, in that order, the rarely used
  controls folded away.
- **Bilingual by design.** Every primary line can carry a quieter second line: translation and original, a
  name and its role, a state and its detail.

## Principles shared by every direction

These fix the hierarchy problems in the current shell regardless of which direction is chosen.

**Three text tiers, one filled action per view.**

| tier       | size / weight     | used for                                                                  |
| ---------- | ----------------- | ------------------------------------------------------------------------- |
| View title | 20 / 600          | Live, Files, Settings, a recording's name                                 |
| Section    | 14 / 600          | numbered steps and panel titles; the step numeral is where the accent sits |
| Body       | 13 / 400          | fields, table cells, transcript; buttons 12.5 / 500                       |
| Secondary  | 12.5 / 400 · fg-2 | labels, the quieter line of a stack, the status sentence                  |
| Hint       | 12 / 400 · fg-3   | explanations under a row, footer, timestamps (mono, tabular)              |

Today the section title (11 px grey caps) is smaller than the labels beneath it, the Live toolbar has two
filled colours competing on one row (red record, blue share), status chips are styled like buttons, and the
shortcut help sits in the toolbar. After: the status reads as one sentence in text colour with a dot (only
recording keeps its colour), there is one filled button per view (Live: record; Files: add file; a
recording: download or save), section titles are the largest text in a panel, and shortcuts live in a footer
and next to nav items.

**The stack.** One row pattern everywhere: a primary line in `fg` at body size and a secondary line in `fg-3`
one step smaller, 2 px apart. Nav item + shortcut, file name + "recording · 粵語 → 中文 · 47:12", "Tencent
Cloud" + "實時語音翻譯 · keys from seesubtitles.com", translation + original. Chinese terms go on the secondary
line in the UI, never inline in an English sentence.

**Colour.** Three surfaces (`bg` window, `side` sidebar and footer, `surface` panels and buttons) plus
`surface-2` for inputs and hover and a single `line` colour. The accent appears in exactly three places: the
primary action, the active nav item, the step numerals. Status is a dot and a word; hues are the same in every
direction (`ok` ready, `warn` reconnecting or paused, `bad` error, `rec` recording); demo mode is an outlined
chip, not a fifth colour. No shadows inside the window; elevation is a border. Menus and the QR sheet are the
only floating surfaces.

**Scale.** Spacing 4 8 12 16 24 32. Radius 4 (tags) 6 (buttons, fields) 10 (panels) 14 (sheets). Control
heights 24 small, 28 default, 32 primary. Sidebar 200, label column 128, left column 600.

**Words.** Sentence case everywhere except macOS menu bar items. Say what happened in a sentence:
"Connected · Guangzhou edge", "Reconnecting in 12 s", "Recording 12:04". No exclamation marks. Numbers are
tabular, times monospaced, sizes carry a unit in `fg-3`. Keyboard shortcuts appear once, in the footer, and
next to nav items.

## The three directions

The mark, the tone and the type are separate decisions; any mark works in any direction (see the icon sheet).

### A · Marquee — the venue (chosen)

Warm charcoal like a darkened hall, and the yellow of a cinema subtitle as the one accent. Dark-first; the
light appearance uses warm paper. Instrument Sans for the UI, Noto Sans TC for Chinese, Instrument Serif
italic for the wordmark only. Mark: the Stack (a long warm-white line over a shorter yellow line) on a
near-black tile, with a red on-air dot (the recording colour) in the top-left corner.

- Best when: conference and venue use; a natural evolution of the current dark shell with a colour that is
  actually ours.
- Watch out: the light appearance is the second-class citizen, and yellow needs care next to amber warnings
  (`warn` is pushed towards orange for that reason).
- Tokens: `tokens/marquee.css`.

### B · Daylight — the page

Warm paper and ink, serif titles, no brand colour at all: colour is reserved for status. Light-first with a
warm dark appearance. IBM Plex Sans and IBM Plex Sans TC for the UI, Newsreader (and Noto Serif TC) for view
titles, section titles and the wordmark. No cards: hairlines and type do the grouping; row labels are small
tracked capitals; the record button is ink with a red dot. Mark: the Eye-line (an upper lid and pupil over a
subtitle bar) in paper on ink.

- Best when: the inclusion ethos made visible; calm, high-contrast, reads like a well-set document at a desk
  or on a phone; the hosted web app benefits most.
- Watch out: light-first in rooms that are often dark, and the quietest of the three; it relies on typography
  to carry personality.
- Tokens: `tokens/daylight.css`.

### C · Signal — the on-air light

Cool neutrals, a grotesk built for signage, and one coral accent that is also the recording colour. Light and
dark are equals. Archivo for the UI and the tracked-uppercase wordmark and view titles, Noto Sans TC for
Chinese. Step labels are tracked micro-capitals above the section title. Mark: the Stack in white with a coral
on-air dot in the corner.

- Best when: work files and the hosted web app matter as much as the venue; a contemporary product feel.
- Watch out: the most conventional "modern app" of the three; coral must stay away from error red, so `bad`
  is a crimson and errors always carry an icon and a word.
- Tokens: `tokens/signal.css`.

### Why Marquee

It is the most ours: the yellow is a memory every Cantonese-speaking audience has of subtitles, the stacked
mark is the product itself, and it evolves the shell that already worked rather than replacing it. Its light
appearance uses Daylight's paper tokens.

## App icon

Three concepts, all bottom-weighted: the empty upper part is the screen, the mark is what appears at its foot.

- **Stack** (chosen): the bilingual pair, a long bright line over a shorter quieter one, with the red on-air
  dot in the corner. The product itself; survives 16 px. The menu-bar template uses the bars only, since the
  dot would be a stray pixel at 18 px.
- **Eye-line**: an upper lid and a pupil over a subtitle bar that doubles as the lower lid; "see" made
  literal. Default for Daylight.
- **Bracket**: the corner quotes 「 」 that Cantonese and Traditional Chinese text uses, framing a subtitle
  line. Typographic and rooted in the language, but it turns to noise at 16 px.

Wordmark: "See Subtitles" in the direction's display face, locked up with the Chinese name 看字幕 (kàn zìmù, "see the
subtitles"), which reads the same in Traditional and Simplified. 睇字幕 (Cantonese) and 見字幕 were considered.

Production: one 1024 × 1024 PNG with the 100 px transparent margin as `desktop/build/icon.png`
(electron-builder derives the icns; `icons/app-<direction>.svg` is the source); `trayTemplate.png` and
`trayTemplate@2x.png` at 22 and 44 px, black on transparent, loaded as a template image in place of the empty
image the tray uses today (`icons/tray-<concept>.svg`); the same SVG inline in the sidebar (22 px) and on the
phone share page (18 px).

## Applying a direction

Applied (Marquee): `web/tokens.css` is `tokens/marquee.css` with the bundled Instrument Sans and Instrument Serif
faces prepended (SIL OFL, `web/fonts/`); every stylesheet runs on the tokens and follows the system appearance;
the sidebar, topbars and favicon carry the mark; `desktop/build/icon.png` (rasterised from `icons/app-marquee.svg`)
is the app icon via electron-builder, and `desktop/assets/trayTemplate*.png` (from `icons/tray-stack.svg`) is the
menu-bar icon. To regenerate the PNGs after changing the SVGs, render them with any SVG rasteriser at 1024, 22 and 44 px
with a transparent background. The shell anatomy (Live, Files, Settings), the hosted pages (overview, job, log in,
account, reset, poster), the attendee page, the new screens (first run, glossary, not-logged-in card) and the website
(`web/site.html`, EN / 简) follow the artboards on the canvas; the gap board's deliberate omissions (speaker
labels, attendee audio, meeting integrations) stay omitted.

1. Load the chosen `tokens/<direction>.css` first and replace the hard-coded colours in `web/style.css`,
   `web/desktop.css` and `web/app.css` with the custom properties; both appearances then follow the system
   (`data-appearance` on `<html>` forces one).
2. Add the Google Fonts link (in the header comment of the token file) to `desktop.html`, `app.html`,
   `login.html` and `job.html`; the display page keeps the user-chosen subtitle font.
3. Live, Files and Settings take the header, toolbar, section, row and footer anatomy from the principles
   above (see the Live artboards for the exact layout).
4. The hosted pages and the phone share page use the same tokens so the web and the app read as one product.
5. Icon: rasterise the chosen SVG to `desktop/build/icon.png`, add `mac.icon` to `electron-builder.yml`, and
   load the tray template in `desktop/main.js`.

## Regenerating the canvas

```bash
cd design/canvas && node build.mjs      # writes out/*.dc.html, out/canvas.json, out/tokens, out/icons
```

`tokens.mjs` holds every value per direction; `icons.mjs` the marks; `lib.mjs` the shell CSS and the
direction boards; `app-screens.mjs`, `web-screens.mjs` and `boards.mjs` the round-two screens; `sizes.json`
the rendered board heights used for the canvas layout.

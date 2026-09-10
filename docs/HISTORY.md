# History

See Subtitles grew out of a localhost tool that ran one talk on one Mac. These notes record what came
across when the pipeline was packaged into an app, kept because they explain why a few things are
shaped the way they are.

## 0.2.0 — the port from the local tool

Ported the local-tool commits after `3cff4b8` through `2be9fbc` (7 September 2026):

- **AI learning summaries** with a concise synthesis prompt, progress reporting, Markdown viewing,
  clickable recording timestamps and A4 PDF export. They run through Tencent TokenHub (DeepSeek V4
  Flash by default; V4 Pro, Kimi K3 and MiniMax M3 selectable) using the key the server hands to
  logged-in desktops, so no VPN is needed in mainland China and no key is typed. Effort maps to the
  model's thinking budget, and timestamps beyond the recording's length are dropped. PDFs are rendered
  with the app's bundled Chromium.
- **Chinese recording filenames**, with legacy recordings still discoverable and playable. New audio,
  subtitles, MP4s, summaries and PDFs follow the same scheme; existing files are never renamed
  automatically. An optional migration previews the changes before applying them:
  `npm run rename-recordings -w desktop -- /absolute/recordings/folder` (add `--apply`).
- **A 字幕 menu-bar item** to open the controls, fill any display, reload or close the overlay, or
  quit. The overlay never takes keyboard focus from the presentation, and closing it leaves capture
  and recording running.
- **Overlay registration survives a pipeline restart**, the selected display is highlighted, and the
  hidden audience-screen hint matches the local tool. Because the app owns the overlay and the local
  server in one process, it needs none of the standalone overlay's server-loss quit timer.
- Applying a preset refreshes the controls in the browser that asked for it. Microphone capture
  ignores unrelated audio-device changes, and Tencent connection retries avoid edges that just failed.
- **MP4 exports carry no embedded subtitle track** — players would draw a second copy over the
  burned-in text. The stacked subtitles fill the frame and dissolve at the top edge, like the live
  display. Plain-text downloads (original, translation, text only) exist for the live transcript and
  for every recording.
- **Recognition tuning** in the Input group, applied at the next connection through a graceful
  rotation: hotwords (`词|权重`, one per line, up to 128), the pause that ends a sentence
  (500–2000 ms), a forced split (5–90 s), the filler-word filter and a noise threshold. Measured on
  Cantonese: shorter sentences translate more literally and finalise sooner; longer ones read more
  fluently but get paraphrased. Values that are not URL-safe are signed raw and sent URL-encoded, as
  the API requires.
- **Finding the mainland edge from behind a VPN**: Chinese DoH resolvers are queried with a mainland
  client-subnet hint, with a known-good Guangzhou edge as the last resort. Without this, an overseas
  edge answers and has no route for 实时语音翻译.

Summary generation is for desktop recordings; it is not part of hosted upload jobs.

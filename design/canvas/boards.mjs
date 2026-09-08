// Guide boards for the second round: the start page, the final icon sheet and the gap analysis.
import { NEUTRAL_CSS, page, markSvg } from './lib.mjs';
import { DIRECTIONS, cssVars } from './tokens.mjs';
import { CONCEPTS, tray } from './icons.mjs';

const M = DIRECTIONS.marquee; const T = M.dark;
const mark = (size) => markSvg(M, { size });

export function startHere() {
  const css = NEUTRAL_CSS + `
.nb{width:1200px;min-height:1200px}
.dec{display:flex;gap:22px;align-items:center;padding:22px 24px;border-radius:14px;background:${T.bg};color:${T.fg};border:1px solid ${T.line}}
.dec h2{margin:0 0 4px;font:italic 400 30px/1.1 ${M.fonts.display}, serif;color:${T.fg};letter-spacing:0;text-transform:none;border:0;padding:0} .dec p{color:${T.fg2};font-size:14px;max-width:760px}
.pages{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.pages div{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--surface)} .pages b{display:block;font-weight:600;margin-bottom:4px} .pages span{color:var(--fg-2);font-size:13px;line-height:1.5}
.inv{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.inv h3{margin:0 0 8px;font:600 14px var(--ui)} .inv ul{gap:5px} .inv li{font-size:13.5px} .inv li em{color:var(--fg-3);font-style:normal;font-size:12px}
`;
  const body = `<div class="nb">
  <div class="sec" style="gap:12px"><h1>See Subtitles · design language</h1><p class="lead">Round two. The direction is chosen; this canvas now holds every screen of the product drawn in it, the website, the flows that were missing, and the brand assets, on four pages.</p></div>
  <div class="dec">${mark(72)}<div><h2>Marquee, with the on-air light</h2><p>Warm charcoal, the yellow of a cinema subtitle as the one accent, Instrument Sans with an italic serif wordmark. The mark is the bilingual stack with a red dot in the corner, the app's own "recording" light. Light appearance uses the paper tokens.</p></div></div>
  <div class="sec"><h2>Pages of this canvas</h2><div class="pages"><div><b>App</b><span>Every desktop screen: Live, Files, a recording, Settings, the Display window with its panel, the Overlay on slides with the menu-bar item, the QR sheet; then first run, glossary, states and the printable poster.</span></div><div><b>Web</b><span>seesubtitles.com home (desktop and phone), log in, create account, password reset, the hosted overview, job editor, learning summary, account and team, and the attendee page with its controls and ended state.</span></div><div><b>Brand</b><span>The Marquee brand board, the final app icon at every size, the principles every screen follows, and the gap analysis against Wordly, Interprefy, Otter and Ava.</span></div><div><b>Considered</b><span>The app as it is today and the two directions not chosen, Daylight and Signal, kept for reference.</span></div></div></div>
  <div class="sec"><h2>Screen inventory</h2><div class="inv">
    <div><h3>Exists today, redrawn</h3><ul><li>Live</li><li>Files list</li><li>Recording: playback, cues, files, summary tab</li><li>Settings <em>· gains a Glossary section</em></li><li>Display window and its control panel</li><li>Overlay window on slides, 字幕 menu-bar item</li><li>QR sheet for the venue screen</li><li>Attendee page on a phone</li><li>Hosted: log in, overview, job editor, learning summary</li></ul></div>
    <div><h3>New, and where the idea comes from</h3><ul><li>First run: log in, microphone, languages <em>· every mature desktop app</em></li><li>Printable QR poster (A4) <em>· Wordly and Interprefy hand organisers signage</em></li><li>Glossary manager, shared with the team <em>· Wordly boost/block, Interprefy pre-loaded terms, Otter custom vocabulary</em></li><li>"This talk" stats on a recording: phones followed, peak <em>· Wordly session reports</em></li><li>Hosted overview with usage and resource pack <em>· Wordly balance, Otter minute pools</em></li><li>Account, security, team and invite codes <em>· Otter workspaces; today this is a CLI</em></li><li>Attendee controls: translation / original / both, text size, high contrast, keep awake; ended state <em>· Ava, Wordly language picker</em></li><li>Create account, forgot password, check email, new password</li><li>States drawn once: not logged in, refused, reconnecting, paused, demo, empty, update</li><li>Website: home for desktop and phone, request an account</li></ul></div></div></div>
  <div class="sec"><h2>Applying it</h2><ul><li>Tokens: <code>design/tokens/marquee.css</code> replaces the hard-coded colours in style.css, desktop.css and app.css; the light appearance follows the system.</li><li>Icon: <code>design/icons/app-marquee.svg</code> rasterised to 1024 for electron-builder; <code>tray-stack.svg</code> as the menu-bar template in place of the empty image.</li><li>Screens in the order they are used: Live, Files, recording, Settings; then the hosted pages; then the new flows.</li><li>Not drawn here: menus and dialogs macOS provides, and the print theme of the PDF summary, which keeps white paper and black ink.</li></ul><p class="hint">Sample names, numbers and sentences on the screens are illustrative. The Chinese name 睇字幕 remains a proposal.</p></div>
</div>`;
  return page({ fontLink: M.fonts.link, css, body });
}

export function finalIcon() {
  const css = NEUTRAL_CSS + `
.nb{width:1200px;min-height:1300px}
.dock{display:flex;align-items:flex-end;gap:14px;padding:12px 16px;border-radius:22px;background:rgba(255,255,255,.55);border:1px solid rgba(0,0,0,.08);width:max-content;backdrop-filter:blur(10px)}
.dock i{display:block;width:64px;height:64px;border-radius:14px;background:#cfcbc2} .dock i.a{background:#3a7bd5} .dock i.b{background:#f0f0f0;border:1px solid #ddd} .dock i.c{background:#2ecc71} .dock i.d{background:#333}
.deskbg{padding:40px;border-radius:16px;background:linear-gradient(160deg,#5b6b8a,#2d3446);display:flex;justify-content:center}
.sizes{display:flex;align-items:flex-end;gap:34px} .sizes div{display:flex;flex-direction:column;align-items:center;gap:8px;font:11px var(--mono);color:var(--fg-3)}
.finder{display:flex;align-items:center;gap:8px;height:28px;padding:0 10px;border-radius:6px;background:#fff;border:1px solid #ddd;font:13px -apple-system,system-ui,sans-serif;color:#111;width:340px}
.menubar{display:flex;align-items:center;gap:12px;height:26px;padding:0 10px;border-radius:5px;font:500 12px -apple-system,system-ui,sans-serif;white-space:nowrap} .menubar.lt{background:#e8e8ea;color:#111} .menubar.dk{background:#2b2b2e;color:#f0f0f0}
.alts{display:flex;gap:40px;align-items:center} .alts div{display:flex;align-items:center;gap:14px;color:var(--fg-2);font-size:13px} .alts b{display:block;color:var(--fg);font-weight:600}
.notes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 28px;font-size:13px;color:var(--fg-2)} .notes code{font:12px var(--mono);color:var(--fg);background:var(--surface-2);padding:1px 5px;border-radius:4px}
.spec{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;font-size:13px;color:var(--fg-2)} .spec b{color:var(--fg);font-weight:500}
`;
  const alt = (svg, name, why) => `<div>${svg}<span><b>${name}</b>${why}</span></div>`;
  const body = `<div class="nb">
  <div class="sec" style="gap:12px"><h1>App icon · final</h1><p class="lead">The Stack in Marquee's colours with the on-air light: a long warm-white line over a shorter yellow line at the foot of a charcoal screen, and a red dot in the corner. The empty upper half is the screen; the dot says a talk is being recorded.</p></div>
  <div class="deskbg"><div class="dock"><i class="a"></i><i class="b"></i>${mark(64)}<i class="c"></i><i class="d"></i></div></div>
  <div class="sec"><h2>Sizes macOS uses</h2><div class="sizes"><div>${mark(256)}<span>1024 / 512 · dock, About, Finder preview</span></div><div>${mark(128)}<span>256 / 128</span></div><div>${mark(64)}<span>64</span></div><div>${mark(32)}<span>32</span></div><div>${mark(16)}<span>16</span></div></div>
    <div style="display:flex;gap:24px;align-items:center;margin-top:8px"><div class="finder">${mark(16)}<span>See Subtitles.app</span><span style="margin-left:auto;color:#888">2.1 GB</span></div><div class="menubar lt">${tray({ color: '#000', size: 18 })}<span>字幕</span><span style="opacity:.5">Wed 14:02</span></div><div class="menubar dk">${tray({ color: '#fff', size: 18 })}<span>字幕</span><span style="opacity:.5">Wed 14:02</span></div><span class="hint">Finder row at 16 · menu bar template, bars only: the dot would be a stray pixel there</span></div></div>
  <div class="sec"><h2>Geometry</h2><div class="spec"><b>Tile</b><span>824 × 824 in a 1024 canvas (100 px transparent margin), corner radius 185, fill #131210</span><b>Top line</b><span>524 × 96, radius 48, centred, top at 452, fill #f1ece2</span><b>Second line</b><span>360 × 72, radius 36, centred, top at 596, fill #f5c518</span><b>On-air dot</b><span>radius 46 at 196, 196, fill #ff453a (the recording colour)</span><b>In the UI</b><span>the same SVG inline at 22 px in the sidebar and 18 px on the phone page, with a 1 px ring of the line colour so the tile reads on the dark sidebar</span></div></div>
  <div class="sec"><h2>Alternates considered</h2><div class="alts">${alt(CONCEPTS.eye({ tile: '#131210', ink: '#f1ece2', bar: '#f5c518', size: 72 }), 'Eye-line', 'the literal "see"; friendlier, less product')}${alt(CONCEPTS.bracket({ tile: '#131210', ink: '#f1ece2', bar: '#f5c518', size: 72 }), 'Bracket 「」', 'typographic and Cantonese, but noise at 16 px')}${alt(CONCEPTS.stack({ tile: '#131210', top: '#f1ece2', bottom: '#f5c518', size: 72 }), 'Stack without the dot', 'the first-round default; quieter, less alive')}</div></div>
  <div class="sec"><h2>Production</h2><div class="notes"><div><code>design/icons/app-marquee.svg</code> is the source. Rasterise to 1024 × 1024 PNG as <code>desktop/build/icon.png</code>; electron-builder writes the icns (add <code>mac.icon: build/icon.png</code>).</div><div><code>design/icons/tray-stack.svg</code> → <code>trayTemplate.png</code> (22 × 22) and <code>@2x</code> (44 × 44), black on transparent, loaded with <code>nativeImage</code> and <code>setTemplateImage(true)</code>, in place of the empty image; keep the 字幕 title beside it.</div><div>The Display and Overlay windows keep no icon of their own; the dock shows the app icon with a badge while recording.</div><div>Favicon for seesubtitles.com: the same SVG, 32 and 180 px.</div></div></div>
</div>`;
  return page({ fontLink: M.fonts.link, css, body });
}

export function gapBoard() {
  const css = NEUTRAL_CSS + `
.nb{width:1200px;min-height:1500px}
.gt{width:100%;border-collapse:collapse;font-size:13px} .gt th{text-align:left;font:600 11.5px/1.3 var(--ui);letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3);padding:10px 10px;border-bottom:1px solid var(--line-strong)} .gt td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top} .gt td:first-child{font-weight:500} .gt .y{color:var(--ok);font-weight:600} .gt .n{color:var(--fg-3)} .gt .new{color:#8f6a00;font-weight:600;background:rgba(245,197,24,.18);border-radius:4px;padding:1px 6px} .gt .p{color:var(--fg-2)}
.src{font-size:12.5px;color:var(--fg-3);line-height:1.6}
`;
  const Y = '<span class="y">✓</span>'; const N = '<span class="n">–</span>'; const NEW = (t) => `<span class="new">${t || 'drawn here'}</span>`; const P = (t) => `<span class="p">${t}</span>`;
  const rows = [
    ['Attendees join by QR / link, no install', Y, Y, N, Y, Y, Y],
    ['Attendee picks language or original', Y, Y, N, P('translation language'), P('shortcut on the display page only'), NEW('phone controls')],
    ['Attendee text size, contrast, keep awake', P('audio or text'), Y, N, Y, N, NEW('phone controls')],
    ['Session ended state for attendees', Y, Y, N, N, N, NEW()],
    ['Printable signage / QR poster', P('organiser kit'), P('organiser kit'), N, N, N, NEW('A4 poster')],
    ['Organiser portal: upcoming sessions, reports', Y, Y, P('recordings list'), N, P('live sessions table'), NEW('overview + this talk')],
    ['Usage / balance / minutes', Y, Y, Y, Y, N, NEW('overview strip · needs billing API')],
    ['Glossary / custom vocabulary', Y, Y, Y, N, P('hotwords textarea'), NEW('manager, shared')],
    ['Team, roles, invites', Y, Y, Y, N, P('CLI only'), NEW('account · team')],
    ['Password reset, account security', Y, Y, Y, Y, N, NEW('auth flow')],
    ['First-run setup', P('web'), P('app'), Y, Y, N, NEW('three steps')],
    ['Overlay on slides / any display', N, N, N, N, Y, Y],
    ['Local recording independent of network', N, N, P('cloud'), N, Y, Y],
    ['Re-subtitle whole recording afterwards', N, N, Y, N, Y, Y],
    ['Editable cues, SRT / VTT / TXT / MP4 burn-in', P('transcripts'), P('transcripts'), P('transcript editor'), N, Y, Y],
    ['AI summary with timestamps', N, N, Y, N, Y, Y],
    ['File upload subtitling', P('videos'), N, Y, N, Y, Y],
    ['Speaker labels', N, N, Y, Y, N, N],
  ];
  const body = `<div class="nb">
  <div class="sec" style="gap:12px"><h1>What the category leaders have</h1><p class="lead">Wordly and Interprefy are event tools: an organiser portal, signage, a glossary, attendees on their own phones. Otter is a recordings tool: workspaces, minute pools, an editor. Ava is an accessibility tool: attendee text size and contrast. See Subtitles already does things none of them do (overlay on slides, a recording that cannot drop, re-subtitling afterwards); the gaps are the organiser and attendee surfaces around a talk.</p></div>
  <table class="gt"><thead><tr><th style="width:26%">Capability</th><th>Wordly</th><th>Interprefy</th><th>Otter</th><th>Ava</th><th>See Subtitles today</th><th>In this canvas</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
  <p class="src">Read from the public pages of each product in September 2026: Wordly's organiser portal with upcoming sessions, balance and reports, glossary boost/block/replace shared with a team, attendee QR → language choice; Interprefy's pre-loaded glossary, attendee app and embedded widget; Otter's custom vocabulary, shared workspaces, admin controls and shared minute pools; Ava's text size and higher-contrast dark mode in the conversation menu. Partial marks (in grey) mean the capability exists in a narrower form.</p>
  <div class="sec"><h2>Deliberately not added</h2><ul><li>Speaker labels: the live pipeline does not return them, and a wrong label on a venue screen is worse than none.</li><li>Audio translation for attendees: the product's stance is that audio stays in the room; phones show text.</li><li>Calendar and meeting-platform integrations: See Subtitles lives at the front of a physical room, not inside Zoom.</li><li>Folders, tags and search across recordings: Files stays one list with a filter until there are enough recordings to need more.</li></ul></div>
</div>`;
  return page({ fontLink: null, css, body });
}

// Builds the See Subtitles design canvas (round two): artboards on four pages, canvas.json, token CSS, icon SVGs.
import fs from 'node:fs';
import path from 'node:path';
import { DIRECTIONS, SCALE } from './tokens.mjs';
import { CONCEPTS, tray } from './icons.mjs';
import { primaryTokens, liveScreen, phoneScreen, brandBoard, principles, current } from './lib.mjs';
import * as A from './app-screens.mjs';
import * as W from './web-screens.mjs';
import * as B from './boards.mjs';

const OUT = path.resolve('out');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'tokens'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });

const MQ = DIRECTIONS.marquee;
const boards = {
  // page: app
  'Main.dc.html': B.startHere(),
  'MarqueeLive.dc.html': liveScreen(MQ),
  'AppFiles.dc.html': A.files(),
  'AppRecording.dc.html': A.recording(),
  'AppSettings.dc.html': A.settings(),
  'AppDisplay.dc.html': A.display(),
  'AppOverlay.dc.html': A.overlay(),
  'AppQrSheet.dc.html': A.qrSheet(),
  'AppFirstRun.dc.html': A.firstRun(),
  'AppGlossary.dc.html': A.glossary(),
  'AppStates.dc.html': A.states(),
  'AppPoster.dc.html': A.poster(),
  // page: web
  'WebHome.dc.html': W.home(),
  'WebHomeMobile.dc.html': W.homeMobile(),
  'WebLogin.dc.html': W.login(),
  'WebSignup.dc.html': W.signup(),
  'WebReset.dc.html': W.reset(),
  'WebDashboard.dc.html': W.dashboard(),
  'WebJob.dc.html': W.job(),
  'WebAccount.dc.html': W.account(),
  'WebSummary.dc.html': W.summary(),
  'MarqueePhone.dc.html': phoneScreen(MQ),
  'WebPhoneMenu.dc.html': W.phoneMenu(),
  'WebPhoneEnded.dc.html': W.phoneEnded(),
  // page: brand
  'MarqueeBrand.dc.html': brandBoard(MQ),
  'Icons.dc.html': B.finalIcon(),
  'Principles.dc.html': principles(),
  'Gap.dc.html': B.gapBoard(),
  // page: considered
  'Current.dc.html': current(),
  'DaylightBrand.dc.html': brandBoard(DIRECTIONS.daylight),
  'DaylightLive.dc.html': liveScreen(DIRECTIONS.daylight),
  'DaylightPhone.dc.html': phoneScreen(DIRECTIONS.daylight),
  'SignalBrand.dc.html': brandBoard(DIRECTIONS.signal),
  'SignalLive.dc.html': liveScreen(DIRECTIONS.signal),
  'SignalPhone.dc.html': phoneScreen(DIRECTIONS.signal),
};
for (const [name, html] of Object.entries(boards)) fs.writeFileSync(path.join(OUT, name), html);

// frame heights: measured renders when available (sizes.json), else the fallback
const sizes = fs.existsSync('sizes.json') ? JSON.parse(fs.readFileSync('sizes.json', 'utf8')) : {};
const H = (name, fallback) => (sizes[name] ? Math.ceil(sizes[name] / 10) * 10 + 20 : fallback);
const ab = (file, title, x, y, w, h, page, extra = {}) => ({ file, title, x, y, w, h, page, ...extra });
const GX = 80, GY = 120;
const art = [];
// --- app page: 3 columns of 1440 screens
const col = (i) => i * (1440 + GX);
const mainH = H('Main', 1200);
art.push(ab('Main.dc.html', 'Start here', 0, 0, 1200, mainH, 'app'));
art.push(ab('MarqueeLive.dc.html', 'Live · exists today', col(1), 0, 1440, 900, 'app'));
art.push(ab('AppFiles.dc.html', 'Files · exists today', col(2), 0, 1440, 900, 'app'));
let y = Math.max(mainH, 900) + GY;
art.push(ab('AppRecording.dc.html', 'Recording · exists today', 0, y, 1440, 900, 'app'));
art.push(ab('AppSettings.dc.html', 'Settings · exists today', col(1), y, 1440, 900, 'app'));
art.push(ab('AppDisplay.dc.html', 'Display window and its panel · exists today', col(2), y, 1280, 720, 'app'));
y += 900 + GY;
art.push(ab('AppOverlay.dc.html', 'Overlay on slides, 字幕 menu bar item · exists today', 0, y, 1440, 900, 'app'));
art.push(ab('AppQrSheet.dc.html', 'QR sheet · exists today', col(1), y, 1440, 900, 'app'));
art.push(ab('AppFirstRun.dc.html', 'First run · new', col(2), y, 1440, 900, 'app'));
y += 900 + GY;
const statesH = H('AppStates', 800);
art.push(ab('AppGlossary.dc.html', 'Glossary · new', 0, y, 1440, 900, 'app'));
art.push(ab('AppStates.dc.html', 'States · new', col(1), y, 1440, statesH, 'app'));
art.push(ab('AppPoster.dc.html', 'QR poster, A4 · new', col(2), y, 794, 1123, 'app', { print: 'fixed' }));
// --- web page
const homeH = H('WebHome', 3300); const mobH = H('WebHomeMobile', 2300);
art.push(ab('WebHome.dc.html', 'seesubtitles.com · home', 0, 0, 1440, homeH, 'web'));
art.push(ab('WebHomeMobile.dc.html', 'home on a phone', 1440 + GX, 0, 390, mobH, 'web'));
const cx = 1440 + GX + 390 + GX;
art.push(ab('WebLogin.dc.html', 'Log in · exists today', cx, 0, 1440, 900, 'web'));
art.push(ab('WebSignup.dc.html', 'Create account · new', cx, 900 + GY, 1440, 900, 'web'));
art.push(ab('WebReset.dc.html', 'Password reset · new', cx, 2 * (900 + GY), 1440, 900, 'web'));
const dx = cx + 1440 + GX;
art.push(ab('WebDashboard.dc.html', 'Overview · exists today (dashboard)', dx, 0, 1440, 900, 'web'));
art.push(ab('WebJob.dc.html', 'Job editor · exists today', dx, 900 + GY, 1440, 900, 'web'));
art.push(ab('WebAccount.dc.html', 'Account and team · new', dx, 2 * (900 + GY), 1440, 900, 'web'));
const ex = dx + 1440 + GX;
art.push(ab('WebSummary.dc.html', 'Learning summary · exists today', ex, 0, 1440, 1100, 'web'));
art.push(ab('MarqueePhone.dc.html', 'Attendee page · exists today', ex, 1100 + GY, 390, 844, 'web'));
art.push(ab('WebPhoneMenu.dc.html', 'Attendee controls · new', ex + 390 + GX, 1100 + GY, 390, 844, 'web'));
art.push(ab('WebPhoneEnded.dc.html', 'Talk ended · new', ex + 2 * (390 + GX), 1100 + GY, 390, 844, 'web'));
// --- brand page
art.push(ab('MarqueeBrand.dc.html', 'A · Marquee · brand', 0, 0, 1200, H('MarqueeBrand', 2040), 'brand'));
art.push(ab('Icons.dc.html', 'App icon · final', 1280, 0, 1200, H('Icons', 1300), 'brand'));
art.push(ab('Principles.dc.html', 'Principles · every screen follows these', 2560, 0, 1200, H('Principles', 2130), 'brand'));
art.push(ab('Gap.dc.html', 'What category leaders have', 3840, 0, 1200, H('Gap', 1500), 'brand'));
// --- considered page
art.push(ab('Current.dc.html', 'The app today · Live', 0, 0, 1440, 900, 'considered'));
const bh = Math.max(H('DaylightBrand', 2020), H('SignalBrand', 2050));
let cy = 900 + GY;
for (const d of [DIRECTIONS.daylight, DIRECTIONS.signal]) {
  art.push(ab(`${d.name}Brand.dc.html`, `${d.letter} · ${d.name} · brand`, 0, cy, 1200, H(`${d.name}Brand`, 2040), 'considered'));
  art.push(ab(`${d.name}Live.dc.html`, `${d.letter} · ${d.name} · Live`, 1280, cy, 1440, 900, 'considered'));
  art.push(ab(`${d.name}Phone.dc.html`, `${d.letter} · ${d.name} · phone`, 2800, cy, 390, 844, 'considered'));
  cy += bh + GY;
}
const canvas = {
  pages: [{ id: 'app', name: 'App' }, { id: 'web', name: 'Web' }, { id: 'brand', name: 'Brand' }, { id: 'considered', name: 'Considered' }],
  artboards: art,
  annotations: [
    { id: 'note-app', page: 'app', x: 0, y: mainH + 24, w: 460, text: 'Titles say whether a screen exists today or is new. The Live screen at the top right is the one from round one, now with the on-air dot in the mark.' },
    { id: 'note-web', page: 'web', x: 1440 + GX, y: mobH + 24, w: 390, text: 'The site is dark like the app, with paper sections for reading. No prices are shown: accounts are created by the team, so the page asks for a request instead.' },
    { id: 'note-considered', page: 'considered', x: 1520, y: 0, w: 380, text: 'Kept for reference: today\'s Live view, and the two directions not chosen. Any of the three marks still works in Marquee\'s colours.' },
  ],
  launch: { view: 'canvas', page: 'app' },
};
fs.writeFileSync(path.join(OUT, 'canvas.json'), JSON.stringify(canvas, null, 2));

// token css per direction
for (const d of Object.values(DIRECTIONS)) {
  const vars = (t) => Object.entries({
    bg: t.bg, side: t.side, surface: t.surface, 'surface-2': t.surface2, line: t.line, 'line-strong': t.lineStrong, fg: t.fg, 'fg-2': t.fg2, 'fg-3': t.fg3,
    accent: t.accent, 'accent-fg': t.accentFg, 'accent-soft': t.accentSoft, 'accent-text': t.accentText, ok: t.ok, warn: t.warn, bad: t.bad, rec: t.rec, stage: t.stage,
  }).map(([k, v]) => `  --${k}: ${v};`).join('\n');
  const fonts = `  --ui: ${d.fonts.ui}, -apple-system, system-ui, ${d.fonts.cjk}, "PingFang TC", "PingFang SC", sans-serif;\n  --cjk: ${d.fonts.cjk}, "PingFang TC", "PingFang SC", "Noto Sans CJK TC", sans-serif;\n  --display: ${d.fonts.display}, ${d.fonts.cjkDisplay || d.fonts.cjk}, serif;\n  --mono: ui-monospace, "SF Mono", Menlo, monospace;`;
  const other = d.primary === 'dark' ? 'light' : 'dark';
  fs.writeFileSync(path.join(OUT, 'tokens', `${d.key}.css`), `/* See Subtitles · direction ${d.letter} · ${d.name}${d.key === 'marquee' ? ' (chosen)' : ''}
   ${d.idea}
   Designed ${d.primary}-first; the other appearance follows the system. Fonts: ${d.fonts.link} */
:root {
${vars(d[d.primary])}
${fonts}
  --r-sm: ${SCALE.radius.sm}px; --r-md: ${SCALE.radius.md}px; --r-lg: ${SCALE.radius.lg}px; --r-xl: ${SCALE.radius.xl}px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
  --control-sm: ${SCALE.control.small}px; --control: ${SCALE.control.default}px; --control-lg: ${SCALE.control.primary}px;
  color-scheme: ${d.primary};
}
@media (prefers-color-scheme: ${other}) {
  :root:not([data-appearance="${d.primary}"]) {
${vars(d[other])}
    color-scheme: ${other};
  }
}
:root[data-appearance="${other}"] {
${vars(d[other])}
  color-scheme: ${other};
}
`);
}

// icon svgs
for (const d of Object.values(DIRECTIONS)) {
  const t = primaryTokens(d); const m = d.mark;
  fs.writeFileSync(path.join(OUT, 'icons', `app-${d.key}.svg`), CONCEPTS[m.concept]({ ...m, margin: true }));
  for (const k of Object.keys(CONCEPTS)) {
    const ink = m.ink || m.top || '#fff'; const mono = t.accent === t.fg;
    const svg = k === 'stack' ? CONCEPTS.stack({ tile: m.tile, top: ink, bottom: mono ? ink : (m.bottom || t.accent), bottomOpacity: mono ? 0.6 : 1, dot: m.dot || null, margin: true }) : CONCEPTS[k]({ tile: m.tile, ink, bar: k === 'eye' && d.key === 'marquee' ? t.accent : null, margin: true });
    fs.writeFileSync(path.join(OUT, 'icons', `${k}-${d.key}.svg`), svg);
  }
}
for (const k of Object.keys(CONCEPTS)) fs.writeFileSync(path.join(OUT, 'icons', `tray-${k}.svg`), tray({ color: '#000', concept: k }));
console.log('wrote', Object.keys(boards).length, 'artboards to', OUT);

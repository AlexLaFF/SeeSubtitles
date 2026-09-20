// Every iOS screen of ios-screens.mjs on one ordinary web page, grouped as docs/IOS.md groups them: the way to
// look at the designs without the canvas editor.   node build-ios-review.mjs <out.html>
import fs from 'node:fs';
import { SCREENS, IOS_CSS, fontLink } from './ios-screens.mjs';

const NOTES = {
  'First run': 'A logged-out app is only this card, as on the Mac. Joining a talk is the one thing that works without an account.',
  Live: 'One bar at the bottom, one filled button. The status is a dot and a word at the top right; only recording keeps a colour. The yellow dot marks a sentence still being spoken.',
  'Live states': 'Every state says what happened and what to do, in words. The recording is never the thing that stops.',
  'Join a talk': 'The same reader without a microphone. The transcript lands in the Library when the host ends the talk.',
  Library: 'The stack row from the Mac: a name, then what it is. A recording opens on its transcript, with the player always in reach.',
  Settings: 'The account first, then what shapes a talk, then the app. The glossary is the account’s, shared with the Mac and the web.',
  'Light and iPad': 'Light follows the system. iPad is the same screens side by side, not a second design.',
  'Tentative: spoken translation': 'Built since this was drawn, except the language picker on a joined talk (a talk has one subtitle language today). The translation read aloud in headphones, a sentence at a time, a few seconds behind the speaker — like an interpreter’s channel at a summit. On your own talk it is one more button; on a joined talk each listener picks their language, which needs the server to translate a talk into more than one. What it would take and how good it would be: docs/IOS.md §8.',
};
const groups = [];
for (const s of SCREENS) { let g = groups.find((x) => x.name === s[5]); if (!g) groups.push(g = { name: s[5], items: [] }); g.items.push(s); }
const out = process.argv[2];
if (!out) { console.error('usage: node build-ios-review.mjs <out.html>'); process.exit(2); }
fs.writeFileSync(out, `<title>See Subtitles iOS Screens</title>
<link rel="stylesheet" href="${fontLink}">
<style>
:root{--pbg:#f5f2eb;--pfg:#1c1a16;--pfg2:#6a6458;--pline:#e0dbcf;--pacc:#8f6a00;--bezel:#1c1a16}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--pbg:#131210;--pfg:#f1ece2;--pfg2:#aca496;--pline:#35322d;--pacc:#f5c518;--bezel:#3a3732}}
:root[data-theme="dark"]{--pbg:#131210;--pfg:#f1ece2;--pfg2:#aca496;--pline:#35322d;--pacc:#f5c518;--bezel:#3a3732}
body{margin:0;background:var(--pbg);color:var(--pfg);font:15px/1.55 -apple-system,system-ui,"PingFang SC","Noto Sans SC",sans-serif}
.rv{max-width:1760px;margin:0 auto;padding:40px 28px 90px}
.rv header h1{margin:0 0 8px;font:400 italic 44px/1.05 "Instrument Serif",Georgia,serif} .rv header p{margin:0;max-width:66ch;color:var(--pfg2)}
.rv nav{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:16px;font-size:14px} .rv nav a{color:var(--pacc);text-decoration:none} .rv nav a:hover,.rv nav a:focus-visible{text-decoration:underline;outline:none}
.rv section{margin-top:52px;padding-top:20px;border-top:1px solid var(--pline)}
.rv h2{margin:0 0 4px;font:600 22px/1.2 -apple-system,system-ui,sans-serif} .rv .note{margin:0 0 22px;max-width:70ch;color:var(--pfg2)}
.rv .row{display:flex;flex-wrap:wrap;gap:36px 32px;align-items:flex-start}
.rv figure{margin:0;display:flex;flex-direction:column;gap:10px;max-width:100%}
.rv figcaption{font-size:13.5px;color:var(--pfg2)}
.rv .dev{border:9px solid var(--bezel);border-radius:54px;overflow:hidden;width:max-content;box-shadow:0 18px 50px rgba(0,0,0,.28)} .rv .dev.pad{border-radius:30px}
.rv .wide{overflow-x:auto;max-width:100%;padding-bottom:6px}
${IOS_CSS}
</style>
<div class="rv">
<header><h1>See Subtitles for iPhone</h1><p>Every screen and state in the specification, drawn in Marquee. Type is the system’s so Dynamic Type and VoiceOver behave; the serif is kept for the wordmark. ${SCREENS.length} screens.</p>
<nav>${groups.map((g) => `<a href="#${g.name.replace(/\W+/g, '-')}">${g.name}</a>`).join('')}</nav></header>
${groups.map((g) => `<section id="${g.name.replace(/\W+/g, '-')}"><h2>${g.name}</h2><p class="note">${NOTES[g.name] || ''}</p><div class="row">
${g.items.map(([, title, w, , html]) => `<figure><div class="${w > 400 ? 'wide' : ''}"><div class="dev ${w > 900 ? 'pad' : ''}">${html}</div></div><figcaption>${title}</figcaption></figure>`).join('\n')}
</div></section>`).join('\n')}
</div>
`);
console.log('wrote', out);

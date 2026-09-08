// Every desktop-app screen in Marquee: the ones that exist today and the ones the category leaders have.
import { SHELL_CSS, DIRECTION_CSS, ICON, svgI, page, markSvg, liveScreen } from './lib.mjs';
import { DIRECTIONS, cssVars } from './tokens.mjs';
import { tray } from './icons.mjs';

const M = DIRECTIONS.marquee;
const T = M.dark;
const L = M.light;
const VARS = cssVars(T, M.fonts);
const mark = (size) => markSvg(M, { size });

const EXTRA_CSS = `
.v{display:flex;align-items:center;gap:8px;min-width:0}
.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;font:500 11.5px/1.3 var(--ui);color:var(--fg-3);padding:10px 12px;border-bottom:1px solid var(--line);letter-spacing:.02em}
.tbl td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle;font-size:13px}
.tbl tr:last-child td{border-bottom:0}
.tbl .nm{font-weight:500;font-family:var(--cjk)} .tbl .sb{color:var(--fg-3);font-size:11.5px;margin-top:1px}
.tbl .r{text-align:right}
.prog{display:inline-block;width:72px;height:4px;border-radius:2px;background:var(--surface-2);vertical-align:middle;margin-left:8px;overflow:hidden}
.prog i{display:block;height:100%;background:var(--accent)}
.pill{height:24px;padding:0 10px;border-radius:12px;background:transparent;border:1px solid transparent;color:var(--fg-2);font:500 12px/22px var(--ui);display:inline-flex;align-items:center;gap:6px}
.pill.on{background:var(--surface-2);color:var(--fg);border-color:var(--line)}
.pill .c{color:var(--fg-3);font-size:11px}
.drop{border:1px dashed var(--line-strong);border-radius:10px;padding:18px;text-align:center;color:var(--fg-3);font-size:12.5px}
.crumb{color:var(--fg-3);font-weight:400}
.stage-p{background:#000;border-radius:10px;height:240px;padding:16px 20px;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;font-family:var(--cjk);font-weight:700;color:#fff;text-align:center;overflow:hidden}
.stage-p .l{font-size:22px;line-height:1.25} .stage-p .l.old{opacity:.5} .stage-p .l .s{display:block;font-size:12px;font-weight:500;opacity:.72}
.player{display:flex;align-items:center;gap:10px;margin-top:10px;font:12px var(--mono);color:var(--fg-2)}
.player .pb{width:26px;height:26px;border-radius:50%;background:var(--fg);color:var(--bg);display:flex;align-items:center;justify-content:center;flex:none}
.player .pb::after{content:"";border-left:8px solid var(--bg);border-top:5px solid transparent;border-bottom:5px solid transparent;margin-left:2px}
.player .tr{flex:1;height:4px;background:var(--surface-2);border-radius:2px;position:relative}
.player .tr i{position:absolute;left:0;top:0;height:100%;width:34%;background:var(--accent);border-radius:2px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:12.5px} .kv span:nth-child(odd){color:var(--fg-3);white-space:nowrap}
.flist{display:grid;grid-template-columns:1fr 1fr;gap:5px 16px;font-size:12.5px}
.flist a{color:var(--fg);text-decoration:none;font-family:var(--cjk)} .flist .m{color:var(--fg-3);font-size:11.5px}
.cue{display:grid;grid-template-columns:64px 1fr auto;gap:10px;padding:8px 6px;border-bottom:1px solid var(--line);align-items:start;font-family:var(--cjk)}
.cue.active{background:var(--accent-soft);border-radius:6px}
.cue .t{font:11px/1.6 var(--mono);color:var(--fg-3);white-space:pre}
.cue .ta{border:1px solid var(--line);background:var(--surface-2);border-radius:6px;padding:4px 8px;font-size:13.5px;line-height:1.45;min-height:26px}
.cue .ta.orig{color:var(--fg-3);font-size:12px;margin-top:4px;background:transparent}
.cue .ops{display:flex;flex-direction:column;gap:3px}
.cue .ops .btn{height:20px;padding:0 7px;font-size:11px}
.tabs{display:flex;gap:4px}
.snav{width:170px;flex:none;display:flex;flex-direction:column;gap:2px}
.snav .nav{font-size:13px;padding:6px 10px}
.set .panel{padding:12px 16px}
.set .row{grid-template-columns:150px 1fr}
.set .hint.ind{margin-left:160px}
.status-line{padding:6px 10px;border-radius:6px;background:var(--surface-2);font-size:12px;white-space:pre-wrap;color:var(--fg-2);flex:1}
.savebar{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:10px 16px;border-top:1px solid var(--line);color:var(--fg-3);font-size:12px}
.scrim{position:absolute;inset:0;background:rgba(10,9,8,.72);display:flex;align-items:center;justify-content:center;z-index:5}
.sheet{background:var(--surface);border:1px solid var(--line-strong);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden}
.sheet .sh{display:flex;align-items:center;gap:12px;padding:16px 20px 12px}
.sheet .sh h2{margin:0;font:600 17px/1.2 var(--ui)}
.sheet .sf{display:flex;align-items:center;gap:8px;padding:12px 20px;border-top:1px solid var(--line)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:26px 28px;display:flex;flex-direction:column;gap:14px}
.card h2{margin:0;font:600 20px/1.2 var(--ui);letter-spacing:-.01em}
.card p{margin:0;color:var(--fg-2);font-size:13px;line-height:1.5}
.card .fld{display:flex;flex-direction:column;gap:5px} .card .fld label{font-size:12px;color:var(--fg-2)}
.card .field{height:32px}
.card .btn.primary,.card .btn.rec{height:34px;justify-content:center;font-size:13px}
.card a{color:var(--accent);text-decoration:none;font-size:12.5px}
.dev{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px}
.dev.on{border-color:var(--accent);background:var(--accent-soft)}
.dev .meter{margin-left:auto}
.steps{display:flex;align-items:center;gap:8px;color:var(--fg-3);font-size:12px}
.steps i{width:8px;height:8px;border-radius:50%;background:var(--line-strong);display:block} .steps i.on{background:var(--accent)}
.alert{background:var(--bad);color:#fff;padding:10px 14px;border-radius:8px;font-weight:500;font-size:13px}
.toast{background:var(--surface);border:1px solid var(--line-strong);border-radius:10px;padding:12px 14px;display:flex;gap:12px;align-items:center;box-shadow:0 12px 40px rgba(0,0,0,.5);font-size:13px}
.empty{color:var(--fg-3);text-align:center;padding:26px 20px;font-size:13px;line-height:1.5}
`;
const BASE = `.win{${VARS}}` + SHELL_CSS + DIRECTION_CSS.marquee + EXTRA_CSS;
const fontLink = M.fonts.link;

function side(active) {
  const item = (key, icon, label, k) => `<div class="nav${active === key ? ' active' : ''}">${svgI(icon)}<span>${label}</span><span class="k">${k}</span></div>`;
  return `<div class="tl"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
<nav class="side">
  <div class="brand">${mark()}<span class="w">See Subtitles</span></div>
  ${item('live', ICON.mic, 'Live', '⌘1')}
  ${item('files', ICON.files, 'Files', '⌘2')}
  <div class="grow"></div>
  ${item('settings', ICON.gear, 'Settings', '⌘,')}
  <div class="account"><b>alex@seesubtitles.com</b><span>seesubtitles.com · connected</span></div>
</nav>`;
}
const win = (inner, extra = '') => `<div class="win"${extra}>${inner}</div>`;
const shell = (active, main) => win(side(active) + `<main class="main">${main}</main>`);
const foot = (right) => `<div class="foot"><span><kbd>⌘1</kbd>Live</span><span><kbd>⌘2</kbd>Files</span><span><kbd>⌘O</kbd>add file</span><span class="sp"></span><span>${right}</span></div>`;
const QR = (px) => `<svg viewBox="0 0 21 21" width="${px}" height="${px}" shape-rendering="crispEdges"><path fill="#111" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM8 0h1v1H8zM10 0h2v2h-2zM8 2h2v1H8zM11 3h1v2h-1zM9 4h1v2H9zM12 5h1v1h-1zM8 7h2v1H8zM11 7h1v1h-1zM13 8h1v1h-1zM0 8h1v1H0zM2 8h2v1H2zM5 8h2v1H5zM9 9h2v1H9zM12 9h2v2h-2zM16 8h1v1h-1zM18 8h2v1h-2zM3 10h1v1H3zM6 10h2v1H6zM15 10h1v1h-1zM17 10h1v2h-1zM19 10h2v1h-2zM1 11h1v1H1zM4 12h2v1H4zM8 11h1v2H8zM10 12h1v1h-1zM13 12h1v2h-1zM15 12h1v1h-1zM19 12h1v1h-1zM9 14h2v1H9zM12 14h1v1h-1zM14 14h2v1h-2zM17 14h2v1h-2zM20 14h1v1h-1zM8 16h1v1H8zM10 16h2v2h-2zM13 16h1v1h-1zM16 16h1v1h-1zM18 16h3v1h-3zM9 18h1v1H9zM12 18h1v1h-1zM14 18h1v2h-1zM17 18h1v1h-1zM19 18h2v1h-2zM8 20h2v1H8zM11 20h2v1h-2zM16 20h1v1h-1zM18 20h1v1h-1z"/></svg>`;
const doc = (body, css = '') => page({ fontLink, css: BASE + css, body });

// ------------------------------------------------------------------------------------------------ Files
export function files() {
  const row = (nm, sb, date, len, subs, mp4, sum, act) => `<tr><td><div class="nm">${nm}</div><div class="sb">${sb}</div></td><td>${date}</td><td style="font-variant-numeric:tabular-nums">${len}</td><td>${subs}</td><td>${mp4}</td><td>${sum}</td><td class="r">${act}</td></tr>`;
  const ok = (t) => `<span class="tag ok"><i class="dot" style="background:var(--ok)"></i>${t}</span>`;
  const busy = (t, p) => `<span class="tag">${t}</span>${p != null ? `<span class="prog"><i style="width:${p}%"></i></span>` : ''}`;
  const main = `
  <div class="top"><h1>Files</h1><div class="status"><span class="s">Recordings from Live and files you add, with their subtitles</span></div>
    <div class="actions"><span class="btn ghost">Open recordings folder</span><span class="btn primary">+ Add file…</span></div></div>
  <div class="toolbar"><span class="pill on">All <span class="c">12</span></span><span class="pill">Recordings <span class="c">8</span></span><span class="pill">Added files <span class="c">4</span></span><span class="sp"></span><span class="field" style="flex:none;width:220px;color:var(--fg-3)">Search</span></div>
  <div class="body" style="flex-direction:column">
    <section class="panel" style="padding:0;overflow:hidden"><table class="tbl">
      <thead><tr><th style="width:36%">Name</th><th>Date</th><th>Length</th><th>Subtitles</th><th>MP4</th><th>Summary</th><th></th></tr></thead><tbody>
      ${row('2026-09-08 字幕與共融 講座', 'recording · 粵語 → 中文 · cloud subtitles', '9/8 14:02', '47:12', ok('complete'), '✓', '✓', '<span class="btn small">Open</span>')}
      ${row('2026-09-08 interview-raw.m4a', 'added file · uploading to seesubtitles.com', '9/8 14:20', '—', busy('uploading 41%', 41), '—', '—', '')}
      ${row('2026-09-05 產品發布會', 'recording · 粵語 → 中文', '9/5 10:30', '1:12:40', busy('re-subtitling · translating', 62), '—', '—', '<span class="btn small">Open</span>')}
      ${row('2026-09-03 團隊週會', 'recording · 粵語 → 中文 · live subtitles from the talk', '9/3 16:00', '38:05', '<span class="tag">live</span>', '✓', '—', '<span class="btn small">Open</span>')}
      ${row('keynote-day2.mp4', 'added file · 粵語 → 中文（简体）', '9/2 09:14', '52:31', ok('612 cues'), '✓', '—', '<span class="btn small">Open on the web ↗</span>')}
      ${row('2026-08-29 開幕致辭', 'recording · 粵語 → 中文 · cloud subtitles', '8/29 09:02', '21:47', ok('complete'), '✓', '✓', '<span class="btn small">Open</span>')}
    </tbody></table></section>
    <div class="drop">Drop a video or audio file here to subtitle it. It is transcribed and translated on seesubtitles.com; an hour of speech takes a few minutes.</div>
  </div>
  ${foot('~/Movies/See Subtitles · 8 recordings · 14.2 GB')}`;
  return doc(shell('files', main));
}

// ------------------------------------------------------------------------------------------------ Recording detail
export function recording() {
  const cue = (t1, t2, zh, yue, active) => `<div class="cue${active ? ' active' : ''}"><span class="t">${t1}\n${t2}</span><div><div class="ta">${zh}</div><div class="ta orig">${yue}</div></div><div class="ops"><span class="btn small">merge ↓</span><span class="btn small">delete</span></div></div>`;
  const main = `
  <div class="top"><h1><span class="crumb">Files ›</span> 2026-09-08 字幕與共融 講座</h1><div class="status"><span class="s"><i class="dot" style="background:var(--ok)"></i>Complete · cloud subtitles · 47:12</span></div>
    <div class="actions"><span class="btn ghost">Re-subtitle via cloud</span><span class="btn ghost">Make MP4</span><span class="btn ghost">AI summary</span><span class="btn primary">Download ▾</span></div></div>
  <div class="body" style="padding-top:6px">
    <div class="col l" style="width:560px">
      <section class="panel" style="padding:10px">
        <div class="stage-p"><div class="l old">首先是現場的觀眾，他們可以用手機掃二維碼。</div><div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div></div>
        <div class="player"><span class="pb"></span><span>16:04</span><span class="tr"><i></i></span><span>47:12</span></div>
        <div class="row" style="margin:10px 0 0"><label>Show Cantonese</label><div class="v"><span class="check on"></span><span class="hint">under each line, like the venue screen</span></div></div>
      </section>
      <section class="panel"><h3>This talk</h3>
        <div class="kv"><span>Recorded</span><span>8 September, 14:02 → 14:49 · MacBook Pro Microphone</span><span>Followed on phones</span><span>128 people · peak 96 at 14:31</span><span>Languages</span><span>粵語 → 中文 · 大模型</span><span>Subtitles</span><span>512 cues from the cloud · live set kept as .live.srt</span></div>
      </section>
      <section class="panel"><h3>Files</h3>
        <div class="flist">
          <div><a>2026-09-08 字幕與共融 講座 錄音.mp3</a> <span class="m">· 43.1 MB</span></div><div><a>…錄音＋字幕.mp4</a> <span class="m">· 612 MB</span></div>
          <div><a>…中文字幕.zh.srt</a></div><div><a>…粵語字幕.yue.srt</a></div>
          <div><a>…中文字幕.zh.live.srt</a> <span class="m">· from the talk</span></div><div><a>…粵語字幕.yue.live.srt</a> <span class="m">· from the talk</span></div>
          <div><a>…學習摘要.md</a></div><div><a>…學習摘要.pdf</a></div>
        </div>
      </section>
    </div>
    <div class="col r">
      <section class="panel transcript" style="flex:1">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><div class="tabs"><span class="pill on">Subtitles</span><span class="pill">Summary</span></div><span class="sp"></span><span class="hint">Click a time to jump · edits regenerate the files</span></div>
        <div class="list">
          ${cue('15:48.2', '15:51.0', '大家好，歡迎來到今天的分享。', '大家好，歡迎嚟到今日嘅分享。', false)}
          ${cue('15:52.4', '15:58.9', '今天我們會講一下如何用字幕幫助更多人參與會議。', '今日我哋會講吓點樣用字幕幫助更多人參與會議。', true)}
          ${cue('15:59.3', '16:04.1', '首先是現場的觀眾，他們可以用手機掃二維碼。', '首先係現場嘅觀眾，佢哋可以用手機掃個二維碼。', false)}
          ${cue('16:04.6', '16:09.8', '然後我們會演示怎樣把字幕疊在投影片上面。', '然後我哋會示範點樣將字幕疊喺投影片上面。', false)}
          ${cue('16:10.2', '16:14.0', '錄音結束之後，字幕會重新整理一次。', '錄音完之後，字幕會重新整理一次。', false)}
          ${cue('16:14.5', '16:19.7', '這樣連線中斷留下的空洞就會補回來。', '咁樣連線斷開留低嘅窿就會補返。', false)}
        </div>
        <div style="display:flex;gap:8px;align-items:center;padding-top:10px;border-top:1px solid var(--line)"><span class="btn primary">Save changes</span><span class="btn">Shift all…</span><span class="hint">3 changes not saved</span></div>
      </section>
    </div>
  </div>
  ${foot('MP4 after recording: on · re-render when subtitles change')}`;
  return doc(shell('files', main));
}

// ------------------------------------------------------------------------------------------------ Settings
export function settings() {
  const row = (label, ...v) => `<div class="row"><label>${label}</label><div class="v">${v.join('')}</div></div>`;
  const sec = (title, sub, inner) => `<section class="panel"><h3><span>${title}</span>${sub ? `<span class="hint" style="font-weight:400">${sub}</span>` : ''}</h3>${inner}</section>`;
  const main = `
  <div class="top"><h1>Settings</h1><div class="status"><span class="s">Also in the menu bar: See Subtitles › Settings… (⌘,)</span></div></div>
  <div class="body set" style="padding-top:6px">
    <div class="snav"><div class="nav active">Account</div><div class="nav">Tencent Cloud</div><div class="nav">Glossary</div><div class="nav">AI summaries</div><div class="nav">Recording</div><div class="nav">Advanced</div><div class="nav">About</div></div>
    <div class="col" style="flex:1;overflow:hidden">
      ${sec('Account', '', row('Logged in as', '<span class="status-line">alex@seesubtitles.com · sharing → seesubtitles.com/d/K7Q2</span><span class="btn small">Log out</span>') + '<div class="hint ind">Logging in gives this app its Tencent keys, the share link for remote displays and cloud re-subtitling.</div>')}
      ${sec('Tencent Cloud', '實時語音翻譯', row('Keys', '<span class="status-line">provided by See Subtitles · fetched today 09:12</span>') + row('Gateway edge', '<span class="field sel">auto <span class="sub">switch to the mainland edge after a 404, use with a VPN</span></span>') + '<div class="fold">Use my own keys instead</div>' + row('Status', '<span class="status-line">Tencent: ready via ap-guangzhou\nmic: MacBook Pro Microphone (running)</span>'))}
      ${sec('AI summaries', '', row('Anthropic API key', '<span class="field" style="color:var(--fg-3)">•••••••• saved, leave blank to keep</span>') + row('Model', '<span class="field">claude-opus-5</span>') + row('Language', '<span class="field sel">简体中文</span>') + row('Reasoning effort', '<span class="field sel">High</span>'))}
      ${sec('Recording', '', row('Recordings folder', '<span class="field">~/Movies/See Subtitles</span><span class="btn small">Choose…</span>') + row('MP3 bitrate', '<span class="field sel" style="max-width:160px">128k</span>') + row('MP4 after recording', '<span class="field sel">yes <span class="sub">video with burned-in subtitles</span></span>') + row('MP4 size', '<span class="field sel">1080 × 1920 portrait</span>') + '<div class="fold">Font size, subtitles shown, encoder</div>')}
      <div class="savebar"><span>saved 14:02 · pipeline restarted</span><span class="btn primary">Save &amp; restart pipeline</span></div>
    </div>
  </div>`;
  return doc(shell('settings', main));
}

// ------------------------------------------------------------------------------------------------ Display window (venue screen) with its panel
export function display() {
  const css = `
.disp{position:relative;width:1280px;height:720px;background:#000;color:#fff;overflow:hidden;font-family:var(--cjk);${VARS}}
.disp .lines{position:absolute;left:0;right:420px;bottom:0;padding:0 40px 32px;display:flex;flex-direction:column;gap:.3em;text-align:center;font-weight:700;font-size:54px;line-height:1.25}
.disp .lines .l.old{opacity:.5} .disp .lines .l.older{opacity:.25} .disp .lines .s{display:block;font-size:.45em;font-weight:500;opacity:.72;margin-top:.1em}
.disp .corner{position:absolute;top:10px;right:430px;font:13px var(--ui);color:rgba(255,255,255,.7);background:rgba(0,0,0,.55);padding:4px 8px;border-radius:6px}
.disp .panel .hint{font-size:12px}
.disp .panel{position:absolute;top:10px;right:10px;width:400px;max-height:700px;background:var(--surface);color:var(--fg);border:1px solid var(--line-strong);border-radius:12px;padding:12px 14px;font:13px/1.45 var(--ui);box-shadow:0 8px 30px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:8px}
.disp .panel h3{margin:6px 0 4px;font:600 12px/1 var(--ui);letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3)}
.disp .btns{display:flex;flex-wrap:wrap;gap:6px}
.disp .row{grid-template-columns:96px 1fr auto auto;margin:3px 0}
.disp .kbd{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px;color:var(--fg-2)}
`;
  const body = `<div class="disp">
  <div class="lines"><div class="l older">大家好，歡迎來到今天的分享。</div><div class="l old">首先是現場的觀眾，他們可以用手機掃二維碼。</div><div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div></div>
  <div class="corner">C = controls · + / − = size · the stage reflows beside the panel while it is open</div>
  <div class="panel">
    <div class="btns"><span class="btn small">Clear</span><span class="btn small">Pause</span><span class="btn small">Reconnect</span><span class="btn small rec"><i class="dot"></i>Rec</span><span class="btn small">Full screen</span><span class="btn small">Control page ↗</span><span class="btn small ghost">Hide (C)</span></div>
    <h3>Output</h3>
    <div class="row wide" style="grid-template-columns:96px 1fr"><label>Preset</label><div class="v"><span class="field sel">Landscape bar</span><span class="btn small">Apply</span></div></div>
    <div class="row wide" style="grid-template-columns:96px 1fr"><label>Show</label><div class="v"><span class="field sel">Translation + original</span></div></div>
    <h3>Text</h3>
    <div class="row"><label>Size</label><span class="slider"><i style="width:48%"></i><b style="left:48%"></b></span><span class="field num">140</span><span class="unit">px</span></div>
    <div class="row"><label>Weight</label><span class="slider"><i style="width:70%"></i><b style="left:70%"></b></span><span class="field num">700</span><span class="unit"></span></div>
    <div class="row wide" style="grid-template-columns:96px 1fr"><label>Colour</label><div class="v"><span class="field" style="max-width:120px"><i class="dot" style="background:#fff"></i>#ffffff</span><span class="check on"></span><span class="hint">shadow</span></div></div>
    <h3>Layout</h3>
    <div class="row"><label>Lines kept</label><span class="slider"><i style="width:30%"></i><b style="left:30%"></b></span><span class="field num">3</span><span class="unit"></span></div>
    <div class="row wide" style="grid-template-columns:96px 1fr"><label>Align</label><div class="v"><span class="pill on">Centre</span><span class="pill">Left</span><span class="pill">Right</span></div></div>
    <h3>Background</h3>
    <div class="row"><label>Opacity</label><span class="slider"><i style="width:100%"></i><b style="left:100%"></b></span><span class="field num">100</span><span class="unit">%</span></div>
    <h3>Shortcuts</h3>
    <div class="kbd"><kbd>+ −</kbd><span>text size (Shift = bigger steps)</span><kbd>[ ]</kbd><span>fewer / more sentences kept</span><kbd>⇧S</kbd><span>translation → both → original</span><kbd>P</kbd><span>pause / resume</span><kbd>X</kbd><span>clear</span><kbd>F</kbd><span>full screen</span></div>
  </div>
</div>`;
  return page({ fontLink, css: SHELL_CSS + DIRECTION_CSS.marquee + EXTRA_CSS + css, body });
}

// ------------------------------------------------------------------------------------------------ Overlay on slides + menu bar item
export function overlay() {
  const css = `
.desk{position:relative;width:1440px;height:900px;overflow:hidden;background:#101010;${VARS};font-family:var(--ui)}
.mb{position:absolute;top:0;left:0;right:0;height:26px;background:rgba(30,29,27,.92);color:#f1ece2;display:flex;align-items:center;gap:18px;padding:0 14px;font:500 13px -apple-system,system-ui,sans-serif}
.mb .apple{width:14px;height:14px;border-radius:4px;background:#f1ece2;display:block}
.mb b{font-weight:700}
.mb .right{margin-left:auto;display:flex;align-items:center;gap:14px}
.mb .tray{display:flex;align-items:center;gap:6px;padding:0 8px;height:26px;background:rgba(255,255,255,.14);border-radius:4px}
.menu{position:absolute;top:30px;right:150px;width:300px;background:rgba(40,38,35,.98);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:5px;box-shadow:0 12px 40px rgba(0,0,0,.6);color:#f1ece2;font:13px -apple-system,system-ui,sans-serif;z-index:3}
.menu div{padding:5px 10px;border-radius:5px} .menu div.sel{background:var(--accent);color:var(--accent-fg)} .menu hr{border:0;border-top:1px solid rgba(255,255,255,.12);margin:4px 0}
.menu .sub{color:rgba(241,236,226,.55);font-size:12px}
.slide{position:absolute;left:0;right:0;top:26px;bottom:0;background:#f4f1eb;color:#1c1a16;padding:110px 140px;font-family:var(--ui)}
.slide h1{margin:0 0 18px;font:700 64px/1.05 var(--ui);letter-spacing:-.02em}
.slide h1 small{display:block;font:500 34px/1.2 var(--cjk);color:#6a6458;margin-top:12px}
.slide ul{margin:36px 0 0;padding-left:26px;font-size:28px;line-height:1.7;color:#3a3630}
.slide .pg{position:absolute;right:60px;bottom:40px;color:#948d80;font-size:16px}
.ov{position:absolute;left:0;right:0;bottom:0;padding:0 6vw 5vh;display:flex;flex-direction:column;gap:.25em;text-align:center;font-family:var(--cjk);font-weight:700;color:#fff;font-size:48px;line-height:1.25;text-shadow:0 0 .06em rgba(0,0,0,.95),0 0 .18em rgba(0,0,0,.9),0 .05em .1em rgba(0,0,0,.8)}
.ov .l.old{opacity:.6} .ov .s{display:block;font-size:.45em;font-weight:500;opacity:.8}
`;
  const body = `<div class="desk">
  <div class="mb"><i class="apple"></i><b>Keynote</b><span>File</span><span>Edit</span><span>Insert</span><span>Slide</span><span>Format</span><span>Arrange</span><span>View</span><span>Play</span><span>Window</span><span>Help</span>
    <div class="right"><span class="tray">${tray({ color: '#f1ece2', size: 18, concept: 'stack' })}<span>字幕</span></span><span>Wed 14:02</span></div></div>
  <div class="menu"><div>Open See Subtitles</div><div>Open overlay</div><hr><div class="sel">Fill: Built-in Retina Display (main) — 1728 × 1117</div><div>Fill: LG UltraFine — 3840 × 2160</div><div>Fill: BetterDisplay Virtual — 1920 × 1080</div><hr><div>Reload overlay</div><div>Close overlay</div><hr><div>Quit See Subtitles</div></div>
  <div class="slide"><h1>Subtitles for everyone in the room<small>字幕，人人可見</small></h1><ul><li>Speak Cantonese, the screen shows Mandarin</li><li>Phones follow along from a QR code</li><li>The recording keeps every word</li></ul><span class="pg">12 / 40</span>
    <div class="ov"><div class="l old">首先是現場的觀眾，他們可以用手機掃二維碼。</div><div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div></div>
  </div>
</div>`;
  return page({ fontLink, css: SHELL_CSS + DIRECTION_CSS.marquee + css, body });
}

// ------------------------------------------------------------------------------------------------ QR sheet over Live
function liveWin() { const h = liveScreen(M); return h.slice(h.indexOf('<div class="win">'), h.lastIndexOf('</x-dc>')); }
export function qrSheet() {
  const css = `.win{position:relative} .qrcard{background:#fff;color:#111;border-radius:18px;padding:30px 36px 26px;display:flex;flex-direction:column;align-items:center;gap:14px;width:600px;font-family:var(--ui)}
.qrcard .ev{font:600 15px/1.3 var(--cjk);color:#333;display:flex;align-items:center;gap:10px} .qrcard .url{font:600 30px/1.1 var(--ui);letter-spacing:.01em} .qrcard .m{color:#666;font-size:13px;text-align:center;line-height:1.5}
.qrcard .bar{width:100%;height:6px;border-radius:3px;background:var(--accent);margin-top:4px}`;
  const inner = liveWin().replace('<div class="win">', `<div class="win"><div class="scrim"><div class="qrcard">${mark(32)}<div class="ev">字幕與共融 講座 · 8 September</div>${QR(360)}<div class="url">seesubtitles.com/d/K7Q2</div><div class="m">Scan to follow the subtitles on your phone · 掃碼用手機睇字幕<br>Click anywhere or press Esc to close · Print QR poster from the share row</div><div class="bar"></div></div></div>`);
  return doc(inner, css);
}

// ------------------------------------------------------------------------------------------------ First run (new)
export function firstRun() {
  const css = `.fr{width:1440px;height:900px;background:var(--bg);color:var(--fg);font:13px/1.45 var(--ui);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;${VARS};position:relative}
.fr .cards{display:grid;grid-template-columns:repeat(3,400px);gap:24px} .fr .card{min-height:520px}
.fr .hd{display:flex;align-items:center;gap:12px;color:var(--fg-2)} .fr .hd .w{font:italic 400 24px var(--display);color:var(--fg)}`;
  const body = `<div class="fr">
  <div class="tl"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
  <div class="hd">${mark(30)}<span class="w">See Subtitles</span><span>· first run, three steps</span></div>
  <div class="cards">
    <div class="card"><div class="steps"><i class="on"></i><i></i><i></i><span>1 of 3</span></div><h2>Welcome</h2><p>Log in to get your subtitle keys, the share link for phones and venue screens, and cloud re-subtitling. Nothing else is needed.</p>
      <div class="fld"><label>Email</label><span class="field">alex@seesubtitles.com</span></div><div class="fld"><label>Password</label><span class="field" style="color:var(--fg-3)">••••••••••</span></div>
      <span class="btn primary">Log in</span><a>I have an invite code · create an account</a><span class="sp"></span><a style="color:var(--fg-3)">Use my own Tencent keys instead</a></div>
    <div class="card"><div class="steps"><i class="on"></i><i class="on"></i><i></i><span>2 of 3</span></div><h2>Which microphone?</h2><p>macOS will ask once for permission. Pick the one that hears the speaker; the meter shows what it picks up right now.</p>
      <div class="dev on"><span class="check on"></span>MacBook Pro Microphone<span class="meter"><i style="width:62%"></i></span></div><div class="dev"><span class="check"></span>USB Audio CODEC (mixer)<span class="meter"><i style="width:8%"></i></span></div><div class="dev"><span class="check"></span>BlackHole 2ch<span class="meter"><i style="width:0"></i></span></div>
      <span class="hint">Rehearsing with an audio file instead is under Live › Source.</span><span class="sp"></span><span class="btn primary">Continue</span></div>
    <div class="card"><div class="steps"><i class="on"></i><i class="on"></i><i class="on"></i><span>3 of 3</span></div><h2>What will people hear?</h2>
      <div class="fld"><label>Spoken language</label><span class="field sel">粵語 <span class="sub">Cantonese</span></span></div><div class="fld"><label>Subtitles in</label><span class="field sel">中文（简体） <span class="sub">Mandarin</span></span></div>
      <div class="stage-p" style="height:120px"><div class="l" style="font-size:18px">今天我們會講一下如何用字幕。<span class="s">今日我哋會講吓點樣用字幕。</span></div></div>
      <span class="sp"></span><span class="btn primary">Start a live talk</span><span class="btn ghost" style="height:34px;justify-content:center">Add a file to subtitle</span><span class="hint" style="text-align:center">Everything here can be changed later under Live.</span></div>
  </div>
</div>`;
  return doc(body, css);
}

// ------------------------------------------------------------------------------------------------ Glossary manager (new)
export function glossary() {
  const css = `.win{position:relative} .gl{width:780px} .gl table{width:100%;border-collapse:collapse} .gl th{text-align:left;font:500 11.5px var(--ui);color:var(--fg-3);padding:8px 20px;border-bottom:1px solid var(--line)} .gl td{padding:8px 20px;border-bottom:1px solid var(--line);font-size:13px;font-family:var(--cjk)} .gl td.w{font-variant-numeric:tabular-nums;color:var(--fg-2)} .gl .note{color:var(--fg-3);font-size:12px}`;
  const rows = [['騰訊雲', 10, 'Tencent Cloud, said in every talk'], ['共融', 8, 'inclusion, not 共融 → 共容'], ['字幕', 6, ''], ['黃大仙', 10, 'place name'], ['實時語音翻譯', 8, 'product name'], ['盧偉聰', 10, 'speaker name']];
  const inner = liveWin().replace('<div class="win">', `<div class="win"><div class="scrim"><div class="sheet gl">
    <div class="sh"><h2>Glossary</h2><span class="hint">Names and terms the recogniser should favour. Applied at the next connection through a graceful rotation.</span></div>
    <table><thead><tr><th>Term</th><th>Weight 1–10</th><th>Note</th><th></th></tr></thead><tbody>${rows.map(([t, w, n]) => `<tr><td>${t}</td><td class="w">${w}</td><td class="note">${n || '—'}</td><td style="text-align:right"><span class="btn small">remove</span></td></tr>`).join('')}
    <tr><td colspan="4" style="padding:6px 20px"><div class="v"><span class="field" style="max-width:260px;color:var(--fg-3)">New term</span><span class="field num">6</span><span class="field" style="color:var(--fg-3)">Note</span><span class="btn small">Add</span></div></td></tr></tbody></table>
    <div class="sf"><span class="btn small">Import CSV</span><span class="btn small">Export</span><span class="hint">6 of 128 terms · shared with your team on seesubtitles.com</span><span class="sp"></span><span class="btn">Cancel</span><span class="btn primary">Apply at next rotation</span></div>
  </div></div>`);
  return doc(inner, css);
}

// ------------------------------------------------------------------------------------------------ States: errors, empty, updates (new)
export function states() {
  const css = `.st{width:1440px;min-height:780px;background:var(--bg);color:var(--fg);font:13px/1.45 var(--ui);padding:40px 48px;${VARS};display:flex;flex-direction:column;gap:22px}
.st h1{margin:0;font:600 22px/1.2 var(--ui)} .st .lead{color:var(--fg-2);max-width:820px;margin:0}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.cell{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:16px;display:flex;flex-direction:column;gap:12px;min-height:190px}
.cell .lab{font:11.5px var(--mono);color:var(--fg-3)} .cell .status{flex-wrap:wrap;gap:8px 14px}`;
  const body = `<div class="st"><h1>States the app already has, drawn once</h1><p class="lead">Every state is a sentence plus one obvious action. Colour marks the state; the words say what happens to subtitles and to the recording.</p>
  <div class="grid">
    <div class="cell"><span class="lab">Live · not logged in</span><div class="status"><span class="s"><i class="dot" style="background:var(--bad)"></i>Not logged in</span></div><div class="card" style="padding:16px;gap:10px"><b>Log in to start</b><p>Your Tencent keys, the share link and cloud re-subtitling come with the account. Recording works without it.</p><span class="btn primary" style="height:30px">Log in under Settings</span></div></div>
    <div class="cell"><span class="lab">Live · Tencent refused the connection</span><div class="alert">Tencent refused the connection (6004): the 實時語音翻譯 resource pack is used up and post-paid billing is off. Subtitles are paused; recording continues. Retrying every 30 s.</div><span class="hint">The alert sits above the header, full width, until the next successful connection.</span></div>
    <div class="cell"><span class="lab">Live · reconnecting</span><div class="status"><span class="s"><i class="dot" style="background:var(--warn)"></i>Reconnecting in 12 s · 3 attempts</span><span class="s"><span class="meter"><i style="width:40%"></i></span>Mic −31 dB</span><span class="s" style="color:var(--rec)"><i class="dot" style="background:var(--rec)"></i>Recording 12:04</span></div><span class="hint">Subtitles pause; the recording and the mic meter keep going so the operator can see the room is still being captured.</span><span class="btn small" style="align-self:flex-start">Reconnect now</span></div>
    <div class="cell"><span class="lab">Live · paused by the operator</span><div class="status"><span class="s"><i class="dot" style="background:var(--warn)"></i>Subtitles paused</span></div><div class="toolbar" style="padding:0"><span class="btn rec"><i class="dot"></i>Stop recording</span><span class="btn primary">Resume subtitles</span><span class="btn">Clear screen</span></div><span class="hint">Resume becomes the one filled action while paused.</span></div>
    <div class="cell"><span class="lab">Live · demo mode</span><div class="status"><span class="s"><span class="tag">Demo mode</span></span><span class="s">scripted sentences, no microphone, no Tencent</span></div><span class="hint">An outlined chip, never a colour: demo is a rehearsal, not a state to worry about. Turned off under Settings › Advanced.</span></div>
    <div class="cell"><span class="lab">Files · empty</span><div class="empty">No files yet.<br>Record a talk under Live, or add a video or audio file to subtitle it.</div><div class="v" style="justify-content:center"><span class="btn">Go to Live</span><span class="btn primary">+ Add file…</span></div></div>
    <div class="cell"><span class="lab">Recording · no subtitles yet</span><div class="empty">This recording has audio but no subtitles.<br>Re-subtitle via cloud creates the complete set in a few minutes.</div><span class="btn primary" style="align-self:center">Re-subtitle via cloud</span></div>
    <div class="cell"><span class="lab">Recording · being replaced</span><div class="status"><span class="s"><i class="dot" style="background:var(--warn)"></i>Re-subtitling · translating 62%</span><span class="prog" style="margin:0"><i style="width:62%"></i></span></div><span class="hint">The live subtitles stay readable and editable until the cloud set arrives; the live files are kept as .live.srt.</span></div>
    <div class="cell"><span class="lab">Update available</span><div class="toast">${mark(28)}<div><b>See Subtitles 0.5 is downloaded</b><div class="hint">Restart to update · what changed</div></div><span class="sp"></span><span class="btn small">Later</span><span class="btn small primary">Restart</span></div><span class="hint">Bottom-right of the window, never during a recording.</span></div>
  </div></div>`;
  return doc(body, css);
}

// ------------------------------------------------------------------------------------------------ Printable QR poster (new, A4)
export function poster() {
  const css = `*{box-sizing:border-box} body{margin:0}
.po{width:794px;height:1123px;background:#fff;color:#1c1a16;padding:64px 64px 56px;font-family:${M.fonts.ui}, -apple-system, system-ui, sans-serif;display:flex;flex-direction:column;gap:22px;position:relative}
.po .hd{display:flex;align-items:center;gap:12px} .po .hd .w{font:italic 400 26px ${M.fonts.display}, serif}
.po h1{margin:14px 0 0;font:700 64px/1.1 "Noto Sans TC", "PingFang TC", sans-serif;letter-spacing:.02em}
.po h2{margin:0;font:500 26px/1.3 ${M.fonts.ui}, sans-serif;color:#5a554c}
.po .qr{align-self:center;margin:14px 0 6px;padding:18px;border:3px solid #1c1a16;border-radius:22px}
.po .url{text-align:center;font:600 40px/1.1 ${M.fonts.ui}, sans-serif;letter-spacing:.01em}
.po .steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:10px}
.po .steps div{display:flex;flex-direction:column;gap:6px;font-size:16px;line-height:1.4;color:#3a3630} .po .steps b{font:700 22px/1.2 "Noto Sans TC", sans-serif;color:#1c1a16} .po .steps i{width:30px;height:30px;border-radius:50%;background:#f5c518;color:#1a1500;font:700 15px/30px ${M.fonts.ui}, sans-serif;text-align:center;font-style:normal}
.po .ft{margin-top:auto;display:flex;align-items:center;gap:12px;color:#8a8478;font-size:14px;border-top:1px solid #dcd6c8;padding-top:16px} .po .ft .ev{color:#1c1a16;font:600 16px "Noto Sans TC", sans-serif}`;
  const body = `<div class="po">
  <div class="hd">${mark(44)}<span class="w">See Subtitles</span></div>
  <div><h1>用手機睇字幕</h1><h2>Follow the subtitles on your phone. Nothing to install.</h2></div>
  <div class="qr">${QR(380)}</div>
  <div class="url">seesubtitles.com/d/K7Q2</div>
  <div class="steps"><div><i>1</i><b>掃碼</b>Scan the code or type the address.</div><div><i>2</i><b>揀語言</b>Choose the translation, the original, or both.</div><div><i>3</i><b>調整字體</b>Set the text size. It stays on while the talk runs.</div></div>
  <div class="ft"><span class="ev">字幕與共融 講座 · 8 September 2026</span><span style="margin-left:auto">Audio stays with the organiser · 音頻不會離開會場</span></div>
</div>`;
  return page({ fontLink, css, body });
}

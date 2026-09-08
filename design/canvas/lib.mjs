// Shared pieces of the See Subtitles design canvas: page wrapper, shell CSS, the direction screens and boards.
import { DIRECTIONS, SCALE, cssVars } from './tokens.mjs';
import { CONCEPTS, tray } from './icons.mjs';


export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const markSvg = (d, opts = {}) => CONCEPTS[d.mark.concept]({ ...d.mark, ...opts });
export const primaryTokens = (d) => d[d.primary];
export const secondaryTokens = (d) => d[d.primary === 'dark' ? 'light' : 'dark'];

export function page({ fontLink, css, body }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
${fontLink ? `  <link rel="stylesheet" href="${fontLink}">\n` : ''}  <style>
${css}
  </style>
</helmet>
${body}
</x-dc>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------- shared UI css
export const ICON = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path>',
  files: '<path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v4h4"></path><path d="M9 13h6M9 17h6"></path>',
  gear: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"></path>',
  display: '<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8"></path>',
  overlay: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><rect x="8" y="8" width="13" height="13" rx="2"></rect>',
};
export const svgI = (p, cls = '') => `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ''}>${p}</svg>`;

export const SHELL_CSS = `
*{box-sizing:border-box}
body{margin:0}
.win{position:relative;width:1440px;height:900px;display:flex;background:var(--bg);color:var(--fg);font:13px/1.45 var(--ui);overflow:hidden;-webkit-font-smoothing:antialiased}
.tl{position:absolute;left:14px;top:14px;display:flex;gap:8px;z-index:2}
.tl i{width:12px;height:12px;border-radius:50%;display:block}
.side{width:200px;flex:none;background:var(--side);border-right:1px solid var(--line);display:flex;flex-direction:column;gap:2px;padding:46px 10px 10px}
.brand{display:flex;align-items:center;gap:9px;padding:0 8px 16px}
.brand svg{width:22px;height:22px;flex:none;border-radius:5px;box-shadow:0 0 0 1px var(--line)}
.brand .w{font-weight:600;font-size:14px;letter-spacing:-.01em;color:var(--fg)}
.nav{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;color:var(--fg-2);font-size:13.5px;font-weight:500}
.nav svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.nav .k{margin-left:auto;font-size:11px;color:var(--fg-3)}
.nav.active{background:var(--accent-soft);color:var(--accent-text)}
.grow{flex:1}
.account{border-top:1px solid var(--line);padding:10px 8px 2px;font-size:11.5px;color:var(--fg-3);display:flex;flex-direction:column;gap:2px}
.account b{color:var(--fg-2);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.top{display:flex;align-items:center;gap:16px;padding:14px 24px 6px;min-height:52px}
.top h1{margin:0;font:600 20px/1.2 var(--ui);letter-spacing:-.01em}
.status{display:flex;align-items:center;gap:14px;color:var(--fg-2);font-size:12.5px}
.status .s{display:flex;align-items:center;gap:7px;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.meter{width:72px;height:6px;border-radius:3px;background:var(--surface-2);border:1px solid var(--line);overflow:hidden}
.meter i{display:block;height:100%;width:62%;background:var(--ok)}
.actions{margin-left:auto;display:flex;gap:8px}
.toolbar{display:flex;gap:8px;padding:2px 24px 12px;align-items:center}
.btn{height:28px;padding:0 12px;border-radius:6px;border:1px solid var(--line-strong);background:var(--surface);color:var(--fg);font:500 12.5px/1 var(--ui);display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.btn svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.btn.ghost{background:transparent}
.btn.primary{background:var(--accent);color:var(--accent-fg);border-color:transparent;font-weight:600}
.btn.rec{background:var(--rec);color:#fff;border-color:transparent;font-weight:600}
.btn.rec .dot{background:#fff}
.btn.small{height:24px;padding:0 9px;font-size:12px}
.body{display:flex;gap:16px;padding:0 24px 12px;flex:1;min-height:0}
.col{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0}
.col.l{width:600px;flex:none;overflow:hidden}
.col.r{flex:1}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 16px;flex:none}
.panel h3{display:flex;align-items:center;gap:10px;margin:0 0 8px;font:600 14px/1.3 var(--ui);color:var(--fg)}
.n{width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--accent-fg);font:700 11px/20px var(--ui);text-align:center;flex:none}
.row{display:grid;grid-template-columns:128px 1fr;gap:8px 10px;align-items:center;margin:4px 0}
.row label{color:var(--fg-2);font-size:12.5px}
.row .v{display:flex;align-items:center;gap:8px;min-width:0}
.field{height:28px;border:1px solid var(--line);background:var(--surface-2);border-radius:6px;padding:0 10px;display:flex;align-items:center;gap:8px;color:var(--fg);font-size:13px;flex:1;min-width:0;white-space:nowrap}
.field .sub{color:var(--fg-3);font-size:12px}
.field.sel::after{content:"";width:6px;height:6px;border-right:1.5px solid var(--fg-3);border-bottom:1.5px solid var(--fg-3);transform:rotate(45deg);margin-left:auto;margin-top:-3px;flex:none}
.slider{flex:1;height:4px;border-radius:2px;background:var(--line-strong);position:relative}
.slider i{position:absolute;left:0;top:0;height:100%;width:58%;background:var(--accent);border-radius:2px}
.slider b{position:absolute;left:58%;top:50%;width:14px;height:14px;border-radius:50%;background:#fff;border:1px solid var(--line-strong);transform:translate(-50%,-50%);box-shadow:0 1px 2px rgba(0,0,0,.25)}
.num{width:64px;flex:none}
.unit{color:var(--fg-3);font-size:12px}
.check{width:15px;height:15px;border-radius:4px;border:1px solid var(--line-strong);background:var(--surface-2);flex:none}
.check.on{background:var(--accent);border-color:transparent;position:relative}
.check.on::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border-right:2px solid var(--accent-fg);border-bottom:2px solid var(--accent-fg);transform:rotate(45deg)}
.fold{display:flex;align-items:center;gap:7px;color:var(--fg-2);font-size:12px;margin-top:6px}
.fold::before{content:"";width:6px;height:6px;border-right:1.5px solid var(--fg-3);border-bottom:1.5px solid var(--fg-3);transform:rotate(-45deg);flex:none}
.hint{color:var(--fg-3);font-size:12px;line-height:1.4}
.hint.ind{margin-left:138px}
.tag{display:inline-flex;align-items:center;gap:6px;height:20px;padding:0 8px;border-radius:10px;font-size:11.5px;font-weight:500;background:var(--surface-2);color:var(--fg-2);border:1px solid var(--line);white-space:nowrap}
.tag.ok{color:var(--ok)} .tag.warn{color:var(--warn)} .tag.rec{color:var(--rec)} .tag.bad{color:var(--bad)}
.qr{width:66px;height:66px;background:#fff;border-radius:6px;padding:4px;flex:none}
.qr svg{width:58px;height:58px;display:block}
.stagebox{background:var(--stage);border-radius:10px;aspect-ratio:16/9;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding:14px 26px;gap:8px;overflow:hidden;font-family:var(--cjk);font-weight:700;color:#fff;text-align:center}
.stagebox .l{font-size:27px;line-height:1.25} .stagebox .l.old{opacity:.5} .stagebox .l .s{display:block;font-size:13px;font-weight:500;opacity:.7;margin-top:2px}
.transcript{flex:1;display:flex;flex-direction:column;min-height:0}
.transcript .list{flex:1;overflow:hidden;display:flex;flex-direction:column}
.p{display:grid;grid-template-columns:58px 1fr;gap:3px 12px;padding:9px 0;border-bottom:1px solid var(--line);font-family:var(--cjk)}
.p .t{color:var(--fg-3);font-size:11.5px;font-family:var(--mono);font-variant-numeric:tabular-nums;padding-top:3px}
.p .zh{font-size:14.5px;color:var(--fg);line-height:1.4} .p .yue{font-size:12.5px;color:var(--fg-3);grid-column:2}
.p.partial{opacity:.55}
.log{display:flex;align-items:center;gap:8px;color:var(--fg-3);font-size:12px}
.foot{display:flex;gap:18px;padding:7px 24px;border-top:1px solid var(--line);color:var(--fg-3);font-size:11.5px;align-items:center}
kbd{font-family:var(--ui);font-size:11px;border:1px solid var(--line-strong);border-radius:4px;padding:0 5px;color:var(--fg-2);margin-right:3px}
.sp{flex:1}
`;

export const DIRECTION_CSS = {
  marquee: `
.brand .w{font-family:var(--display);font-style:italic;font-weight:400;font-size:19px;letter-spacing:0}
.nav.active{color:var(--accent)}
.top h1{font-size:21px}
.stagebox{box-shadow:inset 0 0 0 1px var(--line)}
.status .s.live{color:var(--fg)}
`,
  daylight: `
.brand .w{font:500 18px/1 var(--display);letter-spacing:-.01em}
.nav.active{background:var(--surface);color:var(--fg);box-shadow:0 0 0 1px var(--line)}
.top h1{font:500 27px/1.1 var(--display);letter-spacing:-.01em}
.panel{background:transparent;border:0;border-top:1px solid var(--line);border-radius:0;padding:14px 0 12px}
.col.l .panel:first-child{border-top:0;padding-top:0}
.panel h3{font:500 19px/1.2 var(--display);gap:10px}
.n{width:auto;min-width:14px;height:20px;border-radius:0;background:transparent;color:var(--fg-3);font:400 17px/20px var(--display);text-align:left}
.row{grid-template-columns:140px 1fr}
.row label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3);font-weight:500}
.hint.ind{margin-left:150px}
.btn{background:var(--surface);border-color:var(--line-strong)}
.btn.rec{background:var(--fg);color:var(--bg)} .btn.rec .dot{background:var(--rec)}
.field{background:var(--surface);border-color:var(--line-strong)}
.slider i{background:var(--fg)} .check.on{background:var(--fg)} .check.on::after{border-color:var(--bg)}
.col.r .panel{border:0;padding:0} .col.r .panel h3{font-size:17px}
.tag{border-radius:3px;background:transparent;border-color:var(--line-strong)}
.foot{border-top-color:var(--line)}
`,
  signal: `
.brand .w{font-weight:800;font-size:12.5px;letter-spacing:.1em;text-transform:uppercase}
.top h1{font:800 22px/1.1 var(--ui);letter-spacing:-.01em;text-transform:uppercase}
.panel{border-radius:8px}
.panel h3{flex-direction:column;align-items:flex-start;gap:3px;margin-bottom:12px}
.n{width:auto;height:auto;border-radius:0;background:transparent;color:var(--accent-text);font:700 10.5px/1 var(--ui);letter-spacing:.14em;text-transform:uppercase}
.btn{border-radius:5px}
.tag{border-radius:4px;text-transform:uppercase;letter-spacing:.07em;font-size:10.5px;font-weight:700}
.status .s{font-weight:500}
.nav{font-weight:600}
`,
};

export const numLabel = (d, i) => (d.key === 'signal' ? `Step ${i}` : String(i));

export function sidebar(d, t) {
  return `<div class="tl"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
<nav class="side">
  <div class="brand">${markSvg(d)}<span class="w">See Subtitles</span></div>
  <div class="nav active">${svgI(ICON.mic)}<span>Live</span><span class="k">⌘1</span></div>
  <div class="nav">${svgI(ICON.files)}<span>Files</span><span class="k">⌘2</span></div>
  <div class="grow"></div>
  <div class="nav">${svgI(ICON.gear)}<span>Settings</span><span class="k">⌘,</span></div>
  <div class="account"><b>alex@seesubtitles.com</b><span>seesubtitles.com · sharing</span></div>
</nav>`;
}

export function liveScreen(d) {
  const t = primaryTokens(d);
  const css = `.win{${cssVars(t, d.fonts)}}` + SHELL_CSS + DIRECTION_CSS[d.key];
  const body = `<div class="win">
${sidebar(d, t)}
<main class="main">
  <div class="top">
    <h1>Live</h1>
    <div class="status">
      <span class="s live"><i class="dot" style="background:var(--ok)"></i>Connected · Guangzhou edge</span>
      <span class="s"><span class="meter"><i></i></span>Mic −23 dB</span>
      <span class="s" style="color:var(--rec)"><i class="dot" style="background:var(--rec)"></i>Recording 12:04</span>
    </div>
    <div class="actions"><span class="btn ghost">${svgI(ICON.display)}Display window</span><span class="btn ghost">${svgI(ICON.overlay)}Overlay window</span></div>
  </div>
  <div class="toolbar">
    <span class="btn rec"><i class="dot"></i>Stop recording</span>
    <span class="btn">Stop sharing</span>
    <span class="btn">Pause subtitles</span>
    <span class="btn">Clear screen</span>
  </div>
  <div class="body">
    <div class="col l">
      <section class="panel">
        <h3><span class="n">${numLabel(d, 1)}</span><span>Source</span></h3>
        <div class="row"><label>Microphone</label><div class="v"><span class="field sel">MacBook Pro Microphone</span></div></div>
        <div class="row"><label>Spoken language</label><div class="v"><span class="field sel">粵語 <span class="sub">Cantonese</span></span></div></div>
        <div class="row"><label>Subtitles in</label><div class="v"><span class="field sel">中文（简体） <span class="sub">Mandarin</span></span></div></div>
        <div class="row"><label>Translation model</label><div class="v"><span class="field sel">大模型 <span class="sub">LLM, more fluent</span></span></div></div>
        <div class="fold">Recognition tuning: hotwords, pause length, forced split, filler words, noise</div>
        <div class="fold">Rehearse with an audio file instead of the microphone</div>
        <div class="fold">Connection details</div>
      </section>
      <section class="panel">
        <h3><span class="n">${numLabel(d, 2)}</span><span>Subtitle look</span></h3>
        <div class="row"><label>Preset</label><div class="v"><span class="field sel">Landscape bar</span><span class="btn small">Apply</span><span class="btn small">Save current as…</span></div></div>
        <div class="row"><label>Show</label><div class="v"><span class="field sel">Translation + original</span></div></div>
        <div class="row"><label>Text size</label><div class="v"><span class="slider"><i></i><b></b></span><span class="field num">140</span><span class="unit">px</span></div></div>
        <div class="fold">Text, layout and background</div>
      </section>
      <section class="panel">
        <h3><span class="n">${numLabel(d, 3)}</span><span>Where it shows</span></h3>
        <div class="row"><label>Display window</label><div class="v"><span class="tag ok">open · full screen</span><span class="btn small">Show</span><span class="btn small">Full screen</span></div></div>
        <div class="row"><label>Overlay window</label><div class="v"><span class="field sel">Off</span></div></div>
        <div class="row"><label>Show status</label><div class="v"><span class="check on"></span><span class="hint">a small line on the display when the connection drops</span></div></div>
        <div class="row" style="align-items:start"><label style="padding-top:5px">Share link</label><div class="v" style="align-items:flex-start;gap:12px">
          <div class="qr"><svg viewBox="0 0 21 21" shape-rendering="crispEdges"><path fill="#111" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM8 0h1v1H8zM10 0h2v2h-2zM8 2h2v1H8zM11 3h1v2h-1zM9 4h1v2H9zM12 5h1v1h-1zM8 7h2v1H8zM11 7h1v1h-1zM13 8h1v1h-1zM0 8h1v1H0zM2 8h2v1H2zM5 8h2v1H5zM9 9h2v1H9zM12 9h2v2h-2zM16 8h1v1h-1zM18 8h2v1h-2zM3 10h1v1H3zM6 10h2v1H6zM15 10h1v1h-1zM17 10h1v2h-1zM19 10h2v1h-2zM1 11h1v1H1zM4 12h2v1H4zM8 11h1v2H8zM10 12h1v1h-1zM13 12h1v2h-1zM15 12h1v1h-1zM19 12h1v1h-1zM9 14h2v1H9zM12 14h1v1h-1zM14 14h2v1h-2zM17 14h2v1h-2zM20 14h1v1h-1zM8 16h1v1H8zM10 16h2v2h-2zM13 16h1v1h-1zM16 16h1v1h-1zM18 16h3v1h-3zM9 18h1v1H9zM12 18h1v1h-1zM14 18h1v2h-1zM17 18h1v1h-1zM19 18h2v1h-2zM8 20h2v1H8zM11 20h2v1h-2zM16 20h1v1h-1zM18 20h1v1h-1z"/></svg></div>
          <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0">
            <div class="v"><span class="field">seesubtitles.com/d/K7Q2</span><span class="btn small">Copy</span></div>
            <div class="v"><span class="btn small">Show QR large</span><span class="btn small">Stop sharing</span><span class="hint">1,284 events sent</span></div>
          </div></div></div>
      </section>
      <section class="panel">
        <h3><span class="n">${numLabel(d, 4)}</span><span>Recording</span></h3>
        <div class="row"><label>This talk</label><div class="v"><span class="tag rec"><i class="dot" style="background:var(--rec)"></i>12:04</span><span>18.4 MB · 141 cues</span><span class="btn small">Stop</span></div></div>
        <div class="row"><label>Saves to</label><div class="v"><span class="hint">~/Movies/See Subtitles · MP4 with burned-in subtitles after recording: on</span></div></div>
      </section>
    </div>
    <div class="col r">
      <section class="panel" style="padding:10px"><h3 style="margin:2px 0 8px 6px">Now showing</h3>
        <div class="stagebox">
          <div class="l old">首先是現場的觀眾，他們可以用手機掃二維碼。</div>
          <div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div>
        </div>
      </section>
      <section class="panel transcript"><h3>Transcript</h3>
        <div class="list">
          <div class="p"><span class="t">14:01:48</span><span class="zh">大家好，歡迎來到今天的分享。</span><span class="yue">大家好，歡迎嚟到今日嘅分享。</span></div>
          <div class="p"><span class="t">14:02:11</span><span class="zh">今天我們會講一下如何用字幕幫助更多人參與會議。</span><span class="yue">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div>
          <div class="p"><span class="t">14:02:19</span><span class="zh">首先是現場的觀眾，他們可以用手機掃二維碼。</span><span class="yue">首先係現場嘅觀眾，佢哋可以用手機掃個二維碼。</span></div>
          <div class="p partial"><span class="t">14:02:27</span><span class="zh">然後我們會演示…</span><span class="yue">然後我哋會示範…</span></div>
        </div>
      </section>
      <section class="panel" style="padding:10px 16px"><div class="log"><span class="fold" style="margin:0">Activity log</span><span class="sp"></span><span>14:02:03 connected to ap-guangzhou</span></div></section>
    </div>
  </div>
  <div class="foot"><span><kbd>⇧⌘R</kbd>record</span><span><kbd>P</kbd>pause</span><span><kbd>X</kbd>clear</span><span><kbd>+</kbd><kbd>−</kbd>text size</span><span class="sp"></span><span>Tencent 實時語音翻譯 · rotation in 24 min</span></div>
</main>
</div>`;
  return page({ fontLink: d.fonts.link, css, body });
}

// ---------------------------------------------------------------------------------------------- phone share page
export function phoneScreen(d) {
  const t = primaryTokens(d);
  const css = `.ph{${cssVars(d.dark, d.fonts)}}
*{box-sizing:border-box} body{margin:0}
.ph{width:390px;height:844px;background:#000;color:#fff;display:flex;flex-direction:column;font-family:var(--cjk);overflow:hidden;-webkit-font-smoothing:antialiased}
.hdr{display:flex;align-items:center;gap:8px;padding:58px 18px 10px;font:500 12.5px var(--ui);color:rgba(255,255,255,.72)}
.hdr svg{width:18px;height:18px;flex:none}
.hdr .w{color:#fff}
.hdr .live{margin-left:auto;display:flex;align-items:center;gap:6px}
.hdr .dot{width:7px;height:7px;border-radius:50%;background:var(--ok)}
.lines{flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding:0 20px 28px;gap:16px;text-align:center;font-weight:700}
.l{font-size:30px;line-height:1.3;overflow-wrap:anywhere} .l.old{opacity:.5} .l.older{opacity:.28} .l .s{display:block;font-size:15px;font-weight:500;opacity:.72;margin-top:4px}
.bar{display:flex;justify-content:space-between;padding:8px 20px 34px;font:500 12px var(--ui);color:rgba(255,255,255,.5)}
${d.key === 'marquee' ? '.hdr .w{font:italic 400 17px var(--display)} .hdr .live{color:var(--accent)}' : ''}
${d.key === 'daylight' ? '.hdr .w{font:500 16px var(--display)}' : ''}
${d.key === 'signal' ? '.hdr .w{font:800 11.5px var(--ui);letter-spacing:.1em;text-transform:uppercase} .hdr .live{color:var(--accent)} .hdr .dot{background:var(--accent)}' : ''}`;
  const body = `<div class="ph">
  <div class="hdr">${markSvg(d)}<span class="w">See Subtitles</span><span class="live"><i class="dot"></i>live</span></div>
  <div class="lines">
    <div class="l older">大家好，歡迎來到今天的分享。</div>
    <div class="l old">首先是現場的觀眾，他們可以用手機掃二維碼。</div>
    <div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div>
  </div>
  <div class="bar"><span>Aa  text size</span><span>粵語 original · on</span></div>
</div>`;
  return page({ fontLink: d.fonts.link, css, body });
}

// ---------------------------------------------------------------------------------------------- brand board
export function swatch(name, value, tokens, textOn) {
  return `<div class="sw"><div class="chip" style="background:${value};color:${textOn}"><span>${name}</span></div><div class="hex">${value}</div></div>`;
}
export function brandBoard(d) {
  const t = primaryTokens(d);
  const t2 = secondaryTokens(d);
  const modeName = (m) => (m === 'dark' ? 'Dark' : 'Light');
  const css = `.board{${cssVars(t, d.fonts)}}` + SHELL_CSS + DIRECTION_CSS[d.key] + `
.board{width:1200px;min-height:1740px;background:var(--bg);color:var(--fg);font:13px/1.5 var(--ui);padding:56px 64px 64px;display:flex;flex-direction:column;gap:40px;-webkit-font-smoothing:antialiased}
.hd{display:flex;flex-direction:column;gap:12px}
.hd .letter{font:600 12px/1 var(--ui);letter-spacing:.14em;text-transform:uppercase;color:var(--fg-3)}
.hd h1{margin:0;font:600 40px/1.1 var(--ui);letter-spacing:-.02em}
.hd .idea{font-size:17px;color:var(--fg-2);max-width:760px;line-height:1.45}
.hd .two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:6px}
.hd .two div{font-size:13px;color:var(--fg-2);line-height:1.5;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
.hd .two b{display:block;color:var(--fg);font-weight:600;margin-bottom:3px}
.sec{display:flex;flex-direction:column;gap:14px}
.sec > h2{margin:0;font:600 12px/1 var(--ui);letter-spacing:.14em;text-transform:uppercase;color:var(--fg-3);padding-bottom:10px;border-bottom:1px solid var(--line)}
.markrow{display:flex;align-items:flex-end;gap:36px;padding:24px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.tile{display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--fg-3);font-size:11.5px}
.tile svg{display:block}
.menubar{display:flex;align-items:center;gap:14px;height:28px;padding:0 12px;border-radius:6px;font:500 12.5px -apple-system,system-ui,sans-serif}
.menubar svg{display:block}
.menubar.lt{background:#ececee;color:#111} .menubar.dk{background:#2c2c2f;color:#f0f0f0}
.wm{display:flex;align-items:center;gap:40px}
.wm .big{font-size:56px;line-height:1;letter-spacing:-.02em}
.wm .lock{display:flex;align-items:center;gap:14px}
.wm .lock svg{width:44px;height:44px}
.wm .lock .t{display:flex;flex-direction:column;line-height:1.1}
.wm .lock .t .en{font-size:20px}
.wm .lock .t .zh{font-size:15px;color:var(--fg-2);font-family:var(--cjk);margin-top:3px}
.sws{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:10px}
.sw .chip{height:64px;border-radius:8px;border:1px solid var(--line);display:flex;align-items:flex-end;padding:8px;font-size:11px;font-weight:500}
.sw .hex{font:11px/1 var(--mono);color:var(--fg-3);margin-top:6px}
.modes{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.mode{border:1px solid var(--line);border-radius:10px;padding:16px;background:var(--bg);color:var(--fg)}
.mode h4{margin:0 0 12px;font:600 13px var(--ui);color:var(--fg-2)}
.statusrow{display:flex;gap:22px;flex-wrap:wrap}
.statusrow .s{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--fg-2)}
.type{display:grid;grid-template-columns:150px 1fr;gap:14px 24px;align-items:baseline}
.type .lab{font:11.5px/1.3 var(--mono);color:var(--fg-3)}
.cjk{font-family:var(--cjk)}
.comps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 32px}
.comp{display:flex;flex-direction:column;gap:10px}
.comp .lab{font:11.5px/1 var(--mono);color:var(--fg-3)}
.comp .rowx{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.comp .rowx .field{flex:0 0 auto}
.comp .rowx .slider{flex:0 0 130px}
.filerow{display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
.filerow .name{font-weight:500} .filerow .sub{color:var(--fg-3);font-size:12px;margin-top:1px}
.filerow .meta{color:var(--fg-2);font-size:12px;font-variant-numeric:tabular-nums}
.strip{display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;border:1px solid var(--line)}
`;
  const nameFont = d.key === 'marquee' ? 'font-family:var(--display);font-style:italic;font-weight:400;letter-spacing:0' : d.key === 'daylight' ? 'font-family:var(--display);font-weight:500' : 'font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:44px';
  const wmStyle = d.key === 'marquee' ? 'font:italic 400 56px/1 var(--display)' : d.key === 'daylight' ? 'font:500 56px/1 var(--display);letter-spacing:-.015em' : 'font:800 44px/1 var(--ui);letter-spacing:.08em;text-transform:uppercase';
  const lockEn = d.key === 'marquee' ? 'font:italic 400 24px/1 var(--display)' : d.key === 'daylight' ? 'font:500 22px/1 var(--display)' : 'font:800 15px/1 var(--ui);letter-spacing:.1em;text-transform:uppercase';
  const lockZh = d.key === 'daylight' ? 'font:700 16px/1 var(--display)' : d.key === 'signal' ? 'font:900 15px/1 var(--cjk);letter-spacing:.2em' : 'font:700 16px/1 var(--cjk);letter-spacing:.12em';
  const body = `<div class="board">
  <header class="hd">
    <div class="letter">Direction ${d.letter}</div>
    <h1 style="${nameFont}">${d.name}</h1>
    <div class="idea">${esc(d.idea)}</div>
    <div class="two"><div><b>Best when</b>${esc(d.best)}</div><div><b>Watch out</b>${esc(d.tradeoff)}</div></div>
  </header>

  <section class="sec"><h2>Mark</h2>
    <div class="markrow">
      <div class="tile">${markSvg(d, { size: 160 })}<span>1024 (app icon)</span></div>
      <div class="tile">${markSvg(d, { size: 64 })}<span>64</span></div>
      <div class="tile">${markSvg(d, { size: 32 })}<span>32</span></div>
      <div class="tile">${markSvg(d, { size: 16 })}<span>16</span></div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-left:12px">
        <div class="menubar lt">${tray({ color: '#000', size: 18, concept: d.mark.concept })}<span>字幕</span><span style="opacity:.55">Wed 14:02</span></div>
        <div class="menubar dk">${tray({ color: '#fff', size: 18, concept: d.mark.concept })}<span>字幕</span><span style="opacity:.55">Wed 14:02</span></div>
        <div class="hint">Menu bar: a template icon replaces the text-only item, the 字幕 word can stay beside it.</div>
      </div>
    </div>
  </section>

  <section class="sec"><h2>Wordmark</h2>
    <div class="wm">
      <div class="big" style="${wmStyle}">See Subtitles</div>
      <div class="lock">${markSvg(d)}<div class="t"><span class="en" style="${lockEn}">See Subtitles</span><span class="zh" style="${lockZh}">睇字幕</span></div></div>
    </div>
    <div class="hint">The Chinese line is a proposal: 睇字幕 is the Cantonese way to say it; 看字幕 or 見字幕 if the name should read as Mandarin first.</div>
  </section>

  <section class="sec"><h2>Colour</h2>
    <div class="modes">
      <div class="mode" style="${cssVars(t, d.fonts)}"><h4>${modeName(d.primary)} · default</h4>
        <div class="sws">${[['bg', t.bg], ['side', t.side], ['surface', t.surface], ['surface-2', t.surface2], ['line', t.line], ['fg', t.fg], ['fg-2', t.fg2], ['fg-3', t.fg3], ['accent', t.accent]].map(([n, v]) => swatch(n, v, t, n.startsWith('fg') || n === 'accent' ? (n === 'accent' ? t.accentFg : t.bg) : t.fg)).join('')}</div>
        <div class="statusrow" style="margin-top:16px"><span class="s"><i class="dot" style="background:${t.ok}"></i>Ready</span><span class="s"><i class="dot" style="background:${t.warn}"></i>Attention</span><span class="s"><i class="dot" style="background:${t.bad}"></i>Error</span><span class="s"><i class="dot" style="background:${t.rec}"></i>Recording</span><span class="s"><span class="tag">Demo</span></span></div>
      </div>
      <div class="mode" style="${cssVars(t2, d.fonts)}"><h4>${modeName(d.primary === 'dark' ? 'light' : 'dark')} · follows the system</h4>
        <div class="sws">${[['bg', t2.bg], ['side', t2.side], ['surface', t2.surface], ['surface-2', t2.surface2], ['line', t2.line], ['fg', t2.fg], ['fg-2', t2.fg2], ['fg-3', t2.fg3], ['accent', t2.accent]].map(([n, v]) => swatch(n, v, t2, n.startsWith('fg') || n === 'accent' ? (n === 'accent' ? t2.accentFg : t2.bg) : t2.fg)).join('')}</div>
        <div class="statusrow" style="margin-top:16px"><span class="s"><i class="dot" style="background:${t2.ok}"></i>Ready</span><span class="s"><i class="dot" style="background:${t2.warn}"></i>Attention</span><span class="s"><i class="dot" style="background:${t2.bad}"></i>Error</span><span class="s"><i class="dot" style="background:${t2.rec}"></i>Recording</span><span class="s"><span class="tag">Demo</span></span></div>
      </div>
    </div>
    <div class="hint">Three surfaces (window, sidebar, panel) plus one input fill and one line colour. The accent is for the primary action, selection and the step numerals only; status is always a dot and a word. Demo mode is an outlined chip, not a fifth colour.</div>
  </section>

  <section class="sec"><h2>Type</h2>
    <div class="type">
      <span class="lab">wordmark · ${d.fonts.display.replace(/"/g, '')}${d.key === 'signal' ? ' 800' : ''}</span><span style="${wmStyle};font-size:30px">See Subtitles</span>
      <span class="lab">view title</span><span class="top" style="padding:0;min-height:0"><h1 style="font-size:20px">Files</h1></span>
      <span class="lab">section</span><span class="panel" style="padding:0;border:0;background:transparent"><h3 style="margin:0"><span class="n">${numLabel(d, 2)}</span><span>Subtitle look</span></h3></span>
      <span class="lab">body · 13</span><span>Recording never depends on the network. Finished recordings appear under Files.</span>
      <span class="lab">secondary · 12.5</span><span style="color:var(--fg-2);font-size:12.5px">recording · 粵語 → 中文 · 47:12 · 512 cues</span>
      <span class="lab">hint · 12</span><span class="hint">Phones and venue screens open the link and follow along. Audio stays on this Mac.</span>
      <span class="lab">mono · times</span><span style="font-family:var(--mono);font-size:12px;color:var(--fg-2)">00:47:12.480 → 00:47:15.120</span>
      <span class="lab">chinese · ${d.fonts.cjk.replace(/"/g, '').split(',')[0]}</span><span class="cjk" style="font-size:16px">字幕讓每個人都能參與 · 粵語、普通話、英文</span>
    </div>
  </section>

  <section class="sec"><h2>Components</h2>
    <div class="comps">
      <div class="comp"><span class="lab">buttons · one filled action per view</span><div class="rowx"><span class="btn rec"><i class="dot"></i>Start recording</span><span class="btn primary">+ Add file…</span><span class="btn">Share link</span><span class="btn ghost">Overlay window</span><span class="btn small">Copy</span></div></div>
      <div class="comp"><span class="lab">status · dot + word, never colour alone</span><div class="rowx"><span class="tag ok"><i class="dot" style="background:var(--ok)"></i>Connected</span><span class="tag warn"><i class="dot" style="background:var(--warn)"></i>Reconnecting in 12 s</span><span class="tag bad"><i class="dot" style="background:var(--bad)"></i>Not logged in</span><span class="tag rec"><i class="dot" style="background:var(--rec)"></i>Recording 12:04</span><span class="tag">Demo mode</span></div></div>
      <div class="comp"><span class="lab">fields</span><div class="rowx"><span class="field sel" style="width:170px">粵語 <span class="sub">Cantonese</span></span><span class="field" style="width:190px">seesubtitles.com/d/K7Q2</span><span class="slider"><i></i><b></b></span><span class="field num">140</span><span class="check on"></span></div></div>
      <div class="comp"><span class="lab">navigation · rest and active</span><div class="rowx" style="flex-direction:column;align-items:stretch;gap:2px;max-width:200px;background:var(--side);padding:8px;border-radius:8px;border:1px solid var(--line)"><div class="nav active">${svgI(ICON.mic)}<span>Live</span><span class="k">⌘1</span></div><div class="nav">${svgI(ICON.files)}<span>Files</span><span class="k">⌘2</span></div></div></div>
      <div class="comp"><span class="lab">file row · the stack: a line and a quieter line</span><div class="filerow"><div><div class="name cjk">2026-09-08 字幕與共融 講座</div><div class="sub">recording · 粵語 → 中文 · cloud subtitles</div></div><span class="meta">47:12</span><span class="tag ok">complete</span></div></div>
      <div class="comp"><span class="lab">section with fold and hint</span><div class="panel" style="padding:12px 14px"><h3><span class="n">${numLabel(d, 4)}</span><span>Recording</span></h3><div class="row"><label>Saves to</label><div class="v"><span class="hint">~/Movies/See Subtitles</span></div></div><div class="fold">MP4 and encoder options</div></div></div>
    </div>
    <div class="strip" style="${cssVars(t2, d.fonts)};background:var(--bg);color:var(--fg);margin-top:6px"><div class="nav active" style="width:150px">${svgI(ICON.files)}<span>Files</span><span class="k">⌘2</span></div><span class="btn rec"><i class="dot"></i>Start recording</span><span class="btn primary">+ Add file…</span><span class="btn">Share link</span><span class="field sel" style="flex:none;width:170px">Landscape bar</span><span class="tag ok"><i class="dot" style="background:var(--ok)"></i>Connected</span><span class="hint" style="margin-left:auto">the same components in the other appearance</span></div>
  </section>
</div>`;
  return page({ fontLink: d.fonts.link, css, body });
}

// ---------------------------------------------------------------------------------------------- neutral boards
export const NEUTRAL = `--bg:#f7f6f3;--surface:#ffffff;--surface-2:#efede8;--line:#dedbd3;--line-strong:#c2beb4;--fg:#1a1918;--fg-2:#5d5a54;--fg-3:#8f8b83;--ok:#1f9a4a;--warn:#c76a00;--bad:#c62828;--rec:#d3232a;--ui:-apple-system,system-ui,"Helvetica Neue","PingFang TC","Noto Sans TC",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace;`;
export const NEUTRAL_CSS = `
*{box-sizing:border-box} body{margin:0}
.nb{${NEUTRAL}background:var(--bg);color:var(--fg);font:14px/1.5 var(--ui);padding:56px 64px 64px;display:flex;flex-direction:column;gap:36px;-webkit-font-smoothing:antialiased}
.nb h1{margin:0;font:600 34px/1.15 var(--ui);letter-spacing:-.02em}
.nb .lead{font-size:17px;color:var(--fg-2);max-width:820px;line-height:1.5}
.nb h2{margin:0;font:600 12px/1 var(--ui);letter-spacing:.14em;text-transform:uppercase;color:var(--fg-3);padding-bottom:10px;border-bottom:1px solid var(--line)}
.nb .sec{display:flex;flex-direction:column;gap:14px}
.nb p{margin:0}
.nb ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}
.nb .hint{color:var(--fg-3);font-size:12.5px}
.nb .mono{font-family:var(--mono);font-size:12px;color:var(--fg-3)}
.nb .dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
`;

export const ALL_FONT_LINKS = Object.values(DIRECTIONS).map((d) => d.fonts.link);

export function overview() {
  const card = (d) => {
    const t = primaryTokens(d);
    const nameStyle = d.key === 'marquee' ? `font:italic 400 30px/1 ${d.fonts.display}, serif` : d.key === 'daylight' ? `font:500 30px/1 ${d.fonts.display}, serif;letter-spacing:-.01em` : `font:800 22px/1 ${d.fonts.ui}, sans-serif;letter-spacing:.08em;text-transform:uppercase`;
    return `<div class="card" style="${cssVars(t, d.fonts)}">
      <div class="ch">${markSvg(d, { size: 56 })}<div><div class="lt">Direction ${d.letter}</div><div class="nm" style="${nameStyle}">${d.name}</div></div></div>
      <div class="idea">${esc(d.idea)}</div>
      <div class="pal">${[t.bg, t.side, t.surface, t.line, t.fg2, t.fg, t.accent].map((c) => `<i style="background:${c}"></i>`).join('')}</div>
      <div class="ty"><span style="font-family:var(--ui);font-weight:600">Live · Files · Settings</span><span style="font-family:var(--cjk)">粵語 → 中文字幕</span></div>
      <div class="bw"><b>Best when</b>${esc(d.best)}</div>
      <div class="bw"><b>Watch out</b>${esc(d.tradeoff)}</div>
    </div>`;
  };
  const css = NEUTRAL_CSS + `
.nb{width:1200px;min-height:1080px}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
.card{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:14px;font:13px/1.5 var(--ui)}
.card .ch{display:flex;align-items:center;gap:14px}
.card .lt{font:600 11px/1 var(--ui);letter-spacing:.14em;text-transform:uppercase;color:var(--fg-3);margin-bottom:6px}
.card .idea{color:var(--fg-2);line-height:1.45;min-height:58px}
.card .pal{display:flex;gap:4px} .card .pal i{flex:1;height:22px;border-radius:4px;border:1px solid var(--line);display:block}
.card .ty{display:flex;justify-content:space-between;font-size:14px;padding:10px 12px;background:var(--surface);border:1px solid var(--line);border-radius:8px}
.card .bw{font-size:12.5px;color:var(--fg-2);line-height:1.45} .card .bw b{display:block;color:var(--fg);font-weight:600;margin-bottom:1px}
.rec{border:1px solid var(--line-strong);border-radius:12px;padding:20px 22px;background:var(--surface);display:flex;flex-direction:column;gap:8px}
.rec b{font-weight:600}
.next{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 28px}
.next div{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;color:var(--fg-2)} .next div i{flex:none;width:22px;height:22px;border-radius:50%;background:var(--fg);color:#fff;font:600 11px/22px var(--ui);text-align:center;font-style:normal}
`;
  const body = `<div class="nb">
  <div class="sec" style="gap:12px">
    <h1>See Subtitles · design language</h1>
    <p class="lead">Three complete directions to choose from. Each one has its own mark, palette in both appearances, type pairing and components, and is applied to the Live screen and the phone share page so you can judge it on the real thing. Pick one, or mix: the mark, the tone and the type are separate decisions.</p>
    <p class="lead" style="font-size:15px">Whatever you pick, the principles board fixes the hierarchy: three text tiers, one filled action per view, status as a sentence, shortcuts out of the toolbar, and every row built as a line and a quieter line, the way a subtitle pair is.</p>
  </div>
  <div class="cards">${Object.values(DIRECTIONS).map(card).join('')}</div>
  <div class="rec">
    <b>Recommendation</b>
    <p>A · Marquee for the app, using B · Daylight's paper tokens as its light appearance. It is the most ours: the yellow is a memory every Cantonese-speaking audience has of subtitles, the stacked mark is the product itself, and it evolves the shell you already like instead of replacing it. Daylight is the better answer if the hosted web app and desk work become the main use; Signal if you want the product to read as a contemporary app first and a venue tool second.</p>
    <p class="hint">The three marks are interchangeable across directions, see the icon sheet at the bottom of the canvas. The Chinese name on the wordmarks (睇字幕) is a proposal, not a decision.</p>
  </div>
  <div class="sec"><h2>After you choose</h2>
    <div class="next">
      <div><i>1</i><span>Tokens replace the hard-coded colours in style.css, desktop.css and app.css; both appearances follow the system.</span></div>
      <div><i>2</i><span>App icon (icns + 1024 png) and a menu-bar template icon replace the Electron default and the text-only 字幕 item.</span></div>
      <div><i>3</i><span>Live, Files and Settings get the new header, toolbar, section and row anatomy from the principles board.</span></div>
      <div><i>4</i><span>The hosted pages (login, dashboard, job editor, phone share page) get the same tokens so the web and the app read as one product.</span></div>
    </div>
  </div>
  <p class="hint">Canvas map: principles to the right · the app today below · then one row per direction (brand board, Live screen, phone) · the icon sheet last.</p>
</div>`;
  return page({ fontLink: ALL_FONT_LINKS.join('"><link rel="stylesheet" href="'), css, body });
}

export function principles() {
  const css = NEUTRAL_CSS + `
.nb{width:1200px;min-height:1620px}
.ba{display:grid;grid-template-columns:1fr;gap:22px}
.ba .cap{font:600 11.5px/1 var(--ui);letter-spacing:.1em;text-transform:uppercase;color:var(--fg-3);margin-bottom:10px}
.mini{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface);font-size:12px;max-width:1000px}
.mini .r{display:flex;align-items:center;gap:8px;padding:10px 12px}
.mini .r + .r{border-top:1px solid var(--line)}
.mini .h{font-weight:600;font-size:14px}
.mini .c{padding:2px 8px;border-radius:9px;background:#e6e4de;color:#333}
.mini .c.g{background:#1e8e3e;color:#fff} .mini .c.r{background:#b3261e;color:#fff}
.mini .b{padding:4px 9px;border-radius:5px;background:#e6e4de;color:#1a1918;font-weight:500}
.mini .b.blue{background:#0a84ff;color:#fff} .mini .b.red{background:#b3261e;color:#fff} .mini .b.ghost{background:transparent;border:1px solid #c2beb4}
.mini .b.rec{background:var(--rec);color:#fff;font-weight:600} .mini .b.line{background:transparent;border:1px solid var(--line-strong)}
.mini .sp{flex:1}
.mini .s{display:flex;align-items:center;gap:6px;color:var(--fg-2)}
.mini .foot{color:var(--fg-3);background:var(--bg)}
.mini .sec{padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#9a9a9f;display:flex;align-items:center;gap:6px}
.mini .sec i{width:14px;height:14px;border-radius:50%;background:#e6e4de;color:#333;font:600 9px/14px var(--ui);text-align:center;font-style:normal}
.mini .lab{color:#5d5a54;font-size:12px;width:96px} .mini .in{flex:1;height:22px;border:1px solid var(--line);border-radius:5px;background:var(--surface-2)}
.mini .sec2{padding:10px 12px 6px;font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px}
.mini .sec2 i{width:18px;height:18px;border-radius:50%;background:var(--fg);color:#fff;font:700 10px/18px var(--ui);text-align:center;font-style:normal}
.tiers{display:grid;grid-template-columns:170px 150px 1fr;gap:8px 20px;align-items:baseline;border-top:1px solid var(--line)}
.tiers > *{padding:8px 0;border-bottom:1px solid var(--line)}
.tiers .k{font:11.5px var(--mono);color:var(--fg-3)}
.stack{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.stack .cell{border:1px solid var(--line);border-radius:8px;padding:12px 14px;background:var(--surface);display:flex;flex-direction:column;gap:2px}
.stack .cell b{font-weight:500;font-size:13.5px} .stack .cell span{color:var(--fg-3);font-size:12px}
.stack .cell .what{margin-top:8px;font:11px var(--mono);color:var(--fg-3)}
.ladder{display:flex;gap:10px;align-items:stretch}
.ladder div{flex:1;border:1px solid var(--line);border-radius:8px;padding:12px;font-size:12px;color:var(--fg-2)} .ladder b{display:block;color:var(--fg);font-weight:600;margin-bottom:2px}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}
.scale{display:flex;gap:10px;align-items:flex-end} .scale i{display:block;background:var(--fg);border-radius:2px} .scale span{font:11px var(--mono);color:var(--fg-3);display:flex;flex-direction:column;align-items:center;gap:6px}
.radii{display:flex;gap:14px} .radii span{display:flex;flex-direction:column;align-items:center;gap:6px;font:11px var(--mono);color:var(--fg-3)} .radii i{display:block;width:44px;height:44px;border:1.5px solid var(--fg)}
.ctrl{display:flex;gap:14px;align-items:flex-end} .ctrl span{display:flex;flex-direction:column;align-items:center;gap:6px;font:11px var(--mono);color:var(--fg-3)} .ctrl i{display:block;width:84px;border:1.5px solid var(--fg);border-radius:6px}
.status{display:flex;gap:24px;flex-wrap:wrap} .status span{display:flex;align-items:center;gap:7px;font-size:13px}
`;
  const body = `<div class="nb">
  <div class="sec" style="gap:12px">
    <h1>What every direction shares</h1>
    <p class="lead">The app exists so that anyone can use subtitles as an assist, in any room: a hall, a meeting, a video on a laptop. That asks four things of the interface.</p>
    <ul style="max-width:860px">
      <li><b>The subtitles are the show.</b> The operator's window is calm and mostly monochrome so the stage preview, the status and the one thing to do next stand out.</li>
      <li><b>Legible before pretty.</b> Body text never below 13 px, secondary text never below 12, contrast that holds up on a projector-lit laptop at the back of a room.</li>
      <li><b>Setup is a sequence.</b> Source, look, where it shows, recording: numbered, in that order, with the rarely-used controls folded away.</li>
      <li><b>Bilingual by design.</b> Every primary line can carry a quieter second line: the translation and the original, the name and its role, the state and its detail.</li>
    </ul>
  </div>

  <div class="sec"><h2>Hierarchy · the Live header, today and after</h2>
    <div class="ba">
      <div><div class="cap">Today</div><div class="mini">
        <div class="r"><span class="h">Live</span><span class="c g">● Tencent connected · ap-guangzhou edge</span><span class="c">Mic ▮▮▮▯ −23 dB</span><span class="c r">● Recording 12:04</span><span class="sp"></span><span class="b ghost">Display window</span><span class="b ghost">Overlay window</span></div>
        <div class="r"><span class="b red">● Start recording</span><span class="b blue">Share link</span><span class="b">Pause subtitles</span><span class="b">Clear screen</span><span style="color:#9a9a9f">Shortcuts: ⇧⌘R record · P pause · X clear · +/− text size</span></div>
        <div class="sec"><i>1</i>SOURCE</div>
        <div class="r" style="padding-top:0"><span class="lab">Audio device</span><span class="in"></span></div>
      </div>
      <p class="hint" style="margin-top:10px">Two filled colours compete on one row. Status chips are styled like buttons. The section title (11 px caps, grey) is smaller than the labels under it. Shortcut help sits where actions belong.</p></div>
      <div><div class="cap">After</div><div class="mini">
        <div class="r"><span class="h">Live</span><span class="s"><i class="dot" style="background:var(--ok)"></i>Connected · Guangzhou edge</span><span class="s">Mic −23 dB</span><span class="s" style="color:var(--rec)"><i class="dot" style="background:var(--rec)"></i>Recording 12:04</span><span class="sp"></span><span class="b line">Display window</span><span class="b line">Overlay window</span></div>
        <div class="r"><span class="b rec">● Stop recording</span><span class="b line">Stop sharing</span><span class="b line">Pause subtitles</span><span class="b line">Clear screen</span></div>
        <div class="sec2"><i>1</i>Source</div>
        <div class="r" style="padding-top:0"><span class="lab">Microphone</span><span class="in"></span></div>
        <div class="r foot">⇧⌘R record · P pause · X clear · + − text size</div>
      </div>
      <p class="hint" style="margin-top:10px">Status reads as one sentence in text colour; only recording keeps its colour. One filled button. Section titles are the biggest text in a panel. Shortcuts live in a footer.</p></div>
    </div>
    <div class="tiers">
      <span class="k">tier</span><span class="k">size / weight</span><span class="k">used for</span>
      <span>View title</span><span>20 / 600</span><span>Live, Files, Settings, a recording's name</span>
      <span>Section</span><span>14 / 600</span><span>numbered steps, panel titles; the step numeral is the one place the accent appears in text</span>
      <span>Body</span><span>13 / 400</span><span>fields, table cells, transcript, buttons (12.5 / 500)</span>
      <span>Secondary</span><span>12.5 / 400 · fg-2</span><span>labels, the quieter line of a stack, status sentence</span>
      <span>Hint</span><span>12 / 400 · fg-3</span><span>explanations under a row, footer, timestamps (mono, tabular)</span>
    </div>
  </div>

  <div class="sec"><h2>The stack · one pattern for every row</h2>
    <div class="stack">
      <div class="cell"><b>Files</b><span>⌘2</span><span class="what">nav item</span></div>
      <div class="cell"><b>2026-09-08 字幕與共融 講座</b><span>recording · 粵語 → 中文 · 47:12</span><span class="what">file row</span></div>
      <div class="cell"><b>Tencent Cloud</b><span>實時語音翻譯 · keys from seesubtitles.com</span><span class="what">settings section</span></div>
      <div class="cell"><b>今天我們會講一下如何用字幕。</b><span>今日我哋會講吓點樣用字幕。</span><span class="what">transcript, cue, stage</span></div>
    </div>
    <p class="hint">Primary line in fg at body size, secondary line in fg-3 one step smaller, 2 px apart. Chinese terms go on the secondary line in the UI (Tencent Cloud / 實時語音翻譯), never inline in an English sentence.</p>
  </div>

  <div class="two">
    <div class="sec"><h2>Colour rules</h2>
      <div class="ladder"><div><b>bg</b>the window</div><div><b>side</b>sidebar, footer</div><div><b>surface</b>panels, buttons</div><div><b>surface-2</b>inputs, hover</div><div><b>line</b>the only border</div></div>
      <ul>
        <li>The accent appears in three places: the primary action, the active nav item, the step numerals. Nothing else.</li>
        <li>Status is a dot and a word, and the word stays in text colour except recording. Hues are fixed across directions.</li>
        <li>No shadows inside the window; elevation is a border. Menus and the QR sheet are the only floating surfaces.</li>
      </ul>
      <div class="status"><span><i class="dot" style="background:var(--ok)"></i>Ready · connected</span><span><i class="dot" style="background:var(--warn)"></i>Attention · reconnecting, paused</span><span><i class="dot" style="background:var(--bad)"></i>Error · not logged in</span><span><i class="dot" style="background:var(--rec)"></i>Recording</span></div>
    </div>
    <div class="sec"><h2>Scale</h2>
      <div class="scale">${SCALE.space.map((s) => `<span><i style="width:${s}px;height:${s}px"></i>${s}</span>`).join('')}<span class="hint" style="margin-left:8px;align-self:center">spacing</span></div>
      <div class="radii">${Object.entries(SCALE.radius).map(([k, v]) => `<span><i style="border-radius:${v}px"></i>${v} · ${k === 'sm' ? 'tags' : k === 'md' ? 'buttons, fields' : k === 'lg' ? 'panels' : 'sheets'}</span>`).join('')}</div>
      <div class="ctrl">${Object.entries(SCALE.control).map(([k, v]) => `<span><i style="height:${v}px"></i>${v} · ${k}</span>`).join('')}</div>
      <p class="hint">Sidebar 200, label column 128, left column 600. Eight-point grid with 4 for the tightest gaps.</p>
    </div>
  </div>

  <div class="sec"><h2>Words</h2>
    <ul>
      <li>Sentence case everywhere, including buttons and menu items that are not macOS menu bar items.</li>
      <li>Say what happened, in a sentence: "Connected · Guangzhou edge", "Reconnecting in 12 s", "Recording 12:04". No exclamation marks, no "successfully".</li>
      <li>Numbers are tabular; times are monospaced; sizes carry a unit in fg-3.</li>
      <li>Keyboard shortcuts appear once, in the footer of the view, and next to nav items.</li>
    </ul>
  </div>
</div>`;
  return page({ fontLink: null, css, body });
}

// ---------------------------------------------------------------------------------------------- the app today
export function current() {
  const css = `
*{box-sizing:border-box} body{margin:0}
.cur{width:1440px;height:900px;display:flex;background:#111;color:#e8e8e8;font:13px/1.45 -apple-system,system-ui,"PingFang SC","Noto Sans TC",sans-serif;overflow:hidden;position:relative;-webkit-font-smoothing:antialiased}
.cur .tl{position:absolute;left:14px;top:14px;display:flex;gap:8px} .cur .tl i{width:12px;height:12px;border-radius:50%;display:block}
.cur .side{width:190px;flex:none;background:#161618;border-right:1px solid #2a2a2d;display:flex;flex-direction:column;gap:2px;padding:40px 10px 10px}
.cur .brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;padding:0 10px 14px;color:#fff}
.cur .nav{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;color:#c8c8cc;font-size:14px}
.cur .nav.active{background:#0a84ff26;color:#fff}
.cur .nav svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.cur .grow{flex:1}
.cur .account{padding:10px;border-top:1px solid #2a2a2d;font-size:12px;color:#9a9a9f;display:flex;flex-direction:column;gap:2px}
.cur .account b{color:#e8e8e8;font-weight:500}
.cur .main{flex:1;display:flex;flex-direction:column;min-width:0}
.cur .top{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid #2a2a2d;min-height:30px}
.cur .top h1{margin:0;font-size:18px;font-weight:600}
.cur .chips{display:flex;align-items:center;gap:8px}
.cur .chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:10px;background:#2c2c2e;font-size:12px;white-space:nowrap}
.cur .chip.ok{background:#1e8e3e} .cur .chip.rec{background:#b3261e}
.cur .dot{width:8px;height:8px;border-radius:50%;background:#34c759;display:inline-block}
.cur .chip .bar{display:inline-block;width:70px;height:6px;background:#3a3a3d;border-radius:3px;overflow:hidden}
.cur .chip .bar i{display:block;height:100%;width:62%;background:linear-gradient(90deg,#1e8e3e,#34c759 55%,#ffd60a 80%,#ff453a)}
.cur .toolbar{display:flex;gap:8px;padding:12px 20px 0;align-items:center}
.cur .btn{font:inherit;background:#3a3a3d;color:#fff;border:0;border-radius:6px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.cur .btn.primary{background:#0a84ff} .cur .btn.danger{background:#b3261e} .cur .btn.ghost{background:transparent;border:1px solid #3a3a3d}
.cur .btn.small{padding:3px 9px;font-size:12px}
.cur .btn svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.cur .muted{color:#9a9a9f}
.cur kbd{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#2c2c2e;padding:1px 6px;border-radius:4px}
.cur .body{display:flex;gap:14px;padding:14px 20px;flex:1;min-height:0;overflow:hidden}
.cur .col{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0}
.cur .ui{color:#e8e8e8;background:#1c1c1e;border-radius:12px;padding:12px 14px;flex:none}
.cur .ui h3{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#9a9a9f;display:flex;align-items:center;gap:8px;font-weight:600}
.cur .ui h3 .n{width:18px;height:18px;border-radius:50%;background:#2c2c2e;color:#e8e8e8;display:inline-flex;align-items:center;justify-content:center;font-size:11px;letter-spacing:0}
.cur .row{display:grid;grid-template-columns:130px 1fr;align-items:center;gap:8px;margin:5px 0}
.cur .row.r4{grid-template-columns:130px 1fr auto auto}
.cur .row label{color:#c8c8cc}
.cur .in{font:inherit;color:#eee;background:#2c2c2e;border:1px solid #3a3a3d;border-radius:6px;padding:3px 6px;display:flex;align-items:center;width:100%;height:26px;white-space:nowrap}
.cur .in.num{width:66px}
.cur .range{height:4px;background:#3a3a3d;border-radius:2px;position:relative} .cur .range b{position:absolute;left:58%;top:50%;width:14px;height:14px;background:#fff;border-radius:50%;transform:translate(-50%,-50%)}
.cur .fold{color:#9a9a9f;font-size:12px;display:flex;align-items:center;gap:6px;padding:2px 0;margin:6px 0 2px}
.cur .fold::before{content:"";width:6px;height:6px;border-right:1.5px solid #9a9a9f;border-bottom:1.5px solid #9a9a9f;transform:rotate(-45deg)}
.cur .hint{color:#8a8a8f;font-size:11.5px;line-height:1.35;margin:-2px 0 4px}
.cur .tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;background:#2c2c2e;color:#cbd5e1} .cur .tag.done{background:#14532d;color:#bbf7d0}
.cur .stage{background:#000;border-radius:10px;aspect-ratio:16/9;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding:14px 26px;gap:8px;font-family:"PingFang SC","Hiragino Sans GB","Noto Sans TC",sans-serif;font-weight:700;color:#fff;text-align:center;overflow:hidden}
.cur .stage .l{font-size:27px;line-height:1.25} .cur .stage .l.old{opacity:.55} .cur .stage .l .s{display:block;font-size:13px;font-weight:500;opacity:.72}
.cur .preview .p{margin:6px 0;padding-bottom:6px;border-bottom:1px solid #2c2c2e;font-size:15px} .cur .preview .s{color:#9a9a9f;font-size:13px} .cur .preview .p.partial{opacity:.7}
.cur .qr{width:96px;height:96px;background:#fff;border-radius:6px;padding:4px;flex:none}
.cur .check{width:16px;height:16px;border-radius:3px;background:#0a84ff}
`;
  const body = `<div class="cur">
  <div class="tl"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
  <nav class="side">
    <div class="brand"><svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:none;stroke:#0a84ff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="M7 15h10M7 11h6"></path></svg><span>See Subtitles</span></div>
    <div class="nav active">${svgI(ICON.mic)}<span>Live</span></div>
    <div class="nav">${svgI(ICON.files)}<span>Files</span></div>
    <div class="grow"></div>
    <div class="nav">${svgI(ICON.gear)}<span>Settings</span></div>
    <div class="account"><b>alex@seesubtitles.com</b><span>seesubtitles.com · sharing</span></div>
  </nav>
  <main class="main">
    <div class="top"><h1>Live</h1><div class="chips"><span class="chip ok"><i class="dot"></i>Tencent connected · ap-guangzhou edge</span><span class="chip">Mic <span class="bar"><i></i></span> −23 dB</span><span class="chip rec"><i class="dot" style="background:#fff"></i>Recording 12:04</span></div><div class="grow"></div><span class="btn ghost">${svgI(ICON.display)}Display window</span><span class="btn ghost">${svgI(ICON.overlay)}Overlay window</span></div>
    <div class="toolbar"><span class="btn primary">■ Stop recording</span><span class="btn">Stop sharing</span><span class="btn">Pause subtitles</span><span class="btn">Clear screen</span><span class="muted">Shortcuts: <kbd>⇧⌘R</kbd> record · <kbd>P</kbd> pause · <kbd>X</kbd> clear · <kbd>+</kbd>/<kbd>−</kbd> text size</span></div>
    <div class="body">
      <div class="col" style="width:600px;flex:none">
        <div class="ui"><h3><span class="n">1</span>Source</h3>
          <div class="row"><label>Audio device</label><span class="in">MacBook Pro Microphone</span></div>
          <div class="row"><label>Spoken language</label><span class="in">粤语 (Cantonese)</span></div>
          <div class="row"><label>Subtitles in</label><span class="in">中文 (简体)</span></div>
          <div class="row"><label>Translation model</label><span class="in">大模型 (LLM)</span></div>
          <div class="fold">Recognition tuning: hotwords, pause length, forced split, filler words, noise</div>
          <div class="fold">Rehearse with an audio file instead of the microphone</div>
          <div class="fold">Connection details</div></div>
        <div class="ui"><h3><span class="n">2</span>Subtitle look</h3>
          <div class="row"><label>Presets</label><div><span class="in">Landscape bar</span><div style="display:flex;gap:6px;margin-top:6px"><span class="btn primary small">Apply</span><span class="btn small">Save current as…</span><span class="btn small">Update</span><span class="btn danger small">Delete</span></div></div></div>
          <div class="row"><label>Show</label><span class="in">translation + original</span></div>
          <div class="row r4"><label>Text size</label><span class="range"><b></b></span><span class="in num">140</span><span class="muted">px</span></div>
          <div class="fold">Text, layout and background</div></div>
        <div class="ui"><h3><span class="n">3</span>Where it shows</h3>
          <div class="row"><label>Display window</label><div style="display:flex;gap:6px;align-items:center"><span class="tag done">open · full screen</span><span class="btn small">Show</span><span class="btn small">Full screen</span></div></div>
          <div class="row"><label>Overlay window</label><span class="in">none</span></div>
          <div class="row"><label>Show status</label><span class="check"></span></div>
          <div class="row" style="align-items:start"><label>Share link</label><div style="display:flex;gap:10px"><div class="qr"><svg viewBox="0 0 21 21" width="88" height="88" shape-rendering="crispEdges"><path fill="#111" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM8 0h1v1H8zM10 0h2v2h-2zM8 2h2v1H8zM11 3h1v2h-1zM9 4h1v2H9zM12 5h1v1h-1zM8 7h2v1H8zM11 7h1v1h-1zM13 8h1v1h-1zM0 8h1v1H0zM2 8h2v1H2zM5 8h2v1H5zM9 9h2v1H9zM12 9h2v2h-2zM16 8h1v1h-1zM18 8h2v1h-2zM3 10h1v1H3zM6 10h2v1H6zM15 10h1v1h-1zM17 10h1v2h-1zM19 10h2v1h-2zM1 11h1v1H1zM4 12h2v1H4zM8 11h1v2H8zM10 12h1v1h-1zM13 12h1v2h-1zM15 12h1v1h-1zM19 12h1v1h-1zM9 14h2v1H9zM12 14h1v1h-1zM14 14h2v1h-2zM17 14h2v1h-2zM20 14h1v1h-1zM8 16h1v1H8zM10 16h2v2h-2zM13 16h1v1h-1zM16 16h1v1h-1zM18 16h3v1h-3zM9 18h1v1H9zM12 18h1v1h-1zM14 18h1v2h-1zM17 18h1v1h-1zM19 18h2v1h-2zM8 20h2v1H8zM11 20h2v1h-2zM16 20h1v1h-1zM18 20h1v1h-1z"/></svg></div><div style="flex:1;display:flex;flex-direction:column;gap:6px"><div style="display:flex;gap:6px"><span class="in">https://seesubtitles.com/d/K7Q2</span><span class="btn small">Copy</span><span class="btn small">Show QR large</span><span class="btn small">Stop</span></div><div class="hint">1284 events sent · attendees scan the code or type the link</div></div></div></div>
          <div class="hint" style="margin-left:138px">Phones and venue screens open the link and follow along. Audio stays on this Mac.</div></div>
        <div class="ui"><h3><span class="n">4</span>Recording</h3>
          <div class="row"><label>This talk</label><div style="display:flex;gap:10px;align-items:center"><span class="btn small">■ Stop</span><span>12:04 · 18.4 MB · 141 cues</span></div></div>
          <div class="row"><label>Saves to</label><span class="muted">/Users/alex/Movies/See Subtitles · MP4 after recording: on</span></div></div>
      </div>
      <div class="col" style="flex:1">
        <div class="ui" style="padding:10px"><h3>Now showing</h3><div class="stage"><div class="l old">首先是現場的觀眾，他們可以用手機掃二維碼。</div><div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div></div></div>
        <div class="ui preview" style="flex:1;overflow:hidden"><h3>Transcript</h3><div class="hint">Saved with the recording; download the subtitle files under Files.</div>
          <div class="p"><div class="s">14:01:48</div><div>大家好，歡迎來到今天的分享。</div><div class="s">大家好，歡迎嚟到今日嘅分享。</div></div>
          <div class="p"><div class="s">14:02:11</div><div>今天我們會講一下如何用字幕幫助更多人參與會議。</div><div class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</div></div>
          <div class="p"><div class="s">14:02:19</div><div>首先是現場的觀眾，他們可以用手機掃二維碼。</div><div class="s">首先係現場嘅觀眾，佢哋可以用手機掃個二維碼。</div></div>
          <div class="p partial"><div class="s">14:02:27</div><div>然後我們會演示…</div><div class="s">然後我哋會示範…</div></div></div>
        <div class="ui" style="padding:8px 14px"><div class="fold" style="margin:0">Activity log <span class="muted" style="margin-left:6px">last: 14:02:03 connected to ap-guangzhou</span></div></div>
      </div>
    </div>
  </main>
</div>`;
  return page({ fontLink: null, css, body });
}

// ---------------------------------------------------------------------------------------------- icon sheet
export function iconSheet() {
  const stories = {
    stack: ['Stack', 'The bilingual pair: a long bright line over a shorter, quieter one, at the foot of an empty screen. It is the product itself, and it survives 16 px.'],
    eye: ['Eye-line', 'An upper lid and a pupil over a subtitle bar, the bar doubling as the lower lid: "see" made literal. Friendlier, less generic than a caption box.'],
    bracket: ['Bracket', 'The corner quote 「 that Cantonese and Traditional Chinese text uses, framing a subtitle line. Typographic and rooted in the language.'],
  };
  const neutral = { stack: { tile: '#1a1918', top: '#ffffff', bottom: '#ffffff' }, eye: { tile: '#1a1918', ink: '#ffffff' }, bracket: { tile: '#1a1918', ink: '#ffffff' } };
  const inDirection = (concept, d) => {
    const t = primaryTokens(d);
    const m = d.mark;
    const ink = m.ink || m.top || '#fff';
    const mono = t.accent === t.fg; // Daylight: no brand colour, the second bar is the same ink, quieter
    if (concept === 'stack') return CONCEPTS.stack({ tile: m.tile, top: ink, bottom: mono ? ink : (m.bottom || t.accent), bottomOpacity: mono ? 0.6 : 1, dot: m.dot || null, size: 64 });
    return CONCEPTS[concept]({ tile: m.tile, ink, bar: concept === 'eye' && d.key === 'marquee' ? t.accent : null, size: 64 });
  };
  const css = NEUTRAL_CSS + `
.nb{width:1200px;min-height:1260px}
.crow{display:grid;grid-template-columns:260px 160px repeat(3,80px) 1fr;gap:24px;align-items:center;padding:22px 0;border-bottom:1px solid var(--line)}
.crow .nm{font-weight:600;font-size:16px;margin-bottom:4px} .crow .st{font-size:12.5px;color:var(--fg-2);line-height:1.45}
.crow .sz{display:flex;flex-direction:column;align-items:center;gap:8px;font:11px var(--mono);color:var(--fg-3)}
.menubar{display:flex;align-items:center;gap:12px;height:26px;padding:0 10px;border-radius:5px;font:500 12px -apple-system,system-ui,sans-serif;white-space:nowrap}
.menubar.lt{background:#e8e8ea;color:#111} .menubar.dk{background:#2b2b2e;color:#f0f0f0}
.mix{display:grid;grid-template-columns:120px repeat(3,minmax(0,1fr));gap:10px 18px;align-items:center}
.mix .h{font:600 11px/1 var(--ui);letter-spacing:.1em;text-transform:uppercase;color:var(--fg-3)}
.mix .c{display:flex;gap:14px;align-items:center;padding:12px;border-radius:10px;border:1px solid var(--line)}
.mix .c span{font-size:12px;color:var(--fg-2)}
.notes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 28px;font-size:13px;color:var(--fg-2)}
.notes code{font:12px var(--mono);color:var(--fg);background:var(--surface-2);padding:1px 5px;border-radius:4px}
`;
  const body = `<div class="nb">
  <div class="sec" style="gap:12px"><h1>App icon · three concepts</h1><p class="lead">All three are bottom-weighted: the empty upper part is the screen, the mark is what appears at its foot. Shown at the dock size, then at the sizes Finder and the menu bar actually use.</p></div>
  <div class="sec"><h2>Concepts</h2>
    ${Object.entries(stories).map(([k, [name, story]]) => `<div class="crow">
      <div><div class="nm">${name}</div><div class="st">${story}</div></div>
      <div class="sz">${CONCEPTS[k]({ ...neutral[k], size: 160 })}<span>1024</span></div>
      <div class="sz">${CONCEPTS[k]({ ...neutral[k], size: 64 })}<span>64</span></div>
      <div class="sz">${CONCEPTS[k]({ ...neutral[k], size: 32 })}<span>32</span></div>
      <div class="sz">${CONCEPTS[k]({ ...neutral[k], size: 16 })}<span>16</span></div>
      <div style="display:flex;flex-direction:column;gap:6px"><div class="menubar lt">${tray({ color: '#000', size: 18, concept: k })}<span>字幕</span><span style="opacity:.5">Wed 14:02</span></div><div class="menubar dk">${tray({ color: '#fff', size: 18, concept: k })}<span>字幕</span><span style="opacity:.5">Wed 14:02</span></div><span class="hint" style="font-size:11.5px">menu bar, template image</span></div>
    </div>`).join('')}
  </div>
  <div class="sec"><h2>In each direction's colours</h2>
    <div class="mix"><span></span>${Object.values(DIRECTIONS).map((d) => `<span class="h">${d.letter} · ${d.name}</span>`).join('')}
    ${Object.keys(stories).map((k) => `<span class="h">${stories[k][0]}</span>${Object.values(DIRECTIONS).map((d) => `<div class="c">${inDirection(k, d)}<span>${d.mark.concept === k ? 'default for this direction' : ''}</span></div>`).join('')}`).join('')}
    </div>
  </div>
  <div class="sec"><h2>Production</h2>
    <div class="notes">
      <div>App icon: one 1024 × 1024 PNG with the 100 px transparent margin, as <code>desktop/build/icon.png</code>; electron-builder writes the icns from it.</div>
      <div>Menu bar: <code>trayTemplate.png</code> and <code>trayTemplate@2x.png</code> at 22 × 22 and 44 × 44, black on transparent, loaded with <code>nativeImage</code> as a template image, replacing the empty image the tray uses today.</div>
      <div>Dock badge and the About window use the same PNG. The Display and Overlay windows keep no icon of their own.</div>
      <div>The sidebar and hosted pages use the same SVG inline, 22 px in the sidebar and 18 px on the phone page, so the mark is identical everywhere.</div>
    </div>
  </div>
</div>`;
  return page({ fontLink: null, css, body });
}


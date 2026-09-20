// See Subtitles for iPhone and iPad in Marquee: every screen and state of docs/IOS.md.
// One stylesheet scoped under .ios, one body fragment per screen. build.mjs wraps each fragment as an artboard
// for the canvas's iOS page; build-ios-review.mjs lays them all out on one page for review in a browser.
// Type on iOS is the system's (SF Pro, PingFang SC) so Dynamic Type and VoiceOver behave; Instrument Serif is
// kept for the wordmark only. Sample text is Simplified Chinese, like every string the product shows.
import { page, markSvg } from './lib.mjs';
import { DIRECTIONS, cssVars } from './tokens.mjs';

const M = DIRECTIONS.marquee;
const SYS = { ...M.fonts, ui: '-apple-system, "SF Pro Text"', cjk: '"PingFang SC", "Noto Sans SC"' };
const DARK = cssVars(M.dark, SYS); const LIGHT = cssVars(M.light, SYS);
export const fontLink = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Noto+Sans+SC:wght@400;500;700&display=swap';
const mark = (size) => markSvg(M, { size });

const I = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  lib: '<path d="M4 5h16M4 12h16M4 19h10"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  aa: '<path d="M3 18 8 6l5 12M5 14h6M15 18l3-7 3 7M16 16h4"/>',
  bubble: '<path d="M4 5h16v11H9l-5 4z"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4M5 12v7h14v-7"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  down: '<path d="M12 5v13M6 13l6 6 6-6"/>',
  spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/>',
  cloud: '<path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.3A4.5 4.5 0 0 1 17 18z"/>',
  lock: '<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  ear: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
};
const i = (name, cls = '') => `<svg viewBox="0 0 24 24" class="ic ${cls}">${I[name]}</svg>`;

export const IOS_CSS = `
.ios,.ios *{box-sizing:border-box}
.ios{${DARK}position:relative;width:390px;height:844px;background:var(--bg);color:var(--fg);font:17px/1.35 var(--ui),var(--cjk),sans-serif;display:flex;flex-direction:column;overflow:hidden;-webkit-font-smoothing:antialiased}
.ios.light{${LIGHT}}
.ios.land{width:844px;height:390px}
.ios.pad{width:1180px;height:820px}
.ios .ic{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.ios .ic.s{width:17px;height:17px} .ios .ic.l{width:28px;height:28px}
.ios .sb{height:54px;flex:none;display:flex;align-items:flex-end;justify-content:space-between;padding:0 30px 8px;font:600 16px var(--ui);position:relative}
.ios .sb::before{content:"";position:absolute;left:50%;top:11px;width:124px;height:36px;margin-left:-62px;border-radius:20px;background:#000}
.ios .sb .r{display:flex;gap:5px;align-items:center;font-size:12px}
.ios .sb .bat{width:25px;height:12px;border-radius:3.5px;border:1px solid currentColor;opacity:.9;position:relative}
.ios .sb .bat::after{content:"";position:absolute;inset:1.5px;right:5px;border-radius:2px;background:currentColor}
.ios .home{height:34px;flex:none;position:relative} .ios .home::after{content:"";position:absolute;left:50%;bottom:8px;width:136px;height:5px;margin-left:-68px;border-radius:3px;background:var(--fg);opacity:.85}
.ios .tabs{flex:none;display:flex;border-top:1px solid var(--line);background:var(--side);padding:7px 0 0}
.ios .tabs span{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;font:500 10.5px var(--ui);color:var(--fg-3)} .ios .tabs .on{color:var(--accent-text)}
.ios .tabs+.home{background:var(--side)}
.ios h1{margin:0;font:700 30px/1.15 var(--ui),var(--cjk)} .ios h2{margin:0;font:600 17px/1.3 var(--ui),var(--cjk)}
.ios .top{flex:none;display:flex;align-items:center;gap:10px;padding:6px 18px 10px;min-height:44px}
.ios .top .grow{flex:1;min-width:0} .ios .top .act{color:var(--accent-text);font-weight:500}
.ios .pair{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:18px;background:var(--surface);border:1px solid var(--line);font:500 15px var(--ui),var(--cjk)}
.ios .pair b{color:var(--fg-3);font-weight:400}
.ios .st{display:inline-flex;align-items:center;gap:7px;font:15px var(--ui),var(--cjk);color:var(--fg-2)}
.ios .st i{width:8px;height:8px;border-radius:50%;background:var(--fg-3);flex:none} .ios .st.ok i{background:var(--ok)} .ios .st.warn i{background:var(--warn)} .ios .st.bad i{background:var(--bad)} .ios .st.rec i{background:var(--rec);box-shadow:0 0 0 4px rgba(255,69,58,.18)}
.ios .st .t{font-family:var(--mono);font-size:14px;color:var(--fg)}
.ios .reader{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-end;gap:20px;padding:0 22px 18px;overflow:hidden;position:relative}
.ios .reader.fade::before{content:"";position:absolute;left:0;right:0;top:0;height:90px;background:linear-gradient(var(--bg),transparent);z-index:1}
.ios .line .tr{font:600 25px/1.34 var(--cjk),var(--ui)} .ios .line .or{margin-top:5px;font:400 16px/1.4 var(--cjk),var(--ui);color:var(--fg-3)}
.ios .line.old .tr{color:var(--fg-2)} .ios .line.draft .tr{color:var(--fg-2)} .ios .line.draft .tr::after{content:"";display:inline-block;width:9px;height:9px;margin-left:8px;border-radius:50%;background:var(--accent);vertical-align:middle}
.ios .line .ts{font:12px var(--mono);color:var(--fg-3);margin-bottom:3px}
.ios .line.mine{align-self:flex-end;max-width:82%;padding:10px 14px;border-radius:16px 16px 4px 16px;background:var(--accent-soft);border:1px solid var(--line)} .ios .line.mine .tr{font-size:19px;color:var(--fg)} .ios .line.mine .ts{color:var(--accent-text)}
.ios .bar{flex:none;display:flex;align-items:center;gap:12px;padding:12px 18px 6px;border-top:1px solid var(--line);background:var(--bg)}
.ios .btn{height:50px;padding:0 20px;border-radius:14px;border:1px solid var(--line-strong);background:var(--surface);color:var(--fg);font:600 17px var(--ui),var(--cjk);display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap}
.ios .btn.primary{background:var(--accent);color:var(--accent-fg);border-color:transparent} .ios .btn.wide{flex:1} .ios .btn.sq{width:50px;padding:0} .ios .btn.stop{background:var(--surface);color:var(--fg)} .ios .btn.stop::before{content:"";width:14px;height:14px;border-radius:3px;background:var(--rec)}
.ios .btn.quiet{border-color:transparent;background:transparent;color:var(--accent-text);font-weight:500} .ios .btn.on{border-color:var(--rec);color:var(--fg)} .ios .btn.sm{height:38px;border-radius:10px;font-size:15px;padding:0 14px}
.ios .hint{font:13px/1.45 var(--ui),var(--cjk);color:var(--fg-3)} .ios .sec{font:15px/1.4 var(--ui),var(--cjk);color:var(--fg-2)}
.ios .empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:0 36px}
.ios .empty .big{font:400 italic 34px/1.1 "Instrument Serif",serif;color:var(--fg)}
.ios .pill{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:2;display:flex;align-items:center;gap:6px;height:38px;padding:0 16px;border-radius:19px;background:var(--accent);color:var(--accent-fg);font:600 15px var(--ui);box-shadow:0 6px 20px rgba(0,0,0,.4);white-space:nowrap}
.ios .scrim{position:absolute;inset:0;background:rgba(0,0,0,.5)}
.ios .sheet{position:absolute;left:0;right:0;bottom:0;background:var(--surface);border-radius:22px 22px 0 0;padding:10px 20px 40px;display:flex;flex-direction:column;gap:16px;box-shadow:0 -10px 40px rgba(0,0,0,.35)}
.ios .sheet .grab{align-self:center;width:38px;height:5px;border-radius:3px;background:var(--line-strong)}
.ios .seg{display:flex;padding:3px;border-radius:11px;background:var(--surface-2);font:500 14px var(--ui),var(--cjk)} .ios .seg span{flex:1;text-align:center;padding:8px 4px;border-radius:9px;color:var(--fg-2)} .ios .seg .on{background:var(--bg);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.25)}
.ios .slider{display:flex;align-items:center;gap:12px} .ios .slider .trk{flex:1;height:5px;border-radius:3px;background:var(--surface-2);position:relative} .ios .slider .trk i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--accent)} .ios .slider .trk b{position:absolute;top:-11px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.ios .tog{width:51px;height:31px;border-radius:16px;background:var(--surface-2);position:relative;flex:none} .ios .tog::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.3)} .ios .tog.on{background:var(--ok)} .ios .tog.on::after{left:22px}
.ios .list{margin:0 16px;border-radius:14px;background:var(--surface);overflow:hidden} .ios .grp{padding:18px 32px 7px;font:13px var(--ui);color:var(--fg-3);text-transform:uppercase;letter-spacing:.04em}
.ios .row{display:flex;align-items:center;gap:12px;min-height:50px;padding:9px 16px;position:relative} .ios .row+.row::before{content:"";position:absolute;left:16px;right:0;top:0;height:1px;background:var(--line)}
.ios .row .grow{flex:1;min-width:0} .ios .row .v{color:var(--fg-3);font-size:16px;white-space:nowrap} .ios .row .ic.c{color:var(--fg-3);width:16px;height:16px} .ios .row.act{color:var(--accent-text)} .ios .row.del{color:var(--bad)}
.ios .stack .a{font:500 17px/1.3 var(--ui),var(--cjk);white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .ios .stack .b{margin-top:2px;font:14px/1.35 var(--ui),var(--cjk);color:var(--fg-3);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ios .bdg{font:600 10.5px var(--ui);letter-spacing:.03em;padding:2px 6px;border-radius:5px;background:var(--accent-soft);color:var(--accent-text)} .ios .bdg.n{background:var(--surface-2);color:var(--fg-2)}
.ios .field{height:50px;border-radius:12px;border:1px solid var(--line-strong);background:var(--surface);display:flex;align-items:center;padding:0 14px;color:var(--fg)} .ios .field.ph{color:var(--fg-3)} .ios .field.focus{border-color:var(--accent)}
.ios .searchf{margin:0 16px 10px;height:38px;border-radius:11px;background:var(--surface-2);display:flex;align-items:center;gap:7px;padding:0 10px;color:var(--fg-3);font-size:16px;flex:none}
.ios .scroll{flex:1;min-height:0;overflow:hidden}
.ios .card{margin:0 16px;padding:18px;border-radius:16px;background:var(--surface);border:1px solid var(--line);display:flex;flex-direction:column;gap:12px}
.ios .tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px} .ios .tile{padding:12px 14px;border-radius:12px;background:var(--surface-2)} .ios .tile .n{font:600 22px var(--ui);font-variant-numeric:tabular-nums} .ios .tile .n small{font:400 14px var(--ui);color:var(--fg-3)} .ios .tile .m{height:4px;border-radius:2px;background:var(--line);margin-top:8px;overflow:hidden} .ios .tile .m i{display:block;height:100%;background:var(--accent)}
.ios .player{flex:none;padding:4px 20px 14px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid var(--line)}
.ios .scrub{height:5px;border-radius:3px;background:var(--surface-2);position:relative} .ios .scrub i{position:absolute;left:0;top:0;bottom:0;width:34%;border-radius:3px;background:var(--fg-2)} .ios .scrub b{position:absolute;left:34%;top:-5px;width:15px;height:15px;margin-left:-7px;border-radius:50%;background:var(--fg)}
.ios .times{display:flex;justify-content:space-between;font:12px var(--mono);color:var(--fg-3)}
.ios .ctl{display:flex;align-items:center;justify-content:center;gap:34px} .ios .ctl .pp{width:56px;height:56px;border-radius:50%;background:var(--fg);color:var(--bg);display:flex;align-items:center;justify-content:center} .ios .ctl .sk{font:600 13px var(--ui);color:var(--fg-2);width:44px;text-align:center} .ios .ctl .sp{font:600 14px var(--ui);color:var(--fg-2)}
.ios .tline{display:grid;grid-template-columns:48px 1fr;gap:10px;padding:10px 20px} .ios .tline .ts{font:12.5px var(--mono);color:var(--fg-3);padding-top:4px} .ios .tline .tr{font:500 18px/1.4 var(--cjk),var(--ui)} .ios .tline .or{font:15px/1.4 var(--cjk);color:var(--fg-3);margin-top:3px} .ios .tline.now{background:var(--accent-soft)} .ios .tline.now .ts{color:var(--accent-text)}
.ios .md{padding:4px 22px;font:16px/1.55 var(--cjk),var(--ui)} .ios .md h3{margin:18px 0 6px;font:600 19px/1.3 var(--cjk),var(--ui)} .ios .md h4{margin:16px 0 6px;font:600 16px/1.35 var(--cjk);color:var(--fg)} .ios .md p{margin:0 0 10px;color:var(--fg-2)} .ios .md ul{margin:0;padding-left:20px;color:var(--fg-2)} .ios .md li{margin-bottom:7px} .ios .md b{color:var(--fg)} .ios .md .tsl{font:12.5px var(--mono);color:var(--accent-text);white-space:nowrap}
.ios .prog{height:4px;border-radius:2px;background:var(--surface-2);overflow:hidden} .ios .prog i{display:block;height:100%;background:var(--accent)}
.ios .cam{flex:1;background:#0b0b0a;position:relative;display:flex;align-items:center;justify-content:center;color:#fff} .ios .cam .frame{width:230px;height:230px;border-radius:26px;box-shadow:0 0 0 2000px rgba(0,0,0,.55);border:3px solid var(--accent)}
.ios .lockscr{flex:1;display:flex;flex-direction:column;align-items:center;background:linear-gradient(160deg,#2b2926,#0e0d0c 70%);color:#fff;padding-top:18px}
.ios .lockscr .clock{font:600 86px/1 var(--ui);letter-spacing:-.02em;margin-top:6px} .ios .lockscr .date{font:500 20px var(--ui);opacity:.85}
.ios .la{width:358px;margin-top:auto;margin-bottom:96px;border-radius:24px;background:rgba(33,32,29,.92);padding:14px 16px;display:grid;gap:8px;color:#f1ece2} .ios .la .hd{display:flex;align-items:center;gap:8px;font:600 14px var(--ui)} .ios .la .hd svg{width:20px;height:20px;border-radius:5px} .ios .la .tx{font:600 18px/1.35 var(--cjk)} .ios .la .ft{display:flex;align-items:center;justify-content:space-between}
.ios .island{position:absolute;left:50%;top:11px;width:250px;height:37px;margin-left:-125px;border-radius:20px;background:#000;display:flex;align-items:center;justify-content:space-between;padding:0 12px;font:600 14px var(--mono);color:#fff;z-index:3} .ios .island .d{width:9px;height:9px;border-radius:50%;background:#ff453a}
.ios .shown{flex:1;display:flex;align-items:center;justify-content:center;padding:26px;background:#000;color:#fff;font:700 64px/1.2 var(--cjk);text-align:center}
.ios .split{flex:1;min-height:0;display:grid;grid-template-columns:360px 1fr} .ios .split>div{min-height:0;display:flex;flex-direction:column;overflow:hidden} .ios .split .side{background:var(--side);border-right:1px solid var(--line)}
`;

const sb = (extra = '') => `<div class="sb"><span>9:41</span>${extra}<span class="r">5G<span class="bat"></span></span></div>`;
const home = '<div class="home"></div>';
const tabs = (on) => `<div class="tabs">${[['mic', 'Live'], ['lib', 'Library'], ['gear', 'Settings']].map(([ic, n]) => `<span class="${n === on ? 'on' : ''}">${i(ic)}${n}</span>`).join('')}</div>${home}`;
const pair = '<span class="pair">粤语 <b>→</b> 普通话 ' + i('chev', 's') + '</span>';
const L = {
  a: ['大家好，欢迎来到今天的分享。', '大家好，欢迎嚟到今日嘅分享。'],
  b: ['首先是现场的观众，他们可以用手机扫二维码。', '首先系现场嘅观众，佢哋可以用手机扫二维码。'],
  c: ['今天我们会讲一下如何用字幕帮助更多人参与会议。', '今日我哋会讲吓点样用字幕帮助更多人参与会议。'],
  d: ['字幕不只是给听不见的人', '字幕唔只系畀听唔到嘅人'],
};
const line = ([tr, or], cls = '', ts = '') => `<div class="line ${cls}">${ts ? `<div class="ts">${ts}</div>` : ''}<div class="tr">${tr}</div><div class="or">${or}</div></div>`;
const frame = (cls, inner) => `<div class="ios ${cls}">${inner}</div>`;

// ------------------------------------------------------------------------------------------------ screens
const login = () => frame('', `${sb()}
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:14px;padding:0 28px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">${mark(44)}<span style="font:400 italic 34px 'Instrument Serif',serif">See Subtitles</span></div>
    <h2 style="font-size:22px">Log in</h2>
    <div class="field">alex@example.com</div>
    <div class="field focus">••••••••••</div>
    <div class="btn primary" style="width:100%">Log in</div>
    <div class="hint" style="text-align:center">Accounts are opened at seesubtitles.com.<br>账号在 seesubtitles.com 申请开通。</div>
  </div>
  <div style="padding:0 28px 8px;text-align:center"><span class="btn quiet sm">${i('qr', 's')} Join a talk with a code</span></div>${home}`);

const firstMic = () => frame('', `${sb()}
  <div class="empty" style="justify-content:flex-end;padding-bottom:40px;align-items:flex-start;text-align:left">
    <span style="width:64px;height:64px;border-radius:20px;background:var(--accent-soft);color:var(--accent-text);display:flex;align-items:center;justify-content:center">${i('mic', 'l')}</span>
    <h1>The microphone is how subtitles begin</h1>
    <div class="sec">See Subtitles listens while a talk is running, sends the sound to be recognised, and keeps the recording on this phone.</div>
    <div class="hint">Nothing is heard before you press Start.</div>
  </div>
  <div style="padding:0 20px 8px;display:grid;gap:8px"><div class="btn primary">Allow the microphone</div><div class="btn quiet">Not now</div></div>
  <div style="display:flex;justify-content:center;gap:7px;padding:6px 0 4px"><i style="width:7px;height:7px;border-radius:50%;background:var(--fg-3)"></i><i style="width:7px;height:7px;border-radius:50%;background:var(--accent)"></i><i style="width:7px;height:7px;border-radius:50%;background:var(--fg-3)"></i></div>${home}`);

const firstLang = () => frame('', `${sb()}
  <div class="top"><div class="grow"><h1>Two languages</h1></div></div>
  <div class="scroll">
    <div class="grp">Spoken in the room</div>
    <div class="list"><div class="row"><span class="grow">粤语 <span class="v">Cantonese</span></span><span style="color:var(--accent-text)">✓</span></div><div class="row"><span class="grow">普通话 <span class="v">Mandarin</span></span></div><div class="row"><span class="grow">English</span></div><div class="row"><span class="grow">日本語 <span class="v">Japanese</span></span></div><div class="row act">6 more…</div></div>
    <div class="grp">Subtitles in</div>
    <div class="list"><div class="row"><span class="grow">普通话 <span class="v">Mandarin</span></span><span style="color:var(--accent-text)">✓</span></div><div class="row"><span class="grow">English</span></div><div class="row"><span class="grow">粤语 <span class="v">words as spoken</span></span></div></div>
    <div class="hint" style="padding:10px 32px">Only pairs that connect are offered. Change them any time from the top of Live.</div>
  </div>
  <div style="padding:0 20px 8px"><div class="btn primary" style="width:100%">Done</div></div>${home}`);

const liveIdle = () => frame('', `${sb()}
  <div class="top"><div class="grow">${pair}</div><span class="st ok"><i></i>ready</span></div>
  <div class="empty"><div class="big">Ready when the room is.</div><div class="sec">Put the phone where it can hear the speaker.</div><span class="btn quiet sm">${i('qr', 's')} Join a talk</span></div>
  <div class="bar"><span class="btn sq on" title="Record">${'<i style="width:16px;height:16px;border-radius:50%;background:var(--rec)"></i>'}</span><span class="btn primary wide">Start</span><span class="btn sq">${i('aa')}</span></div>
  <div class="hint" style="text-align:center;padding:2px 0 6px">Recording is on · 6 h 12 min of live hours left</div>${tabs('Live')}`);

const liveListening = (light = '') => frame(light, `${sb()}
  <div class="top"><div class="grow">${pair}</div><span class="st rec"><i></i>recording <span class="t">12:41</span></span></div>
  <div class="reader fade">${line(L.a, 'old')}${line(L.b, 'old')}${line(L.c)}${line(L.d, 'draft')}</div>
  <div class="bar"><span class="btn stop wide">Stop</span><span class="btn sq">${i('bubble')}</span><span class="btn sq">${i('aa')}</span></div>${tabs('Live')}`);

const liveBack = () => frame('', `${sb()}
  <div class="top"><div class="grow">${pair}</div><span class="st rec"><i></i>recording <span class="t">12:58</span></span></div>
  <div class="reader" style="justify-content:flex-start;padding-top:6px">${line(L.a, '', '00:04')}${line(L.b, '', '00:11')}${line(L.c, '', '00:19')}${line(['第二，是会后想重温内容的人。', '第二，系会后想重温内容嘅人。'], '', '00:27')}<span class="pill">${i('down', 's')} 4 new · Jump to latest</span></div>
  <div class="bar"><span class="btn stop wide">Stop</span><span class="btn sq">${i('bubble')}</span><span class="btn sq">${i('aa')}</span></div>${tabs('Live')}`);

const liveReply = () => frame('', `${sb()}
  <div class="top"><div class="grow">${pair}</div><span class="st rec"><i></i>recording <span class="t">14:02</span></span></div>
  <div class="reader fade">${line(L.b, 'old')}${line(L.c)}<div class="line mine"><div class="ts">you · 13:40</div><div class="tr">请问可以再讲一次吗？</div></div></div>
  <div class="scrim" style="top:54px"></div>
  <div class="sheet"><span class="grab"></span><h2>Reply</h2>
    <div class="field focus" style="height:96px;align-items:flex-start;padding-top:12px;font-size:19px">我想问一个问题</div>
    <div style="display:flex;gap:8px;overflow:hidden"><span class="btn sm">请问可以再讲一次吗？</span><span class="btn sm">谢谢</span><span class="btn sm">请讲慢一点</span></div>
    <div class="btn primary">Show it large</div>
    <div class="hint">What you type fills the screen so the other person can read it. It is kept with the transcript.</div></div>`);

const liveShown = () => frame('', `${sb()}<div class="shown">我想问一个问题</div><div style="background:#000;padding:0 20px 6px;display:flex;gap:10px"><span class="btn wide" style="background:#1c1c1c;color:#fff;border-color:#333">Back to subtitles</span></div><div class="home" style="background:#000"></div>`);

const liveLandscape = () => frame('land', `<div class="reader" style="padding:22px 64px 26px;gap:16px">
    <div class="line old"><div class="tr" style="font-size:34px">${L.b[0]}</div></div>
    <div class="line"><div class="tr" style="font-size:44px;line-height:1.28">${L.c[0]}</div><div class="or" style="font-size:20px">${L.c[1]}</div></div></div>
  <span class="st rec" style="position:absolute;right:64px;top:18px"><i></i><span class="t">12:41</span></span>`);

const stateScreen = (status, body, bar) => frame('', `${sb()}<div class="top"><div class="grow">${pair}</div>${status}</div>${body}${bar}${tabs('Live')}`);
const liveReconnecting = () => stateScreen('<span class="st warn"><i></i>reconnecting</span>',
  `<div class="reader fade">${line(L.a, 'old')}${line(L.b, 'old')}${line(L.c, 'old')}<div class="card" style="margin:0;flex-direction:row;align-items:center"><span class="st warn"><i></i></span><div class="grow"><div style="font-weight:600">Subtitles are paused</div><div class="hint">The recording continues. Trying again in 4 s.</div></div></div></div>`,
  `<div class="bar"><span class="btn stop wide">Stop</span><span class="btn sq">${i('bubble')}</span><span class="btn sq">${i('aa')}</span></div>`);
const liveInterrupted = () => stateScreen('<span class="st warn"><i></i>paused · call</span>',
  `<div class="reader fade">${line(L.b, 'old')}${line(L.c, 'old')}<div class="card" style="margin:0"><div style="font-weight:600">Paused for a phone call</div><div class="hint">The gap is kept as silence so the subtitles stay in time. Listening resumes when the call ends.</div></div></div>`,
  `<div class="bar"><span class="btn stop wide">Stop</span><span class="btn sq">${i('bubble')}</span><span class="btn sq">${i('aa')}</span></div>`);
const liveRefused = () => stateScreen('<span class="st bad"><i></i>not started</span>',
  `<div class="empty"><span class="st bad" style="font-size:17px;color:var(--fg)"><i></i>This plan runs one talk at a time</span><div class="sec">A talk is running on “Alex’s MacBook Pro”. End it there, then start here.<br><span class="hint">此方案同时只能进行一场，请先结束另一场。</span></div></div>`,
  `<div class="bar"><span class="btn sq on"><i style="width:16px;height:16px;border-radius:50%;background:var(--rec)"></i></span><span class="btn primary wide">Try again</span><span class="btn sq">${i('aa')}</span></div>`);
const liveEnded = () => stateScreen('<span class="st"><i></i>ended</span>',
  `<div class="reader fade">${line(L.b, 'old')}${line(L.c, 'old')}<div class="card" style="margin:0"><div class="stack"><div class="a">9月20号14点02分</div><div class="b">47:12 · 1,284 sentences · 粤语 → 普通话</div></div><div style="display:flex;gap:8px"><span class="btn primary wide sm">Open recording</span><span class="btn wide sm">${i('spark', 's')} Summarise</span></div></div></div>`,
  `<div class="bar"><span class="btn sq on"><i style="width:16px;height:16px;border-radius:50%;background:var(--rec)"></i></span><span class="btn primary wide">Start</span><span class="btn sq">${i('aa')}</span></div>`);

const textSheet = () => frame('', `${sb()}
  <div class="top"><div class="grow">${pair}</div><span class="st rec"><i></i>recording <span class="t">12:41</span></span></div>
  <div class="reader" style="justify-content:flex-start;padding-top:8px">${line(L.b, 'old')}${line(L.c)}</div>
  <div class="sheet"><span class="grab"></span><h2>Text</h2>
    <div class="seg"><span>Translation</span><span class="on">Both</span><span>Original</span></div>
    <div class="slider"><span style="font-size:14px;font-weight:600">A</span><span class="trk"><i style="width:58%"></i><b style="left:calc(58% - 13px)"></b></span><span style="font-size:26px;font-weight:600">A</span></div>
    <div class="seg"><span>Regular</span><span class="on">Semibold</span><span>Bold</span></div>
    <div class="row" style="padding:0;min-height:40px"><span class="grow">High contrast<div class="hint">black stage, white text, no fades</div></span><span class="tog"></span></div>
    <div class="row" style="padding:0;min-height:40px"><span class="grow">Tap when a sentence arrives<div class="hint">feel when to look down</div></span><span class="tog on"></span></div></div>`);

const joinScan = () => frame('', `${sb()}
  <div class="top"><span class="act">Cancel</span><div class="grow" style="text-align:center"><h2>Join a talk</h2></div><span style="width:52px"></span></div>
  <div class="cam"><div class="frame"></div><div style="position:absolute;bottom:26px;left:0;right:0;text-align:center;font-size:15px;opacity:.85">Point at the code on the screen</div></div>
  <div style="padding:16px 20px 6px;display:grid;gap:10px"><div class="field ph">or type the code · k7m2xq</div><div class="hint" style="text-align:center">Joining needs no account.</div></div>${home}`);

const joined = () => frame('', `${sb()}
  <div class="top"><div class="grow stack"><div class="a">字幕与共融 讲座</div><div class="b">粤语 → 普通话 · 96 following</div></div><span class="st ok"><i></i>live</span></div>
  <div class="reader fade">${line(L.a, 'old')}${line(L.b, 'old')}${line(L.c)}</div>
  <div class="bar"><span class="btn wide">Leave</span><span class="btn sq">${i('bubble')}</span><span class="btn sq">${i('aa')}</span></div>${home}`);

const joinedEnded = () => frame('', `${sb()}
  <div class="top"><div class="grow stack"><div class="a">字幕与共融 讲座</div><div class="b">ended 14:49</div></div><span class="st"><i></i>ended</span></div>
  <div class="empty">${mark(48)}<h1 style="font-size:26px">这场讲座已经结束</h1><div class="sec">The transcript is saved in your Library.<br>47 minutes · 1,284 sentences</div><span class="btn primary">Open the transcript</span></div>${home}`);

const recRow = (name, meta, badges = '') => `<div class="row"><div class="grow stack"><div class="a">${name}</div><div class="b">${meta}${badges}</div></div>${i('chev', 'c')}</div>`;
const libraryList = () => `<div class="list">
    ${recRow('9月20号14点02分', '粤语 → 中文 · 47:12 · today', '<span class="bdg">summary</span><span class="bdg">MP4</span>')}
    ${recRow('周会 · 产品路线', '普通话 → English · 1:02:40 · yesterday', '<span class="bdg n">re-subtitled</span>')}
    ${recRow('字幕与共融 讲座', '粤语 → 中文 · 47 min · 8 Sep', '<span class="bdg n">joined</span>')}
    ${recRow('9月5号14点33分', '粤语 → 中文 · 31:05 · 5 Sep', '<span class="bdg">summary</span>')}
    ${recRow('9月2号10点15分', '粤语 → 中文 · 12:48 · 2 Sep', '<span class="bdg n">transcript only</span>')}</div>`;
const library = (light = '') => frame(light, `${sb()}
  <div class="top"><div class="grow"><h1>Library</h1></div><span class="act">Select</span></div>
  <div class="searchf">${i('search', 's')} Search recordings and transcripts</div>
  <div class="scroll">${libraryList()}<div class="hint" style="padding:14px 32px">5 recordings · 412 MB on this iPhone · <span style="color:var(--accent-text)">Storage</span></div></div>${tabs('Library')}`);

const libraryEmpty = () => frame('', `${sb()}<div class="top"><div class="grow"><h1>Library</h1></div></div>
  <div class="empty"><div class="big">Nothing recorded yet.</div><div class="sec">A talk you record, or one you join, is kept here with its transcript.</div><span class="btn primary">Start a talk</span></div>${tabs('Library')}`);

const player = `<div class="player"><div class="scrub"><i></i><b></b></div><div class="times"><span>16:02</span><span>-31:10</span></div>
    <div class="ctl"><span class="sp">1×</span><span class="sk">−15</span><span class="pp">${i('pause', 'l')}</span><span class="sk">+15</span><span style="color:var(--fg-2)">${i('share')}</span></div></div>`;
const recTop = (on) => `<div class="top">${i('back')}<div class="grow stack"><div class="a">9月20号14点02分</div><div class="b">粤语 → 中文 · 47:12</div></div><span class="act">•••</span></div>${player}
  <div style="padding:12px 16px 8px"><div class="seg">${['Transcript', 'Summary', 'Files'].map((n) => `<span class="${n === on ? 'on' : ''}">${n}</span>`).join('')}</div></div>`;
const tl = (ts, [tr, or], now = '') => `<div class="tline ${now}"><span class="ts">${ts}</span><div><div class="tr">${tr}</div><div class="or">${or}</div></div></div>`;
const transcriptBody = `${tl('15:48', L.b)}${tl('16:01', L.c, 'now')}${tl('16:09', ['第二，是会后想重温内容的人。', '第二，系会后想重温内容嘅人。'])}<div class="tline"><span class="ts" style="color:var(--accent-text)">16:20</span><div><div class="line mine" style="max-width:100%"><div class="tr">请问可以再讲一次吗？</div></div></div></div>`;
const recTranscript = () => frame('', `${sb()}${recTop('Transcript')}<div class="scroll">${transcriptBody}</div>${tabs('Library')}`);
const summaryBody = `<div class="md"><h3>《用字幕让更多人参与会议》</h3><p>字幕不是给少数人的补救，而是让<b>所有人同时跟上</b>的基础设施；做得好，靠的是现场流程而不是技术本身。</p>
    <h4>字幕服务的是整个房间</h4><ul><li><b>听不清、听不懂、走神</b>的人都在用字幕 <span class="tsl">[03:12]</span></li><li>会后重温的人需要<b>可检索的文字</b> <span class="tsl">[16:09]</span></li></ul>
    <h4>准确来自事先准备</h4><ul><li>把<b>人名和术语</b>提前放进词汇表 <span class="tsl">[22:40]</span></li><li>话筒离讲者<b>一个拳头</b>以内 <span class="tsl">[25:03]</span></li></ul></div>`;
const recSummary = () => frame('', `${sb()}${recTop('Summary')}<div class="scroll">${summaryBody}</div>${tabs('Library')}`);
const recSummaryWriting = () => frame('', `${sb()}${recTop('Summary')}<div class="scroll"><div style="padding:6px 22px 10px;display:grid;gap:8px"><span class="st ok" style="color:var(--fg)"><i></i>Writing the summary…</span><div class="prog"><i style="width:40%"></i></div></div>
    <div class="md"><h3>《用字幕让更多人参与会议》</h3><p>字幕不是给少数人的补救，而是让<b>所有人同时跟上</b>的基础设施；做得好，靠的是</p></div></div>${tabs('Library')}`);
const fileRow = (name, size, ic = 'share') => `<div class="row"><div class="grow stack"><div class="a" style="font-size:16px">${name}</div><div class="b">${size}</div></div>${i(ic, 'c')}</div>`;
const recFiles = () => frame('', `${sb()}${recTop('Files')}<div class="scroll">
    <div class="list">${fileRow('9月20号14点02分录音.m4a', 'audio · 34.1 MB')}${fileRow('9月20号14点02分中文字幕.zh.srt', 'subtitles · 96 KB')}${fileRow('9月20号14点02分粤语字幕.yue.srt', 'subtitles · 101 KB')}${fileRow('9月20号14点02分AI总结.pdf', 'summary · 212 KB')}
      <div class="row"><div class="grow stack"><div class="a" style="font-size:16px">Making the MP4…</div><div class="b" style="display:block"><div class="prog" style="margin-top:6px"><i style="width:62%"></i></div></div></div><span class="v">62%</span></div></div>
    <div class="grp">Do more</div>
    <div class="list"><div class="row act">${i('cloud')}<span class="grow">Re-subtitle in the cloud<div class="hint">fills gaps · uses 47 min of file hours</div></span></div><div class="row act">${i('down')}<span class="grow">Save everything to Files</span></div><div class="row act"><span class="grow">Rename</span></div><div class="row del"><span class="grow">Delete recording</span></div></div></div>${tabs('Library')}`);

const settings = () => frame('', `${sb()}<div class="top"><div class="grow"><h1>Settings</h1></div></div><div class="scroll">
    <div class="card" style="gap:10px"><div class="stack"><div class="a">alex@example.com</div><div class="b">Business · 3 talks at once · 字幕小组</div></div>
      <div class="tiles"><div class="tile"><div class="hint">Live this month</div><div class="n">33:48 <small>/ 40 h</small></div><div class="m"><i style="width:84%"></i></div></div><div class="tile"><div class="hint">Files this month</div><div class="n">4:10 <small>/ 20 h</small></div><div class="m"><i style="width:21%"></i></div></div></div></div>
    <div class="list" style="margin-top:12px"><div class="row"><span class="grow">Devices</span><span class="v">3</span>${i('chev', 'c')}</div><div class="row"><span class="grow">Change password</span>${i('chev', 'c')}</div><div class="row"><span class="grow">Two-factor</span><span class="v">on</span></div></div>
    <div class="grp">Talks</div>
    <div class="list"><div class="row"><span class="grow">Languages</span><span class="v">粤语 → 普通话</span>${i('chev', 'c')}</div><div class="row"><span class="grow">Glossary</span><span class="v">42 terms</span>${i('chev', 'c')}</div><div class="row"><span class="grow">Recognition</span>${i('chev', 'c')}</div><div class="row"><span class="grow">Text</span>${i('chev', 'c')}</div><div class="row"><span class="grow">Recording</span><span class="v">96 kb/s</span>${i('chev', 'c')}</div></div>
    <div class="grp">App</div>
    <div class="list"><div class="row"><span class="grow">Language</span><span class="v">简体中文</span>${i('chev', 'c')}</div><div class="row"><span class="grow">Appearance</span><span class="v">System</span>${i('chev', 'c')}</div></div></div>${tabs('Settings')}`);

const glossary = () => frame('', `${sb()}<div class="top">${i('back')}<div class="grow"><h2 style="text-align:center">Glossary</h2></div>${i('plus')}</div>
  <div class="searchf">${i('search', 's')} 42 terms</div><div class="scroll"><div class="list">
    ${[['张培光', '10', 'speaker'], ['腾讯云', '10', 'Tencent Cloud'], ['共融', '8', 'inclusion'], ['实时字幕', '8', ''], ['安利', '100', 'always'], ['湾区', '6', 'Greater Bay Area']].map(([w, n, note]) => `<div class="row"><div class="grow stack"><div class="a">${w}</div>${note ? `<div class="b">${note}</div>` : ''}</div><span class="v" style="font-family:var(--mono)">${n}</span></div>`).join('')}</div>
    <div class="hint" style="padding:12px 32px">Names and terms the recogniser should prefer, shared with your Mac and the web app. Applied at the next connection.</div></div>${tabs('Settings')}`);

const lockScreen = () => frame('', `<div class="island"><span class="d"></span><span>12:41</span></div>
  <div class="lockscr">${'<span style="margin-top:48px;opacity:.8">' + i('lock', 's') + '</span>'}<div class="date">Sunday 20 September</div><div class="clock">9:41</div>
    <div class="la"><div class="hd">${mark(20)}See Subtitles<span class="st rec" style="margin-left:auto;color:#f1ece2"><i></i><span class="t" style="color:#f1ece2">12:41</span></span></div><div class="tx">${L.c[0]}</div><div class="ft"><span class="hint" style="color:#aca496">粤语 → 普通话 · recording</span><span class="btn sm stop" style="height:32px;background:#2b2926;color:#f1ece2;border-color:#4a463f">Stop</span></div></div></div>
  <div class="home" style="position:absolute;bottom:0;left:0;right:0"></div>`);

const ipad = () => `<div class="ios pad"><div class="sb" style="height:32px;padding:0 24px 4px;font-size:13px"><span>9:41  Sun 20 Sep</span><span class="r">Wi-Fi<span class="bat"></span></span></div><style>.ios.pad .sb::before{display:none}</style>
  <div class="split"><div class="side"><div class="top"><div class="grow"><h1>Library</h1></div></div><div class="searchf">${i('search', 's')} Search</div><div class="scroll">${libraryList()}</div>
    <div class="tabs" style="background:transparent">${[['mic', 'Live'], ['lib', 'Library'], ['gear', 'Settings']].map(([ic, n]) => `<span class="${n === 'Library' ? 'on' : ''}">${i(ic)}${n}</span>`).join('')}</div><div style="height:14px"></div></div>
    <div><div class="top"><div class="grow stack"><div class="a" style="font-size:20px">9月20号14点02分</div><div class="b">粤语 → 中文 · 47:12</div></div><span class="act">•••</span></div>
      <div style="max-width:620px;width:100%;align-self:center">${player}<div style="padding:12px 16px 8px"><div class="seg"><span class="on">Transcript</span><span>Summary</span><span>Files</span></div></div></div>
      <div class="scroll" style="max-width:720px;width:100%;align-self:center">${transcriptBody}${tl('16:31', L.d)}${tl('16:40', L.a)}</div></div></div></div>`;


// ---- tentative: spoken translation (docs/IOS.md §8). Drawn to be argued with, not yet built.
const spoken = () => frame('', `${sb()}
  <div class="top"><div class="grow">${pair.replace('普通话', 'English')}</div><span class="st rec"><i></i>recording <span class="t">12:41</span></span></div>
  <div class="reader fade">${line(['Hello everyone, and welcome to today’s session.', L.a[1]], 'old')}${line(['First, the people in the room: they can scan a code with their phones.', L.b[1]], 'old')}${line(['Today we will talk about how subtitles help more people take part in a meeting.', L.c[1]])}</div>
  <div style="flex:none;margin:0 16px 10px;padding:10px 14px;border-radius:14px;background:var(--accent-soft);display:flex;align-items:center;gap:10px"><span style="color:var(--accent-text)">${i('ear')}</span><div class="grow stack"><div class="a" style="font-size:15px">Speaking English in your headphones</div><div class="b">AirPods Pro · about 3 s behind the speaker</div></div><span class="v" style="color:var(--fg-3)">1.1×</span></div>
  <div class="bar"><span class="btn stop wide">Stop</span><span class="btn sq" style="border-color:var(--accent);color:var(--accent-text)">${i('ear')}</span><span class="btn sq">${i('bubble')}</span><span class="btn sq">${i('aa')}</span></div>${tabs('Live')}`);

const spokenSheet = () => frame('', `${sb()}
  <div class="top"><div class="grow">${pair.replace('普通话', 'English')}</div><span class="st rec"><i></i>recording <span class="t">12:41</span></span></div>
  <div class="reader" style="justify-content:flex-start;padding-top:8px">${line(['Hello everyone, and welcome to today’s session.', L.a[1]], 'old')}</div>
  <div class="scrim" style="top:54px"></div>
  <div class="sheet"><span class="grab"></span><h2>Listen</h2>
    <div class="row" style="padding:0;min-height:40px"><span class="grow">Speak the translation<div class="hint">each sentence, once it has settled</div></span><span class="tog on"></span></div>
    <div class="list" style="margin:0;background:var(--surface-2)"><div class="row"><span class="grow">Voice</span><span class="v">English · Ava (enhanced)</span>${i('chev', 'c')}</div><div class="row"><span class="grow">Speed</span><span class="v">1.1×, faster when behind</span></div><div class="row"><span class="grow">When it falls behind</span><span class="v">skip to the newest</span></div></div>
    <div class="card" style="margin:0;flex-direction:row;align-items:center;gap:10px"><span class="st warn"><i></i></span><div class="grow"><div style="font-weight:600;font-size:15px">Headphones only</div><div class="hint">Through the speaker the phone would hear itself and subtitle its own voice.</div></div></div></div>`);

const spokenJoin = () => frame('', `${sb()}
  <div class="top"><div class="grow stack"><div class="a">字幕与共融 讲座</div><div class="b">粤语 · 96 following</div></div><span class="st ok"><i></i>live</span></div>
  <div class="reader fade">${line(['First, the people in the room: they can scan a code with their phones.', L.b[1]], 'old')}${line(['Today we will talk about how subtitles help more people take part in a meeting.', L.c[1]])}</div>
  <div style="flex:none;margin:0 16px 10px;display:flex;gap:8px;overflow:hidden"><span class="btn sm" style="border-color:var(--accent);color:var(--accent-text)">${i('ear', 's')} English</span><span class="btn sm">普通话</span><span class="btn sm">日本語</span><span class="btn sm">한국어</span><span class="btn sm">…</span></div>
  <div class="bar"><span class="btn wide">Leave</span><span class="btn sq" style="border-color:var(--accent);color:var(--accent-text)">${i('ear')}</span><span class="btn sq">${i('aa')}</span></div>${home}`);

// ------------------------------------------------------------------------------------------------ the set
/** Every iOS artboard: [key, title, width, height, html fragment, group]. */
export const SCREENS = [
  ['IosLogin', 'Logged out · the login card', 390, 844, login(), 'First run'],
  ['IosFirstMic', 'First run · microphone', 390, 844, firstMic(), 'First run'],
  ['IosFirstLang', 'First run · languages', 390, 844, firstLang(), 'First run'],
  ['IosLiveIdle', 'Live · idle', 390, 844, liveIdle(), 'Live'],
  ['IosLiveListening', 'Live · listening and recording', 390, 844, liveListening(), 'Live'],
  ['IosLiveBack', 'Live · looking back', 390, 844, liveBack(), 'Live'],
  ['IosTextSheet', 'Live · Text sheet', 390, 844, textSheet(), 'Live'],
  ['IosReply', 'Live · Reply', 390, 844, liveReply(), 'Live'],
  ['IosReplyShown', 'Live · a reply shown large', 390, 844, liveShown(), 'Live'],
  ['IosLandscape', 'Live · held up (landscape)', 844, 390, liveLandscape(), 'Live'],
  ['IosLock', 'Lock screen · Live Activity and Dynamic Island', 390, 844, lockScreen(), 'Live'],
  ['IosReconnecting', 'State · reconnecting', 390, 844, liveReconnecting(), 'Live states'],
  ['IosInterrupted', 'State · interrupted by a call', 390, 844, liveInterrupted(), 'Live states'],
  ['IosRefused', 'State · refused by the plan', 390, 844, liveRefused(), 'Live states'],
  ['IosEnded', 'State · ended', 390, 844, liveEnded(), 'Live states'],
  ['IosJoinScan', 'Join · scan', 390, 844, joinScan(), 'Join a talk'],
  ['IosJoined', 'Join · following a talk', 390, 844, joined(), 'Join a talk'],
  ['IosJoinedEnded', 'Join · the talk ended', 390, 844, joinedEnded(), 'Join a talk'],
  ['IosLibrary', 'Library', 390, 844, library(), 'Library'],
  ['IosLibraryEmpty', 'Library · empty', 390, 844, libraryEmpty(), 'Library'],
  ['IosRecTranscript', 'Recording · Transcript', 390, 844, recTranscript(), 'Library'],
  ['IosRecSummary', 'Recording · Summary', 390, 844, recSummary(), 'Library'],
  ['IosRecSummaryWriting', 'Recording · the summary being written', 390, 844, recSummaryWriting(), 'Library'],
  ['IosRecFiles', 'Recording · Files', 390, 844, recFiles(), 'Library'],
  ['IosSettings', 'Settings', 390, 844, settings(), 'Settings'],
  ['IosGlossary', 'Settings · Glossary', 390, 844, glossary(), 'Settings'],
  ['IosLiveLight', 'Light appearance · Live', 390, 844, liveListening('light'), 'Light and iPad'],
  ['IosLibraryLight', 'Light appearance · Library', 390, 844, library('light'), 'Light and iPad'],
  ['IosPad', 'iPad · Library beside a recording', 1180, 820, ipad(), 'Light and iPad'],
  ['IosSpoken', 'Tentative · the translation spoken in headphones', 390, 844, spoken(), 'Tentative: spoken translation'],
  ['IosSpokenSheet', 'Tentative · Listen sheet', 390, 844, spokenSheet(), 'Tentative: spoken translation'],
  ['IosSpokenJoin', 'Tentative · a joined talk, heard in your own language', 390, 844, spokenJoin(), 'Tentative: spoken translation'],
];

/** One screen as a canvas artboard. */
export const artboard = (fragment) => page({ fontLink, css: `body{margin:0}\n${IOS_CSS}`, body: fragment });

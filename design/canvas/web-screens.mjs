// seesubtitles.com in Marquee: the marketing site, the hosted app, the auth flows and the attendee page.
import { SHELL_CSS, DIRECTION_CSS, page, markSvg } from './lib.mjs';
import { DIRECTIONS, cssVars } from './tokens.mjs';

const M = DIRECTIONS.marquee;
const T = M.dark; const L = M.light;
const DARK = cssVars(T, M.fonts); const LIGHT = cssVars(L, M.fonts);
const mark = (size) => markSvg(M, { size });
const fontLink = M.fonts.link;
const QR = (px) => `<svg viewBox="0 0 21 21" width="${px}" height="${px}" shape-rendering="crispEdges"><path fill="#111" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM8 0h1v1H8zM10 0h2v2h-2zM8 2h2v1H8zM11 3h1v2h-1zM9 4h1v2H9zM12 5h1v1h-1zM8 7h2v1H8zM11 7h1v1h-1zM13 8h1v1h-1zM0 8h1v1H0zM2 8h2v1H2zM5 8h2v1H5zM9 9h2v1H9zM12 9h2v2h-2zM16 8h1v1h-1zM18 8h2v1h-2zM3 10h1v1H3zM6 10h2v1H6zM15 10h1v1h-1zM17 10h1v2h-1zM19 10h2v1h-2zM1 11h1v1H1zM4 12h2v1H4zM8 11h1v2H8zM10 12h1v1h-1zM13 12h1v2h-1zM15 12h1v1h-1zM19 12h1v1h-1zM9 14h2v1H9zM12 14h1v1h-1zM14 14h2v1h-2zM17 14h2v1h-2zM20 14h1v1h-1zM8 16h1v1H8zM10 16h2v2h-2zM13 16h1v1h-1zM16 16h1v1h-1zM18 16h3v1h-3zM9 18h1v1H9zM12 18h1v1h-1zM14 18h1v2h-1zM17 18h1v1h-1zM19 18h2v1h-2zM8 20h2v1H8zM11 20h2v1h-2zM16 20h1v1h-1zM18 20h1v1h-1z"/></svg>`;

const WEB_CSS = `
*{box-sizing:border-box} body{margin:0}
.web{width:1440px;background:var(--bg);color:var(--fg);font:15px/1.55 var(--ui);-webkit-font-smoothing:antialiased;${DARK}}
.web a{color:var(--fg);text-decoration:none} .web a:hover{color:var(--accent)}
.nav{display:flex;align-items:center;gap:28px;padding:0 64px;height:68px;border-bottom:1px solid var(--line)}
.nav .brand{display:flex;align-items:center;gap:10px;margin-right:auto} .nav .brand svg{width:26px;height:26px;border-radius:6px;box-shadow:0 0 0 1px var(--line)} .nav .brand .w{font:italic 400 22px var(--display)}
.nav a{font-size:14px;color:var(--fg-2)}
.btn{height:36px;padding:0 16px;border-radius:7px;border:1px solid var(--line-strong);background:var(--surface);color:var(--fg);font:500 14px/1 var(--ui);display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.btn.primary{background:var(--accent);color:var(--accent-fg);border-color:transparent;font-weight:600} .btn.ghost{background:transparent} .btn.big{height:44px;padding:0 20px;font-size:15px}
.hero{display:grid;grid-template-columns:1.05fr 1fr;gap:48px;padding:88px 64px 80px;align-items:center}
.hero h1{margin:0 0 20px;font:600 58px/1.05 var(--ui);letter-spacing:-.025em} .hero h1 em{font:italic 400 1em var(--display);color:var(--accent)}
.hero p{margin:0 0 28px;font-size:18px;color:var(--fg-2);max-width:560px}
.hero .cta{display:flex;gap:12px;align-items:center} .hero .fine{margin-top:14px;color:var(--fg-3);font-size:13px}
.vis{position:relative;height:420px}
.vis .stage{position:absolute;left:0;top:20px;width:560px;aspect-ratio:16/9;background:#000;border-radius:12px;border:1px solid var(--line-strong);display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:8px;padding:20px 28px;font-family:var(--cjk);font-weight:700;color:#fff;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.6)}
.vis .stage .l{font-size:30px;line-height:1.25} .vis .stage .l.old{opacity:.5} .vis .stage .s{display:block;font-size:14px;font-weight:500;opacity:.72}
.vis .phone{position:absolute;right:0;bottom:0;width:190px;height:380px;background:#000;border-radius:28px;border:6px solid #2b2926;display:flex;flex-direction:column;justify-content:flex-end;padding:16px 14px 22px;gap:10px;font-family:var(--cjk);font-weight:700;color:#fff;text-align:center;box-shadow:0 30px 60px rgba(0,0,0,.6)}
.vis .phone .l{font-size:17px;line-height:1.3} .vis .phone .l.old{opacity:.5} .vis .phone .s{display:block;font-size:10px;font-weight:500;opacity:.72}
.vis .phone .hd{position:absolute;top:14px;left:14px;right:14px;display:flex;align-items:center;gap:6px;font:500 9px var(--ui);color:rgba(255,255,255,.7)} .vis .phone .hd svg{width:12px;height:12px}
.vis .qr{position:absolute;right:210px;bottom:0;background:#fff;border-radius:10px;padding:8px;display:flex;flex-direction:column;align-items:center;gap:4px;font:600 10px var(--ui);color:#111}
.sec{padding:80px 64px} .sec.paper{background:var(--bg);color:var(--fg);${LIGHT}}
.sec h2{margin:0 0 10px;font:600 36px/1.15 var(--ui);letter-spacing:-.02em} .sec .sub{margin:0 0 40px;color:var(--fg-2);font-size:17px;max-width:680px}
.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px}
.steps .n{width:34px;height:34px;border-radius:50%;background:var(--accent);color:var(--accent-fg);font:700 15px/34px var(--ui);text-align:center;margin-bottom:14px}
.steps h3{margin:0 0 8px;font:600 20px/1.2 var(--ui)} .steps p{margin:0;color:var(--fg-2);font-size:15px}
.cards4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}
.cards4 div{border:1px solid var(--line);border-radius:12px;padding:22px;background:var(--surface)} .cards4 h3{margin:0 0 8px;font:600 17px/1.2 var(--ui)} .cards4 h3 small{display:block;font:500 13px var(--cjk);color:var(--fg-3);margin-top:3px} .cards4 p{margin:0;color:var(--fg-2);font-size:14px}
.feat{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 48px}
.feat div{display:grid;grid-template-columns:22px 1fr;gap:12px;font-size:15px;color:var(--fg-2)} .feat b{color:var(--fg);font-weight:600;display:block} .feat i{width:22px;height:22px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:700;font-size:13px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.cues{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:6px 14px;font-family:var(--cjk)} .cues > div{display:grid;grid-template-columns:70px 1fr;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px} .cues > div:last-child{border-bottom:0} .cues span{font:11.5px var(--mono);color:var(--fg-3);padding-top:2px} .cues small{display:block;color:var(--fg-3);font-size:12px}
.form{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:640px} .form .field{height:40px;border:1px solid var(--line-strong);background:var(--surface);border-radius:7px;padding:0 12px;display:flex;align-items:center;color:var(--fg-3);font-size:14px} .form .field.wide{grid-column:1/-1}
.foot{display:flex;align-items:center;gap:28px;padding:32px 64px;border-top:1px solid var(--line);color:var(--fg-3);font-size:13px} .foot .brand{display:flex;align-items:center;gap:10px;margin-right:auto;color:var(--fg)} .foot .brand svg{width:22px;height:22px} .foot .lang span{padding:0 6px} .foot .lang span.on{color:var(--fg)}
`;

export function home() {
  const body = `<div class="web">
  <div class="nav"><div class="brand">${mark()}<span class="w">See Subtitles</span></div><a>How it works</a><a>For venues</a><a>For files</a><a>Log in</a><span class="btn primary">Download for Mac</span></div>
  <div class="hero">
    <div><h1>Subtitles for <em>everyone</em> in the room.</h1><p>See Subtitles turns Cantonese speech into Mandarin subtitles as it is spoken: on the venue screen, over the slides, and on every phone that scans a code. When the talk ends you have the recording, the complete subtitles and a summary.</p>
      <div class="cta"><span class="btn primary big">Download for macOS</span><span class="btn ghost big">Open the web app</span></div><div class="fine">macOS 13 or later, Apple silicon · the web app subtitles video and audio files in any browser</div></div>
    <div class="vis"><div class="stage"><div class="l old">首先是現場的觀眾，他們可以用手機掃二維碼。</div><div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div></div>
      <div class="qr">${QR(72)}<span>seesubtitles.com/d/K7Q2</span></div>
      <div class="phone"><div class="hd">${mark(12)}See Subtitles<span style="margin-left:auto;color:var(--accent)">● live</span></div><div class="l old">首先是現場的觀眾。</div><div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕。</span></div></div></div>
  </div>
  <div class="sec paper"><h2>How it works</h2><p class="sub">One Mac at the front of the room. The person speaking does nothing differently.</p>
    <div class="steps"><div><div class="n">1</div><h3>Speak</h3><p>A microphone on the speaker. The app streams the audio to Tencent 實時語音翻譯 and gets each sentence back, translated, as it finishes.</p></div>
    <div><div class="n">2</div><h3>Show</h3><p>A Display window on the projector, a transparent Overlay on the slides, or the share link and QR code for phones. Presets for a portrait strip, a landscape bar, or text over slides.</p></div>
    <div><div class="n">3</div><h3>Keep</h3><p>Recording never depends on the network. Afterwards: a complete set of subtitles from the cloud, an MP4 with the text burned in, and a learning summary as a PDF.</p></div></div></div>
  <div class="sec"><h2>Where it helps</h2><p class="sub">Any situation where following the words is the difference between attending and taking part.</p>
    <div class="cards4"><div><h3>Conferences and talks<small>會議・講座</small></h3><p>The venue screen, the slides, and every phone in the audience, from one laptop.</p></div><div><h3>Classes and workshops<small>課堂・工作坊</small></h3><p>Students follow on their own screens; the recording and summary become the notes.</p></div><div><h3>Meetings<small>會議室</small></h3><p>A meeting room with a mix of Cantonese and Mandarin speakers reads the same subtitle line.</p></div><div><h3>Video and audio files<small>影片・錄音</small></h3><p>Drop a file in the web app: subtitles in minutes, edit the cues, export SRT, VTT, text or MP4.</p></div></div></div>
  <div class="sec paper"><h2>Made for the room</h2><p class="sub">Every part of the app was shaped by running it at real talks.</p>
    <div class="feat"><div><i>1</i><span><b>Overlay on any display</b>Transparent window over the slides, placeable on every screen, including virtual ones, from the 字幕 menu bar item.</span></div><div><i>2</i><span><b>Phones follow along</b>A share link and QR code; attendees choose translation, original or both and their own text size. Audio never leaves the Mac.</span></div><div><i>3</i><span><b>Recording that cannot drop</b>MP3 and subtitle files are written locally while the talk runs; a lost connection pauses subtitles, not the recording.</span></div><div><i>4</i><span><b>Re-subtitle via cloud</b>After the talk, the whole recording is recognised and translated in one pass, filling any holes a connection drop left.</span></div><div><i>5</i><span><b>Glossary</b>Names, places and terms the recogniser should favour, shared with your team.</span></div><div><i>6</i><span><b>Learning summary</b>A concise summary with clickable timestamps, as Markdown or an A4 PDF.</span></div></div></div>
  <div class="sec"><div class="two"><div><h2>Files, too</h2><p class="sub" style="margin-bottom:22px">Upload a video or audio file up to five hours. Choose the spoken language and the subtitle language; the cues arrive split at punctuation, at most 22 characters a line, with the timing of the speech.</p><div class="cta" style="display:flex;gap:12px"><span class="btn primary">Open the web app</span><span class="btn ghost">See an example job</span></div></div>
    <div class="cues"><div><span>00:15:48</span><div>大家好，歡迎來到今天的分享。<small>大家好，歡迎嚟到今日嘅分享。</small></div></div><div><span>00:15:52</span><div>今天我們會講一下如何用字幕幫助更多人參與會議。<small>今日我哋會講吓點樣用字幕幫助更多人參與會議。</small></div></div><div><span>00:15:59</span><div>首先是現場的觀眾，他們可以用手機掃二維碼。<small>首先係現場嘅觀眾，佢哋可以用手機掃個二維碼。</small></div></div></div></div></div>
  <div class="sec paper"><div class="two"><div><h2>Get started</h2><p class="sub" style="margin-bottom:22px">Download the app and log in. Accounts are created by the team that runs See Subtitles; tell us what you will subtitle and we will set one up.</p><span class="btn primary big">Download for macOS</span></div>
    <div class="form"><span class="field">Name</span><span class="field">Email</span><span class="field wide">Organisation or event</span><span class="field wide" style="height:80px;align-items:flex-start;padding-top:10px">What will you subtitle? Talks, classes, files…</span><span class="btn" style="grid-column:1/-1;justify-content:center">Request an account</span></div></div></div>
  <div class="foot"><div class="brand">${mark()}<span>See Subtitles · 看字幕</span></div><a>Download</a><a>Web app</a><a>Privacy</a><a>Contact</a><span class="lang"><span class="on">EN</span>·<span>繁</span>·<span>简</span></span></div>
</div>`;
  return page({ fontLink, css: WEB_CSS, body });
}

export function homeMobile() {
  const css = WEB_CSS + `
.web{width:390px;font-size:15px} .nav{padding:0 20px;height:58px;gap:14px} .nav a,.nav .btn{display:none} .nav .brand .w{font-size:20px} .nav .burger{width:22px;height:2px;background:var(--fg);box-shadow:0 7px 0 var(--fg),0 -7px 0 var(--fg);display:block}
.hero{grid-template-columns:1fr;padding:40px 20px 36px;gap:28px} .hero h1{font-size:38px} .hero p{font-size:16px} .hero .cta{flex-direction:column;align-items:stretch} .hero .cta .btn{justify-content:center}
.vis{height:auto} .vis .stage{position:static;width:100%;padding:14px 16px} .vis .stage .l{font-size:19px} .vis .stage .s{font-size:11px} .vis .phone,.vis .qr{display:none}
.sec{padding:44px 20px} .sec h2{font-size:28px} .sec .sub{font-size:15px;margin-bottom:24px}
.steps,.cards4,.feat,.two{grid-template-columns:1fr;gap:22px}
.form{grid-template-columns:1fr} .form .field.wide{grid-column:auto}
.foot{flex-wrap:wrap;gap:14px 20px;padding:24px 20px} .foot .brand{width:100%}`;
  const body = `<div class="web">
  <div class="nav"><div class="brand">${mark()}<span class="w">See Subtitles</span></div><i class="burger"></i></div>
  <div class="hero"><div><h1>Subtitles for <em>everyone</em> in the room.</h1><p>Cantonese speech becomes Mandarin subtitles as it is spoken: on the screen, over the slides, and on every phone that scans a code.</p><div class="cta"><span class="btn primary big">Download for macOS</span><span class="btn ghost big">Open the web app</span></div></div>
    <div class="vis"><div class="stage"><div class="l old">首先是現場的觀眾，他們可以用手機掃二維碼。</div><div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div></div></div></div>
  <div class="sec paper"><h2>How it works</h2><div class="steps"><div><div class="n">1</div><h3>Speak</h3><p>A microphone on the speaker; each sentence comes back translated as it finishes.</p></div><div><div class="n">2</div><h3>Show</h3><p>Display window, overlay on the slides, or the share link for phones.</p></div><div><div class="n">3</div><h3>Keep</h3><p>The recording, complete subtitles, an MP4 and a summary.</p></div></div></div>
  <div class="sec"><h2>Where it helps</h2><div class="cards4"><div><h3>Conferences and talks<small>會議・講座</small></h3><p>Screen, slides and every phone, from one laptop.</p></div><div><h3>Classes and workshops<small>課堂・工作坊</small></h3><p>Students follow on their own screens.</p></div><div><h3>Video and audio files<small>影片・錄音</small></h3><p>Subtitles in minutes, export SRT, VTT, text or MP4.</p></div></div></div>
  <div class="sec paper"><h2>Get started</h2><p class="sub">Accounts are created by the team that runs See Subtitles.</p><div class="form"><span class="field">Name</span><span class="field">Email</span><span class="field">What will you subtitle?</span><span class="btn" style="justify-content:center">Request an account</span></div></div>
  <div class="foot"><div class="brand">${mark()}<span>See Subtitles · 看字幕</span></div><a>Download</a><a>Web app</a><a>Privacy</a><span class="lang"><span class="on">EN</span>·<span>繁</span>·<span>简</span></span></div>
</div>`;
  return page({ fontLink, css, body });
}

// ------------------------------------------------------------------------------------------------ hosted app shell
const APP_CSS = `.win{${DARK}}` + SHELL_CSS + DIRECTION_CSS.marquee + `
.v{display:flex;align-items:center;gap:8px;min-width:0}
.win{flex-direction:column}
.topbar{display:flex;align-items:center;gap:26px;height:56px;padding:0 32px;border-bottom:1px solid var(--line);background:var(--side)}
.topbar .brand{display:flex;align-items:center;gap:10px;margin-right:12px} .topbar .brand svg{width:22px;height:22px;border-radius:5px;box-shadow:0 0 0 1px var(--line)} .topbar .brand .w{font:italic 400 19px var(--display)}
.topbar a{font-size:13.5px;color:var(--fg-2);font-weight:500;padding:6px 0} .topbar a.on{color:var(--accent);box-shadow:inset 0 -2px 0 var(--accent)}
.topbar .who{margin-left:auto;color:var(--fg-3);font-size:12.5px;display:flex;gap:14px;align-items:center}
.page{padding:24px 32px 32px;display:flex;flex-direction:column;gap:16px;flex:1;min-height:0}
.page .top{padding:0;min-height:0}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.stat{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--surface)} .stat .v{font:600 22px/1.1 var(--ui);letter-spacing:-.01em;font-variant-numeric:tabular-nums;margin-top:4px} .stat .k{color:var(--fg-3);font-size:12px} .stat .d{color:var(--fg-3);font-size:11.5px;margin-top:4px}
.grid2{display:grid;grid-template-columns:420px 1fr;gap:16px;align-items:start}
.tbl{width:100%;border-collapse:collapse} .tbl th{text-align:left;font:500 11.5px var(--ui);color:var(--fg-3);padding:8px 12px;border-bottom:1px solid var(--line)} .tbl td{padding:9px 12px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:middle} .tbl tr:last-child td{border-bottom:0} .tbl .nm{font-weight:500;font-family:var(--cjk)} .tbl .sb{color:var(--fg-3);font-size:11.5px}
.prog{display:inline-block;width:80px;height:4px;border-radius:2px;background:var(--surface-2);vertical-align:middle;overflow:hidden} .prog i{display:block;height:100%;background:var(--accent)}
.drop{border:1px dashed var(--line-strong);border-radius:10px;padding:22px;text-align:center;color:var(--fg-3);font-size:12.5px}
.cue{display:grid;grid-template-columns:64px 1fr auto;gap:10px;padding:8px 6px;border-bottom:1px solid var(--line);align-items:start;font-family:var(--cjk)} .cue.active{background:var(--accent-soft);border-radius:6px} .cue .t{font:11px/1.6 var(--mono);color:var(--fg-3);white-space:pre} .cue .ta{border:1px solid var(--line);background:var(--surface-2);border-radius:6px;padding:4px 8px;font-size:13.5px;min-height:26px} .cue .ta.orig{color:var(--fg-3);font-size:12px;margin-top:4px;background:transparent} .cue .ops{display:flex;flex-direction:column;gap:3px} .cue .ops .btn{height:20px;padding:0 7px;font-size:11px}
.video{background:#000;border-radius:10px;aspect-ratio:16/9;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding:16px 24px;gap:6px;font-family:var(--cjk);font-weight:700;color:#fff;text-align:center;position:relative} .video .l{font-size:24px;line-height:1.25} .video .s{display:block;font-size:12px;font-weight:500;opacity:.72} .video .ctl{position:absolute;left:12px;right:12px;bottom:8px;height:3px;background:rgba(255,255,255,.25);border-radius:2px} .video .ctl i{display:block;height:100%;width:38%;background:var(--accent);border-radius:2px}
.dl{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;font-size:12.5px} .dl a{color:var(--fg);text-decoration:none} .dl .m{color:var(--fg-3);font-size:11.5px}
.snav{width:170px;flex:none;display:flex;flex-direction:column;gap:2px} .snav .nav{font-size:13px;padding:6px 10px}
.set .row{grid-template-columns:150px 1fr} .status-line{padding:6px 10px;border-radius:6px;background:var(--surface-2);font-size:12px;color:var(--fg-2);white-space:pre-wrap;line-height:1.5}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:28px 30px;display:flex;flex-direction:column;gap:14px;width:400px} .card h2{margin:0;font:600 22px/1.2 var(--ui);letter-spacing:-.01em} .card p{margin:0;color:var(--fg-2);font-size:13px;line-height:1.5} .card .fld{display:flex;flex-direction:column;gap:5px} .card .fld label{font-size:12px;color:var(--fg-2)} .card .field{height:34px} .card .btn.primary{height:36px;justify-content:center;font-size:13px} .card a{color:var(--accent);text-decoration:none;font-size:12.5px} .card .err{background:var(--bad);color:#fff;border-radius:6px;padding:8px 10px;font-size:12.5px}
.auth{display:grid;grid-template-columns:1fr 1fr;height:900px} .auth .left{background:var(--side);border-right:1px solid var(--line);padding:56px;display:flex;flex-direction:column;gap:24px} .auth .left .brand{display:flex;align-items:center;gap:10px} .auth .left .brand svg{width:28px;height:28px;border-radius:6px} .auth .left .brand .w{font:italic 400 26px var(--display)} .auth .left h1{margin:auto 0 0;font:600 36px/1.15 var(--ui);letter-spacing:-.02em;max-width:520px} .auth .left p{margin:0 0 auto;color:var(--fg-2);font-size:16px;max-width:520px} .auth .right{display:flex;align-items:center;justify-content:center}
.auth .stage{background:#000;border-radius:12px;aspect-ratio:16/9;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding:16px 22px;gap:6px;font-family:var(--cjk);font-weight:700;color:#fff;text-align:center;border:1px solid var(--line-strong)} .auth .stage .l{font-size:26px;line-height:1.25} .auth .stage .l.old{opacity:.5} .auth .stage .s{display:block;font-size:12px;font-weight:500;opacity:.72}
.doc{max-width:860px;font-size:15px;line-height:1.7;font-family:var(--cjk)} .doc h1{margin:0 0 6px;font:700 26px/1.2 var(--cjk)} .doc .meta{color:var(--fg-3);font-size:13px;margin-bottom:22px;font-family:var(--ui)} .doc h2{margin:26px 0 8px;font:600 18px/1.3 var(--cjk);border-bottom:1px solid var(--line);padding-bottom:6px} .doc li{margin:4px 0} .doc .ts{color:var(--accent);font:12px var(--mono);text-decoration:none;margin-left:6px} .doc blockquote{margin:10px 0;padding:6px 14px;border-left:3px solid var(--accent);color:var(--fg-2)}
`;
const topbar = (on) => `<div class="topbar"><div class="brand">${mark()}<span class="w">See Subtitles</span></div>${['Overview', 'Files', 'Live sessions', 'Account'].map((l) => `<a${l === on ? ' class="on"' : ''}>${l}</a>`).join('')}<div class="who"><span>alex@seesubtitles.com</span><span class="btn small ghost">Log out</span></div></div>`;
const app = (on, inner, h = 900) => page({ fontLink, css: APP_CSS + `.win{height:${h}px}`, body: `<div class="win">${topbar(on)}<div class="page">${inner}</div></div>` });

export function dashboard() {
  const stat = (k, v, d) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  return app('Overview', `
  <div class="top"><h1>Overview</h1><div class="status"><span class="s">September · 3 people on your team</span></div><div class="actions"><span class="btn primary">Upload a file</span></div></div>
  <div class="stats">${stat('Live this month', '6 h 40 m', '4 talks · longest 1 h 12 m')}${stat('Phones followed', '412', 'peak 96 at one talk')}${stat('Files subtitled', '4', '2 h 51 m of speech')}${stat('Tencent resource pack', '63% left', 'renews 1 October · needs the billing API')}</div>
  <div class="grid2">
    <section class="panel"><h3>Upload a video or audio file</h3><div class="drop">Drop a file here or click to choose<br><span style="font-size:11.5px">mp4, mov, mkv, mp3, m4a, wav… up to 5 hours</span></div>
      <div class="row" style="margin-top:10px"><label>Spoken language</label><div class="v"><span class="field sel">粵語 <span class="sub">Cantonese</span></span></div></div><div class="row"><label>Translate subtitles to</label><div class="v"><span class="field sel">中文（简体） <span class="sub">Mandarin</span></span></div></div>
      <div class="v" style="margin-top:8px"><span class="btn primary">Upload &amp; transcribe</span><span class="hint">an hour of speech takes a few minutes</span></div></section>
    <div class="col" style="gap:16px">
      <section class="panel" style="padding:0;overflow:hidden"><h3 style="padding:12px 14px 0">Live sessions <span class="hint" style="font-weight:400">from the desktop app</span></h3><table class="tbl"><thead><tr><th>Name</th><th>Share link</th><th>Following</th><th>Lines</th><th>Status</th><th></th></tr></thead><tbody>
        <tr><td><div class="nm">字幕與共融 講座</div><div class="sb">Alex's MacBook Pro · started 14:02</div></td><td>seesubtitles.com/d/K7Q2</td><td>96</td><td>1,284</td><td><span class="tag rec"><i class="dot" style="background:var(--rec)"></i>live</span></td><td style="text-align:right"><span class="btn small">Open ↗</span></td></tr>
        <tr><td><div class="nm">產品發布會</div><div class="sb">5 September</div></td><td>seesubtitles.com/d/M3PX</td><td>212</td><td>3,410</td><td><span class="tag">ended</span></td><td style="text-align:right"><span class="btn small">Transcript</span></td></tr></tbody></table></section>
      <section class="panel" style="padding:0;overflow:hidden"><h3 style="padding:12px 14px 0">Subtitle jobs</h3><table class="tbl"><thead><tr><th>File</th><th>Languages</th><th>Status</th><th>Cues</th><th>Created</th><th></th></tr></thead><tbody>
        <tr><td class="nm">keynote-day2.mp4</td><td>粵語 → 中文（简体）</td><td><span class="tag ok"><i class="dot" style="background:var(--ok)"></i>done</span></td><td>612</td><td>2 Sep 09:14</td><td style="text-align:right"><span class="btn small">Open</span></td></tr>
        <tr><td class="nm">interview-raw.m4a</td><td>粵語 → 中文（简体）</td><td><span class="tag">translating</span> <span class="prog"><i style="width:62%"></i></span></td><td>—</td><td>today 14:20</td><td style="text-align:right"><span class="btn small">Open</span></td></tr>
        <tr><td class="nm">panel-discussion.mov</td><td>普通話 → 中文（繁體）</td><td><span class="tag bad"><i class="dot" style="background:var(--bad)"></i>failed · no speech found</span></td><td>—</td><td>1 Sep 17:40</td><td style="text-align:right"><span class="btn small">Retry</span></td></tr></tbody></table></section>
    </div>
  </div>`);
}

export function job() {
  const cue = (t1, t2, zh, yue, a) => `<div class="cue${a ? ' active' : ''}"><span class="t">${t1}\n${t2}</span><div><div class="ta">${zh}</div><div class="ta orig">${yue}</div></div><div class="ops"><span class="btn small">merge ↓</span><span class="btn small">delete</span></div></div>`;
  return app('Files', `
  <div class="top"><h1><span class="crumb" style="color:var(--fg-3);font-weight:400">Files ›</span> keynote-day2.mp4</h1><div class="status"><span class="s"><i class="dot" style="background:var(--ok)"></i>Done · 612 cues · 52:31 · 粵語 → 中文（简体）</span></div><div class="actions"><span class="btn ghost">Render MP4</span><span class="btn primary">Download ▾</span></div></div>
  <div class="body" style="padding:0;gap:16px">
    <div class="col" style="width:560px;flex:none">
      <section class="panel" style="padding:10px"><div class="video"><div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div><div class="ctl"><i></i></div></div><div class="hint" style="margin:8px 4px 0">Space plays · click a cue time to jump</div></section>
      <section class="panel"><h3>Downloads</h3><div class="dl"><div><a>Subtitles · translation (SRT)</a></div><div><a>Subtitles · original (SRT)</a></div><div><a>WebVTT</a></div><div><a>Plain text · translation</a></div><div><a>Plain text · original</a></div><div><a>Plain text · bilingual</a></div><div><a>Video with subtitles (MP4)</a> <span class="m">· 1.2 GB · rendered 2 Sep</span></div></div></section>
      <section class="panel"><h3>Burn subtitles into the video</h3><div class="v"><span class="field sel" style="max-width:240px">Translation + original</span><span class="btn">Render MP4</span><span class="hint">a 52-minute video takes about 6 minutes</span></div></section>
    </div>
    <section class="panel transcript" style="flex:1"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><h3 style="margin:0">Cues</h3><span class="sp"></span><span class="btn primary small">Save changes</span><span class="btn small">Shift all…</span><span class="hint">saved 14:22</span></div>
      <div class="list">${cue('00:00.8', '00:03.9', '各位早晨，歡迎來到第二日的主題演講。', '各位早晨，歡迎嚟到第二日嘅主題演講。', false)}${cue('00:04.2', '00:08.6', '今天我想從一個問題開始：誰聽不到我們在說什麼？', '今日我想由一個問題開始：邊個聽唔到我哋講咩？', true)}${cue('00:09.0', '00:12.4', '不只是聽力的問題，也是語言的問題。', '唔單止係聽力嘅問題，都係語言嘅問題。', false)}${cue('00:12.9', '00:17.1', '所以我們把字幕放到了每一個人的手機上。', '所以我哋將字幕放到每一個人嘅手機上面。', false)}${cue('00:17.5', '00:21.0', '接下來的五十分鐘，你們會看到它是怎樣運作的。', '接落嚟嘅五十分鐘，你哋會見到佢係點樣運作。', false)}${cue('00:21.4', '00:24.8', '先從最簡單的一步說起。', '先由最簡單嘅一步講起。', false)}</div></section>
  </div>`);
}

export function account() {
  const row = (l, ...v) => `<div class="row"><label>${l}</label><div class="v">${v.join('')}</div></div>`;
  const sec = (t, inner) => `<section class="panel"><h3>${t}</h3>${inner}</section>`;
  return app('Account', `
  <div class="top"><h1>Account</h1><div class="status"><span class="s">alex@seesubtitles.com · administrator</span></div></div>
  <div class="body set" style="padding:0;gap:16px">
    <div class="snav"><div class="nav active">Profile</div><div class="nav">Security</div><div class="nav">Team</div><div class="nav">Glossary</div><div class="nav">Usage</div></div>
    <div class="col" style="flex:1;gap:16px;overflow:hidden">
      ${sec('Profile', row('Email', '<span class="field" style="max-width:320px">alex@seesubtitles.com</span>') + row('Name', '<span class="field" style="max-width:320px">Alex</span>') + row('Language of the site', '<span class="field sel" style="max-width:200px">English</span>'))}
      ${sec('Security', row('Password', '<span class="btn small">Change password…</span>') + row('Logged-in devices', '<span class="status-line" style="flex:1">This Mac · See Subtitles app · now\nSafari on iPhone · 2 hours ago\nChrome on MacBook · 3 days ago</span><span class="btn small">Log out everywhere</span>'))}
      ${sec('Team', `<table class="tbl" style="margin:-4px 0 10px"><thead><tr><th>Member</th><th>Role</th><th>Last active</th><th></th></tr></thead><tbody>
        <tr><td>alex@seesubtitles.com</td><td>administrator</td><td>now</td><td></td></tr><tr><td>mei@seesubtitles.com</td><td>member</td><td>yesterday</td><td style="text-align:right"><span class="btn small">remove</span></td></tr><tr><td>ken@seesubtitles.com</td><td>member</td><td>5 September</td><td style="text-align:right"><span class="btn small">remove</span></td></tr></tbody></table>
        ${row('Invite codes', '<span class="field" style="max-width:220px;font-family:var(--mono)">SUBS-7Q2K-M3PX</span><span class="hint">unused · expires in 6 days</span><span class="btn small">Copy</span><span class="btn small primary">Create invite code</span>')}<div class="hint ind">Members see only their own files and live sessions. Everyone shares the glossary.</div>`)}
    </div>
  </div>`);
}

export function summary() {
  return app('Files', `
  <div class="top"><h1><span class="crumb" style="color:var(--fg-3);font-weight:400">Files › 字幕與共融 講座 ›</span> Learning summary</h1><div class="actions"><span class="btn ghost">Download .md</span><span class="btn ghost">Download PDF</span><span class="btn primary">Regenerate</span></div></div>
  <div class="doc"><h1>字幕與共融：讓每個人都能參與</h1><div class="meta">Generated 8 September 15:02 · claude-opus-5 · 简体中文 · 47 minutes of speech · 6 sections</div>
    <h2>核心观点</h2><ul><li>字幕不是给"听不见的人"的补充，而是给房间里每一个人的默认界面。<a class="ts">14:03</a></li><li>粤语到普通话的实时翻译，把"能听懂"和"能参与"之间的距离缩短到一句话的时间。<a class="ts">14:11</a></li><li>录音与字幕文件在本机生成，连线中断只影响屏幕上的字幕，不影响记录。<a class="ts">14:27</a></li></ul>
    <h2>三个现场做法</h2><ol><li>把二维码放在每一张开场幻灯片上，而不只是入口处。<a class="ts">14:15</a></li><li>演讲前把人名、地名和产品名加入词表。<a class="ts">14:19</a></li><li>演讲结束后立刻用云端重新生成完整字幕，再导出 MP4。<a class="ts">14:41</a></li></ol>
    <blockquote>"我们要做的不是翻译，而是让人留在房间里。" <a class="ts">14:33</a></blockquote>
    <h2>问答要点</h2><ul><li>关于口音与噪声：词表与暂停长度是最有效的两个调整项。<a class="ts">14:44</a></li></ul></div>`, 1100);
}

export function login() {
  return page({ fontLink, css: APP_CSS, body: `<div class="win auth" style="display:grid">
    <div class="left"><div class="brand">${mark()}<span class="w">See Subtitles</span></div><h1>Subtitles for everyone in the room.</h1><p>Live Cantonese → Mandarin subtitles on the venue screen and on every phone. Recordings with editable subtitles, MP4 and a summary. Video and audio files subtitled in minutes.</p><div class="stage"><div class="l old">首先是現場的觀眾，他們可以用手機掃二維碼。</div><div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div></div></div>
    <div class="right"><div class="card"><h2>Log in</h2><p>The same account as the desktop app.</p><div class="fld"><label>Email</label><span class="field">alex@seesubtitles.com</span></div><div class="fld"><label>Password</label><span class="field" style="color:var(--fg-3)">••••••••••</span></div><span class="btn primary">Log in</span><div style="display:flex;justify-content:space-between"><a>Forgot your password?</a><a>Create an account</a></div></div></div>
  </div>` });
}
export function signup() {
  return page({ fontLink, css: APP_CSS, body: `<div class="win auth" style="display:grid">
    <div class="left"><div class="brand">${mark()}<span class="w">See Subtitles</span></div><h1>Create your account.</h1><p>Accounts are created with an invite code from the person who runs See Subtitles. The account gives the desktop app its subtitle keys, the share link for phones and cloud re-subtitling.</p><div class="stage"><div class="l">字幕讓每個人都能參與。<span class="s">字幕令每個人都可以參與。</span></div></div></div>
    <div class="right"><div class="card"><h2>Create an account</h2><div class="fld"><label>Email</label><span class="field">mei@seesubtitles.com</span></div><div class="fld"><label>Password <span style="color:var(--fg-3)">· at least 8 characters</span></label><span class="field" style="color:var(--fg-3)">••••••••••</span></div><div class="fld"><label>Invite code</label><span class="field" style="font-family:var(--mono)">SUBS-7Q2K-M3PX</span></div><div class="err">That invite code has already been used. Ask for a new one.</div><span class="btn primary">Create account</span><a>I already have an account</a></div></div>
  </div>` });
}
export function reset() {
  const css = APP_CSS + `.flow{width:1440px;height:900px;display:flex;align-items:center;justify-content:center;gap:24px;background:var(--bg);color:var(--fg);font:13px/1.45 var(--ui);${DARK}} .flow .card{min-height:330px}`;
  return page({ fontLink, css, body: `<div class="flow">
    <div class="card"><div class="steps" style="display:flex;gap:8px;color:var(--fg-3);font-size:12px">1 of 3</div><h2>Forgot your password?</h2><p>Enter the email you log in with. If an account exists we send a link that works for 30 minutes.</p><div class="fld"><label>Email</label><span class="field">alex@seesubtitles.com</span></div><span class="btn primary">Send reset link</span><a>Back to log in</a></div>
    <div class="card"><div class="steps" style="display:flex;gap:8px;color:var(--fg-3);font-size:12px">2 of 3</div><h2>Check your email</h2><p>We sent a link to <b>a•••@seesubtitles.com</b>. Open it on this device to choose a new password.</p><p class="hint">Nothing arrived after a minute? Check spam, or</p><span class="btn">Send it again</span><a>Use a different email</a></div>
    <div class="card"><div class="steps" style="display:flex;gap:8px;color:var(--fg-3);font-size:12px">3 of 3</div><h2>Choose a new password</h2><div class="fld"><label>New password <span style="color:var(--fg-3)">· at least 8 characters</span></label><span class="field" style="color:var(--fg-3)">••••••••••</span></div><div class="fld"><label>Repeat it</label><span class="field" style="color:var(--fg-3)">••••••••••</span></div><span class="btn primary">Save and log in</span><p class="hint">Other devices are logged out. The desktop app asks you to log in again.</p></div>
  </div>` });
}

// ------------------------------------------------------------------------------------------------ attendee page states
const PHONE_CSS = `.ph{${DARK}}
*{box-sizing:border-box} body{margin:0}
.ph{width:390px;height:844px;background:#000;color:#fff;display:flex;flex-direction:column;font-family:var(--cjk);overflow:hidden;position:relative;-webkit-font-smoothing:antialiased}
.hdr{display:flex;align-items:center;gap:8px;padding:58px 18px 10px;font:500 12.5px var(--ui);color:rgba(255,255,255,.72)} .hdr svg{width:18px;height:18px;flex:none} .hdr .w{color:#fff;font:italic 400 17px var(--display)} .hdr .live{margin-left:auto;display:flex;align-items:center;gap:6px;color:var(--accent)} .hdr .dot{width:7px;height:7px;border-radius:50%;background:var(--ok)}
.lines{flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding:0 20px 28px;gap:16px;text-align:center;font-weight:700} .l{font-size:30px;line-height:1.3} .l.old{opacity:.5} .l.older{opacity:.28} .l .s{display:block;font-size:15px;font-weight:500;opacity:.72;margin-top:4px}
.bar{display:flex;justify-content:space-between;padding:8px 20px 34px;font:500 12px var(--ui);color:rgba(255,255,255,.5)}
.sheetbg{position:absolute;inset:0;background:rgba(0,0,0,.55)}
.sheet{position:absolute;left:0;right:0;bottom:0;background:var(--surface);color:var(--fg);border-radius:18px 18px 0 0;padding:14px 20px 40px;font:13px/1.45 var(--ui);display:flex;flex-direction:column;gap:16px;border-top:1px solid var(--line-strong)}
.sheet .grab{width:36px;height:4px;border-radius:2px;background:var(--line-strong);align-self:center}
.sheet h2{margin:0;font:600 16px/1.3 var(--cjk)} .sheet .m{color:var(--fg-3);font-size:12px}
.seg{display:flex;border:1px solid var(--line-strong);border-radius:8px;overflow:hidden} .seg span{flex:1;text-align:center;padding:10px 0;font-weight:500;color:var(--fg-2)} .seg span.on{background:var(--accent);color:var(--accent-fg)}
.opt{display:flex;align-items:center;gap:12px;min-height:44px} .opt b{font-weight:500} .opt .m{margin-left:auto}
.slider{flex:1;height:4px;border-radius:2px;background:var(--line-strong);position:relative} .slider i{position:absolute;left:0;top:0;height:100%;width:55%;background:var(--accent);border-radius:2px} .slider b{position:absolute;left:55%;top:50%;width:22px;height:22px;border-radius:50%;background:#fff;transform:translate(-50%,-50%);box-shadow:0 1px 3px rgba(0,0,0,.4)}
.tog{width:44px;height:26px;border-radius:13px;background:var(--line-strong);position:relative;margin-left:auto} .tog::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff} .tog.on{background:var(--accent)} .tog.on::after{left:21px}
.done{height:46px;border-radius:10px;background:var(--fg);color:var(--bg);font:600 15px var(--ui);display:flex;align-items:center;justify-content:center}
.ended{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:0 32px;text-align:center;font-family:var(--ui)} .ended h1{margin:0;font:700 28px/1.2 var(--cjk)} .ended p{margin:0;color:rgba(255,255,255,.65);font-size:14px;line-height:1.5} .ended .m{color:rgba(255,255,255,.4);font-size:12px} .ended svg{width:44px;height:44px;border-radius:10px}`;
const phoneHead = `<div class="hdr">${mark()}<span class="w">See Subtitles</span><span class="live"><i class="dot" style="background:var(--accent)"></i>live</span></div>`;
export function phoneMenu() {
  return page({ fontLink, css: PHONE_CSS, body: `<div class="ph">${phoneHead}
    <div class="lines"><div class="l old">首先是現場的觀眾，他們可以用手機掃二維碼。</div><div class="l">今天我們會講一下如何用字幕幫助更多人參與會議。<span class="s">今日我哋會講吓點樣用字幕幫助更多人參與會議。</span></div></div>
    <div class="sheetbg"></div>
    <div class="sheet"><span class="grab"></span><div><h2>字幕與共融 講座</h2><div class="m">96 people following · started 14:02</div></div>
      <div><div class="m" style="margin-bottom:6px">Show</div><div class="seg"><span>中文 translation</span><span>粵語 original</span><span class="on">Both</span></div></div>
      <div class="opt"><b style="font-size:13px">Aa</b><span class="slider"><i></i><b></b></span><b style="font-size:20px">Aa</b></div>
      <div class="opt"><b>High contrast</b><span class="m">yellow text, heavier weight</span><span class="tog on"></span></div>
      <div class="opt"><b>Keep the screen awake</b><span class="tog on"></span></div>
      <div class="done">Done</div></div>
  </div>` });
}
export function phoneEnded() {
  return page({ fontLink, css: PHONE_CSS, body: `<div class="ph"><div class="hdr">${mark()}<span class="w">See Subtitles</span><span class="live" style="color:rgba(255,255,255,.5)">ended 14:49</span></div>
    <div class="ended">${mark(44)}<h1>這場講座已經結束</h1><p>This talk has ended. Thank you for following along.<br>The organiser can share the recording and the subtitles from See Subtitles.</p><p class="m">字幕與共融 講座 · 8 September · 47 minutes · 1,284 lines</p></div>
    <div class="bar"><span>seesubtitles.com</span><span>看字幕</span></div>
  </div>` });
}

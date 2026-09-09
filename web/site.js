// Website: language toggle (EN / 简), the download link from the latest published build, the QR in the hero,
// and the request-an-account form.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const T = {
    'zh-Hans': {
      'nav.how': '运作方式', 'nav.where': '适用场合', 'nav.files': '文件', 'nav.login': '登录', 'nav.download': '下载 Mac 版',
      'hero.h1': '让<em>现场每一个人</em>都看得见字幕。',
      'hero.p': 'See Subtitles 把粤语讲话实时变成普通话字幕：显示在会场屏幕、幻灯片之上，以及每一部扫码的手机。讲座结束后，录音、完整字幕和摘要都已经准备好。',
      'cta.download': '下载 macOS 版', 'cta.web': '打开网页版', 'hero.fine': 'macOS 13 或以上、Apple 芯片 · 网页版可在任何浏览器为视频和录音加字幕',
      'how.h2': '运作方式', 'how.sub': '会场前方一台 Mac。讲者不用改变任何习惯。',
      'how.1h': '讲', 'how.1p': '讲者身上一支麦克风。App 把声音流式发送到腾讯实时语音翻译，每一句讲完就拿回翻译。',
      'how.2h': '显示', 'how.2p': '投影机上的显示窗口、幻灯片上的透明覆盖层，或给手机用的分享链接和二维码。竖向字幕条、横向字幕栏、幻灯片上的文字都有预设。',
      'how.3h': '保存', 'how.3p': '录音从不依赖网络。之后：云端整理的完整字幕、烧录字幕的 MP4，以及一份 PDF 学习摘要。',
      'where.h2': '适用场合', 'where.sub': '凡是“跟得上内容”决定了“在场”还是“参与”的场合。',
      'where.1h': '会议与讲座<small>Conferences and talks</small>', 'where.1p': '会场屏幕、幻灯片和观众席每一部手机，只需一台笔记本电脑。',
      'where.2h': '课堂与工作坊<small>Classes and workshops</small>', 'where.2p': '学生在自己的屏幕上跟读；录音和摘要就是笔记。',
      'where.3h': '会议室<small>Meetings</small>', 'where.3p': '粤语和普通话讲者同处一室，读的是同一行字幕。',
      'where.4h': '视频与录音<small>Video and audio files</small>', 'where.4p': '把文件拖进网页版：几分钟内有字幕，可以修改字幕，导出 SRT、VTT、纯文本或 MP4。',
      'room.h2': '为会场而造', 'room.sub': 'App 的每一部分都是在真实讲座中用出来的。',
      'room.1h': '覆盖在任何屏幕上', 'room.1p': '幻灯片上的透明窗口，可放到每一个屏幕，包括虚拟屏幕，从菜单栏的“字幕”项目操作。',
      'room.2h': '手机跟读', 'room.2p': '分享链接和二维码；观众自选翻译、原文或双语，以及自己的字体大小。声音从不离开这台 Mac。',
      'room.3h': '录音不会断', 'room.3p': '讲座进行时 MP3 和字幕文件就在本机写入；断线只会暂停字幕，不会暂停录音。',
      'room.4h': '云端重新加字幕', 'room.4p': '讲座之后把整段录音一次过识别和翻译，补回断线留下的空白。',
      'room.5h': '词汇表', 'room.5p': '识别器应该偏向的人名、地名和术语，跟账户一起保存，App 和网页共用。',
      'room.6h': '学习摘要', 'room.6p': '一份可点时间戳的精简摘要，Markdown 或 A4 PDF。',
      'files.h2': '文件也可以', 'files.sub': '上传最长五小时的视频或录音。选择讲话语言和字幕语言；字幕按标点切分，每行最多 22 字，跟随语音的时间。',
      'files.open': '打开网页版',
      'start.h2': '开始使用', 'start.sub': '下载 App 然后登录。账户由运营 See Subtitles 的团队创建；告诉我们你会为什么加字幕，我们替你开设。',
      'form.name': '姓名', 'form.email': '邮箱', 'form.org': '机构或活动', 'form.note': '你会为什么加字幕？讲座、课堂、文件……', 'form.submit': '申请账户',
      'form.sent': '已收到。我们会回复到 {email}。', 'form.err': '请填写可以回复的邮箱地址。',
      'foot.download': '下载', 'foot.web': '网页版',
      'dl.version': 'See Subtitles {version} · macOS 13 或以上、Apple 芯片', 'dl.none': '尚未发布可下载的版本；先登录或申请账户。',
    },
  };
  T.en = {
    'form.sent': 'Thanks. We will reply to {email}.', 'form.err': 'Please give an email address we can reply to.',
    'dl.version': 'See Subtitles {version} · macOS 13 or later, Apple silicon', 'dl.none': 'No build is published for download yet; log in or request an account.',
  };
  // English lives in the markup: remember it so the toggle can go back
  const nodes = [...document.querySelectorAll('[data-t]')];
  for (const n of nodes) { const attr = n.dataset.attr; n.dataset.en = attr ? n.getAttribute(attr) : n.innerHTML; }
  let lang = 'en';
  const msg = (key, vars = {}) => { const s = (T[lang] && T[lang][key]) || (T.en[key]) || ''; return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] || ''); };
  function setLang(l) {
    lang = T[l] ? l : 'en';
    document.documentElement.lang = lang === 'en' ? 'en' : lang;
    for (const n of nodes) {
      const key = n.dataset.t; const attr = n.dataset.attr;
      const val = lang === 'en' ? n.dataset.en : (T[lang][key] ?? n.dataset.en);
      if (attr) n.setAttribute(attr, val); else n.innerHTML = val;
    }
    for (const b of $('lang').querySelectorAll('button')) b.classList.toggle('on', b.dataset.lang === lang);
    try { localStorage.setItem('site.lang', lang); } catch { /* private mode */ }
    renderDownload();
  }
  $('lang').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setLang(b.dataset.lang); });

  // the download link: the newest build published on this server
  let release = null;
  function renderDownload() {
    const links = document.querySelectorAll('a.dl');
    if (release && release.dmg) {
      for (const a of links) { a.href = release.dmg; a.hidden = false; }
      $('fine').textContent = msg('dl.version', { version: release.version });
      $('fine2').textContent = msg('dl.version', { version: release.version });
    } else {
      for (const a of links) { if (a.closest('.nav')) a.hidden = true; else if (a.closest('.foot')) a.href = '#start'; else a.href = '#start'; }
      $('fine2').textContent = msg('dl.none');
    }
  }
  fetch('/api/desktop/version').then((r) => r.json()).then((r) => { release = r && r.version ? r : null; renderDownload(); }).catch(renderDownload);

  // the QR in the hero points at this site
  try { const q = qrcode(0, 'M'); q.addData(location.origin); q.make(); $('qr').insertAdjacentHTML('afterbegin', q.createSvgTag({ cellSize: 3, margin: 0, scalable: true })); $('qrText').textContent = location.host; } catch { $('qr').hidden = true; }

  // request an account
  $('req').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const msg = $('reqMsg'); const btn = $('reqBtn');
    const body = { name: f.name.value, email: f.email.value, org: f.org.value, note: f.note.value };
    btn.disabled = true; msg.hidden = true; msg.className = 'msg wide';
    const r = await fetch('/api/request-account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: 'network error' }));
    if (r.error) { msg.textContent = /email/i.test(r.error) ? msg('form.err') : r.error; msg.classList.add('bad'); msg.hidden = false; btn.disabled = false; return; }
    msg.textContent = msg('form.sent', { email: body.email.trim() }); msg.hidden = false;
    f.reset(); btn.disabled = false;
  });

  let saved = 'en';
  try { saved = localStorage.getItem('site.lang') || ''; } catch { /* none */ }
  if (!saved) { const nav = (navigator.language || '').toLowerCase(); saved = /^zh/.test(nav) ? 'zh-Hans' : 'en'; }
  setLang(saved);
})();

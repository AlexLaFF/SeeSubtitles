// Website: language toggle (EN / 简), the monthly / pay-as-you-go pricing switch, the download link from the
// latest published build, the QR in the hero, and the request-an-account form.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const T = {
    'zh-Hans': {
      'nav.how': '运作方式', 'nav.where': '适用场合', 'nav.pricing': '价格', 'nav.files': '文件', 'nav.login': '登录', 'nav.download': '下载 Mac 版',
      'req.title': '账号需申请开通', 'req.body': '没有自助注册。告诉我们你要为什么加字幕；我们邮件回复并为你开通。已有账号？<a href="/login">登录</a>。',
      'price.h2': '价格', 'price.sub': '两种付费方式。都包含 Mac 应用、网页版，以及只保存在你 Mac 上的录音。',
      'price.mode.month': '按月订阅', 'price.mode.payg': '按用量付费',
      'price.fine.month': '价格为每月美元。划掉的金额是同样的包含小时数按“按用量付费”单价计算的费用——分享、AI 总结等功能还在此之外。小时数指每月处理的音频时长，不结转；超出部分实时字幕每小时 $1.50、文件字幕每小时 $0.60，或升级方案。申请账号时说明你想要的方案。',
      'price.fine.payg': '只为实际处理的用量付费，没有月费。额度预先购买，不过期；由我们人工开票并在你的账号上设置费率。分享到手机和其他屏幕仍属于按月订阅。',
      'plan.pick': '申请此方案', 'plan.month': '/月', 'plan.contact': '联系我们',
      'plan.vsPayg': '按用量付费价', 'plan.save': '省 {pct}%',
      'hero.h1': '让<em>现场每一个人</em>都看得见字幕。',
      'hero.p': '<span class="lang src"><b>粤语</b></span>进，<span class="lang tgt"><b>普通话</b></span>字幕出——实时显示在会场屏幕、幻灯片之上，以及全场每一部手机。散场时，录音、字幕和摘要都已经在手。',
      'hero.langs': '实时字幕支持 9 种讲话语言、46 个语言对；上传的文件支持 17 种讲话语言，可译成 31 种字幕语言。',
      'cta.download': '下载 macOS 版', 'cta.web': '打开网页版', 'hero.fine': 'macOS 13 或以上、Apple 芯片 · 文件字幕可在任何浏览器使用',
      'how.h2': '运作方式', 'how.sub': '会场前方一台 Mac。讲者什么都不用改。',
      'how.1h': '讲', 'how.1p': '讲者身上一支麦克风。声音流式发送到腾讯实时语音翻译，每一句讲完就带着译文回来。',
      'how.2h': '显示', 'how.2p': '投影机上的显示窗口、幻灯片上的透明覆盖层，或给手机扫的二维码。竖向字幕条、横向字幕栏、幻灯片上的文字，都有预设。',
      'how.3h': '保存', 'how.3p': '录音从不经过网络。之后：云端整理的完整字幕、烧录字幕的 MP4，以及一份 PDF 摘要。',
      'where.h2': '适用场合', 'where.sub': '凡是“跟得上内容”决定了“在场”还是“参与”的场合。',
      'where.1h': '会议与讲座<small>Conferences and talks</small>', 'where.1p': '会场屏幕、幻灯片，以及观众席每一部手机——只需一台笔记本电脑。',
      'where.2h': '课堂与工作坊<small>Classes and workshops</small>', 'where.2p': '学生在自己的屏幕上跟读；录音和摘要就是笔记。',
      'where.3h': '会议室<small>Meetings</small>', 'where.3p': '粤语和普通话讲者同处一室，读的是同一行字幕。',
      'where.4h': '视频与录音<small>Video and audio files</small>', 'where.4p': '把文件拖进网页版：几分钟内出字幕。可修改字幕，导出 SRT、VTT、纯文本或 MP4。',
      'room.h2': '为会场而造', 'room.sub': '这里的每一部分，都是在真实讲座中用出来的。',
      'room.1h': '覆盖在任何屏幕上', 'room.1p': '幻灯片上的透明窗口，可放到任何屏幕，包括虚拟屏幕，从菜单栏的“字幕”项目操作。',
      'room.2h': '手机跟读', 'room.2p': '一条链接和一个二维码。观众自选译文、原文或双语，以及自己的字号。声音从不离开这台 Mac。',
      'room.3h': '录音不会断', 'room.3p': '讲座进行时，MP3 和字幕就在本机写入。断线只会暂停字幕，不会暂停录音。',
      'room.4h': '云端重新加字幕', 'room.4p': '讲座之后把整段录音一次过重跑，补回断线留下的空白。',
      'room.5h': '词汇表', 'room.5p': '识别器应该偏向的人名、地名和术语。随账号保存，App 和网页共用。',
      'room.6h': '学习摘要', 'room.6p': '一份可点时间戳的精简摘要，Markdown 或 A4 PDF。',
      'files.h2': '文件也可以', 'files.sub': '上传视频或录音，最长五小时。选择讲话语言和字幕语言；字幕按标点切分，每行最多 22 字，跟随语音时间。',
      'files.open': '打开网页版',
      'start.h2': '已有账号？', 'start.sub': '下载应用，用我们为你开通的邮箱登录。网页版可在任何浏览器处理视频和录音文件。',
      'form.name': '姓名', 'form.email': '邮箱', 'form.org': '机构或活动', 'form.note': '你会为什么加字幕？讲座、课堂、文件……', 'form.submit': '申请账户',
      'form.sent': '已收到。我们会回复到 {email}。', 'form.err': '请填写可以回复的邮箱地址。',
      'foot.download': '下载', 'foot.web': '网页版',
      'dl.version': 'See Subtitles {version} · macOS 13 或以上、Apple 芯片', 'dl.none': '尚未发布可下载的版本；先登录或申请账户。',
      'rate.free': '免费', 'rate.incl': '已包含', 'rate.each': '/ 份', 'rate.hour': '/ 小时',
      'rate.note': '<b>按用量付费不含：</b>分享到手机和其他屏幕——二维码、分享链接和可打印海报。这些在按月订阅中。',
      'rate.cta': '申请按用量付费',
    },
  };
  T.en = {
    'form.sent': 'Thanks. We will reply to {email}.', 'form.err': 'Please give an email address we can reply to.',
    'dl.version': 'See Subtitles {version} · macOS 13 or later, Apple silicon', 'dl.none': 'No build is published for download yet; log in or request an account.',
    'price.fine.month': 'Prices in US dollars per month. The struck-through figure is what the same included hours would cost at the pay-as-you-go rates — sharing, summaries and the rest of the plan are on top of that. Hours are audio processed each month and do not carry over; extra live hours are $1.50 and extra file hours $0.60, or move up a plan. Say which plan you want when you request an account.',
    'price.fine.payg': 'Pay only for what you process — no monthly fee. Credit is bought up front and does not expire; we invoice by hand and set the rate on your account. Sharing to phones and other screens stays on the monthly plans.',
    'plan.vsPayg': 'at pay-as-you-go rates', 'plan.save': 'save {pct}%',
    'rate.free': 'Free', 'rate.incl': 'Included', 'rate.each': '/ each', 'rate.hour': '/ hour',
    'rate.note': '<b>Not in pay as you go:</b> sharing to phones and other screens — the QR code, the share link and the printable poster. Those are on the monthly plans.',
    'rate.cta': 'Request pay as you go',
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
    renderPlans();
    renderRates();
    applyMode();
    rotateLanguages();
  }
  $('lang').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setLang(b.dataset.lang); });

  // jump to the request form with the plan (or the pay-as-you-go rate) already chosen
  function requestWith(plan) {
    const form = $('req'); form.dataset.plan = plan;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => form.querySelector('input[name=name]').focus({ preventScroll: true }), 500);
  }

  // the plans: prices in USD per month; the feature lines carry both languages
  const PLANS = [
    { id: 'hobbyist', price: 28, cny: 200, liveHours: 10, fileHours: 5, en: 'Hobbyist', zh: '爱好者版',
      forEn: 'One Mac, one room: subtitles on the venue screen or over the slides, and recordings to keep.',
      forZh: '一台 Mac、一个会场：字幕显示在会场屏幕或幻灯片上，录音留档。',
      lines: [
        { en: '10 hours of live subtitles a month', zh: '每月 10 小时实时字幕' },
        { en: '5 hours of file subtitling a month', zh: '每月 5 小时文件字幕' },
        { en: 'Display window and overlay on the Mac', zh: 'Mac 上的显示窗口和悬浮字幕' },
        { en: 'Recordings with editable subtitles and MP4 export', zh: '录音、可编辑字幕和 MP4 导出' },
        { en: 'Sharing to phones and other screens (QR code, link)', zh: '分享到手机和其他屏幕（二维码、链接）', no: true },
        { en: 'AI summaries', zh: 'AI 总结', no: true },
      ] },
    { id: 'business', price: 88, cny: 630, liveHours: 40, fileHours: 20, en: 'Business', zh: '商务版', best: true,
      forEn: 'Every seat in the room follows along, and every talk ends with a summary.',
      forZh: '全场每一部手机都能跟读，每场讲话结束都有一份总结。',
      lines: [
        { en: '40 hours of live subtitles a month', zh: '每月 40 小时实时字幕' },
        { en: '20 hours of file subtitling a month', zh: '每月 20 小时文件字幕' },
        { en: 'Everything in Hobbyist', zh: '爱好者版的全部功能' },
        { en: 'Share to every phone and screen: QR code, link, printable poster', zh: '分享到每一部手机和屏幕：二维码、链接、可打印海报' },
        { en: 'AI summary for every recording, as Markdown or PDF', zh: '每段录音的 AI 总结，Markdown 或 PDF' },
        { en: 'Cloud re-subtitling of recordings and a glossary synced to your account', zh: '录音的云端重新加字幕，词汇表随账号同步' },
      ] },
    { id: 'enterprise', price: 388, cny: 2780, liveHours: 200, fileHours: 100, en: 'Enterprise', zh: '企业版',
      forEn: 'Several people, many rooms, a team that manages itself.',
      forZh: '多人、多会场，团队自行管理。',
      lines: [
        { en: '200 hours of live subtitles a month', zh: '每月 200 小时实时字幕' },
        { en: '100 hours of file subtitling a month', zh: '每月 100 小时文件字幕' },
        { en: 'Everything in Business', zh: '商务版的全部功能' },
        { en: 'Team accounts: members, roles, shared glossary, usage per member', zh: '团队账号：成员、角色、共享词汇表、按成员统计用量' },
        { en: 'Invoice billing and a named contact', zh: '对公开票，专人对接' },
        { en: 'Higher limits on request', zh: '可按需提高限额' },
      ] },
  ];
  /** What a plan's included hours would cost at the pay-as-you-go rates, so the saving is visible. */
  const rateOf = (id) => { const r = RATES.find((x) => x.id === id); return r ? r.usd : 0; };
  function paygValue(p) {
    if (!p.liveHours && !p.fileHours) return null;
    const total = (p.liveHours || 0) * rateOf('live') + (p.fileHours || 0) * rateOf('file');
    if (!(total > p.price)) return null; // never advertise a saving that is not there
    return { total, pct: Math.round((1 - p.price / total) * 100) };
  }
  const money = (v) => `$${v % 1 === 0 ? v : v.toFixed(2)}`;

  function renderPlans() {
    const box = $('plans'); if (!box) return;
    box.innerHTML = '';
    const zh = lang === 'zh-Hans';
    for (const p of PLANS) {
      const card = document.createElement('div'); card.className = `plan ${p.id}`;
      const h = document.createElement('h3'); h.textContent = zh ? p.zh : p.en;
      if (p.best) { const s = document.createElement('small'); s.textContent = zh ? '最受欢迎' : 'Most popular'; h.appendChild(s); }
      const price = document.createElement('div'); price.className = 'price';
      price.textContent = `${p.from ? (zh ? '起 ' : 'from ') : ''}$${p.price}`;
      const per = document.createElement('small'); per.textContent = (zh ? '/月' : '/month') + (zh ? ` · 约 ¥${p.cny}` : ''); price.appendChild(per);
      const cmp = paygValue(p);
      let compare = null;
      if (cmp) {
        compare = document.createElement('div'); compare.className = 'compare';
        const was = document.createElement('s'); was.textContent = money(cmp.total);
        const at = document.createElement('span'); at.textContent = msg('plan.vsPayg');
        const save = document.createElement('span'); save.className = 'save'; save.textContent = msg('plan.save', { pct: cmp.pct });
        compare.append(was, at, save);
      }
      const f = document.createElement('p'); f.className = 'for'; f.textContent = zh ? p.forZh : p.forEn;
      const ul = document.createElement('ul');
      for (const l of p.lines) { const li = document.createElement('li'); if (l.no) li.className = 'no'; li.textContent = zh ? l.zh : l.en; ul.appendChild(li); }
      const b = document.createElement('a'); b.href = '#req'; b.className = `btn ${p.best ? 'primary' : ''}`; b.textContent = zh ? (p.from ? '联系我们' : '申请此方案') : (p.from ? 'Talk to us' : 'Request this plan');
      b.addEventListener('click', (e) => { e.preventDefault(); requestWith(p.id); });
      card.append(h, price, ...(compare ? [compare] : []), f, ul, b);
      box.appendChild(card);
    }
  }

  // pay as you go: a price per hour of audio, charged only on what is actually processed.
  // `cny` is the rounded yuan equivalent shown on the Chinese page.
  const RATES = [
    { id: 'live', en: 'Live subtitles', zh: '实时字幕', unitEn: 'per hour of speech, on the venue screen or over your slides', unitZh: '每小时讲话，显示在会场屏幕或幻灯片上', usd: 3.00, cny: 21, per: 'hour' },
    { id: 'file', en: 'File subtitling', zh: '文件字幕', unitEn: 'per hour of uploaded video or audio', unitZh: '每小时上传的视频或录音', usd: 0.90, cny: 6.5, per: 'hour' },
    { en: 'Cloud re-subtitling', zh: '云端重新加字幕', unitEn: 'per hour of recording, run again in one pass', unitZh: '每小时录音，整段重跑一次', usd: 0.90, cny: 6.5, per: 'hour' },
    { en: 'AI summary', zh: 'AI 摘要', unitEn: 'each, as Markdown or an A4 PDF', unitZh: '每份，Markdown 或 A4 PDF', usd: 0.75, cny: 5.4, per: 'each' },
    { en: 'MP4 with burned-in subtitles', zh: '烧录字幕的 MP4', unitEn: 'per hour of video, in the web app — free on the Mac', unitZh: '每小时视频，网页版——在 Mac 上免费', usd: 0.50, cny: 3.6, per: 'hour' },
    { en: 'MP3, SRT, VTT and plain text', zh: 'MP3、SRT、VTT 和纯文本', unitEn: 'written on your Mac as the talk runs', unitZh: '讲座进行时就在你的 Mac 上写入', free: true },
    { en: 'Display window, overlay, glossary, recordings', zh: '显示窗口、悬浮字幕、词汇表、录音', unitEn: 'the app itself, at no charge', unitZh: '应用本身，不收费', incl: true },
  ];
  function renderRates() {
    const box = $('rates'); if (!box) return;
    box.innerHTML = '';
    const zh = lang === 'zh-Hans';
    for (const r of RATES) {
      const row = document.createElement('div'); row.className = 'r';
      const left = document.createElement('div');
      const b = document.createElement('b'); b.textContent = zh ? r.zh : r.en;
      const s = document.createElement('small'); s.textContent = zh ? r.unitZh : r.unitEn;
      left.append(b, s);
      const amt = document.createElement('div'); amt.className = 'amt';
      if (r.free || r.incl) { amt.classList.add('free'); amt.textContent = msg(r.free ? 'rate.free' : 'rate.incl'); }
      else {
        amt.textContent = `$${r.usd.toFixed(2)}`;
        const per = document.createElement('small');
        per.textContent = msg(r.per === 'each' ? 'rate.each' : 'rate.hour') + (zh ? ` · 约 ¥${r.cny}` : '');
        amt.appendChild(per);
      }
      row.append(left, amt);
      box.appendChild(row);
    }
    const note = document.createElement('div'); note.className = 'note'; note.innerHTML = msg('rate.note');
    const go = document.createElement('div'); go.className = 'go';
    const a = document.createElement('a'); a.href = '#req'; a.className = 'btn primary'; a.textContent = msg('rate.cta');
    a.addEventListener('click', (e) => { e.preventDefault(); requestWith('payg'); });
    go.appendChild(a);
    box.append(note, go);
  }

  // monthly / pay as you go
  let mode = 'month';
  function applyMode() {
    $('plans').hidden = mode !== 'month';
    $('rates').hidden = mode !== 'payg';
    $('priceFine').textContent = msg(mode === 'month' ? 'price.fine.month' : 'price.fine.payg');
    for (const b of $('modes').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === mode);
  }
  $('modes').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    mode = b.dataset.mode;
    try { localStorage.setItem('site.mode', mode); } catch { /* private mode */ }
    applyMode();
  });
  try { mode = localStorage.getItem('site.mode') === 'payg' ? 'payg' : 'month'; } catch { /* none */ }

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

  // ---- the two languages in the pitch walk through every pair the speech API accepts.
  // The matrix comes from /schema.js, the same table the app connects with, so the website cannot advertise
  // a pair Tencent would refuse. Without it (schema.js failed to load) the sentence simply stays still.
  const LANG = {
    yue: ['Cantonese', '粤语'], zh: ['Mandarin', '普通话'], zh_en: ['Mandarin + English', '中英混合'],
    en: ['English', '英语'], ja: ['Japanese', '日语'], ko: ['Korean', '韩语'],
    id: ['Indonesian', '印尼语'], th: ['Thai', '泰语'], ru: ['Russian', '俄语'],
  };
  const HOLD_MS = 2800;
  const OPENERS = ['yue>zh', 'yue>en', 'zh>en', 'en>zh']; // the sentence always starts on the flagship pair
  let rotTimer = null;

  /** Every pair worth showing (same-language pairs are transcription, not the promise the sentence makes),
   *  opening on OPENERS and then ordered so each step changes one word where it can — a ticker, not a slot
   *  machine. Returns [] when /schema.js is missing, which leaves the sentence still. */
  function languagePairs() {
    const matrix = window.SCHEMA && SCHEMA.LIVE_PAIRS;
    if (!matrix) return [];
    const left = new Map();
    for (const [source, targets] of Object.entries(matrix)) {
      for (const target of targets) if (source !== target && LANG[source] && LANG[target]) left.set(`${source}>${target}`, [source, target]);
    }
    const out = [];
    for (const key of OPENERS) if (left.has(key)) { out.push(left.get(key)); left.delete(key); }
    if (!out.length && left.size) { const [key, pair] = left.entries().next().value; out.push(pair); left.delete(key); }
    while (left.size) {
      const [source, target] = out[out.length - 1];
      const rest = [...left];
      const [key, pair] = rest.find(([, [s, t]]) => (s === source) !== (t === target)) || rest[0];
      out.push(pair);
      left.delete(key);
    }
    return out;
  }

  /** Swap one word: lift the old one out, re-flow the sentence to the new width while nothing is visible,
   *  then drop the new one in — so the box is never caught clipping a word it has not finished opening for. */
  function setWord(box, text) {
    const word = box && box.firstElementChild;
    if (!word || word.textContent === text) return;
    box.style.width = `${word.offsetWidth}px`;
    box.classList.add('turning');
    setTimeout(() => {
      word.textContent = text;
      box.style.width = `${word.offsetWidth}px`; // nowrap keeps the word at its natural width inside the narrow box
      setTimeout(() => box.classList.remove('turning'), 260); // matches the width transition in site.css
    }, 170);
  }

  function rotateLanguages() {
    clearTimeout(rotTimer);
    const src = document.querySelector('.hero .lang.src');
    const tgt = document.querySelector('.hero .lang.tgt');
    if (!src || !tgt) return;
    for (const box of [src, tgt]) box.style.width = `${box.firstElementChild.offsetWidth}px`;
    const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pairs = languagePairs();
    if (still || pairs.length < 2) return;
    const name = (code) => LANG[code][lang === 'en' ? 0 : 1];
    let i = 0;
    const step = () => {
      if (!document.hidden) { // a background tab should not race through the list unseen
        i = (i + 1) % pairs.length;
        setWord(src, name(pairs[i][0]));
        setWord(tgt, name(pairs[i][1]));
      }
      rotTimer = setTimeout(step, HOLD_MS);
    };
    rotTimer = setTimeout(step, HOLD_MS);
  }
  // the boxes are sized from the rendered text, so re-measure once the brand fonts have replaced the fallback
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(rotateLanguages);

  // request an account
  $('req').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const box = $('reqMsg'); const btn = $('reqBtn');
    const body = { name: f.name.value, email: f.email.value, org: f.org.value, note: f.note.value, plan: f.dataset.plan || '' };
    btn.disabled = true; box.hidden = true; box.className = 'msg wide';
    const r = await fetch('/api/request-account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: 'network error' }));
    if (r.error) { box.textContent = /email/i.test(r.error) ? msg('form.err') : r.error; box.classList.add('bad'); box.hidden = false; btn.disabled = false; return; }
    box.textContent = msg('form.sent', { email: body.email.trim() }); box.hidden = false;
    f.reset(); delete f.dataset.plan; btn.disabled = false;
  });

  let saved = 'en';
  try { saved = localStorage.getItem('site.lang') || ''; } catch { /* none */ }
  if (!saved) { const nav = (navigator.language || '').toLowerCase(); saved = /^zh/.test(nav) ? 'zh-Hans' : 'en'; }
  setLang(saved);
})();

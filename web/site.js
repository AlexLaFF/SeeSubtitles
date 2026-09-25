// Public website: language, pricing, latest Mac build, and account requests.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const T = {
    'zh-Hans': {
      'skip': '跳到正文',
      'meta.description': '为讲座、课堂和会议实时识别并翻译语音。字幕同步显示在大屏和手机上，散场后留下录音、可编辑字幕和摘要。',
      'nav.label': '主导航', 'nav.product': '产品', 'nav.workflow': '运作方式', 'nav.pricing': '价格', 'nav.login': '登录', 'nav.request': '申请使用 ↗',
      'hero.eyebrow': '实时跟上，随时回看。',
      'hero.h1': '让每句话，<br><em>都被看见。</em>',
      'hero.p': '每句话都能实时翻译，清楚显示在会场大屏、幻灯片和观众的手机上。散场后，保留录音、修订字幕，需要时再生成摘要。',
      'hero.cta': '申请使用 ↗', 'hero.see': '看看如何运作 ↓',
      'hero.note': 'Mac 负责现场字幕 · 网页版处理视频和录音',
      'hero.art': '会场大屏和手机上的实时翻译字幕示意图',
      'hero.bottom': '为现场而生，也为散场以后准备。',
      'mock.display': '会场大屏', 'mock.share': '一场讲话，每块屏幕。', 'mock.shareSub': '通过链接或二维码分享', 'mock.phone': '实时跟读',
      'language.label': '实时语言组合示例',
      'language.kicker': '自在表达，让更多人听懂。',
      'language.live': '实时语言组合 <span aria-hidden="true">↗</span>',
      'language.caption': '一种语言说出来，另一种语言同步显示。对话继续，字幕也不会停。',
      'language.hint': '这里只展示 See Subtitles 支持的部分实时语言组合。',
      'language.all': '查看全部输入与字幕语言 ↗',
      'languages.kicker': '完整语言列表',
      'languages.title': '支持哪些语言，一目了然。',
      'languages.intro': '输入是录音中说的语言，输出是你选择的字幕语言。实时讲话和上传文件的选项不同，下面分别列出。',
      'languages.tag.live1': '01 / 实时', 'languages.tag.live2': '02 / 实时',
      'languages.tag.file3': '03 / 文件', 'languages.tag.file4': '04 / 文件',
      'languages.live.input': '讲话输入语言', 'languages.live.output': '字幕输出语言',
      'languages.file.input': '音视频输入语言', 'languages.file.output': '字幕输出语言',
      'languages.live.input.note': '列表中的“普通话 + 英语”是混合输入选项，不是另一种语言。也可选多语种自动识别；效果取决于语言和音频质量。',
      'languages.live.output.note': '标准实时模式中，上列任一输入选项均可搭配这些字幕语言。可选的合并实时模式支持的组合较少。',
      'languages.file.input.note': '这里列出所有可选的识别选项，包括混合语言、大模型和自动识别模式。',
      'languages.file.output.note': '也可以不翻译，只保留原文字幕。',
      'product.kicker': '01 / 实时体验', 'product.h2': '一个人讲。<br><em>全场都跟上。</em>',
      'product.intro': '讲者说话时，字幕随即出现，译文紧接而来。观众不必等下一页幻灯片，也不必请讲者重复。',
      'product.screen.h': '大屏幕，看得清。', 'product.screen.p': '投影机上显示清晰字幕，也能覆盖在幻灯片上。一台 Mac 就能控制现场。',
      'product.phone.h': '每个座位，跟得上。', 'product.phone.p': '观众扫二维码或打开链接，就能在手机上跟读，自选原文、译文或双语，并调整字号。',
      'product.record.h': '重要内容，留得住。', 'product.record.p': '录音和字幕在讲话时写入本机。即使网络中断，录音也不会丢失。',
      'workflow.kicker': '02 / 散场以后', 'workflow.h2': '对话结束了，<br><em>价值还在。</em>',
      'workflow.intro': '让现场内容变成可用的资料。重新为录音加字幕、修订文字，让大家随时回看重点。',
      'workflow.one.h': '修好每一行', 'workflow.one.p': '改正人名，补回漏掉的话，字幕时间仍与声音对齐。',
      'workflow.two.h': '按需要导出', 'workflow.two.p': '下载 SRT、VTT、纯文本，或烧录字幕的 MP4。',
      'workflow.three.h': '把重点带走', 'workflow.three.p': '生成带时间戳的精简摘要，导出 Markdown 或 PDF。',
      'mock.summary': '摘要已生成', 'mock.summaryLine': '一页，读懂重点。',
      'files.kicker': '03 / 文件也可以', 'files.h2': '已经录好了？<br><em>从这里开始。</em>',
      'files.p': '把视频或录音拖进网页版，取得按时间对齐、可编辑的字幕。翻译会参考整段内容，让前后用词一致。',
      'files.cta': '打开网页版 ↗',
      'uses.kicker': '为在场的每个人而造', 'uses.h2': '无论为何相聚，<br><em>都别让人掉队。</em>',
      'uses.one.h': '讲座与大会', 'uses.one.p': '会场大屏、幻灯片、观众手机，都能看见同一场讲话。',
      'uses.two.h': '课堂与工作坊', 'uses.two.p': '学生按自己的节奏跟读，课后还能回看完整内容。',
      'uses.three.h': '多语言会议', 'uses.three.p': '实时识别和翻译，帮助不同语言的人参与同一场对话。',
      'price.kicker': '选择适合你的方式', 'price.h2': '方案与价格', 'price.sub': '按月使用，照顾全场；或按实际处理的音频量付费。', 'price.label': '价格方案',
      'price.mode.month': '按月订阅', 'price.mode.payg': '按用量付费',
      'price.fine.month': '价格为每月美元。划掉的金额是同样的包含小时数按“按用量付费”单价计算的费用——分享、AI 总结等功能还在此之外。小时数指每月处理的音频时长，不结转；超出部分实时字幕每小时 $1.50、文件字幕每小时 $0.60，或升级方案。申请账号时说明你想要的方案。',
      'price.fine.payg': '只为实际处理的用量付费，没有月费。额度预先购买，不过期；由我们人工开票并在你的账号上设置费率。分享到手机和其他屏幕仍属于按月订阅。',
      'plan.pick': '申请此方案', 'plan.month': '/月', 'plan.contact': '联系我们',
      'plan.vsPayg': '按用量付费价', 'plan.save': '省 {pct}%',
      'request.kicker': '下一场讲话，从这里开始', 'request.h2': '给每种声音，<br><em>留一个位置。</em>',
      'request.p': '告诉我们你要为什么加字幕。我们会通过邮件回复，帮你开通合适的账号。',
      'request.already': '已经有账号？', 'request.download': '下载 Mac 版 ↗', 'request.login': '登录 ↗',
      'req.title': '申请使用', 'req.body': '只需填写几项信息，接下来交给我们。',
      'form.nameLabel': '你的姓名', 'form.emailLabel': '邮箱', 'form.orgLabel': '机构或活动', 'form.noteLabel': '你要为哪些内容加字幕？',
      'form.name': '姓名', 'form.email': 'you@example.com', 'form.org': '选填', 'form.note': '讲座、课堂、会议、文件……', 'form.submit': '发送申请 ↗',
      'request.formFoot': '账号需申请开通，暂不提供自助注册。',
      'foot.line': '让每句话，都传到每个人耳边。', 'foot.product': '产品', 'foot.pricing': '价格', 'foot.made': '为值得聆听的每一刻而造。',
      'form.sent': '已收到。我们会回复到 {email}。', 'form.err': '请填写可以回复的邮箱地址。',
      'foot.download': '下载', 'foot.web': '网页版',
      'dl.version': 'See Subtitles {version} · macOS 13 或以上、Apple 芯片', 'dl.none': '尚未发布可下载的版本；先登录或申请账户。',
      'dl.preview': '这是本地预览。下载和账号申请请在 seesubtitles.com 使用。',
      'form.preview': '这是本地预览。账号申请请在 seesubtitles.com 提交。',
      'rate.free': '免费', 'rate.incl': '已包含', 'rate.each': '/ 份', 'rate.hour': '/ 小时',
      'rate.note': '<b>按用量付费不含：</b>分享到手机和其他屏幕——二维码、分享链接和可打印海报。这些在按月订阅中。',
      'rate.cta': '申请按用量付费',
    },
  };
  T.en = {
    'form.sent': 'Thanks. We will reply to {email}.', 'form.err': 'Please give an email address we can reply to.',
    'dl.version': 'See Subtitles {version} · macOS 13 or later, Apple silicon', 'dl.none': 'No build is published for download yet; log in or request an account.',
    'dl.preview': 'Local preview · downloads and account requests work at seesubtitles.com.',
    'form.preview': 'This is a local preview. Request an account at seesubtitles.com.',
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

  // Rotate only language pairs the live speech pipeline accepts. The served page loads the
  // shared schema; the file preview uses the same source file, with a small valid fallback.
  const LANG = {
    yue: ['Cantonese', '粤语'], zh: ['Mandarin', '普通话'],
    en: ['English', '英语'], ja: ['Japanese', '日语'],
    ko: ['Korean', '韩语'], id: ['Indonesian', '印尼语'],
    th: ['Thai', '泰语'], ru: ['Russian', '俄语'],
  };
  const FALLBACK_PAIRS = [['yue', 'zh'], ['id', 'en'], ['en', 'ja'], ['ko', 'zh'], ['th', 'en'], ['ru', 'zh']];
  let pairs = FALLBACK_PAIRS;
  let pairIndex = 0;
  let pairTimer = null;
  let flipTimer = null;

  function orderedPairs(matrix) {
    if (!matrix) return [];
    const left = new Map();
    for (const [source, targets] of Object.entries(matrix)) {
      for (const target of targets) if (source !== target && LANG[source] && LANG[target]) left.set(`${source}>${target}`, [source, target]);
    }
    if (!left.size) return [];
    const first = left.has('yue>zh') ? 'yue>zh' : left.keys().next().value;
    const out = [left.get(first)];
    left.delete(first);
    const seen = new Map(out[0].map((code) => [code, 0]));
    while (left.size) {
      const step = out.length;
      const [wasSource, wasTarget] = out[step - 1];
      let bestKey;
      let best = -Infinity;
      for (const [key, [source, target]] of left) {
        let score = (source !== wasSource ? 100 : 0) + (target !== wasTarget ? 100 : 0);
        if (source !== wasTarget && target !== wasSource) score += 40;
        score += Math.min(step - (seen.has(source) ? seen.get(source) : -10), 14);
        score += Math.min(step - (seen.has(target) ? seen.get(target) : -10), 14);
        if (score > best) { best = score; bestKey = key; }
      }
      const pair = left.get(bestKey);
      out.push(pair);
      left.delete(bestKey);
      seen.set(pair[0], step);
      seen.set(pair[1], step);
    }
    return out;
  }

  function showLanguagePair(animate = false) {
    const source = $('languageSource');
    const target = $('languageTarget');
    const [from, to] = pairs[pairIndex];
    const names = [LANG[from][lang === 'en' ? 0 : 1], LANG[to][lang === 'en' ? 0 : 1]];
    clearTimeout(flipTimer);
    source.classList.remove('turning');
    target.classList.remove('turning');
    if (!animate) {
      source.firstElementChild.textContent = names[0];
      target.firstElementChild.textContent = names[1];
      return;
    }
    source.classList.add('turning');
    target.classList.add('turning');
    flipTimer = setTimeout(() => {
      source.firstElementChild.textContent = names[0];
      target.firstElementChild.textContent = names[1];
      source.classList.remove('turning');
      target.classList.remove('turning');
    }, 170);
  }

  function startLanguageRotation() {
    clearTimeout(pairTimer);
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const step = () => {
      if (!document.hidden) {
        pairIndex = (pairIndex + 1) % pairs.length;
        showLanguagePair(true);
      }
      pairTimer = setTimeout(step, 2800);
    };
    pairTimer = setTimeout(step, 2800);
  }

  function loadLanguagePairs() {
    const script = document.createElement('script');
    script.src = location.protocol === 'file:' ? '../core/schema.js' : '/schema.js';
    script.onload = () => {
      const available = orderedPairs(window.SCHEMA && window.SCHEMA.LIVE_PAIRS);
      if (available.length < 2) return;
      pairs = available;
      pairIndex = 0;
      showLanguagePair();
      startLanguageRotation();
    };
    document.head.appendChild(script);
  }

  function renderLanguageReference() {
    const lists = window.SITE_LANGUAGES;
    if (!lists) return;
    for (const [key, id] of [
      ['liveInput', 'liveInputLanguages'], ['liveOutput', 'liveOutputLanguages'],
      ['fileInput', 'fileInputLanguages'], ['fileOutput', 'fileOutputLanguages'],
    ]) {
      const ul = $(id);
      ul.replaceChildren();
      for (const { code, label } of lists[key]) {
        const li = document.createElement('li');
        li.dataset.code = code;
        li.textContent = label;
        ul.appendChild(li);
      }
      $(`${key}Count`).textContent = String(lists[key].length).padStart(2, '0');
    }
  }

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
    document.title = lang === 'en' ? 'See Subtitles — Make every word land' : 'See Subtitles — 让每句话都被看见';
    showLanguagePair();
  }
  $('lang').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setLang(b.dataset.lang); });

  // jump to the request form with the plan (or the pay-as-you-go rate) already chosen
  function requestWith(plan) {
    const form = $('req'); form.dataset.plan = plan;
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    form.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => form.querySelector('input[name=name]').focus({ preventScroll: true }), reduced ? 0 : 500);
  }

  // the plans: prices in USD per month; the feature lines carry both languages
  const PLANS = [
    { id: 'hobbyist', price: 28, cny: 200, liveHours: 10, fileHours: 5, en: 'Hobbyist', zh: '爱好者版',
      forEn: 'One Mac, one room: subtitles on the venue screen or over the slides, and recordings to keep.',
      forZh: '一台 Mac、一个会场：字幕显示在会场屏幕或幻灯片上，录音留档。',
      lines: [
        { en: '10 hours of live subtitles a month', zh: '每月 10 小时实时字幕' },
        { en: '5 hours of file subtitling a month', zh: '每月 5 小时文件字幕' },
        { en: 'One talk at a time', zh: '同时进行 1 场' },
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
        { en: 'Up to 3 talks at once', zh: '最多同时进行 3 场' },
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
        { en: 'Up to 10 talks at once, across the team', zh: '全团队最多同时进行 10 场' },
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
      $('fine2').textContent = msg('dl.version', { version: release.version });
    } else {
      for (const a of links) a.href = '#request';
      $('fine2').textContent = msg(location.protocol === 'file:' ? 'dl.preview' : 'dl.none');
    }
  }
  if (location.protocol !== 'file:') fetch('/api/desktop/version').then((r) => r.json()).then((r) => { release = r && r.version ? r : null; renderDownload(); }).catch(renderDownload);

  // request an account
  $('req').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const box = $('reqMsg'); const btn = $('reqBtn');
    if (location.protocol === 'file:') { box.textContent = msg('form.preview'); box.hidden = false; return; }
    const body = { name: f.elements.namedItem('name').value, email: f.elements.namedItem('email').value, org: f.elements.namedItem('org').value, note: f.elements.namedItem('note').value, plan: f.dataset.plan || '' };
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
  renderLanguageReference();
  startLanguageRotation();
  loadLanguagePairs();
})();

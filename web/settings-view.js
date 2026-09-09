// Settings view (desktop app): account, Tencent keys, AI summaries, recording, advanced, about.
// Talks to the Electron main process through the preload bridge (window.desktop).
(function () {
  'use strict';
  const el = Controls.el;
  const $ = (id) => document.getElementById(id);
  const view = { title: 'Settings' };
  let mounted = false;

  const SECTIONS = [['account', 'Account'], ['tencent', 'Tencent Cloud'], ['summaries', 'AI summaries'], ['recording', 'Recording'], ['advanced', 'Advanced'], ['about', 'About']];
  const row = (label, ...content) => { const r = el('div', { class: 'row wide' }); r.appendChild(el('label', {}, label)); const w = el('div', { style: 'display:flex;gap:6px;align-items:center;min-width:0' }); for (const c of content) w.appendChild(typeof c === 'string' ? el('span', {}, c) : c); r.appendChild(w); return r; };
  const hint = (t) => el('div', { class: 'hint', style: 'margin-left:160px' }, t);
  const input = (attrs) => el('input', { type: 'text', ...attrs });
  const select = (options, value) => { const s = el('select'); for (const [v, l] of options) s.appendChild(el('option', { value: v }, l)); if (value != null) s.value = value; return s; };

  view.render = async function (root) {
    Controls.reset();
    mounted = true;
    root.innerHTML = `<div class="top"><h1>Settings</h1><div class="chips"><span class="chip">Also in the menu bar: See Subtitles › Settings… (⌘,)</span></div></div>
      <div class="body set"><div class="snav" id="snav"></div><div class="col scroll" id="sbody" style="flex:1"></div></div>`;
    for (const [id, label] of SECTIONS) { const n = el('div', { class: 'nav', 'data-s': id }, label); n.addEventListener('click', () => { const t = $(`sec-${id}`); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); $('snav').appendChild(n); }
    const d = App.desktop();
    const body = $('sbody');
    if (!d) { body.appendChild(el('div', { class: 'ui empty' }, 'Settings are available in the See Subtitles app window.')); return; }
    const cfg = await d.getConfig();
    const sec = (id, title, sub) => { const s = el('div', { class: 'ui', id: `sec-${id}` }); const h = el('h3', {}, title); if (sub) h.appendChild(el('span', { class: 'hint', style: 'margin:0;font-weight:400' }, sub)); s.appendChild(h); body.appendChild(s); return s; };

    // ---- Account
    const acc = sec('account', 'Account');
    const email = input({ id: 'email', autocomplete: 'username', value: cfg.cloud.email || '' });
    const pass = el('input', { type: 'password', id: 'password', autocomplete: 'current-password' });
    const invite = input({ id: 'invite', autocomplete: 'off', placeholder: 'from the person who runs See Subtitles' });
    const btnLogin = el('button', { class: 'primary small' }, 'Log in');
    const btnSignup = el('button', { class: 'primary small' }, 'Create account');
    const status = el('div', { class: 'status-line', id: 'accStatus', style: 'flex:1' });
    const btnLogout = el('button', { class: 'small' }, 'Log out');
    const toggle = el('a', { href: '#' }, 'Create an account instead');
    const rowEmail = row('Email', email); const rowPass = row('Password', pass, btnLogin); const rowInvite = row('Invite code', invite, btnSignup); rowInvite.hidden = true;
    acc.append(rowEmail, rowPass, rowInvite);
    const h = el('div', { class: 'hint', style: 'margin-left:160px' }); h.append(toggle, ' · Logging in gives this app its Tencent keys, the share link for remote displays and cloud re-subtitling.'); acc.appendChild(h);
    acc.appendChild(row('Status', status, btnLogout));
    let creating = false;
    toggle.addEventListener('click', (e) => { e.preventDefault(); creating = !creating; rowInvite.hidden = !creating; btnLogin.hidden = creating; toggle.textContent = creating ? 'I already have an account' : 'Create an account instead'; pass.autocomplete = creating ? 'new-password' : 'current-password'; });
    const renderAcc = (c) => {
      if (!c || !c.loggedIn) { status.textContent = 'not logged in'; btnLogout.hidden = true; return; }
      status.textContent = `logged in as ${c.email}` + (c.session ? `\nsharing → ${c.shareUrl}` : '') + (c.error ? `\n${c.error}` : '');
      btnLogout.hidden = false;
    };
    const auth = async (action) => {
      status.textContent = action === 'signup' ? 'creating the account…' : 'logging in…';
      try {
        const r = await d.cloud({ action, email: email.value, password: pass.value, invite: invite.value });
        pass.value = ''; invite.value = '';
        renderAcc(r.cloud);
        if (r.keys && r.keys.startsWith('unavailable')) status.textContent += `\nkeys ${r.keys}`;
        renderKeys(await d.getConfig());
      } catch (err) { status.textContent = `${action === 'signup' ? 'sign-up' : 'login'} failed: ${err.message.replace(/^.*Error: /, '')}`; }
    };
    btnLogin.addEventListener('click', () => auth('login'));
    btnSignup.addEventListener('click', () => auth('signup'));
    btnLogout.addEventListener('click', async () => { const r = await d.cloud({ action: 'logout' }); renderAcc(r.cloud); renderKeys(await d.getConfig()); });

    // ---- Tencent
    const tc = sec('tencent', 'Tencent Cloud', '實時語音翻譯');
    const keysStatus = el('div', { class: 'status-line', style: 'flex:1' });
    const btnUseCloud = el('button', { class: 'small' }, 'Use the keys from See Subtitles');
    tc.appendChild(row('Keys', keysStatus, btnUseCloud));
    tc.appendChild(hint('The live pipeline needs Tencent keys. They arrive automatically when you log in and are stored encrypted with the macOS Keychain. Only enter your own if you run without an account.'));
    const edge = select([['auto', 'auto (switch to the mainland edge after a 404 — use with a VPN)'], ['cn', 'cn (always the mainland Guangzhou edge)'], ['system', 'system (never switch)']], cfg.edge || 'auto');
    tc.appendChild(row('Gateway edge', edge));
    const own = el('details', { class: 'fold' }); own.appendChild(el('summary', {}, 'Use my own keys instead')); const ownIn = el('div', { class: 'inner' }); own.appendChild(ownIn);
    const appid = input({ placeholder: '10-digit APPID (not the account UIN)', value: cfg.appid || '' }); const secretId = input({ placeholder: 'AKID…', value: cfg.secretId || '' }); const secretKey = el('input', { type: 'password', placeholder: cfg.secretKeySet ? '•••••••• (saved — leave blank to keep)' : '' });
    ownIn.append(row('APPID', appid), row('SecretId', secretId), row('SecretKey', secretKey), hint('Get them at console.cloud.tencent.com/cam/capi; the 实时语音翻译 service must be activated on the account. Save below to apply.'));
    tc.appendChild(own);
    const tcStatus = el('div', { class: 'status-line', style: 'flex:1' }); tc.appendChild(row('Status', tcStatus));
    const renderKeys = (c) => {
      if (c.keysSource === 'manual') { keysStatus.textContent = 'your own keys (entered below)'; btnUseCloud.hidden = false; own.open = true; }
      else if (c.keysSource === 'cloud') { keysStatus.textContent = `provided by See Subtitles${c.cloudKeysAt ? ` · fetched ${new Date(c.cloudKeysAt).toLocaleString()}` : ''}`; btnUseCloud.hidden = true; }
      else { keysStatus.textContent = c.cloud.loggedIn ? 'none yet — log in again to fetch them' : 'none yet — log in above and they arrive automatically'; btnUseCloud.hidden = true; }
    };
    btnUseCloud.addEventListener('click', async () => { await d.saveConfig({ useCloudKeys: true }); appid.value = secretId.value = secretKey.value = ''; own.open = false; renderKeys(await d.getConfig()); });
    renderKeys(cfg);

    // ---- Summaries
    const su = sec('summaries', 'AI summaries');
    const sumKey = el('input', { type: 'password', placeholder: cfg.summaryKeySet ? '•••••••• (saved — leave blank to keep)' : 'sk-ant-…' });
    const sumModel = input({ value: cfg.summaryModel || 'claude-opus-5' });
    const sumLang = select([['zh', '简体中文'], ['en', 'English'], ['yue', '粤语']], cfg.summaryLanguage || 'zh');
    const sumEffort = select([['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], cfg.summaryEffort || 'high');
    su.append(row('Anthropic API key', sumKey), hint('Generates a learning summary of a recording (Files › recording › AI summary). Stored encrypted like the other keys.'), row('Model', sumModel), row('Language', sumLang), row('Reasoning effort', sumEffort));

    // ---- Recording
    const rec = sec('recording', 'Recording');
    const dir = input({ value: cfg.recordingsDir || '', readonly: 'readonly', style: 'flex:1' }); const btnDir = el('button', { class: 'small' }, 'Choose…');
    btnDir.addEventListener('click', async () => { const p = await d.chooseFolder(); if (p) dir.value = p; });
    const bitrate = select([['96k', '96k'], ['128k', '128k'], ['192k', '192k']], cfg.bitrate || '128k');
    const mp4auto = select([['1', 'yes — video with burned-in subtitles'], ['0', 'no']], cfg.mp4.auto ? '1' : '0');
    const mp4size = select([['1080x1920', '1080×1920 portrait'], ['1920x1080', '1920×1080 landscape'], ['720x1280', '720×1280 portrait (small)']], cfg.mp4.size);
    const mp4font = el('input', { type: 'number', min: 24, max: 200, value: cfg.mp4.fontSize, style: 'width:80px' });
    const mp4show = select([['target', 'translation only'], ['both', 'translation + original']], cfg.mp4.show);
    const mp4enc = select([['libx264', 'libx264 (smaller files)'], ['h264_videotoolbox', 'h264_videotoolbox (faster)']], cfg.mp4.encoder);
    rec.append(row('Recordings folder', dir, btnDir), row('MP3 bitrate', bitrate), row('MP4 after recording', mp4auto), row('MP4 size', mp4size), row('MP4 font size', mp4font), row('MP4 subtitles', mp4show), row('MP4 encoder', mp4enc));

    // ---- Advanced
    const adv = sec('advanced', 'Advanced');
    const demo = select([['0', 'off'], ['1', 'on — scripted sentences, no microphone, no Tencent']], cfg.demo ? '1' : '0');
    adv.append(row('Demo mode', demo), hint('For laying out screens without a talk. Rehearsing with an audio file instead of the microphone is under Live › Source.'));

    // ---- About
    const ab = sec('about', 'About');
    const ver = el('span', {}, `See Subtitles ${cfg.version}${cfg.packaged ? '' : ' (running from source)'}`);
    const btnUpd = el('button', { class: 'small' }, 'Check for updates');
    btnUpd.addEventListener('click', () => d.checkUpdates());
    ab.append(row('Version', ver, btnUpd), hint('Updates are checked when the app starts. Data stays on this Mac and on seesubtitles.com for your account.'));

    // ---- Save bar
    const bar = el('div', { class: 'savebar' });
    const saved = el('span', { class: 'hint', style: 'margin:0' });
    const btnSave = el('button', { class: 'primary' }, 'Save & restart pipeline');
    btnSave.addEventListener('click', async () => {
      btnSave.disabled = true; saved.textContent = 'saving…';
      await d.saveConfig({
        appid: appid.value, secretId: secretId.value, secretKey: secretKey.value, edge: edge.value,
        summaryKey: sumKey.value, summaryModel: sumModel.value.trim() || 'claude-opus-5', summaryLanguage: sumLang.value, summaryEffort: sumEffort.value,
        recordingsDir: dir.value, bitrate: bitrate.value,
        mp4: { auto: mp4auto.value === '1', size: mp4size.value, fontSize: Number(mp4font.value) || 64, show: mp4show.value, encoder: mp4enc.value },
        demo: demo.value === '1',
      });
      secretKey.value = ''; sumKey.value = '';
      const c2 = await d.getConfig(); secretKey.placeholder = c2.secretKeySet ? '•••••••• (saved — leave blank to keep)' : ''; sumKey.placeholder = c2.summaryKeySet ? '•••••••• (saved — leave blank to keep)' : '';
      renderKeys(c2);
      saved.textContent = 'saved, pipeline restarted'; btnSave.disabled = false;
    });
    bar.append(saved, btnSave);
    body.appendChild(bar);

    view.update = () => {
      if (!mounted) return;
      const s = Sub.status || {}; const st = s.stream || {};
      renderAcc(s.cloud);
      const parts = [];
      if (s.demo) parts.push('demo mode');
      else if (s.credsError) parts.push(`✖ ${s.credsError}`);
      else parts.push(`Tencent: ${st.state || '…'}${st.edge ? ` via ${st.edge}` : ''}${st.lastError ? ` — ${st.lastError.message}` : ''}`);
      if (s.capture) parts.push(`mic: ${s.capture.device}${s.capture.alive ? ' (running)' : ''}${s.capture.lastError ? ` — ${s.capture.lastError}` : ''}`);
      tcStatus.textContent = parts.join('\n');
    };
    view.update();
  };
  view.leave = () => { mounted = false; view.update = null; };

  App.register('settings', view);
})();

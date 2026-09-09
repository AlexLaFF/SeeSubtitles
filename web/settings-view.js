// Settings view (desktop app): language, account, Tencent keys, AI summaries, recording, advanced, about.
// Talks to the Electron main process through the preload bridge (window.desktop). Strings from the catalog.
(function () {
  'use strict';
  const el = Controls.el;
  const $ = (id) => document.getElementById(id);
  const view = { get title() { return t('settings.title'); } };
  let mounted = false;

  const SECTIONS = ['general', 'account', 'tencent', 'summaries', 'recording', 'advanced', 'about'];
  const row = (label, ...content) => { const r = el('div', { class: 'row wide' }); r.appendChild(el('label', {}, label)); const w = el('div', { style: 'display:flex;gap:6px;align-items:center;min-width:0' }); for (const c of content) w.appendChild(typeof c === 'string' ? el('span', {}, c) : c); r.appendChild(w); return r; };
  const hint = (text) => el('div', { class: 'hint', style: 'margin-left:138px' }, text);
  const input = (attrs) => el('input', { type: 'text', ...attrs });
  const select = (options, value) => { const s = el('select'); for (const [v, l] of options) s.appendChild(el('option', { value: v }, l)); if (value != null) s.value = value; return s; };

  view.render = async function (root) {
    Controls.reset();
    mounted = true;
    root.innerHTML = `<div class="top"><h1>${t('settings.title')}</h1><span class="muted">${t('settings.menuHint')}</span></div>
      <div class="body"><div class="snav" id="snav"></div><div class="col scroll" id="sbody" style="flex:1"></div></div>`;
    for (const id of SECTIONS) { const n = el('div', { class: 'nav', 'data-s': id }, t(`settings.sec.${id}`)); n.addEventListener('click', () => { const x = $(`sec-${id}`); if (x) x.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); $('snav').appendChild(n); }
    const d = App.desktop();
    const body = $('sbody');
    if (!d) { body.appendChild(el('div', { class: 'ui empty' }, t('settings.appOnly'))); return; }
    const cfg = await d.getConfig();
    const sec = (id) => { const s = el('div', { class: 'ui', id: `sec-${id}` }); s.appendChild(el('h3', {}, t(`settings.sec.${id}`))); body.appendChild(s); return s; };

    // ---- General: language (applies at once, no restart)
    const gen = sec('general');
    const lang = select([['system', t('settings.lang.system')], ['en', t('settings.lang.en')], ['zh', t('settings.lang.zh')]], cfg.language || 'system');
    lang.addEventListener('change', async () => { await d.saveConfig({ language: lang.value, restart: false }); });
    gen.append(row(t('settings.language'), lang), hint(t('settings.languageHint')));

    // ---- Account
    const acc = sec('account');
    const email = input({ id: 'email', autocomplete: 'username', value: cfg.cloud.email || '' });
    const pass = el('input', { type: 'password', id: 'password', autocomplete: 'current-password' });
    const invite = input({ id: 'invite', autocomplete: 'off', placeholder: t('settings.invitePh') });
    const btnLogin = el('button', { class: 'primary small' }, t('settings.login'));
    const btnSignup = el('button', { class: 'primary small' }, t('settings.createAccount'));
    const status = el('div', { class: 'status-line', id: 'accStatus', style: 'flex:1' });
    const btnLogout = el('button', { class: 'small' }, t('settings.logout'));
    const toggle = el('a', { href: '#' }, t('settings.toggleSignup'));
    const rowPass = row(t('settings.password'), pass, btnLogin); const rowInvite = row(t('settings.invite'), invite, btnSignup); rowInvite.hidden = true;
    acc.append(row(t('settings.email'), email), rowPass, rowInvite);
    const h = el('div', { class: 'hint', style: 'margin-left:138px' }); h.append(toggle, t('settings.loginHint')); acc.appendChild(h);
    acc.appendChild(row(t('settings.status'), status, btnLogout));
    let creating = false;
    toggle.addEventListener('click', (e) => { e.preventDefault(); creating = !creating; rowInvite.hidden = !creating; btnLogin.hidden = creating; toggle.textContent = creating ? t('settings.toggleLogin') : t('settings.toggleSignup'); pass.autocomplete = creating ? 'new-password' : 'current-password'; });
    const renderAcc = (c) => {
      if (!c || !c.loggedIn) { status.textContent = t('settings.notLoggedIn'); btnLogout.hidden = true; return; }
      status.textContent = t('settings.loggedInAs', { email: c.email }) + (c.session ? `\n${t('settings.sharingTo', { url: c.shareUrl })}` : '') + (c.error ? `\n${c.error}` : '');
      btnLogout.hidden = false;
    };
    const auth = async (action) => {
      status.textContent = action === 'signup' ? t('settings.creating') : t('settings.loggingIn');
      try {
        const r = await d.cloud({ action, email: email.value, password: pass.value, invite: invite.value });
        pass.value = ''; invite.value = '';
        renderAcc(r.cloud);
        if (r.keys && r.keys.startsWith('unavailable')) status.textContent += `\n${t('settings.keysUnavailable', { status: r.keys })}`;
        renderKeys(await d.getConfig());
      } catch (err) { const msg = err.message.replace(/^.*Error: /, ''); status.textContent = action === 'signup' ? t('settings.signupFailed', { message: msg }) : t('settings.loginFailed', { message: msg }); }
    };
    btnLogin.addEventListener('click', () => auth('login'));
    btnSignup.addEventListener('click', () => auth('signup'));
    btnLogout.addEventListener('click', async () => { const r = await d.cloud({ action: 'logout' }); renderAcc(r.cloud); renderKeys(await d.getConfig()); });

    // ---- Tencent
    const tc = sec('tencent');
    const keysStatus = el('div', { class: 'status-line', style: 'flex:1' });
    const btnUseCloud = el('button', { class: 'small' }, t('settings.useCloudKeys'));
    tc.appendChild(row(t('settings.keys'), keysStatus, btnUseCloud));
    tc.appendChild(hint(t('settings.keysHint')));
    const edge = select([['auto', t('settings.edge.auto')], ['cn', t('settings.edge.cn')], ['system', t('settings.edge.system')]], cfg.edge || 'auto');
    tc.appendChild(row(t('settings.edge'), edge));
    const own = el('details', { class: 'fold' }); own.appendChild(el('summary', {}, t('settings.ownKeys'))); const ownIn = el('div', { class: 'inner' }); own.appendChild(ownIn);
    const appid = input({ placeholder: t('settings.appidPh'), value: cfg.appid || '' }); const secretId = input({ placeholder: 'AKID…', value: cfg.secretId || '' }); const secretKey = el('input', { type: 'password', placeholder: cfg.secretKeySet ? t('settings.keysSavedPh') : '' });
    ownIn.append(row(t('settings.appid'), appid), row(t('settings.secretId'), secretId), row(t('settings.secretKey'), secretKey), hint(t('settings.ownHint')));
    tc.appendChild(own);
    const tcStatus = el('div', { class: 'status-line', style: 'flex:1' }); tc.appendChild(row(t('settings.status'), tcStatus));
    const renderKeys = (c) => {
      if (c.keysSource === 'manual') { keysStatus.textContent = t('settings.keys.manual'); btnUseCloud.hidden = false; own.open = true; }
      else if (c.keysSource === 'cloud') { keysStatus.textContent = t('settings.keys.cloud') + (c.cloudKeysAt ? t('settings.keys.fetched', { when: new Date(c.cloudKeysAt).toLocaleString() }) : ''); btnUseCloud.hidden = true; }
      else { keysStatus.textContent = c.cloud.loggedIn ? t('settings.keys.noneLoggedIn') : t('settings.keys.none'); btnUseCloud.hidden = true; }
    };
    btnUseCloud.addEventListener('click', async () => { await d.saveConfig({ useCloudKeys: true }); appid.value = secretId.value = secretKey.value = ''; own.open = false; renderKeys(await d.getConfig()); });
    renderKeys(cfg);

    // ---- Summaries
    const su = sec('summaries');
    const CLOUD_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k3', 'minimax-m3'];
    const provider = select([['seesubtitles', t('sumprov.seesubtitles')], ['anthropic', t('sumprov.anthropic')]], cfg.summaryProvider || 'seesubtitles');
    const cloudModel = select(CLOUD_MODELS.map((m) => [m, t(`summodel.${m}`)]), CLOUD_MODELS.includes(cfg.summaryModel) ? cfg.summaryModel : 'deepseek-v4-flash');
    const claudeModel = input({ value: CLOUD_MODELS.includes(cfg.summaryModel) || !cfg.summaryModel ? 'claude-opus-5' : cfg.summaryModel });
    const sumKeyStatus = el('div', { class: 'status-line', style: 'flex:1' });
    const sumKey = el('input', { type: 'password', placeholder: cfg.summaryKeySet ? t('settings.keysSavedPh') : 'sk-ant-…' });
    const sumLang = select([['zh', t('sumlang.zh')], ['en', t('sumlang.en')], ['yue', t('sumlang.yue')]], cfg.summaryLanguage || 'zh');
    const sumEffort = select([['low', t('effort.low')], ['medium', t('effort.medium')], ['high', t('effort.high')]], cfg.summaryEffort || 'high');
    const rowCloudModel = row(t('settings.sumModel'), cloudModel); const rowClaudeModel = row(t('settings.sumModel'), claudeModel);
    const rowKeyStatus = row(t('settings.sumKeyStatus'), sumKeyStatus); const rowKey = row(t('settings.anthropicKey'), sumKey); const keyHint = hint(t('settings.anthropicHint'));
    su.append(hint(t('settings.sumHint')), row(t('settings.sumProvider'), provider), rowCloudModel, rowKeyStatus, rowClaudeModel, rowKey, keyHint, row(t('settings.sumLang'), sumLang), row(t('settings.effort'), sumEffort));
    const renderProvider = (c) => {
      const cloud = provider.value === 'seesubtitles';
      rowCloudModel.hidden = !cloud; rowKeyStatus.hidden = !cloud; rowClaudeModel.hidden = cloud; rowKey.hidden = cloud; keyHint.hidden = cloud;
      sumKeyStatus.textContent = c.summaryKeyFromCloud ? t('settings.sumKey.cloud') : t('settings.sumKey.none');
    };
    provider.addEventListener('change', () => renderProvider(cfg));
    renderProvider(cfg);

    // ---- Recording
    const rec = sec('recording');
    const dir = input({ value: cfg.recordingsDir || '', readonly: 'readonly', style: 'flex:1' }); const btnDir = el('button', { class: 'small' }, t('settings.choose'));
    btnDir.addEventListener('click', async () => { const p = await d.chooseFolder(); if (p) dir.value = p; });
    const bitrate = select([['96k', '96k'], ['128k', '128k'], ['192k', '192k']], cfg.bitrate || '128k');
    const mp4auto = select([['1', t('settings.mp4.yes')], ['0', t('common.no')]], cfg.mp4.auto ? '1' : '0');
    const mp4size = select([['1080x1920', t('mp4size.portrait')], ['1920x1080', t('mp4size.landscape')], ['720x1280', t('mp4size.small')]], cfg.mp4.size);
    const mp4font = el('input', { type: 'number', min: 24, max: 200, value: cfg.mp4.fontSize, style: 'width:80px' });
    const mp4show = select([['target', t('mp4show.target')], ['both', t('mp4show.both')]], cfg.mp4.show);
    const mp4enc = select([['libx264', t('mp4enc.x264')], ['h264_videotoolbox', t('mp4enc.vt')]], cfg.mp4.encoder);
    rec.append(row(t('settings.recDir'), dir, btnDir), row(t('settings.bitrate'), bitrate), row(t('settings.mp4auto'), mp4auto), row(t('settings.mp4size'), mp4size), row(t('settings.mp4font'), mp4font), row(t('settings.mp4show'), mp4show), row(t('settings.mp4enc'), mp4enc));

    // ---- Advanced
    const adv = sec('advanced');
    const startup = select([['1', t('startup.paused')], ['0', t('startup.running')]], cfg.startPaused === false ? '0' : '1');
    const demo = select([['0', t('demo.off')], ['1', t('demo.on')]], cfg.demo ? '1' : '0');
    adv.append(row(t('settings.startup'), startup), hint(t('settings.startupHint')), row(t('settings.demo'), demo), hint(t('settings.demoHint')));

    // ---- About
    const ab = sec('about');
    const ver = el('span', {}, t('settings.versionText', { version: cfg.version }) + (cfg.packaged ? '' : t('settings.fromSource')));
    const btnUpd = el('button', { class: 'small' }, t('settings.checkUpdates'));
    btnUpd.addEventListener('click', () => d.checkUpdates());
    ab.append(row(t('settings.version'), ver, btnUpd), hint(t('settings.aboutHint')));

    // ---- Save bar
    const bar = el('div', { class: 'ui', style: 'display:flex;gap:10px;align-items:center;justify-content:flex-end' });
    const saved = el('span', { class: 'muted' });
    const btnSave = el('button', { class: 'primary' }, t('settings.save'));
    btnSave.addEventListener('click', async () => {
      btnSave.disabled = true; saved.textContent = t('settings.saving');
      await d.saveConfig({
        appid: appid.value, secretId: secretId.value, secretKey: secretKey.value, edge: edge.value,
        summaryProvider: provider.value, summaryKey: sumKey.value, summaryModel: provider.value === 'seesubtitles' ? cloudModel.value : (claudeModel.value.trim() || 'claude-opus-5'), summaryLanguage: sumLang.value, summaryEffort: sumEffort.value,
        recordingsDir: dir.value, bitrate: bitrate.value,
        mp4: { auto: mp4auto.value === '1', size: mp4size.value, fontSize: Number(mp4font.value) || 64, show: mp4show.value, encoder: mp4enc.value },
        startPaused: startup.value === '1', demo: demo.value === '1',
      });
      secretKey.value = ''; sumKey.value = '';
      const c2 = await d.getConfig(); secretKey.placeholder = c2.secretKeySet ? t('settings.keysSavedPh') : ''; sumKey.placeholder = c2.summaryKeySet ? t('settings.keysSavedPh') : '';
      renderKeys(c2); renderProvider(c2);
      saved.textContent = t('settings.savedRestarted'); btnSave.disabled = false;
    });
    bar.append(saved, btnSave);
    body.appendChild(bar);

    view.update = () => {
      if (!mounted) return;
      const s = Sub.status || {}; const st = s.stream || {};
      renderAcc(s.cloud);
      const parts = [];
      if (s.demo) parts.push(t('settings.tc.demo'));
      else if (s.credsError) parts.push(`✖ ${s.credsError}`);
      else parts.push(t('settings.tc.tencent', { state: st.state || '…' }) + (st.edge ? t('settings.tc.via', { edge: st.edge }) : '') + (st.lastError ? ` — ${st.lastError.message}` : ''));
      if (s.capture) parts.push(t('settings.tc.mic', { device: s.capture.device }) + (s.capture.alive ? t('settings.tc.running') : '') + (s.capture.lastError ? ` — ${s.capture.lastError}` : ''));
      tcStatus.textContent = parts.join('\n');
    };
    view.update();
  };
  view.leave = () => { mounted = false; view.update = null; };

  App.register('settings', view);
})();

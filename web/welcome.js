// The login card (desktop app): the account is the door. On a first run it is followed by two more cards — pick the
// microphone, choose the languages — then straight to Live or Files; later log-ins go straight to Live.
(function () {
  'use strict';
  const el = Controls.el;
  const $ = (id) => document.getElementById(id);
  const view = { get title() { return t('wel.title'); } };
  const MARK = '<svg viewBox="0 0 824 824" aria-hidden="true"><rect width="824" height="824" rx="185" fill="#131210"/><circle cx="196" cy="196" r="46" fill="#ff453a"/><rect x="150" y="452" width="524" height="96" rx="48" fill="#f1ece2"/><rect x="232" y="596" width="360" height="72" rx="36" fill="#f5c518"/></svg>';
  let step = 1;
  let mounted = false;
  let cfg = null;
  const firstRun = () => !(cfg && cfg.firstRunDone);

  view.render = async function (root) {
    Controls.reset();
    mounted = true;
    document.body.classList.add('welcome');
    root.innerHTML = `<div class="fr"><div class="hd">${MARK}<span class="w">${t('brand')}</span><span class="m" id="wmode"></span></div><div class="card" id="wcard"></div></div>`;
    const d = App.desktop();
    cfg = d ? await d.getConfig() : { cloud: {} };
    if (!mounted) return;
    step = 1;
    $('wmode').textContent = firstRun() ? t('wel.firstRun') : t('wel.signIn');
    renderStep();
  };
  view.leave = () => { mounted = false; document.body.classList.remove('welcome'); };
  view.update = () => { if (mounted && step === 2) updateMeter(); };

  const stepsBar = (n) => { const s = el('div', { class: 'steps' }); for (let i = 1; i <= 3; i++) s.appendChild(el('i', { class: i <= n ? 'on' : '' })); s.appendChild(el('span', {}, t('wel.steps', { n }))); return s; };
  const fld = (label, input) => { const f = el('div', { class: 'fld' }); f.appendChild(el('label', {}, label)); f.appendChild(input); return f; };

  function renderStep() {
    const card = $('wcard'); if (!card) return;
    card.innerHTML = '';
    if (firstRun()) card.appendChild(stepsBar(step));
    if (step === 1) renderLogin(card);
    else if (step === 2) renderMic(card);
    else renderLanguages(card);
  }

  // ---- 1. account
  function renderLogin(card) {
    const d = App.desktop();
    card.appendChild(el('h2', {}, t('wel.title')));
    if (cfg.cloud && cfg.cloud.loggedIn) {
      card.appendChild(el('p', {}, t('wel.loggedIn', { email: cfg.cloud.email })));
      card.appendChild(el('span', { class: 'sp' }));
      const go = el('button', { class: 'primary' }, t('wel.continue')); go.addEventListener('click', () => { step = 2; renderStep(); }); card.appendChild(go);
      return;
    }
    card.appendChild(el('p', {}, t('wel.intro')));
    const email = el('input', { type: 'text', autocomplete: 'username', placeholder: t('wel.emailPh'), value: (cfg.cloud && cfg.cloud.email) || '' });
    const pass = el('input', { type: 'password', autocomplete: 'current-password' });
    const invite = el('input', { type: 'text', autocomplete: 'off', placeholder: t('settings.invitePh') });
    const inviteRow = fld(t('settings.invite'), invite); inviteRow.hidden = true;
    const code = el('input', { type: 'text', autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: '20', spellcheck: 'false' });
    const codeRow = fld(t('settings.totpCode'), code); codeRow.hidden = true;
    const codeHint = el('div', { class: 'hint', hidden: '' }, t('web.login.totpHint'));
    let needCode = false;
    const err = el('div', { class: 'alert', hidden: '' });
    const btn = el('button', { class: 'primary' }, t('settings.login'));
    const toggle = el('a', { href: '#' }, t('wel.haveInvite'));
    let creating = false;
    const labelBtn = () => { btn.textContent = creating ? t('settings.createAccount') : t('settings.login'); };
    toggle.addEventListener('click', (e) => { e.preventDefault(); creating = !creating; inviteRow.hidden = !creating; codeRow.hidden = creating || !needCode; codeHint.hidden = creating || !needCode; labelBtn(); toggle.textContent = creating ? t('wel.haveAccount') : t('wel.haveInvite'); pass.autocomplete = creating ? 'new-password' : 'current-password'; });
    const submit = async () => {
      if (!d) { err.textContent = t('wel.appOnly'); err.hidden = false; return; }
      err.hidden = true; btn.disabled = true; btn.textContent = creating ? t('settings.creating') : t('settings.loggingIn');
      try {
        const r = await d.cloud({ action: creating ? 'signup' : 'login', email: email.value.trim(), password: pass.value, invite: invite.value.trim(), code: code.value.trim() });
        if (r && r.totp) { // the account has a second factor: ask for the code and submit again
          needCode = true; codeRow.hidden = false; codeHint.hidden = false;
          if (r.totp === 'totp_bad') { err.textContent = t('err.totp_bad'); err.hidden = false; code.select(); } else code.focus();
          btn.disabled = false; labelBtn();
          return;
        }
        cfg = await d.getConfig();
        App.setLocked(false);
        if (r.keys && String(r.keys).startsWith('unavailable')) { err.textContent = t('wel.keysUnavailable', { status: r.keys }); err.hidden = false; }
        if (!firstRun()) { App.go('live', {}, { replace: true }); return; }
        step = 2; renderStep();
      } catch (e) { err.textContent = String(e.message || e).replace(/^.*Error: /, ''); err.hidden = false; btn.disabled = false; labelBtn(); }
    };
    btn.addEventListener('click', submit);
    for (const i of [email, pass, invite, code]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    card.append(fld(t('settings.email'), email), fld(t('settings.password'), pass), inviteRow, codeRow, codeHint, err, btn, toggle);
    setTimeout(() => (email.value ? pass : email).focus(), 0);
  }

  // ---- 2. microphone
  let devRows = [];
  function renderMic(card) {
    card.appendChild(el('h2', {}, t('wel.micTitle')));
    card.appendChild(el('p', {}, t('wel.micIntro')));
    const list = el('div', { class: 'devs' });
    const devices = (Controls.devices && Controls.devices.length) ? Controls.devices : [{ id: 'default', name: t('ctl.systemDefault') }];
    const current = (Sub.settings && Sub.settings.audioDevice) || 'default';
    devRows = [];
    for (const dev of devices) {
      const r = el('div', { class: `dev${dev.id === current ? ' on' : ''}`, 'data-id': dev.id });
      const meter = el('span', { class: 'meter' }); meter.appendChild(el('i'));
      r.append(el('span', { class: 'check' }), el('span', { class: 'nm' }, dev.id === 'default' ? t('ctl.systemDefault') : (dev.name || dev.label || dev.id)), meter);
      r.addEventListener('click', () => { Sub.update({ audioDevice: dev.id }); for (const x of devRows) x.classList.toggle('on', x.dataset.id === dev.id); updateMeter(); });
      list.appendChild(r); devRows.push(r);
    }
    card.appendChild(list);
    card.appendChild(el('span', { class: 'hint' }, t('wel.rehearseHint')));
    card.appendChild(el('span', { class: 'sp' }));
    const nav = el('div', { class: 'nav2' });
    const back = el('button', { class: 'ghost' }, t('wel.back')); back.addEventListener('click', () => { step = 1; renderStep(); });
    const go = el('button', { class: 'primary' }, t('wel.continue')); go.addEventListener('click', () => { step = 3; renderStep(); });
    nav.append(back, go); card.appendChild(nav);
    updateMeter();
  }
  function updateMeter() {
    const s = Sub.status || {};
    const db = s.level ? s.level.dbfs : null;
    const pct = db == null ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    const current = (Sub.settings && Sub.settings.audioDevice) || 'default';
    for (const r of devRows) r.querySelector('.meter i').style.width = `${r.dataset.id === current ? pct : 0}%`;
  }

  // ---- 3. languages
  function renderLanguages(card) {
    card.appendChild(el('h2', {}, t('wel.langTitle')));
    const fields = el('div', { class: 'fields' });
    Controls.renderFields(fields, ['source', 'target']);
    card.appendChild(fields);
    const stage = el('div', { class: 'stage-p' });
    const l = el('div', { class: 'l' }, '今天我们会讲一下如何用字幕。'); l.appendChild(el('span', { class: 's' }, '今日我哋会讲吓点样用字幕。')); stage.appendChild(l);
    card.appendChild(stage);
    card.appendChild(el('span', { class: 'sp' }));
    const live = el('button', { class: 'primary' }, t('wel.startLive')); live.addEventListener('click', () => finish('live'));
    const files = el('button', { class: 'ghost' }, t('wel.addFile')); files.addEventListener('click', () => finish('files'));
    card.append(live, files, el('span', { class: 'hint c' }, t('wel.hintLater')));
  }
  async function finish(target) {
    const d = App.desktop();
    if (d) { try { await d.saveConfig({ firstRunDone: true, restart: false }); } catch { /* keep going */ } }
    App.go(target, {}, { replace: true });
  }

  App.register('welcome', view);
})();

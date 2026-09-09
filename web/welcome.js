// First run (desktop app): three cards — log in, pick the microphone, choose the languages — then straight to Live
// or Files. Shown once (config.firstRunDone); everything here can be changed later under Live and Settings.
(function () {
  'use strict';
  const el = Controls.el;
  const $ = (id) => document.getElementById(id);
  const view = { title: 'Welcome' };
  const MARK = '<svg viewBox="0 0 824 824" aria-hidden="true"><rect width="824" height="824" rx="185" fill="#131210"/><circle cx="196" cy="196" r="46" fill="#ff453a"/><rect x="150" y="452" width="524" height="96" rx="48" fill="#f1ece2"/><rect x="232" y="596" width="360" height="72" rx="36" fill="#f5c518"/></svg>';
  let step = 1;
  let mounted = false;
  let ownKeys = false;
  let cfg = null;

  view.render = async function (root) {
    Controls.reset();
    mounted = true;
    document.body.classList.add('welcome');
    root.innerHTML = `<div class="fr"><div class="hd">${MARK}<span class="w">See Subtitles</span><span class="m">first run · three steps</span></div><div class="card" id="wcard"></div></div>`;
    const d = App.desktop();
    cfg = d ? await d.getConfig() : { cloud: {} };
    if (!mounted) return;
    renderStep();
  };
  view.leave = () => { mounted = false; document.body.classList.remove('welcome'); };
  view.update = () => { if (mounted && step === 2) updateMeter(); };

  const stepsBar = (n) => { const s = el('div', { class: 'steps' }); for (let i = 1; i <= 3; i++) s.appendChild(el('i', { class: i <= n ? 'on' : '' })); s.appendChild(el('span', {}, `${n} of 3`)); return s; };
  const fld = (label, input) => { const f = el('div', { class: 'fld' }); f.appendChild(el('label', {}, label)); f.appendChild(input); return f; };

  function renderStep() {
    const card = $('wcard'); if (!card) return;
    card.innerHTML = '';
    card.appendChild(stepsBar(step));
    if (step === 1) renderLogin(card);
    else if (step === 2) renderMic(card);
    else renderLanguages(card);
  }

  // ---- 1. account
  function renderLogin(card) {
    const d = App.desktop();
    card.appendChild(el('h2', {}, 'Welcome'));
    if (cfg.cloud && cfg.cloud.loggedIn) {
      card.appendChild(el('p', {}, `Logged in as ${cfg.cloud.email}. Your subtitle keys, the share link for phones and cloud re-subtitling come with the account.`));
      card.appendChild(el('span', { class: 'sp' }));
      const go = el('button', { class: 'primary' }, 'Continue'); go.addEventListener('click', () => { step = 2; renderStep(); }); card.appendChild(go);
      return;
    }
    card.appendChild(el('p', {}, 'Log in to get your subtitle keys, the share link for phones and venue screens, and cloud re-subtitling. Nothing else is needed.'));
    const email = el('input', { type: 'text', autocomplete: 'username', placeholder: 'you@example.com', value: (cfg.cloud && cfg.cloud.email) || '' });
    const pass = el('input', { type: 'password', autocomplete: 'current-password' });
    const invite = el('input', { type: 'text', autocomplete: 'off', placeholder: 'from the person who runs See Subtitles' });
    const inviteRow = fld('Invite code', invite); inviteRow.hidden = true;
    const err = el('div', { class: 'alert', hidden: '' });
    const btn = el('button', { class: 'primary' }, 'Log in');
    const toggle = el('a', { href: '#' }, 'I have an invite code · create an account');
    const own = el('a', { href: '#', class: 'quiet' }, 'Use my own Tencent keys instead');
    let creating = false;
    toggle.addEventListener('click', (e) => { e.preventDefault(); creating = !creating; inviteRow.hidden = !creating; btn.textContent = creating ? 'Create account' : 'Log in'; toggle.textContent = creating ? 'I already have an account' : 'I have an invite code · create an account'; pass.autocomplete = creating ? 'new-password' : 'current-password'; });
    own.addEventListener('click', (e) => { e.preventDefault(); ownKeys = true; step = 2; renderStep(); });
    const submit = async () => {
      if (!d) { err.textContent = 'Log in from the See Subtitles app window.'; err.hidden = false; return; }
      err.hidden = true; btn.disabled = true; btn.textContent = creating ? 'creating the account…' : 'logging in…';
      try {
        const r = await d.cloud({ action: creating ? 'signup' : 'login', email: email.value.trim(), password: pass.value, invite: invite.value.trim() });
        cfg = await d.getConfig();
        if (r.keys && String(r.keys).startsWith('unavailable')) { err.textContent = `Logged in, but the server gave no Tencent keys (${r.keys}). You can enter your own under Settings.`; err.hidden = false; }
        step = 2; renderStep();
      } catch (e) { err.textContent = String(e.message || e).replace(/^.*Error: /, ''); err.hidden = false; btn.disabled = false; btn.textContent = creating ? 'Create account' : 'Log in'; }
    };
    btn.addEventListener('click', submit);
    for (const i of [email, pass, invite]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    card.append(fld('Email', email), fld('Password', pass), inviteRow, err, btn, toggle, el('span', { class: 'sp' }), own);
    setTimeout(() => (email.value ? pass : email).focus(), 0);
  }

  // ---- 2. microphone
  let devRows = [];
  function renderMic(card) {
    card.appendChild(el('h2', {}, 'Which microphone?'));
    card.appendChild(el('p', {}, 'macOS asks once for permission. Pick the one that hears the speaker; the meter shows what it picks up right now.'));
    const list = el('div', { class: 'devs' });
    const devices = (Controls.devices && Controls.devices.length) ? Controls.devices : [{ id: 'default', name: 'System default input' }];
    const current = (Sub.settings && Sub.settings.audioDevice) || 'default';
    devRows = [];
    for (const dev of devices) {
      const r = el('div', { class: `dev${dev.id === current ? ' on' : ''}`, 'data-id': dev.id });
      const meter = el('span', { class: 'meter' }); meter.appendChild(el('i'));
      r.append(el('span', { class: 'check' }), el('span', { class: 'nm' }, dev.name || dev.label || dev.id), meter);
      r.addEventListener('click', () => { Sub.update({ audioDevice: dev.id }); for (const x of devRows) x.classList.toggle('on', x.dataset.id === dev.id); updateMeter(); });
      list.appendChild(r); devRows.push(r);
    }
    card.appendChild(list);
    card.appendChild(el('span', { class: 'hint' }, 'Rehearsing with an audio file instead of the microphone is under Live › Source.'));
    card.appendChild(el('span', { class: 'sp' }));
    const nav = el('div', { class: 'nav2' });
    const back = el('button', { class: 'ghost' }, 'Back'); back.addEventListener('click', () => { step = 1; renderStep(); });
    const go = el('button', { class: 'primary' }, 'Continue'); go.addEventListener('click', () => { step = 3; renderStep(); });
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
    card.appendChild(el('h2', {}, 'What will people hear?'));
    const fields = el('div', { class: 'fields' });
    Controls.renderFields(fields, ['source', 'target']);
    card.appendChild(fields);
    const stage = el('div', { class: 'stage-p' });
    const l = el('div', { class: 'l' }, '今天我們會講一下如何用字幕。'); l.appendChild(el('span', { class: 's' }, '今日我哋會講吓點樣用字幕。')); stage.appendChild(l);
    card.appendChild(stage);
    card.appendChild(el('span', { class: 'sp' }));
    const live = el('button', { class: 'primary' }, 'Start a live talk'); live.addEventListener('click', () => finish('live'));
    const files = el('button', { class: 'ghost' }, 'Add a file to subtitle'); files.addEventListener('click', () => finish('files'));
    card.append(live, files, el('span', { class: 'hint c' }, ownKeys ? 'Your Tencent keys go under Settings › Tencent Cloud; that is where you land next.' : 'Everything here can be changed later under Live.'));
  }
  async function finish(target) {
    const d = App.desktop();
    if (d) { try { await d.saveConfig({ firstRunDone: true, restart: false }); } catch { /* keep going */ } }
    App.go(ownKeys ? 'settings' : target);
  }

  App.register('welcome', view);
})();

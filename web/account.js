// Account page: profile, password, signed-in devices, the team (administrators), the glossary shared with the
// desktop app, and usage. Everything talks to /api/account*, /api/team* and /api/glossary. Strings from the catalog.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v != null) e.setAttribute(k, v); } if (text != null) e.textContent = text; return e; };
  const api = (p, body, method) => fetch(p, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(I18n.err(j.error ? j : { error: r.statusText })); return j; });
  const alertBox = (msg) => { const a = $('alert'); a.textContent = msg; a.hidden = !msg; };
  const locale = () => (I18n.lang === 'zh' ? 'zh-CN' : undefined);
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' }) : '–');
  const fmtAgo = (ms) => {
    if (!ms) return t('acct.never');
    const d = Date.now() - ms;
    if (d < 90_000) return t('acct.now');
    if (d < 3600_000) return t('acct.minAgo', { n: Math.round(d / 60_000) });
    if (d < 86400_000) return t('acct.hAgo', { n: Math.round(d / 3600_000) });
    if (d < 2 * 86400_000) return t('acct.yesterday');
    return new Date(ms).toLocaleDateString(locale(), { month: 'long', day: 'numeric' });
  };
  const copyBtn = (text, label) => { const b = el('button', { class: 'small' }, label || t('acct.copy')); b.onclick = () => navigator.clipboard.writeText(text).then(() => { b.textContent = t('common.copied'); setTimeout(() => { b.textContent = label || t('acct.copy'); }, 1200); }).catch(() => {}); return b; };
  const dotChip = (cls, text) => { const c = el('span', { class: `chip ${cls}` }); c.append(el('span', { class: 'dot' }), text); return c; };
  const roleName = (role) => (role === 'admin' ? t('acct.administrator') : t('acct.member'));

  let me = null;
  const sec = (id, title, sub) => {
    const s = el('section', { class: 'ui', id: `sec-${id}` });
    const h = el('h2', {}, title); if (sub) h.appendChild(el('span', { class: 'hint' }, sub));
    s.appendChild(h); $('body').appendChild(s);
    const n = el('a', { class: 'nav', href: `#sec-${id}` }, title); n.onclick = (e) => { e.preventDefault(); s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; $('snav').appendChild(n);
    return s;
  };
  const row = (label, ...content) => { const r = el('div', { class: 'row' }); r.appendChild(el('label', {}, label)); const w = el('div', { class: 'v' }); for (const c of content) w.appendChild(typeof c === 'string' ? el('span', {}, c) : c); r.appendChild(w); return r; };
  const hint = (text) => el('div', { class: 'hint ind' }, text);
  const field = (attrs) => el('input', { type: 'text', ...attrs });

  // ---- profile
  function renderProfile() {
    const s = sec('profile', t('acct.profile'));
    s.append(row(t('settings.email'), me.user.email), row(t('acct.role'), roleName(me.user.role)), row(t('acct.since'), fmtDate(me.user.created_at)));
    s.appendChild(hint(t('acct.profileHint')));
  }

  // ---- security
  function renderSecurity() {
    const s = sec('security', t('acct.security'));
    const cur = el('input', { type: 'password', autocomplete: 'current-password' });
    const next = el('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
    const again = el('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
    const btn = el('button', {}, t('acct.change'));
    const msg = el('span', { class: 'hint' });
    s.append(row(t('acct.current'), cur), row(t('acct.new'), next, el('span', { class: 'hint' }, t('acct.atLeast'))), row(t('acct.repeat'), again), row('', btn, msg));
    s.appendChild(hint(t('acct.securityHint')));
    btn.onclick = async () => {
      msg.textContent = '';
      if (next.value !== again.value) { msg.textContent = t('acct.differ'); return; }
      btn.disabled = true;
      try { await api('/api/account/password', { current: cur.value, next: next.value }); cur.value = next.value = again.value = ''; msg.textContent = t('acct.changed'); renderDevicesRows(); }
      catch (err) { msg.textContent = err.message; }
      btn.disabled = false;
    };
  }

  // ---- devices
  let devicesBox = null;
  async function renderDevicesRows() {
    if (!devicesBox) return;
    const list = await api('/api/account/tokens').catch(() => []);
    devicesBox.innerHTML = '';
    const table = el('table'); table.appendChild(el('thead')).appendChild(el('tr')).append(el('th', {}, t('acct.device')), el('th', {}, t('acct.signedIn')), el('th', {}, t('acct.lastUsed')), el('th'));
    const tb = table.appendChild(el('tbody'));
    for (const tok of list) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, `${tok.label}${tok.kind === 'bearer' ? '' : ` · ${t('acct.browser')}`}`));
      tr.appendChild(el('td', { class: 'muted' }, fmtDate(tok.created_at)));
      tr.appendChild(el('td', { class: 'muted' }, tok.current ? t('acct.thisDevice') : fmtAgo(tok.last_used)));
      const ops = el('td', { class: 'r' });
      if (!tok.current) { const b = el('button', { class: 'small' }, t('acct.signOut')); b.onclick = () => api('/api/account/tokens/revoke', { id: tok.id }).then(renderDevicesRows).catch((e) => alertBox(e.message)); ops.appendChild(b); }
      tr.appendChild(ops); tb.appendChild(tr);
    }
    devicesBox.appendChild(table);
    const all = el('button', { class: 'small' }, t('acct.signOutOthers')); all.disabled = list.length < 2;
    all.onclick = () => { if (confirm(t('acct.signOutConfirm'))) api('/api/account/tokens/revoke', { all: true }).then(renderDevicesRows).catch((e) => alertBox(e.message)); };
    devicesBox.appendChild(el('div', { class: 'btns' })).appendChild(all);
  }
  function renderDevices() {
    const s = sec('devices', t('acct.devices'), t('acct.devicesSub'));
    devicesBox = el('div'); s.appendChild(devicesBox);
    renderDevicesRows();
  }

  // ---- team (administrators)
  let teamBox = null;
  async function renderTeamRows() {
    if (!teamBox) return;
    const team = await api('/api/team').catch((e) => { alertBox(e.message); return null; });
    if (!team) return;
    teamBox.innerHTML = '';
    // members
    const table = el('table'); table.appendChild(el('thead')).appendChild(el('tr')).append(el('th', {}, t('acct.memberCol')), el('th', {}, t('acct.role')), el('th', {}, t('acct.lastActive')), el('th', {}, t('acct.sessions')), el('th', {}, t('acct.jobs')), el('th'));
    const tb = table.appendChild(el('tbody'));
    for (const u of team.users) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, u.email));
      tr.appendChild(el('td', {}, roleName(u.role)));
      tr.appendChild(el('td', { class: 'muted' }, fmtAgo(u.last_active)));
      tr.appendChild(el('td', {}, String(u.sessions))); tr.appendChild(el('td', {}, String(u.jobs)));
      const ops = el('td', { class: 'r' });
      const role = el('button', { class: 'small' }, u.role === 'admin' ? t('acct.makeMember') : t('acct.makeAdmin'));
      role.onclick = () => api(`/api/team/users/${u.id}/role`, { role: u.role === 'admin' ? 'user' : 'admin' }).then(renderTeamRows).catch((e) => alertBox(e.message));
      const reset = el('button', { class: 'small' }, t('acct.resetLink'));
      reset.onclick = async () => {
        try {
          const r = await api(`/api/team/users/${u.id}/reset`, {});
          const box = el('div', { class: 'linkbox' });
          box.append(el('div', {}, t('acct.resetText', { email: r.email })));
          const line = el('div', { class: 'v' }); line.append(field({ readonly: 'readonly', value: r.url }), copyBtn(r.url)); box.appendChild(line);
          tr.after(el('tr', { class: 'sub' })); tr.nextSibling.appendChild(el('td', { colspan: 6 })).appendChild(box);
        } catch (e) { alertBox(e.message); }
      };
      ops.append(role, reset); tr.appendChild(ops); tb.appendChild(tr);
    }
    teamBox.appendChild(table);
    // invites
    const inv = el('div', { class: 'block' }); inv.appendChild(el('h3', {}, t('acct.invites')));
    const list = el('div', { class: 'invites' });
    for (const i of team.invites) {
      const line = el('div', { class: 'v' });
      line.append(el('code', {}, i.code), el('span', { class: 'muted' }, i.used_at ? t('acct.usedBy', { email: i.used_by, when: fmtDate(i.used_at) }) : t('acct.unused', { when: fmtDate(i.created_at), by: i.created_by || '–' })));
      if (!i.used_at) { line.appendChild(copyBtn(i.code)); const d = el('button', { class: 'small' }, t('acct.delete')); d.onclick = () => api(`/api/team/invites/${i.code}`, null, 'DELETE').then(renderTeamRows).catch((e) => alertBox(e.message)); line.appendChild(d); }
      list.appendChild(line);
    }
    if (!team.invites.length) list.appendChild(el('div', { class: 'muted' }, t('web.none')));
    inv.appendChild(list);
    const mk = el('button', { class: 'small' }, t('acct.createInvite')); mk.onclick = () => api('/api/team/invites', {}).then(renderTeamRows).catch((e) => alertBox(e.message));
    inv.appendChild(el('div', { class: 'btns' })).appendChild(mk);
    inv.appendChild(hint(me.signup === 'invite' ? t('acct.inviteHintInvite') : t('acct.inviteHintOther', { mode: me.signup })));
    teamBox.appendChild(inv);
    // requests
    const req = el('div', { class: 'block' }); req.appendChild(el('h3', {}, `${t('acct.requests')} ${t('acct.fromSite')}`));
    if (!team.requests.length) req.appendChild(el('div', { class: 'muted' }, t('web.none')));
    else {
      const rt = el('table'); rt.appendChild(el('thead')).appendChild(el('tr')).append(el('th', {}, t('acct.who')), el('th', {}, t('acct.org')), el('th', {}, t('acct.what')), el('th', {}, t('acct.received')), el('th'));
      const rb = rt.appendChild(el('tbody'));
      for (const r of team.requests) {
        const tr = el('tr', { class: r.handled_at ? 'muted' : '' });
        const who = el('td'); who.append(el('div', {}, r.name || '–'), el('a', { href: `mailto:${r.email}` }, r.email)); tr.appendChild(who);
        tr.appendChild(el('td', {}, r.org || '–')); tr.appendChild(el('td', { class: 'wrap' }, r.note || '–')); tr.appendChild(el('td', { class: 'muted' }, fmtDate(r.created_at)));
        const ops = el('td', { class: 'r' });
        if (r.handled_at) ops.appendChild(el('span', { class: 'muted' }, t('acct.handled', { when: fmtDate(r.handled_at) })));
        else { const b = el('button', { class: 'small' }, t('acct.markHandled')); b.onclick = () => api(`/api/team/requests/${r.id}/handled`, {}).then(renderTeamRows).catch((e) => alertBox(e.message)); ops.appendChild(b); }
        tr.appendChild(ops); rb.appendChild(tr);
      }
      req.appendChild(rt);
    }
    teamBox.appendChild(req);
  }
  function renderTeam() {
    if (me.user.role !== 'admin') return;
    const s = sec('team', t('acct.team'), t('acct.teamSub'));
    teamBox = el('div'); s.appendChild(teamBox);
    s.appendChild(hint(t('acct.teamHint')));
    renderTeamRows();
  }

  // ---- glossary
  const MAX_TERMS = 128;
  let terms = [];
  function renderGlossary() {
    const s = sec('glossary', t('gl.title'), t('acct.glossarySub'));
    const table = el('table', { class: 'gl' }); table.appendChild(el('thead')).appendChild(el('tr')).append(el('th', {}, t('gl.term')), el('th', {}, t('gl.weight')), el('th', {}, t('gl.note')), el('th'));
    const tb = table.appendChild(el('tbody'));
    const foot = el('div', { class: 'v foot' });
    const count = el('span', { class: 'hint' });
    const save = el('button', {}, t('acct.saveGlossary'));
    const add = el('button', { class: 'small' }, t('acct.addTerm'));
    const exp = el('button', { class: 'small' }, t('gl.export'));
    const paste = el('button', { class: 'small' }, t('acct.paste'));
    const msg = el('span', { class: 'hint' });
    const draw = () => {
      tb.innerHTML = '';
      terms.forEach((it, i) => {
        const tr = el('tr');
        const term = field({ value: it.term, placeholder: t('gl.termPh'), maxlength: 40 }); term.oninput = () => { it.term = term.value; };
        const w = el('input', { type: 'number', min: 1, max: 100, value: it.weight }); w.oninput = () => { it.weight = Number(w.value); };
        const note = field({ value: it.note || '', placeholder: t('gl.notePh'), maxlength: 120 }); note.oninput = () => { it.note = note.value; };
        const rm = el('button', { class: 'small' }, t('gl.remove')); rm.onclick = () => { terms.splice(i, 1); draw(); };
        tr.appendChild(el('td')).appendChild(term); tr.appendChild(el('td')).appendChild(w); tr.appendChild(el('td')).appendChild(note); tr.appendChild(el('td', { class: 'r' })).appendChild(rm);
        tb.appendChild(tr);
      });
      if (!terms.length) tb.appendChild(el('tr')).appendChild(el('td', { colspan: 4, class: 'muted' }, t('acct.glEmpty')));
      count.textContent = t('acct.glCount', { n: terms.length, max: MAX_TERMS });
      add.disabled = terms.length >= MAX_TERMS;
    };
    add.onclick = () => { terms.push({ term: '', weight: 6, note: '' }); draw(); tb.lastChild.querySelector('input').focus(); };
    save.onclick = async () => {
      save.disabled = true; msg.textContent = t('acct.saving');
      try { const r = await api('/api/glossary', { items: terms }, 'PUT'); terms = r.items; draw(); msg.textContent = t('acct.glSaved'); }
      catch (err) { msg.textContent = err.message; }
      save.disabled = false;
    };
    exp.onclick = () => {
      const text = terms.filter((it) => it.term).map((it) => `${it.term}|${it.weight}${it.note ? `|${it.note}` : ''}`).join('\n');
      const a = el('a', { href: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`, download: 'glossary.txt' }); document.body.appendChild(a); a.click(); a.remove();
    };
    const pasteBox = el('div', { class: 'pastebox', hidden: '' });
    const ta = el('textarea', { rows: 6, placeholder: t('acct.pastePh') });
    const doPaste = el('button', { class: 'small' }, t('acct.addThese'));
    doPaste.onclick = () => {
      for (const line of ta.value.split(/\r?\n/)) {
        const [term, weight, note] = line.split(/[|｜]/).map((x) => x.trim());
        if (!term) continue;
        const cur = terms.find((it) => it.term.toLowerCase() === term.toLowerCase());
        if (cur) { if (weight) cur.weight = Number(weight) || cur.weight; if (note) cur.note = note; }
        else terms.push({ term, weight: Number(weight) || 6, note: note || '' });
      }
      ta.value = ''; pasteBox.hidden = true; draw();
    };
    pasteBox.append(ta, el('div', { class: 'btns' })); pasteBox.lastChild.append(doPaste);
    paste.onclick = () => { pasteBox.hidden = !pasteBox.hidden; if (!pasteBox.hidden) ta.focus(); };
    foot.append(add, paste, exp, count, el('span', { class: 'spacer' }), msg, save);
    s.append(table, pasteBox, foot);
    s.appendChild(hint(t('acct.glHint')));
    api('/api/glossary').then((g) => { terms = g.items || []; draw(); }).catch((e) => { msg.textContent = e.message; draw(); });
  }

  // ---- usage
  function renderUsage() {
    const s = sec('usage', t('acct.usage'), t('acct.usageSub'));
    const box = el('div', { class: 'stats' }); const note = el('div', { class: 'chips' });
    s.append(box, note);
    api('/api/usage').catch((e) => ({ errors: { usage: e.message } })).then((u) => { UsageTiles.render(box, note, u); if (box.hidden && !note.children.length) note.appendChild(el('span', { class: 'chip' }, t('acct.nothing'))); });
  }

  I18n.apply();
  document.querySelectorAll('a[data-lang]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); I18n.remember(a.dataset.lang); location.reload(); }));
  $('logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/api/logout', {}); location.href = '/login'; });
  (async () => {
    me = await api('/api/me').catch(() => null);
    if (!me) { location.href = '/login?next=%2Faccount'; return; }
    $('who').textContent = me.user.email;
    $('chips').appendChild(dotChip('ok', `${me.user.email} · ${roleName(me.user.role)}`));
    renderProfile(); renderSecurity(); renderDevices(); renderTeam(); renderGlossary(); renderUsage();
  })();
})();

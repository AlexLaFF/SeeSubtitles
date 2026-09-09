// Account page: profile, password, signed-in devices, the team (administrators), the glossary shared with the
// desktop app, and usage. Everything talks to /api/account*, /api/team* and /api/glossary.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v != null) e.setAttribute(k, v); } if (text != null) e.textContent = text; return e; };
  const api = (p, body, method) => fetch(p, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  const alertBox = (msg) => { const a = $('alert'); a.textContent = msg; a.hidden = !msg; };
  const fmtDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '–');
  const fmtAgo = (t) => {
    if (!t) return 'never';
    const d = Date.now() - t;
    if (d < 90_000) return 'now';
    if (d < 3600_000) return `${Math.round(d / 60_000)} min ago`;
    if (d < 86400_000) return `${Math.round(d / 3600_000)} h ago`;
    if (d < 2 * 86400_000) return 'yesterday';
    return new Date(t).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  };
  const copyBtn = (text, label = 'Copy') => { const b = el('button', { class: 'small' }, label); b.onclick = () => navigator.clipboard.writeText(text).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = label; }, 1200); }).catch(() => {}); return b; };
  const dotChip = (cls, text) => { const c = el('span', { class: `chip ${cls}` }); c.append(el('span', { class: 'dot' }), text); return c; };

  let me = null;
  const sec = (id, title, sub) => {
    const s = el('section', { class: 'ui', id: `sec-${id}` });
    const h = el('h2', {}, title); if (sub) h.appendChild(el('span', { class: 'hint' }, sub));
    s.appendChild(h); $('body').appendChild(s);
    const n = el('a', { class: 'nav', href: `#sec-${id}` }, title); n.onclick = (e) => { e.preventDefault(); s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; $('snav').appendChild(n);
    return s;
  };
  const row = (label, ...content) => { const r = el('div', { class: 'row' }); r.appendChild(el('label', {}, label)); const w = el('div', { class: 'v' }); for (const c of content) w.appendChild(typeof c === 'string' ? el('span', {}, c) : c); r.appendChild(w); return r; };
  const hint = (t) => el('div', { class: 'hint ind' }, t);
  const field = (attrs) => el('input', { type: 'text', ...attrs });

  // ---- profile
  function renderProfile() {
    const s = sec('profile', 'Profile');
    s.append(row('Email', me.user.email), row('Role', me.user.role === 'admin' ? 'administrator' : 'member'), row('Member since', fmtDate(me.user.created_at)));
    s.appendChild(hint('The same account logs in to the desktop app. Live sessions, files and the glossary belong to it.'));
  }

  // ---- security
  function renderSecurity() {
    const s = sec('security', 'Security');
    const cur = el('input', { type: 'password', autocomplete: 'current-password' });
    const next = el('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
    const again = el('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
    const btn = el('button', {}, 'Change password');
    const msg = el('span', { class: 'hint' });
    s.append(row('Current password', cur), row('New password', next, el('span', { class: 'hint' }, 'at least 8 characters')), row('Repeat it', again), row('', btn, msg));
    s.appendChild(hint('Changing the password signs out every other device; the desktop app asks you to log in again.'));
    btn.onclick = async () => {
      msg.textContent = '';
      if (next.value !== again.value) { msg.textContent = 'the two passwords differ'; return; }
      btn.disabled = true;
      try { await api('/api/account/password', { current: cur.value, next: next.value }); cur.value = next.value = again.value = ''; msg.textContent = 'changed · other devices signed out'; renderDevicesRows(); }
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
    const table = el('table'); table.appendChild(el('thead')).appendChild(el('tr')).append(el('th', {}, 'Device'), el('th', {}, 'Signed in'), el('th', {}, 'Last used'), el('th'));
    const tb = table.appendChild(el('tbody'));
    for (const t of list) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, `${t.label}${t.kind === 'bearer' ? '' : ' · browser'}`));
      tr.appendChild(el('td', { class: 'muted' }, fmtDate(t.created_at)));
      tr.appendChild(el('td', { class: 'muted' }, t.current ? 'now · this device' : fmtAgo(t.last_used)));
      const ops = el('td', { class: 'r' });
      if (!t.current) { const b = el('button', { class: 'small' }, 'Sign out'); b.onclick = () => api('/api/account/tokens/revoke', { id: t.id }).then(renderDevicesRows).catch((e) => alertBox(e.message)); ops.appendChild(b); }
      tr.appendChild(ops); tb.appendChild(tr);
    }
    devicesBox.appendChild(table);
    const all = el('button', { class: 'small' }, 'Sign out everywhere else'); all.disabled = list.length < 2;
    all.onclick = () => { if (confirm('Sign out every other device and browser?')) api('/api/account/tokens/revoke', { all: true }).then(renderDevicesRows).catch((e) => alertBox(e.message)); };
    devicesBox.appendChild(el('div', { class: 'btns' })).appendChild(all);
  }
  function renderDevices() {
    const s = sec('devices', 'Devices', 'where this account is signed in');
    devicesBox = el('div'); s.appendChild(devicesBox);
    renderDevicesRows();
  }

  // ---- team (administrators)
  let teamBox = null;
  async function renderTeamRows() {
    if (!teamBox) return;
    const t = await api('/api/team').catch((e) => { alertBox(e.message); return null; });
    if (!t) return;
    teamBox.innerHTML = '';
    // members
    const table = el('table'); table.appendChild(el('thead')).appendChild(el('tr')).append(el('th', {}, 'Member'), el('th', {}, 'Role'), el('th', {}, 'Last active'), el('th', {}, 'Sessions'), el('th', {}, 'Jobs'), el('th'));
    const tb = table.appendChild(el('tbody'));
    for (const u of t.users) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, u.email));
      tr.appendChild(el('td', {}, u.role === 'admin' ? 'administrator' : 'member'));
      tr.appendChild(el('td', { class: 'muted' }, fmtAgo(u.last_active)));
      tr.appendChild(el('td', {}, String(u.sessions))); tr.appendChild(el('td', {}, String(u.jobs)));
      const ops = el('td', { class: 'r' });
      const role = el('button', { class: 'small' }, u.role === 'admin' ? 'Make member' : 'Make administrator');
      role.onclick = () => api(`/api/team/users/${u.id}/role`, { role: u.role === 'admin' ? 'user' : 'admin' }).then(renderTeamRows).catch((e) => alertBox(e.message));
      const reset = el('button', { class: 'small' }, 'Reset link');
      reset.onclick = async () => {
        try {
          const r = await api(`/api/team/users/${u.id}/reset`, {});
          const box = el('div', { class: 'linkbox' });
          box.append(el('div', {}, `Send this link to ${r.email}. It works once and expires in 24 hours; when used, every device of theirs is signed out.`));
          const line = el('div', { class: 'v' }); line.append(field({ readonly: 'readonly', value: r.url }), copyBtn(r.url)); box.appendChild(line);
          tr.after(el('tr', { class: 'sub' })); tr.nextSibling.appendChild(el('td', { colspan: 6 })).appendChild(box);
        } catch (e) { alertBox(e.message); }
      };
      ops.append(role, reset); tr.appendChild(ops); tb.appendChild(tr);
    }
    teamBox.appendChild(table);
    // invites
    const inv = el('div', { class: 'block' }); inv.appendChild(el('h3', {}, 'Invite codes'));
    const list = el('div', { class: 'invites' });
    for (const i of t.invites) {
      const line = el('div', { class: 'v' });
      line.append(el('code', {}, i.code), el('span', { class: 'muted' }, i.used_at ? `used by ${i.used_by} · ${fmtDate(i.used_at)}` : `unused · created ${fmtDate(i.created_at)} by ${i.created_by || '–'}`));
      if (!i.used_at) { line.appendChild(copyBtn(i.code)); const d = el('button', { class: 'small' }, 'Delete'); d.onclick = () => api(`/api/team/invites/${i.code}`, null, 'DELETE').then(renderTeamRows).catch((e) => alertBox(e.message)); line.appendChild(d); }
      list.appendChild(line);
    }
    if (!t.invites.length) list.appendChild(el('div', { class: 'muted' }, 'none yet'));
    inv.appendChild(list);
    const mk = el('button', { class: 'small' }, 'Create invite code'); mk.onclick = () => api('/api/team/invites', {}).then(renderTeamRows).catch((e) => alertBox(e.message));
    inv.appendChild(el('div', { class: 'btns' })).appendChild(mk);
    inv.appendChild(hint(me.signup === 'invite' ? 'Sign-up is by invitation: a code is used once, under Create an account in the app or on the log-in page.' : `Sign-up is ${me.signup}; invite codes are only needed when the server runs with SIGNUP_MODE=invite.`));
    teamBox.appendChild(inv);
    // requests
    const req = el('div', { class: 'block' }); req.appendChild(el('h3', {}, 'Account requests', ' from the website'));
    if (!t.requests.length) req.appendChild(el('div', { class: 'muted' }, 'none'));
    else {
      const rt = el('table'); rt.appendChild(el('thead')).appendChild(el('tr')).append(el('th', {}, 'Who'), el('th', {}, 'Organisation or event'), el('th', {}, 'What they will subtitle'), el('th', {}, 'Received'), el('th'));
      const rb = rt.appendChild(el('tbody'));
      for (const r of t.requests) {
        const tr = el('tr', { class: r.handled_at ? 'muted' : '' });
        const who = el('td'); who.append(el('div', {}, r.name || '–'), el('a', { href: `mailto:${r.email}` }, r.email)); tr.appendChild(who);
        tr.appendChild(el('td', {}, r.org || '–')); tr.appendChild(el('td', { class: 'wrap' }, r.note || '–')); tr.appendChild(el('td', { class: 'muted' }, fmtDate(r.created_at)));
        const ops = el('td', { class: 'r' });
        if (r.handled_at) ops.appendChild(el('span', { class: 'muted' }, `handled ${fmtDate(r.handled_at)}`));
        else { const b = el('button', { class: 'small' }, 'Mark handled'); b.onclick = () => api(`/api/team/requests/${r.id}/handled`, {}).then(renderTeamRows).catch((e) => alertBox(e.message)); ops.appendChild(b); }
        tr.appendChild(ops); rb.appendChild(tr);
      }
      req.appendChild(rt);
    }
    teamBox.appendChild(req);
  }
  function renderTeam() {
    if (me.user.role !== 'admin') return;
    const s = sec('team', 'Team', 'administrators see everyone');
    teamBox = el('div'); s.appendChild(teamBox);
    s.appendChild(hint('Members see only their own files and live sessions. A reset link is the way to help someone who forgot their password.'));
    renderTeamRows();
  }

  // ---- glossary
  const MAX_TERMS = 128;
  let terms = [];
  function renderGlossary() {
    const s = sec('glossary', 'Glossary', 'names and terms the recogniser should favour');
    const table = el('table', { class: 'gl' }); table.appendChild(el('thead')).appendChild(el('tr')).append(el('th', {}, 'Term'), el('th', {}, 'Weight'), el('th', {}, 'Note'), el('th'));
    const tb = table.appendChild(el('tbody'));
    const foot = el('div', { class: 'v foot' });
    const count = el('span', { class: 'hint' });
    const save = el('button', {}, 'Save glossary');
    const add = el('button', { class: 'small' }, '+ Add term');
    const exp = el('button', { class: 'small' }, 'Export');
    const paste = el('button', { class: 'small' }, 'Paste a list…');
    const msg = el('span', { class: 'hint' });
    const draw = () => {
      tb.innerHTML = '';
      terms.forEach((t, i) => {
        const tr = el('tr');
        const term = field({ value: t.term, placeholder: 'term', maxlength: 40 }); term.oninput = () => { t.term = term.value; };
        const w = el('input', { type: 'number', min: 1, max: 100, value: t.weight }); w.oninput = () => { t.weight = Number(w.value); };
        const note = field({ value: t.note || '', placeholder: 'note', maxlength: 120 }); note.oninput = () => { t.note = note.value; };
        const rm = el('button', { class: 'small' }, 'Remove'); rm.onclick = () => { terms.splice(i, 1); draw(); };
        tr.appendChild(el('td')).appendChild(term); tr.appendChild(el('td')).appendChild(w); tr.appendChild(el('td')).appendChild(note); tr.appendChild(el('td', { class: 'r' })).appendChild(rm);
        tb.appendChild(tr);
      });
      if (!terms.length) tb.appendChild(el('tr')).appendChild(el('td', { colspan: 4, class: 'muted' }, 'No terms yet. Names, places, product names and words the recogniser gets wrong.'));
      count.textContent = `${terms.length} of ${MAX_TERMS} terms · weight 1–11, 100 forces the term`;
      add.disabled = terms.length >= MAX_TERMS;
    };
    add.onclick = () => { terms.push({ term: '', weight: 6, note: '' }); draw(); tb.lastChild.querySelector('input').focus(); };
    save.onclick = async () => {
      save.disabled = true; msg.textContent = 'saving…';
      try { const r = await api('/api/glossary', { items: terms }, 'PUT'); terms = r.items; draw(); msg.textContent = 'saved · the desktop app pulls it from Live › Glossary'; }
      catch (err) { msg.textContent = err.message; }
      save.disabled = false;
    };
    exp.onclick = () => {
      const text = terms.filter((t) => t.term).map((t) => `${t.term}|${t.weight}${t.note ? `|${t.note}` : ''}`).join('\n');
      const a = el('a', { href: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`, download: 'glossary.txt' }); document.body.appendChild(a); a.click(); a.remove();
    };
    const pasteBox = el('div', { class: 'pastebox', hidden: '' });
    const ta = el('textarea', { rows: 6, placeholder: 'One per line: 詞|權重|note — the weight and the note are optional\n騰訊雲|10|Tencent Cloud\n共融' });
    const doPaste = el('button', { class: 'small' }, 'Add these');
    doPaste.onclick = () => {
      for (const line of ta.value.split(/\r?\n/)) {
        const [term, weight, note] = line.split(/[|｜]/).map((x) => x.trim());
        if (!term) continue;
        const cur = terms.find((t) => t.term.toLowerCase() === term.toLowerCase());
        if (cur) { if (weight) cur.weight = Number(weight) || cur.weight; if (note) cur.note = note; }
        else terms.push({ term, weight: Number(weight) || 6, note: note || '' });
      }
      ta.value = ''; pasteBox.hidden = true; draw();
    };
    pasteBox.append(ta, el('div', { class: 'btns' })); pasteBox.lastChild.append(doPaste);
    paste.onclick = () => { pasteBox.hidden = !pasteBox.hidden; if (!pasteBox.hidden) ta.focus(); };
    foot.append(add, paste, exp, count, el('span', { class: 'spacer' }), msg, save);
    s.append(table, pasteBox, foot);
    s.appendChild(hint('The desktop app applies the glossary to the recogniser at its next connection (Live › Source › Glossary). Terms are per account.'));
    api('/api/glossary').then((g) => { terms = g.items || []; draw(); }).catch((e) => { msg.textContent = e.message; draw(); });
  }

  // ---- usage
  function renderUsage() {
    const s = sec('usage', 'Usage', 'this server’s Tencent account');
    const box = el('div', { class: 'stats' }); const note = el('div', { class: 'chips' });
    s.append(box, note);
    api('/api/usage').catch((e) => ({ errors: { usage: e.message } })).then((u) => { UsageTiles.render(box, note, u); if (box.hidden && !note.children.length) note.appendChild(el('span', { class: 'chip' }, 'nothing to show yet')); });
  }

  $('logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/api/logout', {}); location.href = '/login'; });
  (async () => {
    me = await api('/api/me').catch(() => null);
    if (!me) { location.href = '/login?next=%2Faccount'; return; }
    $('who').textContent = me.user.email;
    $('chips').appendChild(dotChip('ok', `${me.user.email} · ${me.user.role === 'admin' ? 'administrator' : 'member'}`));
    renderProfile(); renderSecurity(); renderDevices(); renderTeam(); renderGlossary(); renderUsage();
  })();
})();

// Glossary sheet (desktop app): the names and terms the recogniser should favour, kept in the app's config and
// synced with the account on seesubtitles.com. Applied as the pipeline's hotwords at the next connection.
(function () {
  'use strict';
  const el = Controls.el;
  const MAX = 128;
  const G = { items: [], loaded: false };

  const clean = (items) => {
    const seen = new Set(); const out = [];
    for (const it of items) {
      const term = String(it.term || '').trim().replace(/[|\n\r]/g, '');
      if (!term || seen.has(term.toLowerCase())) continue;
      seen.add(term.toLowerCase());
      let weight = Number(it.weight); if (!Number.isFinite(weight)) weight = 6;
      weight = weight >= 100 ? 100 : Math.min(11, Math.max(1, Math.round(weight)));
      out.push({ term: term.slice(0, 40), weight, note: String(it.note || '').trim().slice(0, 120) });
      if (out.length >= MAX) break;
    }
    return out;
  };
  const hotwordsText = (items) => items.map((i) => `${i.term}|${i.weight}`).join('\n');

  G.load = async function () {
    const d = App.desktop();
    if (!d) return G.items;
    const cfg = await d.getConfig();
    G.items = Array.isArray(cfg.glossary) ? clean(cfg.glossary) : [];
    G.loaded = true;
    return G.items;
  };

  G.open = function () {
    const d = App.desktop();
    document.querySelectorAll('.shell .scrim').forEach((x) => x.remove());
    const scrim = el('div', { class: 'scrim' });
    const sheet = el('div', { class: 'sheet gl' });
    const head = el('div', { class: 'sh' });
    head.append(el('h2', {}, 'Glossary'), el('span', { class: 'hint' }, 'Names and terms the recogniser should favour. Applied at the next connection through a graceful rotation.'));
    const table = el('table'); table.appendChild(el('thead')).appendChild(el('tr')).append(el('th', {}, 'Term'), el('th', {}, 'Weight 1–11'), el('th', {}, 'Note'), el('th'));
    const tb = table.appendChild(el('tbody'));
    const items = G.items.map((i) => ({ ...i }));
    const count = el('span', { class: 'hint' });
    const msg = el('span', { class: 'hint', style: 'color:var(--fg-2)' });
    const draw = () => {
      tb.innerHTML = '';
      items.forEach((t, i) => {
        const tr = el('tr');
        const term = el('input', { type: 'text', value: t.term, placeholder: 'term', maxlength: 40 }); term.addEventListener('input', () => { t.term = term.value; });
        const w = el('input', { type: 'number', min: 1, max: 100, value: t.weight, class: 'num' }); w.addEventListener('input', () => { t.weight = Number(w.value); });
        const note = el('input', { type: 'text', value: t.note || '', placeholder: 'note', maxlength: 120 }); note.addEventListener('input', () => { t.note = note.value; });
        const rm = el('button', { class: 'small' }, 'Remove'); rm.addEventListener('click', () => { items.splice(i, 1); draw(); });
        tr.appendChild(el('td')).appendChild(term); tr.appendChild(el('td', { class: 'w' })).appendChild(w); tr.appendChild(el('td')).appendChild(note); tr.appendChild(el('td', { class: 'r' })).appendChild(rm);
        tb.appendChild(tr);
      });
      const addRow = el('tr', { class: 'add' });
      const term = el('input', { type: 'text', placeholder: 'New term', maxlength: 40 });
      const w = el('input', { type: 'number', min: 1, max: 100, value: 6, class: 'num' });
      const note = el('input', { type: 'text', placeholder: 'Note', maxlength: 120 });
      const add = el('button', { class: 'small' }, 'Add');
      const doAdd = () => { if (!term.value.trim() || items.length >= MAX) return; items.push({ term: term.value.trim(), weight: Number(w.value) || 6, note: note.value.trim() }); draw(); tb.querySelector('tr.add input').focus(); };
      add.addEventListener('click', doAdd);
      for (const i of [term, w, note]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
      addRow.appendChild(el('td')).appendChild(term); addRow.appendChild(el('td', { class: 'w' })).appendChild(w); addRow.appendChild(el('td')).appendChild(note); addRow.appendChild(el('td', { class: 'r' })).appendChild(add);
      tb.appendChild(addRow);
      count.textContent = `${items.length} of ${MAX} terms · 100 forces a term · synced with your account on seesubtitles.com`;
    };
    draw();
    const foot = el('div', { class: 'sf' });
    const pull = el('button', { class: 'small' }, 'Pull from seesubtitles.com');
    const exp = el('button', { class: 'small' }, 'Export');
    const cancel = el('button', {}, 'Cancel');
    const apply = el('button', { class: 'primary' }, 'Apply at next rotation');
    const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    cancel.addEventListener('click', close);
    pull.addEventListener('click', async () => {
      if (!d) return;
      pull.disabled = true; msg.textContent = 'pulling…';
      try { const r = await d.cloud({ action: 'glossary' }); items.splice(0, items.length, ...clean(r.items || [])); draw(); msg.textContent = r.updatedAt ? `list from ${new Date(r.updatedAt).toLocaleString()}` : 'nothing saved on the server yet'; }
      catch (e) { msg.textContent = String(e.message || e).replace(/^.*Error: /, ''); }
      pull.disabled = false;
    });
    exp.addEventListener('click', () => {
      const a = el('a', { href: `data:text/plain;charset=utf-8,${encodeURIComponent(clean(items).map((t) => `${t.term}|${t.weight}${t.note ? `|${t.note}` : ''}`).join('\n'))}`, download: 'glossary.txt' });
      document.body.appendChild(a); a.click(); a.remove();
    });
    apply.addEventListener('click', async () => {
      apply.disabled = true; msg.textContent = 'applying…';
      const next = clean(items);
      try {
        if (d) await d.saveConfig({ glossary: next, restart: false });
        G.items = next; G.loaded = true;
        Sub.update({ hotwords: hotwordsText(next) });
        if (d && Sub.status && Sub.status.cloud && Sub.status.cloud.loggedIn) { try { await d.cloud({ action: 'glossary', items: next }); } catch (e) { console.warn('glossary sync', e); } }
        App.refresh();
        close();
      } catch (e) { msg.textContent = String(e.message || e); apply.disabled = false; }
    });
    foot.append(pull, exp, count, el('span', { class: 'grow' }), msg, cancel, apply);
    sheet.append(head, table, foot);
    scrim.appendChild(sheet);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(scrim);
    const first = tb.querySelector('tr.add input'); if (first) first.focus();
  };

  window.Glossary = G;
})();

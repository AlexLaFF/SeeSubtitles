// Builds the settings controls from SCHEMA. Used by the display page panel and the control page.
(function () {
  'use strict';
  const LOG_MAX = 1000;
  const Controls = { inputs: {}, devices: [], overlay: null, deviceSelects: [], displaysEls: [], _overlayKey: '' };

  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (v !== undefined && v !== null) e.setAttribute(k, v);
    }
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const toSlider = (f, v) => (f.scale === 'log' ? Math.round((LOG_MAX * Math.log(v / f.min)) / Math.log(f.max / f.min)) : v);
  const fromSlider = (f, p) => (f.scale === 'log' ? Math.round(f.min * Math.pow(f.max / f.min, p / LOG_MAX)) : Number(p));

  /** Render only the given field keys into root (no group headings). Used by the desktop app's panels. */
  Controls.renderFields = function (root, keys) {
    for (const key of keys) {
      const f = SCHEMA.byKey ? SCHEMA.byKey[key] : SCHEMA.FIELDS.find((x) => x.key === key);
      if (f) root.appendChild(row(f));
    }
    Controls.sync(Sub.settings, true);
  };
  Controls.presetRow = () => presetRow();
  /** Forget rendered inputs (the desktop app re-renders whole views). */
  Controls.reset = function () { Controls.inputs = {}; Controls.deviceSelects = []; Controls.displaysEls = []; Controls.presetSelects = []; Controls._overlayKey = ''; };

  Controls.render = function (root, { groups } = {}) {
    for (const [g, label] of SCHEMA.GROUPS) {
      if (groups && !groups.includes(g)) continue;
      const sec = el('section', { class: 'grp' });
      sec.appendChild(el('h3', {}, label));
      if (g === 'output') sec.appendChild(presetRow());
      for (const f of SCHEMA.FIELDS) if (f.group === g) sec.appendChild(row(f));
      root.appendChild(sec);
    }
    Controls.sync(Sub.settings, true);
  };

  // Presets: built-in ones from the schema plus user presets saved on the server (presets.json).
  Controls.presets = { builtin: SCHEMA.PRESETS, user: {} };
  Controls.presetSelects = [];
  function presetRow() {
    const r = el('div', { class: 'row wide' });
    r.appendChild(el('label', {}, 'Presets'));
    const wrap = el('div');
    const sel = el('select', { title: 'A preset stores every Text, Layout and Background setting plus "Show"' });
    const btns = el('div', { class: 'btns' });
    const post = (body) => Sub.post('/api/presets', { ...body, from: Sub.clientId }).then((x) => { if (x && x.error) alert(x.error); return x; });
    const selected = () => { const o = sel.options[sel.selectedIndex]; return o ? { name: o.value, user: o.dataset.user === '1' } : null; };
    const btn = (label, cls, fn) => { const b = el('button', cls ? { class: cls } : {}, label); b.addEventListener('click', fn); btns.appendChild(b); return b; };
    btn('Apply', 'primary', () => { const s = selected(); if (s) post({ action: 'apply', name: s.name }); });
    btn('Save current as…', '', () => { const name = prompt('Name for this preset (current text/layout/background settings):'); if (name && name.trim()) post({ action: 'save', name: name.trim() }).then(() => { sel.dataset.want = name.trim(); }); });
    const upd = btn('Update', '', () => { const s = selected(); if (s && s.user && confirm(`Overwrite preset "${s.name}" with the current settings?`)) post({ action: 'save', name: s.name }); });
    const del = btn('Delete', 'danger', () => { const s = selected(); if (s && s.user && confirm(`Delete preset "${s.name}"?`)) post({ action: 'delete', name: s.name }); });
    sel.addEventListener('change', () => { const s = selected(); upd.disabled = del.disabled = !(s && s.user); });
    wrap.append(sel, btns);
    r.appendChild(wrap);
    Controls.presetSelects.push({ sel, upd, del });
    fillPresets();
    return r;
  }
  function fillPresets() {
    for (const { sel, upd, del } of Controls.presetSelects) {
      const want = sel.dataset.want || sel.value;
      sel.innerHTML = '';
      const gUser = el('optgroup', { label: 'Saved presets' });
      for (const name of Object.keys(Controls.presets.user || {})) { const o = el('option', { value: name }, name); o.dataset.user = '1'; gUser.appendChild(o); }
      if (gUser.children.length) sel.appendChild(gUser); else { const o = el('option', { value: '', disabled: 'disabled' }, '(no saved presets yet — use "Save current as…")'); sel.appendChild(o); }
      const gBuilt = el('optgroup', { label: 'Built-in' });
      for (const [key, p] of Object.entries(Controls.presets.builtin || {})) gBuilt.appendChild(el('option', { value: key }, p.label));
      sel.appendChild(gBuilt);
      if (want && [...sel.options].some((o) => o.value === want)) sel.value = want;
      else { const first = [...sel.options].find((o) => !o.disabled); if (first) sel.value = first.value; }
      delete sel.dataset.want;
      const o = sel.options[sel.selectedIndex];
      upd.disabled = del.disabled = !(o && o.dataset.user === '1');
    }
  }
  Controls.setPresets = function (p) { if (!p) return; Controls.presets = p; fillPresets(); };

  function register(key, entry) {
    const list = (Controls.inputs[key] ||= []);
    list.push(entry);
  }

  function row(f) {
    const r = el('div', { class: 'row', 'data-key': f.key });
    r.appendChild(el('label', { title: f.hint || '' }, f.label));
    const set = (v) => Sub.update({ [f.key]: v });
    switch (f.type) {
      case 'range': {
        const log = f.scale === 'log';
        const slider = el('input', { type: 'range', min: log ? 0 : f.min, max: log ? LOG_MAX : f.max, step: log ? 1 : f.step });
        const num = el('input', { type: 'number', min: f.min, max: f.max, step: f.step, class: 'num' });
        slider.addEventListener('input', () => { const v = fromSlider(f, slider.value); num.value = v; set(v); });
        num.addEventListener('change', () => { const v = Math.min(f.max, Math.max(f.min, Number(num.value))); num.value = v; set(v); });
        r.append(slider, num, el('span', { class: 'unit' }, f.unit || ''));
        register(f.key, { els: [slider, num], setValue(v) { slider.value = toSlider(f, v); if (document.activeElement !== num) num.value = v; } });
        break;
      }
      case 'select': {
        const s = el('select');
        for (const [v, label] of f.options) s.appendChild(el('option', { value: v }, label));
        s.addEventListener('change', () => set(s.value));
        r.classList.add('wide');
        r.appendChild(s);
        register(f.key, { els: [s], setValue: (v) => { s.value = v; } });
        break;
      }
      case 'color': {
        const c = el('input', { type: 'color' });
        c.addEventListener('input', () => set(c.value));
        r.appendChild(c);
        register(f.key, { els: [c], setValue: (v) => { c.value = v; } });
        break;
      }
      case 'bool': {
        const c = el('input', { type: 'checkbox' });
        c.addEventListener('change', () => set(c.checked));
        r.appendChild(c);
        register(f.key, { els: [c], setValue: (v) => { c.checked = !!v; } });
        break;
      }
      case 'text': {
        const t = el('input', { type: 'text' });
        t.addEventListener('change', () => set(t.value));
        r.classList.add('wide');
        r.appendChild(t);
        register(f.key, { els: [t], setValue: (v) => { t.value = v; } });
        break;
      }
      case 'textarea': {
        const t = el('textarea', { rows: 4, placeholder: f.placeholder || '' });
        t.addEventListener('change', () => set(t.value));
        r.classList.add('wide');
        r.appendChild(t);
        register(f.key, { els: [t], setValue: (v) => { t.value = v || ''; } });
        break;
      }
      case 'device': {
        const s = el('select');
        const btn = el('button', { title: 'Rescan input devices' }, '↻');
        s.addEventListener('change', () => set(s.value));
        btn.addEventListener('click', () => fetch('/api/devices').then((x) => x.json()).then(Controls.setDevices));
        r.append(s, btn);
        Controls.deviceSelects.push(s);
        register(f.key, { els: [s], setValue: (v) => fillDevices(s, v) });
        break;
      }
      case 'bounds': {
        const wrap = el('div');
        const grid = el('div', { class: 'bounds' });
        const ins = {};
        for (const k of ['x', 'y', 'width', 'height']) { ins[k] = el('input', { type: 'number', placeholder: k, title: k }); grid.appendChild(ins[k]); }
        const apply = el('button', {}, 'Apply');
        apply.addEventListener('click', () => set({ x: +ins.x.value, y: +ins.y.value, width: +ins.width.value, height: +ins.height.value }));
        grid.appendChild(apply);
        const displays = el('div', { class: 'displays' });
        wrap.append(grid, displays);
        r.classList.add('wide');
        r.appendChild(wrap);
        Controls.displaysEls.push(displays);
        register(f.key, { els: Object.values(ins), setValue(v) { if (!v) return; for (const k of Object.keys(ins)) if (document.activeElement !== ins[k] && v[k] !== undefined) ins[k].value = v[k]; } });
        renderDisplays();
        break;
      }
      default:
        break;
    }
    if (f.hint) { const h = el('div', { class: 'hint' }, f.hint); h.style.gridColumn = '1 / -1'; r.appendChild(h); }
    return r;
  }

  function fillDevices(s, current) {
    s.innerHTML = '';
    const list = Controls.devices.length ? [...Controls.devices] : [{ id: 'default', name: 'System default input' }];
    if (current && !list.some((d) => d.id === current)) list.push({ id: current, name: `${current} (not found)` });
    for (const d of list) s.appendChild(el('option', { value: d.id }, d.name));
    s.value = current || 'default';
  }

  Controls.setDevices = function (list) {
    Controls.devices = Array.isArray(list) ? list : [];
    for (const s of Controls.deviceSelects) fillDevices(s, Sub.settings.audioDevice || 'default');
  };

  Controls.setOverlay = function (o) {
    const key = JSON.stringify(o || null);
    if (key === Controls._overlayKey) return;
    Controls._overlayKey = key;
    Controls.overlay = o;
    renderDisplays();
    if (o && o.bounds) for (const c of Controls.inputs.window || []) c.setValue(o.bounds);
  };

  function renderDisplays() {
    for (const box of Controls.displaysEls) {
      box.innerHTML = '';
      const o = Controls.overlay;
      if (!o || !o.present || !(o.displays || []).length) {
        box.appendChild(el('div', { class: 'muted' }, o && o.present
          ? 'An overlay window is connected but has not reported its displays (opened before the last server restart). Quit it with ⌘Q and open it again.'
          : 'Overlay window is closed. It is a transparent, always-on-top window you can drag onto the venue screen.'));
        const b = el('button', { class: 'small' }, 'Open overlay window');
        b.addEventListener('click', () => Sub.post('/api/overlay/open').then((r) => { if (r && r.error) alert(r.error); }));
        box.appendChild(b);
        continue;
      }
      const b = o.bounds;
      const same = (d) => b && d.bounds.x === b.x && d.bounds.y === b.y && d.bounds.width === b.width && d.bounds.height === b.height;
      const within = (d) => b && b.x + b.width / 2 >= d.bounds.x && b.x + b.width / 2 < d.bounds.x + d.bounds.width
        && b.y + b.height / 2 >= d.bounds.y && b.y + b.height / 2 < d.bounds.y + d.bounds.height;
      const filled = (o.displays || []).find(same);
      const on = filled || (o.displays || []).find(within);
      box.appendChild(el('div', { class: 'muted' }, filled
        ? `Overlay is filling: ${filled.label}`
        : on ? `Overlay is on ${on.label} but not filling it (${b.width}×${b.height}). Click a display to fill it:`
          : 'Fill a display with the overlay:'));
      const closeBtn = el('button', { class: 'small' }, 'Close overlay window');
      closeBtn.addEventListener('click', () => Sub.post('/api/overlay/close'));
      box.appendChild(closeBtn);
      for (const d of o.displays || []) {
        const isFilled = filled && filled.id === d.id;
        const btn = el('button', { class: isFilled ? 'display filled' : 'display' },
          `${isFilled ? '● ' : ''}${d.label}${d.primary ? ' (main)' : ''} — ${d.bounds.width}×${d.bounds.height} at ${d.bounds.x},${d.bounds.y}${isFilled ? '   ✓ filling' : ''}`);
        btn.addEventListener('click', () => Sub.update({ window: { ...d.bounds } }));
        box.appendChild(btn);
      }
    }
  }

  Controls.sync = function (settings, force) {
    for (const [key, list] of Object.entries(Controls.inputs)) {
      if (!(key in settings)) continue;
      for (const c of list) {
        if (!force && c.els.some((e) => e === document.activeElement && e.type !== 'checkbox' && e.tagName !== 'SELECT')) continue;
        c.setValue(settings[key]);
      }
    }
  };

  Controls.renderShortcuts = function (root) {
    root.innerHTML = '';
    for (const [k, d] of Sub.SHORTCUTS) { root.appendChild(el('kbd', {}, k)); root.appendChild(el('span', {}, d)); }
  };

  Controls.el = el;
  window.Controls = Controls;
})();

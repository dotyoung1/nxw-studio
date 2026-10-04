/* ================================================================
   NXW STUDIO · mixer
   ================================================================ */
UI.mixer = {
  strips: [], meterGrad: null,
  init() {
    const w = this.w = WM.create(WIN_DEFS[4]);
    this.win = 'mixer';
    w.onShow = () => this.render();
    w.onResize = () => { for (const s of this.strips) { if (s.fader) s.fader.place(); s.W = 0; } };
    this.stripsEl = h('div', { class: 'mx-strips' });
    this.side = h('div', { class: 'mx-side' });
    w.body.append(h('div', { class: 'mx' }, this.stripsEl, this.side));
  },
  sel() { return clamp(S.mixSel | 0, 0, NINS); },
  render() {
    // Strips are rebuilt only when names, routing or effect slots change; levels, pans and buttons update in place.
    const struct = JSON.stringify([P.mixer.map(m => [m.name, m.fx.map(f => f.type + (f.on ? 1 : 0))]), P.channels.map(c => [c.name, c.mixer, c.color])]);
    if (struct !== this._struct || this.strips.length !== P.mixer.length) {
      this._struct = struct; this._side = null;
      const sl = this.stripsEl.scrollLeft;
      this.stripsEl.textContent = ''; this.strips = [];
      const frag = document.createDocumentFragment();
      P.mixer.forEach((m, i) => { const s = this.strip(m, i); this.strips.push(s); frag.append(s.el); });
      this.stripsEl.append(frag);
      this.stripsEl.scrollLeft = sl;
    } else {
      for (const s of this.strips) {
        const m = P.mixer[s.i];
        s.fader.set(m.vol); s.pan.set(m.pan);
        const db = fmtDb(faderGain(m.vol)).replace(' dB', ''); if (s.db.textContent !== db) s.db.textContent = db;
        s.mb.classList.toggle('on', m.mute); s.mb.setAttribute('aria-pressed', String(m.mute));
        if (s.sb) { s.sb.classList.toggle('on', m.solo); s.sb.setAttribute('aria-pressed', String(m.solo)); }
      }
    }
    for (const s of this.strips) s.el.classList.toggle('sel', s.i === this.sel());
    const side = JSON.stringify([S.mixSel, S.fxSel, P.mixer[this.sel()]]);
    if (side !== this._side) { this._side = side; this.renderSide(); }
    const m = P.mixer[this.sel()];
    this.w.sub.textContent = '· ' + (this.sel() ? 'Insert ' + this.sel() + ' · ' : '') + m.name;
  },
  strip(m, i) {
    const srcs = P.channels.filter(c => (c.mixer | 0) === i).map(c => c.name);
    const color = i ? (P.channels.find(c => c.mixer === i) || {}).color : null;
    const el = h('div', { class: 'strip' + (i === 0 ? ' master' : '') + (i === this.sel() ? ' sel' : ''), style: { '--sc': color || null }, 'data-hint': (i ? 'Insert ' + i : 'Master') + ' · click to show its effects, right-click for options' });
    const nameB = h('button', { class: 's-name', 'aria-label': 'Rename ' + m.name }, m.name);
    nameB.ondblclick = e => { e.stopPropagation(); askText(nameB, m.name, v => edit(() => { m.name = v; })); };
    const dots = h('div', { class: 's-fx', 'aria-hidden': 'true' });
    for (let k = 0; k < 8; k++) { const f = m.fx[k]; dots.append(h('i', { class: f ? 'u' + (f.on ? '' : ' off') : '' })); }
    const pan = Knob({ def: { label: 'Pan', min: -1, max: 1, def: 0, unit: 'pan', bipolar: true }, name: m.name + ' pan', value: m.pan, size: 26,
      onStart: () => Hist.push(), onChange: v => { m.pan = v; if (A.ctx) A.strips[i].panTo(v); }, onEnd: touched });
    const meter = h('canvas', { class: 's-meter', 'aria-hidden': 'true' });
    const db = h('div', { class: 's-db' }, fmtDb(faderGain(m.vol)).replace(' dB', ''));
    const fader = Fader({ value: m.vol, name: m.name, label: m.name + ' volume', onStart: () => Hist.push(),
      onChange: v => { m.vol = v; if (A.ctx) A.strips[i].vol(v); db.textContent = fmtDb(faderGain(v)).replace(' dB', ''); touchedLite(); } });
    const mb = h('button', { class: 'm' + (m.mute ? ' on' : ''), 'aria-pressed': String(m.mute), 'aria-label': 'Mute ' + m.name, 'data-hint': 'Mute' }, 'M');
    mb.onclick = e => { e.stopPropagation(); edit(() => { m.mute = !m.mute; }); };
    const sb = i ? h('button', { class: 's' + (m.solo ? ' on' : ''), 'aria-pressed': String(m.solo), 'aria-label': 'Solo ' + m.name, 'data-hint': 'Solo' }, 'S') : null;
    if (sb) sb.onclick = e => { e.stopPropagation(); edit(() => { m.solo = !m.solo; }); };
    el.append(
      h('div', { class: 's-top' }, h('span', { class: 's-num' }, i ? String(i) : 'M'), h('span', { class: 's-col' })),
      nameB, dots, pan,
      h('div', { class: 's-mid' }, meter, fader), db,
      h('div', { class: 's-btns' }, mb, sb),
      h('div', { class: 's-src', title: srcs.join(', ') }, i === 0 ? 'Output' : (srcs.join(', ') || '—')));
    el.addEventListener('click', () => { if (S.mixSel !== i) { S.mixSel = i; S.fxSel = 0; scheduleSave(); this.render(); } });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      const ch = selCh();
      openMenu(e.clientX, e.clientY, [
        { head: (i ? 'Insert ' + i + ' · ' : '') + m.name },
        { label: 'Rename…', action: () => askText(nameB, m.name, v => edit(() => { m.name = v; })) },
        ch && i ? { label: 'Route ' + ch.name + ' here', action: () => edit(() => { ch.mixer = i; }) } : null,
        { label: 'Reset volume and pan', action: () => edit(() => { m.vol = 0.7906; m.pan = 0; }) },
        { label: 'Remove all effects', danger: true, disabled: !m.fx.length, action: () => edit(() => { m.fx = []; }) },
      ]);
    });
    // Effects dragged from the browser's plugin database land on the strip they are dropped on.
    el.addEventListener('dragover', e => { if (UI.br && UI.br.dragKind === 'fx') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('drop'); } });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
    el.addEventListener('drop', e => { el.classList.remove('drop'); try { const o = JSON.parse(e.dataTransfer.getData('application/x-nxw') || 'null'); if (o && o.kind === 'fx') { e.preventDefault(); addFxToInsert(o.type, i); } else if (o && o.kind === 'vstfx') { e.preventDefault(); NATIVE.addPluginFx(o.id, i); } } catch (err) { /* ignore */ } });
    return { el, meter, fader, pan, db, mb, sb, i, disp: [0, 0], hold: [0, 0], holdT: [0, 0] };
  },
  renderSide() {
    const i = this.sel(), m = P.mixer[i], sd = this.side;
    sd.textContent = '';
    sd.append(h('h3', null, h('span', null, m.name), h('small', null, i ? 'INSERT ' + i : 'MASTER')));
    const slots = h('div', { class: 'slots' });
    for (let k = 0; k < 8; k++) {
      const f = m.fx[k];
      if (f) {
        const def = fxDef(f);
        const pw = h('button', { class: 'pw' + (f.on ? '' : ' off'), 'aria-pressed': String(f.on), 'aria-label': (f.on ? 'Bypass ' : 'Enable ') + def.name, 'data-hint': f.on ? 'Effect on · click to bypass' : 'Bypassed · click to enable', html: icon('power', 13) });
        pw.onclick = e => { e.stopPropagation(); edit(() => { f.on = !f.on; }); };
        const dd = h('button', { class: 'dd', 'aria-label': 'Slot options', 'data-hint': 'Replace, move or remove', html: icon('dots', 14) });
        dd.onclick = e => { e.stopPropagation(); menuAt(dd, this.slotMenu(m, k)); };
        const row = h('div', { class: 'slot' + (S.fxSel === k ? ' sel' : ''), role: 'button', tabindex: 0, 'data-hint': def.name + ' · click to edit' }, h('span', { class: 'n' }, String(k + 1)), pw, h('span', { class: 't' }, def.name), dd);
        row.onclick = () => { S.fxSel = k; this.renderSide(); };
        if (f.type === 'plugin') row.ondblclick = () => NATIVE.openPlugin(f.id);
        row.onkeydown = e => { if (e.key === 'Enter') { S.fxSel = k; this.renderSide(); } };
        slots.append(row);
      } else {
        const row = h('div', { class: 'slot empty', role: 'button', tabindex: 0, 'data-hint': 'Empty slot · click to add an effect' }, h('span', { class: 'n' }, String(k + 1)), h('span', { class: 't' }, k === m.fx.length ? 'Add effect…' : '(empty)'));
        row.onclick = () => menuAt(row, [{ head: 'Add effect' }, ...FX_ORDER.map(t => ({ label: FX_DEFS[t].name, action: () => { edit(() => { m.fx.push(newFx(t)); S.fxSel = m.fx.length - 1; }); } })), ...pluginFxItems(i)]);
        row.onkeydown = e => { if (e.key === 'Enter') row.click(); };
        slots.append(row);
      }
    }
    sd.append(slots);
    const panel = h('div', { class: 'fxp' });
    const f = m.fx[S.fxSel];
    if (!f) panel.append(h('p', { class: 'empty' }, m.fx.length ? 'Choose an effect slot to edit it.' : 'This track has no effects yet. Click an empty slot to add EQ, filter, drive, compression, pump, chorus, delay or reverb.'));
    else {
      const def = fxDef(f);
      panel.append(h('h4', null, def.name, h('span', null, 'SLOT ' + (S.fxSel + 1) + (f.on ? '' : ' · BYPASSED'))));
      if (f.type === 'plugin') panel.append(pluginPanel(f.id, f.plugin));
      const grid = h('div', { class: 'kgrid' });
      for (const d of def.params) {
        if (d.options) {
          const seg = h('div', { class: 'seg copper', role: 'group', 'aria-label': d.label }, d.options.map((o, oi) => h('button', { class: (f.p[d.k] | 0) === oi ? 'on' : '', onclick: () => { edit(() => { f.p[d.k] = oi; }); } }, o)));
          grid.append(h('div', { class: 'opt-row' }, h('span', { class: 'lbl' }, d.label), seg));
        } else {
          grid.append(h('div', { class: 'kcell' }, Knob({ def: d, value: f.p[d.k], size: 40, label: true, showVal: true, color: CSSV.copper, name: def.name + ' ' + d.label.toLowerCase(),
            onStart: () => Hist.push(), onChange: v => { f.p[d.k] = v; if (A.ctx) { const st = A.strips[i], u = st.units[S.fxSel]; st.fxJson = null; if (u && u.id === f.id) u.set(f.p, A.ctx.currentTime); else st.setFx(m.fx); } }, onEnd: touched })));
        }
      }
      panel.append(grid);
      if (f.type === 'comp') { this.grEl = h('div', { class: 'gr' }, 'Gain reduction —'); panel.append(this.grEl); } else this.grEl = null;
      this.grFx = f.type === 'comp' ? S.fxSel : -1;
    }
    sd.append(panel);
  },
  slotMenu(m, k) {
    return [
      { head: 'Replace with' }, ...FX_ORDER.map(t => ({ label: FX_DEFS[t].name, checked: m.fx[k].type === t, action: () => edit(() => { m.fx[k] = newFx(t); S.fxSel = k; }) })),
      { sep: true },
      m.fx[k].type === 'plugin' ? { label: 'Open plugin window', action: () => NATIVE.openPlugin(m.fx[k].id) } : null,
      { label: 'Move up', disabled: k === 0, action: () => edit(() => { const [f] = m.fx.splice(k, 1); m.fx.splice(k - 1, 0, f); S.fxSel = k - 1; }) },
      { label: 'Move down', disabled: k >= m.fx.length - 1, action: () => edit(() => { const [f] = m.fx.splice(k, 1); m.fx.splice(k + 1, 0, f); S.fxSel = k + 1; }) },
      { label: 'Remove', danger: true, action: () => edit(() => { m.fx.splice(k, 1); S.fxSel = Math.max(0, k - 1); }) },
    ];
  },
  frame() {
    if (!WM.shown('mixer') || !A.ctx) return;
    const now = performance.now();
    if (!this.scan) { const c = document.createElement('canvas'); c.width = 1; c.height = 3; const x = c.getContext('2d'); x.fillStyle = 'rgba(13,16,19,0.55)'; x.fillRect(0, 2, 1, 1); this.scan = c; }
    const n = v => v <= 0.00002 ? 0 : clamp((20 * Math.log10(v) + 48) / 54, 0, 1);
    for (const s of this.strips) {
      const st = A.strips[s.i]; if (!st) continue;
      if (!s.W) { s.W = s.meter.clientWidth; s.H = s.meter.clientHeight; s.ctx = null; s.drawn = ''; }
      const W = s.W, H = s.H; if (!W || !H) continue;
      const px = [];
      for (let c = 0; c < 2; c++) {
        const lv = st.level(c);
        s.disp[c] = Math.max(lv, s.disp[c] * 0.86); if (s.disp[c] < 0.00002) s.disp[c] = 0;
        if (lv >= s.hold[c] || now - s.holdT[c] > 1200) { s.hold[c] = lv; s.holdT[c] = now; }
        px.push(Math.round(n(s.disp[c]) * (H - 2)), Math.round(n(s.hold[c]) * (H - 2)), s.hold[c] >= 1 ? 1 : 0);
      }
      const key = px.join(',');
      if (key === s.drawn) continue;   // nothing moved: skip the repaint
      s.drawn = key;
      if (!s.ctx) {
        s.ctx = fitCanvas(s.meter, W, H);
        const g = s.ctx.createLinearGradient(0, H, 0, 0);
        g.addColorStop(0, '#1d6f5e'); g.addColorStop(0.55, CSSV.verdigris); g.addColorStop(0.78, CSSV.amber); g.addColorStop(0.9, CSSV.alert); g.addColorStop(1, CSSV.alert);
        s.grad = g; s.pat = s.ctx.createPattern(this.scan, 'repeat');
      }
      const ctx = s.ctx, bw = (W - 3) / 2;
      ctx.clearRect(0, 0, W, H);
      for (let c = 0; c < 2; c++) {
        const x = 1 + c * (bw + 1), hh = px[c * 3], hold = px[c * 3 + 1];
        if (hh > 0) { ctx.fillStyle = s.grad; ctx.fillRect(x, H - 1 - hh, bw, hh); }
        if (hold > 0) { ctx.fillStyle = px[c * 3 + 2] ? CSSV.alert : CSSV.text; ctx.fillRect(x, H - 1 - hold, bw, 1); }
      }
      ctx.fillStyle = s.pat; ctx.fillRect(0, 0, W, H);
    }
    if (this.grEl && this.grFx >= 0) {
      const u = A.strips[this.sel()].units[this.grFx];
      if (u && u.comp) { const r = u.comp.reduction; const txt = 'Gain reduction ' + (typeof r === 'number' ? r.toFixed(1) : '0.0') + ' dB'; if (this.grEl.textContent !== txt) this.grEl.textContent = txt; }
    }
  },
};
function touchedLite() { scheduleSave(); }

/* A slot's definition; VST3 effects have no built-in knobs (their own window has the controls). */
function fxDef(f) {
  if (f.type === 'plugin') return { name: (f.plugin && f.plugin.name) || 'Plugin', params: [] };
  return FX_DEFS[f.type] || { name: f.type, params: [] };
}
function pluginFxItems(i) {
  if (!NATIVE.on) return [];
  const list = NATIVE.plugins.filter(q => !q.instrument);
  if (!list.length) return [{ head: 'VST3 effects' }, { label: 'Scan for plugins…', action: () => NATIVE.scan(false) }];
  return [{ head: 'VST3 effects' }, ...list.map(q => ({ label: q.name, hint: q.vendor, action: () => NATIVE.addPluginFx(q.id, i) }))];
}
/* Shared by the mixer slot editor and the channel settings window. */
function pluginPanel(ownerId, ref) {
  const st = NATIVE.status[ownerId];
  const box = h('div', { class: 'plug-panel' });
  if (!NATIVE.on) {
    box.append(h('p', { class: 'empty' }, (ref && ref.name || 'This plugin') + ' is a VST3 plugin. It plays in the NXW Studio desktop app; in the browser it stays silent but is kept in the project.'));
    return box;
  }
  box.append(...[
    h('p', { class: 'plug-meta' }, [ref && ref.vendor, ref && ref.format || 'VST3', ref && ref.instrument ? 'instrument' : 'effect'].filter(Boolean).join(' · ')),
    st && st !== 'loaded' ? h('p', { class: 'plug-err' }, st) : null,
    h('button', { class: 'btn primary', onclick: () => NATIVE.openPlugin(ownerId) }, 'Open plugin window'),
    h('p', { class: 'empty' }, 'Its settings are saved with the project.')].filter(Boolean));
  return box;
}

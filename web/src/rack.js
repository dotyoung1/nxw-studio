/* ================================================================
   NXW STUDIO · channel rack + step sequencer
   ================================================================ */
const STEP_W = 20, STEP_GAP = 2, GRP_GAP = 4;
const stepsWidth = len => len * STEP_W + (len - 1) * STEP_GAP + (Math.ceil(len / 4) - 1) * GRP_GAP;
const isStepRow = (notes, root) => notes.every(n => Math.abs(n.t - Math.round(n.t)) < 1e-6 && n.key === root && n.len <= 1.0001);
const r2 = v => Math.round(v * 100) / 100;
const REPS = [1, 2, 3, 4, 6, 8];   // note repeat (ratchet) counts per step

UI.rack = {
  cells: [], rowsById: new Map(), nowIdx: -1,
  init() {
    const w = this.w = WM.create(WIN_DEFS[1]);
    this.win = 'rack';
    w.onShow = () => this.render();
    // toolbar
    this.patBtn = h('button', { class: 'btn', 'data-hint': 'Pattern shown in the rack · click for pattern options' }, h('i', { class: 'sw' }), h('span'));
    this.patBtn.onclick = () => patternMenu(this.patBtn);
    this.swing = Knob({ def: { label: 'Swing', min: 0, max: 1, def: 0, unit: '%' }, name: 'Swing', value: P.swing, size: 26,
      onStart: () => Hist.push(), onChange: v => { P.swing = v; }, onEnd: touched });
    this.lenSel = h('select', { class: 'sel-box', id: 'rackLen', 'aria-label': 'Pattern length', 'data-hint': 'Pattern length' },
      [1, 2, 3, 4, 6, 8].map(b => h('option', { value: b * 16 }, b + (b === 1 ? ' bar' : ' bars'))));
    this.lenSel.onchange = () => edit(() => { curPat().len = +this.lenSel.value; });
    this.laneSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Step editing lane' },
      [['steps', 'Steps', 'Click steps to toggle them; drag to paint; Alt+click a lit step to cycle its repeat'], ['vel', 'Velocity', 'Drag up and down inside lit steps to set velocity'], ['chance', 'Chance', 'Drag inside lit steps to set the probability each step plays'], ['rep', 'Repeat', 'Repeat · drag up inside a lit step to retrigger it 2, 3, 4, 6 or 8 times (rolls and ratchets)']]
        .map(([k, l, hn]) => h('button', { dataset: { k }, 'data-hint': hn, onclick: () => { S.lane = k; scheduleSave(); this.render(); } }, l)));
    const add = h('button', { class: 'btn', 'data-hint': 'Add an instrument channel', html: icon('plus', 13) + '<span>Add</span>' });
    add.onclick = () => menuAt(add, addMenuItems());
    w.tools.append();
    const tb = h('div', { class: 'tb' }, this.patBtn, h('span', { class: 'div' }), h('div', { class: 'ks' }, this.swing, h('span', { class: 'lbl' }, 'Swing')),
      h('span', { class: 'div' }), this.lenSel, h('span', { class: 'div' }), this.laneSeg, h('span', { style: { flex: '1' } }), add);
    this.rows = h('div', { class: 'rack-rows' });
    const foot = h('div', { class: 'rack-foot' },
      h('button', { class: 'addch', 'data-hint': 'Add an instrument channel', onclick: e => menuAt(e.currentTarget, addMenuItems()), html: icon('plus', 13) + '<span>Channel</span>' }),
      h('span', { class: 'br-note', style: { padding: '0' } }, 'Drop audio files here to make sampler channels.'));
    this.rows.append();
    w.body.append(tb, this.rows, foot);
    // drag + drop
    const body = w.body;
    body.addEventListener('dragover', e => { const t = [...e.dataTransfer.types]; if (t.includes('Files') || t.includes('application/x-nxw')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; body.classList.add('rack-drop'); } });
    body.addEventListener('dragleave', e => { if (!body.contains(e.relatedTarget)) body.classList.remove('rack-drop'); });
    body.addEventListener('drop', e => {
      e.preventDefault(); body.classList.remove('rack-drop');
      if (e.dataTransfer.files && e.dataTransfer.files.length) { handleDrop(e.dataTransfer, true); return; }
      try { const o = JSON.parse(e.dataTransfer.getData('application/x-nxw') || 'null'); if (o && o.kind !== 'pattern') { const sp = specFromBrowser(o); if (sp) addChannel(sp); } } catch (err) { /* ignore */ }
    });
  },
  styleCell(b, n) {
    const rep = n.rep > 1 ? n.rep : 1;
    const v = S.lane === 'chance' ? (n.chance ?? 1) : S.lane === 'rep' ? Math.max(0.12, REPS.indexOf(rep) / (REPS.length - 1)) : n.vel;
    b.style.setProperty('--v', v.toFixed(3));
    b.style.setProperty('--o', (0.3 + n.vel * 0.7).toFixed(3));
    b.classList.toggle('maybe', (n.chance ?? 1) < 0.999 && S.lane === 'steps');
    b.classList.toggle('rpt', rep > 1 && S.lane === 'steps');
    if (rep > 1) { b.dataset.rep = '×' + rep; b.style.setProperty('--rn', rep); } else if (b.dataset.rep) delete b.dataset.rep;
  },
  noteAt(pat, ch, i) { const root = rootKey(ch); return (pat.notes[ch.id] || []).find(n => Math.abs(n.t - i) < 1e-6 && n.key === root); },
  setStep(pat, ch, i, on, cell) {
    const ns = patNotes(pat, ch), root = rootKey(ch);
    const idx = ns.findIndex(n => Math.abs(n.t - i) < 1e-6 && n.key === root);
    if (on && idx < 0) { const n = { t: i, len: 1, key: root, vel: 0.78, chance: 1 }; ns.push(n); cell.classList.add('on'); this.styleCell(cell, n); }
    else if (!on && idx >= 0) { ns.splice(idx, 1); cell.classList.remove('on', 'maybe'); }
    VER++;
  },
  soloCh(ch) {
    edit(() => {
      const others = P.channels.filter(c => c !== ch);
      const soloed = !ch.mute && others.every(c => c.mute);
      if (soloed) P.channels.forEach(c => { c.mute = false; }); else { others.forEach(c => { c.mute = true; }); ch.mute = false; }
    });
  },
  chMenu(ch, x, y, anchor) {
    const pat = curPat();
    const fill = n => edit(() => { const root = rootKey(ch); const keep = (pat.notes[ch.id] || []).filter(q => !(q.key === root && Number.isInteger(q.t))); for (let i = 0; i < pat.len; i += n) keep.push({ t: i, len: 1, key: root, vel: 0.78, chance: 1 }); pat.notes[ch.id] = keep; });
    const i = P.channels.indexOf(ch);
    const rot = d => edit(() => { const ns = pat.notes[ch.id] || []; for (const n of ns) n.t = ((n.t + d) % pat.len + pat.len) % pat.len; });
    const setCut = (k, v) => edit(() => { ch[k] = v; });
    openMenu(x, y, [
      { head: ch.name },
      { label: 'Cut itself', icon: 'scissors', checked: !!ch.cut, hint: 'Each new note stops the one still ringing on this channel (open hats, 808s, vocal chops)', action: () => setCut('cut', !ch.cut) },
      { label: 'Choke group: ' + (ch.cutGroup ? ch.cutGroup : 'none'), icon: 'scissors', hint: 'Channels in the same group stop each other, like a closed hat cutting an open hat', action: () => openMenu(x + 20, y + 40, [{ head: 'Choke group for ' + ch.name }, ...[0, 1, 2, 3, 4].map(g => ({ label: g ? 'Group ' + g + (P.channels.filter(c => c !== ch && c.cutGroup === g).length ? ' · with ' + P.channels.filter(c => c !== ch && c.cutGroup === g).map(c => c.name).join(', ') : '') : 'None', checked: (ch.cutGroup || 0) === g, action: () => setCut('cutGroup', g) }))]) },
      { sep: true },
      { label: 'Open piano roll', key: 'F7', action: () => { S.ch = ch.id; WM.show('pr'); renderAll(); } },
      ch.type === 'plugin' && NATIVE.on ? { label: 'Open plugin window', action: () => { S.ch = ch.id; NATIVE.openPlugin(ch.id); renderAll(); } } : null,
      { label: 'Instrument settings', key: 'F8', action: () => { S.ch = ch.id; WM.show('inst'); renderAll(); } },
      { label: 'Rename…', action: () => askText(anchor, ch.name, v => edit(() => { ch.name = v; })) },
      { sep: true },
      { label: 'Fill every 2 steps', action: () => fill(2) }, { label: 'Fill every 4 steps', action: () => fill(4) }, { label: 'Fill every 8 steps', action: () => fill(8) },
      { label: 'Rotate left', action: () => rot(-1) }, { label: 'Rotate right', action: () => rot(1) },
      { label: 'Clear repeats', disabled: !(pat.notes[ch.id] || []).some(n => n.rep > 1), action: () => edit(() => { for (const n of pat.notes[ch.id] || []) delete n.rep; }) },
      { label: 'Clear in this pattern', action: () => edit(() => { delete pat.notes[ch.id]; }) },
      { sep: true },
      { label: 'Move up', disabled: i === 0, action: () => edit(() => { P.channels.splice(i, 1); P.channels.splice(i - 1, 0, ch); }) },
      { label: 'Move down', disabled: i === P.channels.length - 1, action: () => edit(() => { P.channels.splice(i, 1); P.channels.splice(i + 1, 0, ch); }) },
      { label: 'Duplicate channel', action: () => edit(() => { const c = JSON.parse(JSON.stringify(ch)); c.id = uid(); c.name = ch.name + ' 2'; P.channels.splice(i + 1, 0, c); for (const q of P.patterns) if (q.notes[ch.id]) q.notes[c.id] = JSON.parse(JSON.stringify(q.notes[ch.id])); S.ch = c.id; if (NATIVE.on && ch.plugin) NATIVE.call('copyPluginState', ch.id, c.id); }) },
      { head: 'Colour' }, ...PALETTE.map(c => ({ label: c === ch.color ? 'Current' : '', swatch: c, action: () => edit(() => { ch.color = c; }) })),
      { sep: true },
      { label: 'Delete channel', danger: true, action: () => edit(() => { P.channels.splice(P.channels.indexOf(ch), 1); for (const q of P.patterns) delete q.notes[ch.id]; if (S.ch === ch.id) S.ch = P.channels[0] ? P.channels[0].id : null; }) },
    ]);
  },
  routeEl(ch) {
    const el = h('div', { class: 'route', tabindex: 0, role: 'button', 'aria-label': 'Mixer insert for ' + ch.name, 'data-hint': ch.name + ' plays through ' + (ch.mixer ? 'insert ' + ch.mixer + ' (' + P.mixer[ch.mixer].name + ')' : 'the master') + ' · drag or scroll to change, click to choose' }, ch.mixer ? String(ch.mixer) : 'M');
    const setR = r => { r = clamp(r, 0, NINS); if (r === ch.mixer) return; ch.mixer = r; el.textContent = r ? String(r) : 'M'; syncChannel(ch); hint(ch.name + ' → ' + (r ? 'Insert ' + r + ' · ' + P.mixer[r].name : 'Master')); };
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const y0 = e.clientY, r0 = ch.mixer; let moved = false; Hist.push();
      const mv = ev => { const d = Math.round((y0 - ev.clientY) / 8); if (d) moved = true; setR(r0 + d); };
      const up = () => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        if (!moved) { Hist.u.pop(); menuAt(el, [{ head: 'Route ' + ch.name + ' to' }, ...P.mixer.map((m, i) => ({ label: (i ? i + ' · ' : '') + m.name, checked: ch.mixer === i, action: () => edit(() => { ch.mixer = i; }) }))]); }
        else refresh();
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('wheel', e => { e.preventDefault(); wheelHistory(); setR(ch.mixer + (e.deltaY < 0 ? 1 : -1)); touched(); }, { passive: false });
    return el;
  },
  stepsEl(ch, pat) {
    const notes = pat.notes[ch.id] || [], root = rootKey(ch);
    if (!isStepRow(notes, root)) {
      const cv = h('canvas', { class: 'mini', 'data-hint': 'Piano-roll notes · click to edit them', role: 'button', 'aria-label': 'Edit notes of ' + ch.name });
      const W = stepsWidth(pat.len);
      cv.style.width = W + 'px';
      requestAnimationFrame(() => this.drawMini(cv, ch, pat, W));
      cv.onclick = () => { S.ch = ch.id; WM.show('pr'); renderAll(); };
      this.cells.push([]);
      return cv;
    }
    const wrap = h('div', { class: 'steps' + (S.lane !== 'steps' ? ' lane lane-' + S.lane : ''), role: 'group', 'aria-label': ch.name + ' steps' });
    const map = new Map(notes.map(n => [Math.round(n.t), n])), cells = [];
    // Cells are cloned from a template: building a 64-step row costs a fraction of a millisecond.
    const tpl = this._tpl || (this._tpl = (() => { const b = document.createElement('button'); b.className = 'st'; b.tabIndex = -1; return b; })());
    const gtpl = this._gtpl || (this._gtpl = (() => { const d = document.createElement('div'); d.className = 'grp'; return d; })());
    for (let g = 0; g < Math.ceil(pat.len / 4); g++) {
      const grp = gtpl.cloneNode(false);
      for (let k = 0; k < 4 && g * 4 + k < pat.len; k++) {
        const i = g * 4 + k, n = map.get(i), b = tpl.cloneNode(false);
        b.dataset.i = i; b.setAttribute('aria-label', 'Step ' + (i + 1));
        if (n) { b.classList.add('on'); this.styleCell(b, n); }
        grp.appendChild(b); cells.push(b);
      }
      wrap.appendChild(grp);
    }
    this.cells.push(cells);
    wrap.addEventListener('contextmenu', e => e.preventDefault());
    wrap.addEventListener('pointerdown', e => {
      const cell = e.target.closest('.st'); if (!cell) return;
      e.preventDefault();
      const pat = curPat(); Hist.push();
      wrap.setPointerCapture(e.pointerId);
      const under = ev => { const el = document.elementFromPoint(ev.clientX, ev.clientY); const c2 = el && el.closest && el.closest('.st'); return c2 && wrap.contains(c2) ? c2 : null; };
      let mv;
      if (S.lane === 'steps' && e.altKey && e.button === 0) {
        const n = this.noteAt(pat, ch, +cell.dataset.i);
        if (n) { n.rep = REPS[(REPS.indexOf(n.rep > 1 ? n.rep : 1) + 1) % REPS.length]; this.styleCell(cell, n); VER++; hint(ch.name + ' step ' + (+cell.dataset.i + 1) + (n.rep > 1 ? ' repeats ' + n.rep + ' times' : ' plays once')); previewChannel(ch, null, 0.2); }
        mv = () => {};
      } else if (S.lane === 'steps') {
        const i = +cell.dataset.i, on = e.button === 2 ? false : !this.noteAt(pat, ch, i);
        this.setStep(pat, ch, i, on, cell);
        if (on) previewChannel(ch, null, 0.2);
        const seen = new Set([i]);
        mv = ev => { const c2 = under(ev); if (!c2) return; const j = +c2.dataset.i; if (!seen.has(j)) { seen.add(j); this.setStep(pat, ch, j, on, c2); } };
      } else {
        const apply = ev => {
          const c2 = under(ev); if (!c2) return;
          const n = this.noteAt(pat, ch, +c2.dataset.i); if (!n) return;
          const r = c2.getBoundingClientRect(), v = r2(clamp(1 - (ev.clientY - r.top - 3) / (r.height - 6), 0.02, 1));
          if (S.lane === 'vel') n.vel = v; else if (S.lane === 'chance') n.chance = v; else n.rep = REPS[Math.round(clamp(v, 0, 1) * (REPS.length - 1))];
          this.styleCell(c2, n); VER++;
          hint(ch.name + ' step ' + (+c2.dataset.i + 1) + ' · ' + (S.lane === 'rep' ? (n.rep > 1 ? 'repeats ' + n.rep + ' times' : 'plays once') : (S.lane === 'vel' ? 'velocity ' : 'chance ') + Math.round(v * 100) + '%'));
        };
        apply(e); mv = apply;
      }
      const up = () => { wrap.removeEventListener('pointermove', mv); wrap.removeEventListener('pointerup', up); wrap.removeEventListener('pointercancel', up); touched(); if (UI.pr) UI.pr.dirty = true; };
      wrap.addEventListener('pointermove', mv); wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
    });
    return wrap;
  },
  drawMini(cv, ch, pat, W) {
    const ctx = fitCanvas(cv, W, 26), ns = pat.notes[ch.id] || [];
    ctx.clearRect(0, 0, W, 26);
    let lo = 127, hi = 0; for (const n of ns) { lo = Math.min(lo, n.key); hi = Math.max(hi, n.key); }
    const span = Math.max(1, hi - lo), sx = W / pat.len;
    ctx.fillStyle = CSSV['ink-3'];
    for (let b = 4; b < pat.len; b += 4) ctx.fillRect(Math.round(b * sx), 0, 1, 26);
    ctx.fillStyle = ch.color;
    for (const n of ns) { if (n.t >= pat.len) continue; const y = hi === lo ? 11 : 3 + (hi - n.key) / span * 18; ctx.globalAlpha = 0.45 + n.vel * 0.55; ctx.fillRect(n.t * sx, y, Math.max(2, Math.min(n.len, pat.len - n.t) * sx - 1), 3); }
    ctx.globalAlpha = 1;
  },
  row(ch, pat) {
    const r = h('div', { class: 'rrow' + (ch.id === S.ch ? ' sel' : ''), dataset: { id: ch.id }, style: { '--c': ch.color } });
    const led = h('button', { class: 'led' + (ch.mute ? ' off' : ''), 'aria-label': (ch.mute ? 'Unmute ' : 'Mute ') + ch.name, 'aria-pressed': String(!ch.mute), 'data-hint': ch.name + ' · click to mute, Ctrl+click or right-click to solo' });
    led.onclick = e => { if (e.ctrlKey || e.metaKey) this.soloCh(ch); else edit(() => { ch.mute = !ch.mute; }); };
    led.oncontextmenu = e => { e.preventDefault(); this.soloCh(ch); };
    const pan = Knob({ def: { label: 'Pan', min: -1, max: 1, def: 0, unit: 'pan', bipolar: true }, name: ch.name + ' pan', value: ch.pan, size: 24,
      onStart: () => Hist.push(), onChange: v => { ch.pan = v; syncChannel(ch); }, onEnd: touched });
    const vol = Knob({ def: { label: 'Volume', min: 0, max: 1, def: 0.78, unit: 'vol' }, name: ch.name + ' volume', value: ch.vol, size: 24,
      onStart: () => Hist.push(), onChange: v => { ch.vol = v; syncChannel(ch); }, onEnd: touched });
    const name = h('button', { class: 'chname', 'data-hint': ch.name + ' · click for instrument settings (plugins: show or hide the plugin window), right-click for Cut itself and more' + (ch.cut ? ' · cuts itself' : '') + (ch.cutGroup ? ' · choke group ' + ch.cutGroup : '') },
      h('span', { class: 'nm' }, ch.name),
      ch.cut || ch.cutGroup ? h('span', { class: 'cutb', 'aria-label': (ch.cut ? 'Cuts itself' : '') + (ch.cutGroup ? ' choke group ' + ch.cutGroup : ''), html: icon('scissors', 11) + (ch.cutGroup ? '<b>' + ch.cutGroup + '</b>' : '') }) : null,
      ch.type === 'sampler' && ch.sample && !A.samples.has(ch.sample) ? h('span', { class: 'cutb', 'data-hint': 'Sound loading or missing' }, '…') : null,
      ch.type === 'plugin' && (!NATIVE.on || (NATIVE.status[ch.id] && NATIVE.status[ch.id] !== 'loaded')) ? h('span', { class: 'cutb', 'data-hint': NATIVE.on ? NATIVE.status[ch.id] : 'VST3 plugins play in the desktop app' }, '!') : null,
      h('i', { class: 'hit' }));
    name.onclick = () => { S.ch = ch.id; if (ch.type === 'plugin' && NATIVE.on) NATIVE.openPlugin(ch.id, true); else WM.show('inst'); renderAll(); };
    name.oncontextmenu = e => { e.preventDefault(); this.chMenu(ch, e.clientX, e.clientY, name); };
    const prb = h('button', { class: 'prbtn', html: icon('roll', 15), 'aria-label': 'Open ' + ch.name + ' in the piano roll', 'data-hint': 'Open in the piano roll', onclick: () => { S.ch = ch.id; WM.show('pr'); renderAll(); } });
    const selm = h('div', { class: 'selmark', role: 'button', 'aria-label': 'Select ' + ch.name, 'data-hint': 'Select channel · it receives typing-keyboard notes', onclick: () => { S.ch = ch.id; renderAll(); } });
    pan.classList.add('rk-pan');
    const route = this.routeEl(ch);
    r._refs = { led, pan, vol, route };
    r.append(led, pan, vol, route, name, this.stepsEl(ch, pat), prb, selm);
    // Drop a sound from the browser (or the desktop) on a channel to load it into that channel.
    const isSound = e => { const t = [...e.dataTransfer.types]; return t.includes('Files') || (t.includes('application/x-nxw') && UI.br && UI.br.dragKind === 'sample'); };
    r.addEventListener('dragover', e => { if (isSound(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; r.classList.add('rowdrop'); } });
    r.addEventListener('dragleave', e => { if (!r.contains(e.relatedTarget)) r.classList.remove('rowdrop'); });
    r.addEventListener('drop', async e => {
      if (!isSound(e)) return;
      e.preventDefault(); e.stopPropagation(); r.classList.remove('rowdrop'); this.w.body.classList.remove('rack-drop');
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        const f = [...e.dataTransfer.files].find(x => AUDIO_EXT.test(x.name)); if (!f) { toast('Drop an audio file to load it into ' + ch.name); return; }
        const ids = await runImport([{ file: f, name: f.name, pack: 'Imported', path: '' }], 'Importing sound');
        if (ids[0]) loadSampleInto(ch, ids[0]);
        return;
      }
      try { const o = JSON.parse(e.dataTransfer.getData('application/x-nxw') || 'null'); if (o && o.kind === 'sample') loadSampleInto(ch, o.id); } catch (err) { /* ignore */ }
    });
    return r;
  },
  render() {
    const pat = curPat();
    if (!sigChanged(this, [pat.id, pat.name, pat.color, pat.len, pat.notes, P.swing, S.lane, S.ch, P.channels.map(c => [c.id, c.name, c.color, c.mute, c.vol, c.pan, c.mixer, c.root, c.type, c.cut, c.cutGroup, c.sample, c.sample ? A.samples.has(c.sample) : 0, NATIVE.status[c.id] || '']), P.mixer.map(m => m.name)])) return;
    this.w.sub.textContent = '· ' + pat.name;
    this.patBtn.querySelector('.sw').style.background = pat.color;
    this.patBtn.querySelector('span').textContent = pat.name;
    this.swing.set(P.swing);
    if (![...this.lenSel.options].some(o => +o.value === pat.len)) this.lenSel.append(h('option', { value: pat.len }, (pat.len / 16) + ' bars'));
    this.lenSel.value = String(pat.len);
    for (const b of this.laneSeg.children) b.classList.toggle('on', b.dataset.k === S.lane);
    // When only the notes differ (switching patterns, undo of a step), update the existing cells in place.
    const struct = JSON.stringify([S.lane, P.channels.map(c => [c.id, c.name, c.color, c.root, c.type, c.cut, c.cutGroup, c.sample, c.sample ? A.samples.has(c.sample) : 0, NATIVE.status[c.id] || '']), P.mixer.map(m => m.name)]);
    if (struct === this._struct && this.rowsById.size === P.channels.length) { this.updateRows(); this.updateSteps(pat); return; }
    this._struct = struct;
    const sl = this.rows.scrollLeft, st = this.rows.scrollTop;
    this.rows.textContent = ''; this.cells = []; this.rowsById.clear(); this.nowIdx = -1;
    if (!P.channels.length) this.rows.append(h('div', { class: 'br-note', style: { padding: '14px 16px' } }, 'No channels yet. Add a drum or synth with the Add button, or drop audio files here.'));
    const frag = document.createDocumentFragment();
    for (const ch of P.channels) { const r = this.row(ch, pat); frag.append(r); this.rowsById.set(ch.id, r); }
    this.rows.append(frag);
    this.rows.scrollLeft = sl; this.rows.scrollTop = st;
  },
  updateRows() {
    for (const ch of P.channels) {
      const r = this.rowsById.get(ch.id), f = r && r._refs; if (!f) continue;
      r.classList.toggle('sel', ch.id === S.ch);
      f.led.classList.toggle('off', ch.mute); f.led.setAttribute('aria-pressed', String(!ch.mute)); f.led.setAttribute('aria-label', (ch.mute ? 'Unmute ' : 'Mute ') + ch.name);
      f.pan.set(ch.pan); f.vol.set(ch.vol);
      const rt = ch.mixer ? String(ch.mixer) : 'M'; if (f.route.textContent !== rt) f.route.textContent = rt;
    }
  },
  updateSteps(pat) {
    for (const cells of this.cells) if (cells[this.nowIdx]) cells[this.nowIdx].classList.remove('now');
    this.cells = []; this.nowIdx = -1;
    for (const ch of P.channels) {
      const r = this.rowsById.get(ch.id), old = r && r.querySelector('.steps, .mini'); if (!old) continue;
      const notes = pat.notes[ch.id] || [];
      const cells = old.classList.contains('steps') ? [...old.querySelectorAll('.st')] : null;
      if (cells && cells.length === pat.len && isStepRow(notes, rootKey(ch))) {
        const map = new Map(notes.map(n => [Math.round(n.t), n]));
        cells.forEach((b, i) => { const n = map.get(i); if (n) { b.classList.add('on'); this.styleCell(b, n); } else if (b.classList.contains('on')) b.classList.remove('on', 'maybe'); });
        this.cells.push(cells);
      } else old.replaceWith(this.stepsEl(ch, pat));
    }
  },
  frame() {
    if (!WM.shown('rack')) return;
    const lp = patLocalPos(S.pat), idx = lp == null ? -1 : Math.floor(lp);
    if (idx !== this.nowIdx) {
      for (const cells of this.cells) { if (cells[this.nowIdx]) cells[this.nowIdx].classList.remove('now'); if (cells[idx]) cells[idx].classList.add('now'); }
      this.nowIdx = idx;
    }
    if (A.ctx) {
      const now = A.ctx.currentTime - (A.ctx.outputLatency || 0);
      for (const [id, r] of this.rowsById) { const t = A.hits.get(id); const on = t != null && now >= t && now - t < 0.1; if (on !== r.classList.contains('hit')) r.classList.toggle('hit', on); }
    }
  },
};

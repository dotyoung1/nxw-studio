/* ================================================================
   NXW STUDIO · piano roll
   ================================================================ */
let PR_CLIP = null;     // piano-roll clipboard: notes with times relative to the first one
UI.pr = {
  KW: 62, RH: 24, sel: new Set(), dirty: true, drag: null, marq: null, velMode: 'vel', kbdKey: null, kbdHd: null, lastVel: 0.78, centeredFor: null,
  init() {
    const w = this.w = WM.create(WIN_DEFS[2]);
    w.onResize = () => { this.dirty = true; };
    this.win = 'pr';
    w.onShow = () => { this.render(); requestAnimationFrame(() => this.centerOnNotes()); };
    const toolSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tool' },
      [['draw', 'pencil', 'Draw · click to add notes, drag to move, drag the right edge to resize'], ['select', 'select', 'Select · drag a box around notes'], ['erase', 'erase', 'Erase · click or drag over notes to delete them']]
        .map(([k, ic, hn]) => h('button', { dataset: { k }, 'aria-label': k, 'data-hint': hn, html: icon(ic, 14), onclick: () => { S.prTool = k; this.render(); } })));
    this.toolSeg = toolSeg;
    this.snapSel = h('select', { class: 'sel-box', id: 'prSnap', 'aria-label': 'Snap', 'data-hint': 'Snap · grid that notes lock to (hold Alt while dragging to ignore it)' }, SNAPS.map(s => h('option', { value: s.v }, s.label)));
    this.snapSel.onchange = () => { S.prSnap = +this.snapSel.value; scheduleSave(); };
    this.chordSel = h('select', { class: 'sel-box', id: 'prChord', 'aria-label': 'Chord stamp', 'data-hint': 'Chord stamp · new notes are placed as this chord (Scale chords follow the key)' }, [...Object.keys(CHORDS), 'Scale triad', 'Scale 7th'].map(c => h('option', { value: c }, c)));
    this.chordSel.onchange = () => { S.chord = this.chordSel.value; scheduleSave(); };
    this.rootSel = h('select', { class: 'sel-box', id: 'prRoot', 'aria-label': 'Scale root', 'data-hint': 'Scale root' }, NOTE_NAMES.map((n, i) => h('option', { value: i }, n)));
    this.rootSel.onchange = () => { S.scaleRoot = +this.rootSel.value; scheduleSave(); this.dirty = true; };
    this.scaleSel = h('select', { class: 'sel-box', id: 'prScale', 'aria-label': 'Scale', 'data-hint': 'Scale guide · out-of-scale rows are shaded' }, Object.keys(SCALES).map(s => h('option', { value: s }, s === 'Off' ? 'No scale' : s)));
    this.scaleSel.onchange = () => { S.scale = this.scaleSel.value; scheduleSave(); this.dirty = true; };
    this.lockBtn = h('button', { class: 'btn ghost', 'aria-label': 'Lock to scale', 'data-hint': 'Lock to scale · drawn and moved notes stay on the scale', html: icon('magnet', 14), onclick: () => { S.scaleLock = !S.scaleLock; scheduleSave(); this.render(); hint(S.scaleLock ? 'Notes lock to ' + NOTE_NAMES[S.scaleRoot] + ' ' + S.scale : 'Scale lock off'); } });
    this.ghostBtn = h('button', { class: 'btn', 'data-hint': 'Ghost notes · show the other channels of this pattern', html: icon('ghost', 14) + '<span>Ghosts</span>', onclick: () => { S.ghost = !S.ghost; scheduleSave(); this.render(); } });
    const toolsBtn = h('button', { class: 'btn', 'data-hint': 'Tools · quantize, legato, chop, glue, arpeggiate, strum, humanize, select, MIDI files', html: icon('tools', 14) + '<span>Tools</span>' });
    toolsBtn.onclick = () => menuAt(toolsBtn, this.toolsMenu());
    const progBtn = h('button', { class: 'btn', 'data-hint': 'Chord progression · write a progression in the current key', html: icon('chords', 14) + '<span>Chords</span>', onclick: () => this.progressionDialog() });
    const capBtn = h('button', { class: 'btn', 'data-hint': 'Capture · turn what you just played on the keyboard into a pattern, even without recording', html: icon('capture', 14) + '<span>Capture</span>', onclick: () => captureNotes() });
    this.chordLbl = h('span', { class: 'lbl chord-lbl', 'aria-live': 'polite', 'data-hint': 'Chord of the selected notes' });
    const zo = h('button', { class: 'btn ghost', 'aria-label': 'Zoom out', 'data-hint': 'Zoom out (Ctrl+scroll)', html: icon('zout', 15), onclick: () => this.zoom(1 / 1.25) });
    const zi = h('button', { class: 'btn ghost', 'aria-label': 'Zoom in', 'data-hint': 'Zoom in (Ctrl+scroll)', html: icon('zin', 15), onclick: () => this.zoom(1.25) });
    this.chSel = h('select', { class: 'sel-box', id: 'prCh', 'aria-label': 'Channel', 'data-hint': 'Channel being edited' });
    this.chSel.onchange = () => { S.ch = this.chSel.value; this.sel.clear(); renderAll(); requestAnimationFrame(() => this.centerOnNotes()); };
    const tb = h('div', { class: 'tb' }, toolSeg, h('span', { class: 'div' }), h('span', { class: 'lbl', html: icon('magnet', 13) }), this.snapSel, this.chordSel,
      h('span', { class: 'div' }), this.rootSel, this.scaleSel, this.lockBtn, h('span', { class: 'div' }), toolsBtn, progBtn, capBtn, this.ghostBtn, zo, zi, this.chordLbl, h('span', { style: { flex: '1' } }), this.chSel);
    this.scroller = h('div', { class: 'scroller' });
    this.sizer = h('div', { class: 'sizer' });
    this.cv = h('canvas', { 'aria-label': 'Piano roll note grid' });
    this.sizer.append(this.cv); this.scroller.append(this.sizer);
    this.velBox = h('div', { class: 'vel' }, this.vcv = h('canvas', { 'aria-label': 'Velocity and chance lane' }));
    this.phEl = h('div', { class: 'phline', 'aria-hidden': 'true', style: { '--rh': this.RH + 'px', '--tri': '4px' } });
    w.body.append(tb, h('div', { class: 'cv-main' }, this.scroller, this.velBox, this.phEl));
    this.scroller.addEventListener('scroll', () => { this.dirty = true; });
    this.scroller.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = this.cv.getBoundingClientRect(); this.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left); }
      else if (e.altKey) { e.preventDefault(); this.zoomY(e.deltaY < 0 ? 1 : -1); }
    }, { passive: false });
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => { if (!this.drag) this.hover(e); });
    this.cv.addEventListener('contextmenu', e => e.preventDefault());
    // Double-click a note for its properties (not the note the first click just drew).
    this.cv.addEventListener('dblclick', e => {
      const { x, y } = this.local(e); if (x < this.KW || y < this.RH) return;
      const hh = this.hit(x, y);
      if (hh && !(hh.n === this.lastCreated && performance.now() - this.lastCreatedAt < 700)) this.propsDialog(hh.n);
    });
    this.vcv.addEventListener('pointerdown', e => this.velDown(e));
    this.vcv.addEventListener('contextmenu', e => e.preventDefault());
    // MIDI files dropped on the piano roll are imported.
    w.body.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    w.body.addEventListener('drop', e => { const f = [...(e.dataTransfer.files || [])].find(x => /\.midi?$/i.test(x.name)); if (f) { e.preventDefault(); e.stopPropagation(); importMidiFile(f); } });
  },
  zoom(f, px) {
    const sc = this.scroller, old = S.prZoomX, nz = clamp(old * f, 5, 90);
    if (nz === old) return;
    const anchor = px != null ? px : sc.clientWidth / 2, st = (anchor - this.KW + sc.scrollLeft) / old;
    S.prZoomX = nz; this.draw();
    sc.scrollLeft = st * nz - anchor + this.KW; this.dirty = true; scheduleSave();
  },
  zoomY(d) {
    const sc = this.scroller, old = S.prZoomY, nz = clamp(old + d * 2, 8, 26); if (nz === old) return;
    const mid = (sc.scrollTop + sc.clientHeight / 2 - this.RH) / old;
    S.prZoomY = nz; this.draw(); sc.scrollTop = mid * nz - sc.clientHeight / 2 + this.RH; this.dirty = true; scheduleSave();
  },
  centerOnNotes() {
    const ch = selCh(), sc = this.scroller; if (!sc.clientHeight) return;
    const ns = ch ? (curPat().notes[ch.id] || []) : [];
    let k = 66; if (ns.length) k = Math.round(ns.reduce((a, n) => a + n.key, 0) / ns.length);
    this.draw();
    sc.scrollTop = this.RH + (KEY_HI - k) * S.prZoomY - sc.clientHeight / 2;
    if (ns.length) sc.scrollLeft = Math.max(0, Math.min(...ns.map(n => n.t)) * S.prZoomX - 40);
    this.centeredFor = (ch && ch.id) + curPat().id; this.dirty = true;
  },
  render() {
    const ch = selCh(), pat = curPat();
    this.w.sub.textContent = '· ' + pat.name + (ch ? ' › ' + ch.name : '');
    for (const b of this.toolSeg.children) b.classList.toggle('on', b.dataset.k === S.prTool);
    this.snapSel.value = String(S.prSnap); this.chordSel.value = S.chord; this.rootSel.value = String(S.scaleRoot); this.scaleSel.value = S.scale;
    this.ghostBtn.classList.toggle('on', S.ghost);
    this.lockBtn.classList.toggle('on', !!S.scaleLock && !!SCALES[S.scale]); this.lockBtn.disabled = !SCALES[S.scale];
    const chKey = P.channels.map(c => c.id + c.name).join('|');
    if (chKey !== this._chKey) { this._chKey = chKey; this.chSel.textContent = ''; for (const c of P.channels) this.chSel.append(h('option', { value: c.id }, c.name)); }
    if (ch) this.chSel.value = ch.id;
    for (const n of [...this.sel]) if (!(pat.notes[ch && ch.id] || []).includes(n)) this.sel.delete(n);
    if (WM.shown('pr') && this.centeredFor !== (ch && ch.id) + pat.id) requestAnimationFrame(() => this.centerOnNotes());
    this.dirty = true;
  },
  frame() { if (!WM.shown('pr')) return; if (this.dirty || this.drag) this.draw(); this.placePh(); },
  placePh() {
    const lp = patLocalPos(curPat().id), sc = this.scroller, W = sc.clientWidth, H = sc.clientHeight;
    const x = lp == null ? -9 : this.KW + lp * S.prZoomX - sc.scrollLeft;
    const vis = lp != null && x >= this.KW - 1 && x <= W;
    const key = vis ? Math.round(x * 4) + '|' + H : 'off';
    if (key === this._phKey) return;
    this._phKey = key;
    const e = this.phEl;
    if (!vis) { e.style.display = 'none'; return; }
    e.style.display = 'block'; e.style.height = H + 'px'; e.style.transform = 'translate3d(' + (x - 1).toFixed(2) + 'px,0,0)';
  },
  // geometry
  local(e, cv) { const r = (cv || this.cv).getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
  stepAt(x) { return (x - this.KW + this.scroller.scrollLeft) / S.prZoomX; },
  keyAt(y) { return KEY_HI - Math.floor((y - this.RH + this.scroller.scrollTop) / S.prZoomY); },
  xOf(t) { return this.KW + t * S.prZoomX - this.scroller.scrollLeft; },
  yOf(k) { return this.RH + (KEY_HI - k) * S.prZoomY - this.scroller.scrollTop; },
  notes() { const ch = selCh(); return ch ? patNotes(curPat(), ch) : []; },
  hit(x, y) {
    const ns = this.notes(), st = this.stepAt(x), k = this.keyAt(y);
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i];
      if (n.key === k && st >= n.t && st < n.t + n.len) { const x1 = this.xOf(n.t + n.len); return { n, edge: x > x1 - Math.min(7, n.len * S.prZoomX / 3) }; }
    }
    return null;
  },
  hover(e) {
    const { x, y } = this.local(e);
    let cur = 'default';
    if (y > this.RH && x > this.KW) { const hh = this.hit(x, y); cur = hh ? (hh.edge ? 'ew-resize' : 'grab') : (S.prTool === 'erase' ? 'not-allowed' : S.prTool === 'select' ? 'crosshair' : 'copy'); }
    else if (x <= this.KW) cur = 'pointer';
    if (this.cv.style.cursor !== cur) this.cv.style.cursor = cur;
  },
  audition(key, dur = 0.25) { const ch = selCh(); if (ch) previewChannel(ch, key, dur); },
  down(e) {
    const ch = selCh();
    if (!ch) { hint('Add a channel in the channel rack to write notes'); return; }
    const { x, y } = this.local(e);
    if (y < this.RH) return;
    e.preventDefault();
    this.cv.setPointerCapture(e.pointerId);
    const finish = () => { this.cv.onpointermove = null; this.cv.onpointerup = null; this.cv.onpointercancel = null; };
    if (x < this.KW) {
      const play = k => { const c = audio(); if (!c) return; if (this.kbdHd && this.kbdHd.release) this.kbdHd.release(c.currentTime); this.kbdKey = k; this.kbdHd = playNote(ch, c.currentTime + 0.005, k, 0.8, null); this.dirty = true; };
      play(clamp(this.keyAt(y), KEY_LO, KEY_HI));
      this.cv.onpointermove = ev => { const k = clamp(this.keyAt(this.local(ev).y), KEY_LO, KEY_HI); if (k !== this.kbdKey) play(k); };
      this.cv.onpointerup = this.cv.onpointercancel = () => { if (this.kbdHd && this.kbdHd.release && A.ctx) this.kbdHd.release(A.ctx.currentTime); this.kbdHd = null; this.kbdKey = null; this.dirty = true; finish(); };
      return;
    }
    const pat = curPat(), ns = patNotes(pat, ch);
    let tool = S.prTool;
    if (e.button === 2) tool = 'erase'; else if (e.ctrlKey || e.metaKey) tool = 'select';
    const h0 = this.hit(x, y);
    this.cursorT = Math.max(0, snapFloor(this.stepAt(x), S.prSnap));
    if (tool === 'erase') {
      Hist.push();
      const er = (xx, yy) => { const hh = this.hit(xx, yy); if (hh) { ns.splice(ns.indexOf(hh.n), 1); this.sel.delete(hh.n); VER++; this.dirty = true; } };
      er(x, y);
      this.drag = { mode: 'erase' };
      this.cv.onpointermove = ev => { const p = this.local(ev); er(p.x, p.y); };
      this.cv.onpointerup = this.cv.onpointercancel = () => { this.drag = null; finish(); refresh(); };
      return;
    }
    if (h0 && (e.ctrlKey || e.metaKey)) { if (this.sel.has(h0.n)) this.sel.delete(h0.n); else this.sel.add(h0.n); this.dirty = true; finish(); return; }
    if (h0) {
      Hist.push();
      let anchor = h0.n;
      if (!this.sel.has(anchor)) { if (!e.shiftKey) this.sel.clear(); this.sel.add(anchor); }
      if (e.shiftKey && !h0.edge) {
        const copies = [...this.sel].map(n => Object.assign({}, n));
        const ai = [...this.sel].indexOf(anchor);
        ns.push(...copies); this.sel = new Set(copies); anchor = copies[ai];
      }
      S.prLastLen = anchor.len; this.lastVel = anchor.vel;
      this.audition(anchor.key);
      this.startDrag(h0.edge ? 'resize' : 'move', anchor, x, y);
      return;
    }
    if (tool === 'select') {
      const base = e.shiftKey ? new Set(this.sel) : new Set();
      const t0 = this.stepAt(x), k0 = this.keyAt(y);
      this.marq = { t0, k0, t1: t0, k1: k0 };
      this.drag = { mode: 'marq' };
      this.cv.onpointermove = ev => {
        const p = this.local(ev); this.marq.t1 = this.stepAt(p.x); this.marq.k1 = this.keyAt(p.y);
        const ta = Math.min(this.marq.t0, this.marq.t1), tb = Math.max(this.marq.t0, this.marq.t1), ka = Math.min(this.marq.k0, this.marq.k1), kb = Math.max(this.marq.k0, this.marq.k1);
        this.sel = new Set(base); for (const n of ns) if (n.t < tb && n.t + n.len > ta && n.key >= ka && n.key <= kb) this.sel.add(n);
        this.dirty = true;
      };
      this.cv.onpointerup = this.cv.onpointercancel = () => { this.marq = null; this.drag = null; this.dirty = true; finish(); if (this.sel.size) hint(this.sel.size + ' notes selected · arrows move, Delete removes, Ctrl+D duplicates'); };
      return;
    }
    // draw a new note (or chord)
    Hist.push();
    const t = Math.max(0, snapFloor(this.stepAt(x), S.prSnap)), k0 = clamp(this.keyAt(y), KEY_LO, KEY_HI);
    const k = this.locked() ? clamp(snapToScale(k0), KEY_LO, KEY_HI) : k0;
    const len = S.prLastLen || Math.max(S.prSnap || 1, 1);
    const keys = S.chord === 'Scale triad' ? scaleChordKeys(k, 3) : S.chord === 'Scale 7th' ? scaleChordKeys(k, 4) : (CHORDS[S.chord] || [0]).map(iv => k + iv);
    const created = keys.map(kk => ({ t, len, key: clamp(kk, KEY_LO, KEY_HI), vel: this.lastVel || 0.78, chance: 1 }));
    ns.push(...created); this.sel = new Set(created); this.lastCreated = created[0]; this.lastCreatedAt = performance.now();
    const c = audio(); if (c) created.forEach(n => playNote(ch, c.currentTime + 0.005, n.key, n.vel, 0.25));
    VER++;
    this.startDrag('move', created[0], x, y);
  },
  startDrag(mode, anchor, x, y) {
    const orig = new Map([...this.sel].map(n => [n, { t: n.t, key: n.key, len: n.len }]));
    const a = orig.get(anchor), st0 = this.stepAt(x);
    const vals = [...orig.values()];
    const minT = Math.min(...vals.map(o => o.t)), minK = Math.min(...vals.map(o => o.key)), maxK = Math.max(...vals.map(o => o.key));
    let moved = false, lastDk = 0;
    this.drag = { mode };
    this.cv.onpointermove = ev => {
      const p = this.local(ev);
      if (!moved && Math.hypot(p.x - x, p.y - y) < 3) return;
      moved = true;
      const ds = this.stepAt(p.x) - st0, sn = ev.altKey ? 0 : S.prSnap;
      if (mode === 'move') {
        let dt = snapRound(a.t + ds, sn) - a.t; dt = Math.max(dt, -minT);
        const dk = clamp(Math.round((y - p.y) / S.prZoomY), KEY_LO - minK, KEY_HI - maxK), lock = this.locked() && dk !== 0;
        for (const [n, o] of orig) { n.t = Math.max(0, o.t + dt); n.key = lock ? clamp(snapToScale(o.key + dk), KEY_LO, KEY_HI) : o.key + dk; }
        if (dk !== lastDk) { lastDk = dk; this.audition(anchor.key, 0.18); }
        hint(noteName(anchor.key) + ' · bar ' + (Math.floor(anchor.t / 16) + 1) + ', step ' + (Math.floor(anchor.t % 16) + 1));
      } else {
        const minL = sn || 0.1, nl = Math.max(minL, snapRound(a.t + a.len + ds, sn) - a.t), dl = nl - a.len;
        for (const [n, o] of orig) n.len = Math.max(minL, o.len + dl);
        S.prLastLen = anchor.len;
        hint('Length ' + (anchor.len / 4).toFixed(2).replace(/\.?0+$/, '') + ' beats');
      }
      VER++; this.dirty = true;
    };
    this.cv.onpointerup = this.cv.onpointercancel = () => {
      this.drag = null; this.cv.onpointermove = null; this.cv.onpointerup = null; this.cv.onpointercancel = null;
      growPattern(curPat()); refresh();
    };
  },
  locked() { return !!S.scaleLock && !!SCALES[S.scale]; },
  deleteSel() { if (!this.sel.size) return; edit(() => { const ns = this.notes(); for (const n of this.sel) { const i = ns.indexOf(n); if (i >= 0) ns.splice(i, 1); } this.sel.clear(); }); },
  quantize(ends) {
    const ns = this.notes(); if (!ns.length) return;
    const sn = S.prSnap || 1, tgt = this.sel.size ? [...this.sel] : ns;
    edit(() => NT.quantize(tgt, sn, ends));
    toast('Quantized ' + tgt.length + ' notes to ' + (SNAPS.find(s => s.v === sn) || { label: 'grid' }).label.toLowerCase());
  },
  /* Runs a note tool on the selected notes (or every note of the channel in this pattern), as one undo step. */
  tool(label, fn) {
    const ch = selCh(); if (!ch) { toast('Select a channel first'); return; }
    const all = this.notes(), hadSel = this.sel.size > 0, tgt = hadSel ? [...this.sel] : all.slice();
    if (!tgt.length) { toast('No notes to change'); return; }
    let made;
    edit(() => { made = fn(tgt, all); growPattern(curPat()); });
    const keep = [...this.sel].filter(n => all.includes(n)).concat(Array.isArray(made) ? made : []);
    this.sel = new Set(hadSel ? keep : []); this.dirty = true;
    hint(label + ' · ' + tgt.length + (tgt.length === 1 ? ' note' : ' notes'));
  },
  toolsMenu() {
    const sn = S.prSnap || 1, has = this.notes().length > 0, ch = selCh();
    const T = (label, key, fn, hn) => ({ label, key, hint: hn, disabled: !has, action: () => this.tool(label, fn) });
    return [
      { head: this.sel.size ? 'Selected notes (' + this.sel.size + ')' : 'All notes of ' + (ch ? ch.name : 'this channel') },
      T('Quantize starts', 'Ctrl+Q', ns => NT.quantize(ns, sn, false)),
      T('Quantize starts and lengths', '', ns => NT.quantize(ns, sn, true)),
      T('Legato', 'Ctrl+L', ns => NT.legato(ns), 'Each note lasts until the next one starts'),
      T('Glue', 'Ctrl+G', (ns, all) => { NT.glue(ns, all); }, 'Join touching notes of the same pitch'),
      T('Chop to grid', 'Ctrl+U', (ns, all) => NT.chop(ns, all, sn), 'Split long notes at every grid step'),
      T('Arpeggiate up', 'Alt+A', (ns, all) => NT.arp(ns, all, sn, 'up'), 'Chords become arpeggios at the snap rate'),
      T('Arpeggiate down', '', (ns, all) => NT.arp(ns, all, sn, 'down')),
      T('Arpeggiate up and down', '', (ns, all) => NT.arp(ns, all, sn, 'updown')),
      T('Arpeggiate random', '', (ns, all) => NT.arp(ns, all, sn, 'random')),
      T('Strum up', 'Alt+S', ns => NT.strum(ns, 0.33, false), 'Spread chord notes like a guitar strum'),
      T('Strum down', '', ns => NT.strum(ns, 0.33, true)),
      T('Flam', 'Alt+F', (ns, all) => NT.flam(ns, all), 'A quieter grace note just before each note'),
      T('Limit to scale', 'Alt+K', ns => NT.toScale(ns), 'Move notes onto ' + NOTE_NAMES[S.scaleRoot] + ' ' + (SCALES[S.scale] ? S.scale : 'Major')),
      T('Flip vertically', 'Alt+Y', ns => NT.flipV(ns)),
      T('Reverse in time', '', ns => NT.reverse(ns)),
      T('Humanize timing and velocity', 'Alt+R', ns => NT.humanize(ns, 0.12, 0.12)),
      { head: 'Velocity' },
      T('Ramp up', '', ns => NT.velocity(ns, 'up')), T('Ramp down', '', ns => NT.velocity(ns, 'down')),
      T('Compress (even out)', 'Alt+X', ns => NT.velocity(ns, 'compress')), T('Expand (more contrast)', '', ns => NT.velocity(ns, 'expand')),
      T('Sine wave (LFO)', 'Alt+O', ns => NT.velocity(ns, 'sine')), T('All 100%', '', ns => NT.velocity(ns, 'full')),
      { head: 'Pitch and time' },
      T('Shuffle pitches', '', ns => NT.pitches(ns, 'shuffle'), 'Same rhythm, pitches in a new order'),
      T('Retrograde pitches', '', ns => NT.pitches(ns, 'retro'), 'Same rhythm, pitches backwards'),
      T('Rotate pitches', '', ns => NT.pitches(ns, 'rotate')),
      T('Invert chords', 'Alt+I', ns => NT.invert(ns), 'Lowest note of each chord up an octave'),
      T('Double length (half speed)', '', ns => NT.stretch(ns, 2)), T('Half length (double speed)', '', ns => NT.stretch(ns, 0.5)),
      T('Remove duplicate notes', '', (ns, all) => { NT.dedupe(ns, all); }),
      T(this.sel.size && [...this.sel].every(n => n.mute) ? 'Unmute notes' : 'Mute or unmute notes', 'Ctrl+M', ns => this.muteNotes(ns)),
      { head: 'Select' },
      { label: 'All', key: 'Ctrl+A', action: () => { this.sel = new Set(this.notes()); this.dirty = true; } },
      { label: 'None', key: 'Esc', action: () => { this.sel.clear(); this.dirty = true; } },
      { label: 'Invert selection', action: () => { this.sel = new Set(this.notes().filter(n => !this.sel.has(n))); this.dirty = true; } },
      { label: 'Same pitches as selected', disabled: !this.sel.size, action: () => { const ks = new Set([...this.sel].map(n => n.key)); this.sel = new Set(this.notes().filter(n => ks.has(n.key))); this.dirty = true; } },
      { label: 'Random half', action: () => { this.sel = new Set(this.notes().filter(() => Math.random() < 0.5)); this.dirty = true; } },
      { label: 'Muted notes', action: () => { this.sel = new Set(this.notes().filter(n => n.mute)); this.dirty = true; } },
      { label: 'Notes on the beat', action: () => { this.sel = new Set(this.notes().filter(n => Math.abs(n.t / 4 - Math.round(n.t / 4)) < 1e-3)); this.dirty = true; } },
      { label: 'Notes off the beat', action: () => { this.sel = new Set(this.notes().filter(n => Math.abs(n.t / 4 - Math.round(n.t / 4)) >= 1e-3)); this.dirty = true; } },
      { head: 'Notes' },
      { label: 'Cut', key: 'Ctrl+X', disabled: !this.sel.size, action: () => this.copy(true) },
      { label: 'Copy', key: 'Ctrl+C', disabled: !this.sel.size, action: () => this.copy(false) },
      { label: 'Paste', key: 'Ctrl+V', disabled: !PR_CLIP, action: () => this.paste() },
      { label: 'Duplicate', key: 'Ctrl+B', disabled: !this.sel.size, action: () => this.duplicate() },
      { head: 'Chords and MIDI' },
      { label: 'Chord progression…', icon: 'chords', action: () => this.progressionDialog() },
      { label: 'Capture what I just played', icon: 'capture', action: () => captureNotes() },
      { label: 'Import MIDI file…', action: () => pickMidiFile() },
      { label: 'Export pattern as MIDI file', action: () => exportPatternMidi(curPat()) },
    ];
  },
  muteNotes(ns) { const to = !ns.every(n => n.mute); for (const n of ns) { if (to) n.mute = true; else delete n.mute; } },
  copy(cut) {
    if (!this.sel.size) return;
    const s = [...this.sel], t0 = Math.min(...s.map(n => n.t));
    PR_CLIP = s.map(n => Object.assign({}, n, { t: n.t - t0 }));
    if (cut) this.deleteSel();
    hint((cut ? 'Cut ' : 'Copied ') + s.length + ' notes · click where they should go, then Ctrl+V');
  },
  paste() {
    const ch = selCh(); if (!ch || !PR_CLIP) return;
    const at = this.cursorT != null ? this.cursorT : 0;
    let made;
    edit(() => { made = PR_CLIP.map(n => Object.assign({}, n, { t: n.t + at })); patNotes(curPat(), ch).push(...made); growPattern(curPat()); });
    this.sel = new Set(made);
    const end = Math.max(...made.map(n => n.t + n.len)), sn = S.prSnap || 1;
    this.cursorT = Math.ceil(end / sn - 1e-6) * sn;
    hint('Pasted ' + made.length + ' notes · Ctrl+V again pastes after them');
  },
  duplicate() {
    const ns = this.notes(); if (!this.sel.size) return;
    const s = [...this.sel], t0 = Math.min(...s.map(n => n.t)), t1 = Math.max(...s.map(n => n.t + n.len)), sn = S.prSnap || 1, off = Math.ceil((t1 - t0) / sn - 1e-6) * sn;
    edit(() => { const c = s.map(n => Object.assign({}, n, { t: n.t + off })); ns.push(...c); this.sel = new Set(c); growPattern(curPat()); });
  },
  /* Note properties (double-click a note). */
  propsDialog(n) {
    const ch = selCh(); if (!ch) return;
    const num = (v, min, max, step) => h('input', { type: 'number', class: 'num', value: String(v), min, max, step });
    const keySel = h('select', { class: 'sel-box' }); for (let k = KEY_HI; k >= KEY_LO; k--) keySel.append(h('option', { value: k }, noteName(k)));
    keySel.value = String(n.key);
    const tIn = num(r2(n.t), 0, 1024, 0.25), lIn = num(r2(n.len), 0.05, 1024, 0.25), vIn = num(Math.round(n.vel * 100), 1, 100, 1), cIn = num(Math.round((n.chance ?? 1) * 100), 0, 100, 1);
    const rSel = h('select', { class: 'sel-box' }, REPS.map(r => h('option', { value: r }, r === 1 ? 'Once' : r + ' times')));
    rSel.value = String(n.rep > 1 ? n.rep : 1);
    const mIn = h('input', { type: 'checkbox' }); mIn.checked = !!n.mute;
    const row = (l, el, sub) => h('label', { class: 'frow' }, h('span', null, l), el, sub ? h('small', null, sub) : null);
    dialog('Note properties', h('div', { class: 'form' },
      row('Pitch', keySel), row('Start', tIn, 'steps · 16 per bar'), row('Length', lIn, 'steps'), row('Velocity', vIn, '%'), row('Chance', cIn, '% of the times it plays'),
      row('Repeat', rSel), row('Muted', mIn)), [
      { label: 'Cancel' },
      { label: 'Apply', primary: true, action: () => {
        const v = (el, d) => { const x = parseFloat(el.value); return isFinite(x) ? x : d; };
        edit(() => {
          n.key = clamp(+keySel.value, KEY_LO, KEY_HI); n.t = Math.max(0, v(tIn, n.t)); n.len = Math.max(0.05, v(lIn, n.len));
          n.vel = clamp(v(vIn, 78) / 100, 0.01, 1); n.chance = clamp(v(cIn, 100) / 100, 0, 1);
          const rp = +rSel.value; if (rp > 1) n.rep = rp; else delete n.rep;
          if (mIn.checked) n.mute = true; else delete n.mute;
          growPattern(curPat());
        });
      } }]);
  },
  /* Chord progression writer: preset progressions in the current key, with voicing and voice leading. */
  progressionDialog() {
    const ch = selCh(); if (!ch) { toast('Select a channel first'); return; }
    const names = Object.keys(PROGRESSIONS);
    const progSel = h('select', { class: 'sel-box' }, names.map(n => h('option', { value: n }, n)));
    progSel.value = S.progLast && PROGRESSIONS[S.progLast] ? S.progLast : names[0];
    const lenSel = h('select', { class: 'sel-box' }, [[8, '2 beats'], [16, '1 bar'], [32, '2 bars']].map(([v, l]) => h('option', { value: v }, l))); lenSel.value = '16';
    const octSel = h('select', { class: 'sel-box' }, [2, 3, 4, 5].map(o => h('option', { value: o }, 'Octave ' + o))); octSel.value = '4';
    const voiceSel = h('select', { class: 'sel-box' }, [['close', 'Close'], ['open', 'Open'], ['spread', 'Spread']].map(([v, l]) => h('option', { value: v }, l)));
    const cb = (on) => { const c = h('input', { type: 'checkbox' }); c.checked = on; return c; };
    const sev = cb(false), lead = cb(true), bass = cb(false), repl = cb(false);
    const keyTxt = NOTE_NAMES[S.scaleRoot] + ' ' + (chordScale() === SCALES.Minor && S.scale !== 'Minor' ? 'Minor' : chordScale() === SCALES.Major && S.scale !== 'Major' ? 'Major' : S.scale);
    const row = (l, el) => h('label', { class: 'frow' }, h('span', null, l), el);
    const opts = () => ({ len: +lenSel.value, octave: +octSel.value, voicing: voiceSel.value, sevenths: sev.checked, lead: lead.checked, bass: bass.checked, vel: 0.72 });
    const preview = () => {
      const c = audio(); if (!c) return;
      const ns = buildProgression(PROGRESSIONS[progSel.value], Object.assign(opts(), { len: 8 })), sd = 60 / P.bpm / 4;
      for (const n of ns) playNote(ch, c.currentTime + 0.05 + n.t * sd, n.key, 0.6, n.len * sd * 0.95);
    };
    const dice = () => { progSel.value = names[Math.floor(Math.random() * names.length)]; voiceSel.value = ['close', 'open', 'spread'][Math.floor(Math.random() * 3)]; sev.checked = Math.random() < 0.4; preview(); };
    dialog('Chord progression', h('div', { class: 'form' },
      h('p', { class: 'dlg-note' }, 'Written in ' + keyTxt + ' (change the key with the scale menus in the piano roll) onto ' + ch.name + '.'),
      row('Progression', progSel), row('Chord length', lenSel), row('Register', octSel), row('Voicing', voiceSel),
      row('Seventh chords', sev), row('Smooth voice leading', lead), row('Add bass notes', bass), row('Replace this channel’s notes', repl),
      h('div', { class: 'krow', style: { gap: '6px', marginTop: '6px' } },
        h('button', { class: 'btn', html: icon('play', 11) + '<span>Preview</span>', onclick: preview }),
        h('button', { class: 'btn', 'data-hint': 'Pick a random progression and voicing', onclick: dice }, 'Surprise me'))), [
      { label: 'Cancel' },
      { label: 'Write chords', primary: true, action: () => {
        S.progLast = progSel.value; scheduleSave();
        const at = repl.checked ? 0 : snapFloor(this.cursorT || 0, 16);
        const made = buildProgression(PROGRESSIONS[progSel.value], opts()).map(n => Object.assign(n, { t: n.t + at }));
        edit(() => { const pat = curPat(); if (repl.checked) pat.notes[ch.id] = []; patNotes(pat, ch).push(...made); growPattern(pat); });
        this.sel = new Set(made); this.dirty = true; WM.show('pr');
        toast('Wrote ' + progSel.value.split(' · ')[1] + ' in ' + keyTxt);
      } }]);
  },
  key(e) {
    const mod = e.ctrlKey || e.metaKey, ns = this.notes(), c = e.code, sn = S.prSnap || 1;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (this.sel.size) { e.preventDefault(); this.deleteSel(); return true; } return false; }
    if (mod && c === 'KeyA') { e.preventDefault(); this.sel = new Set(ns); this.dirty = true; return true; }
    if (e.key === 'Escape' && this.sel.size) { this.sel.clear(); this.dirty = true; return true; }
    if (mod && (c === 'KeyD' || c === 'KeyB') && this.sel.size) { e.preventDefault(); this.duplicate(); return true; }
    if (mod && !e.shiftKey && (c === 'KeyC' || c === 'KeyX') && this.sel.size) { e.preventDefault(); this.copy(c === 'KeyX'); return true; }
    if (mod && !e.shiftKey && c === 'KeyV' && PR_CLIP) { e.preventDefault(); this.paste(); return true; }
    const tools = mod && !e.altKey ? { KeyQ: ['Quantize', x => NT.quantize(x, sn, false)], KeyL: ['Legato', x => NT.legato(x)], KeyG: ['Glue', (x, all) => { NT.glue(x, all); }], KeyU: ['Chop', (x, all) => NT.chop(x, all, sn)], KeyM: ['Mute', x => this.muteNotes(x)] }
      : e.altKey && !mod ? { KeyA: ['Arpeggiate', (x, all) => NT.arp(x, all, sn, 'up')], KeyS: ['Strum', x => NT.strum(x, 0.33, false)], KeyF: ['Flam', (x, all) => NT.flam(x, all)], KeyK: ['Limit to scale', x => NT.toScale(x)],
        KeyY: ['Flip', x => NT.flipV(x)], KeyR: ['Humanize', x => NT.humanize(x, 0.12, 0.12)], KeyX: ['Compress velocity', x => NT.velocity(x, 'compress')], KeyO: ['Velocity LFO', x => NT.velocity(x, 'sine')], KeyI: ['Invert chords', x => NT.invert(x)] } : null;
    if (tools && tools[c] && !e.shiftKey) { e.preventDefault(); if (ns.length) this.tool(tools[c][0], tools[c][1]); return true; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.sel.size) {
      e.preventDefault(); const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
      const s = [...this.sel]; if (s.some(n => n.key + d < KEY_LO || n.key + d > KEY_HI)) return true;
      // Locked to the scale, single steps move to the next scale note.
      const lock = this.locked() && !e.shiftKey;
      const step = k => { if (!lock) return k + d; let x = k + d; while (!inScale(x) && x > KEY_LO && x < KEY_HI) x += d; return x; };
      edit(() => { for (const n of s) n.key = clamp(step(n.key), KEY_LO, KEY_HI); }); this.audition(s[0].key, 0.2); return true;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.sel.size) {
      e.preventDefault(); const d = (e.key === 'ArrowRight' ? 1 : -1) * (S.prSnap || 1), s = [...this.sel];
      if (s.some(n => n.t + d < 0)) return true;
      edit(() => { for (const n of s) n.t += d; growPattern(curPat()); }); return true;
    }
    return false;
  },
  velDown(e) {
    const { x, y } = this.local(e, this.vcv);
    if (x < this.KW) { this.velMode = { vel: 'chance', chance: 'rep', rep: 'vel' }[this.velMode]; this.dirty = true; hint({ vel: 'Lane shows velocity', chance: 'Lane shows chance · how often each note plays', rep: 'Lane shows repeat · how many times each note retriggers' }[this.velMode]); return; }
    if (!selCh()) return;
    e.preventDefault(); this.vcv.setPointerCapture(e.pointerId); Hist.push();
    const H = this.vcv.clientHeight, val = yy => r2(clamp(1 - (yy - 6) / (H - 12), 0.01, 1));
    let px = x, pv = val(y);
    const apply = (x2, v2) => {
      const ns = this.sel.size ? [...this.sel] : this.notes(), xa = Math.min(px, x2) - 4, xb = Math.max(px, x2) + 4;
      for (const n of ns) { const nx = this.xOf(n.t); if (nx >= xa && nx <= xb) { const f = x2 === px ? 1 : clamp((nx - px) / (x2 - px), 0, 1); const v = r2(pv + (v2 - pv) * f); if (this.velMode === 'vel') { n.vel = Math.max(0.01, v); this.lastVel = n.vel; } else if (this.velMode === 'chance') n.chance = v; else { const rp = REPS[Math.round(clamp(v, 0, 1) * (REPS.length - 1))]; if (rp > 1) n.rep = rp; else delete n.rep; } } }
      px = x2; pv = v2; VER++; this.dirty = true;
      hint(this.velMode === 'rep' ? 'Repeat ×' + REPS[Math.round(clamp(v2, 0, 1) * (REPS.length - 1))] : (this.velMode === 'vel' ? 'Velocity ' : 'Chance ') + Math.round(v2 * 100) + '%');
    };
    apply(x, pv);
    this.vcv.onpointermove = ev => { const p = this.local(ev, this.vcv); apply(p.x, val(p.y)); };
    this.vcv.onpointerup = this.vcv.onpointercancel = () => { this.vcv.onpointermove = null; this.vcv.onpointerup = null; this.vcv.onpointercancel = null; touched(); if (UI.rack) UI.rack.render(); };
  },
  draw() {
    this.dirty = false;
    const pat = curPat(), ch = selCh(), sc = this.scroller;
    const W = sc.clientWidth, H = sc.clientHeight; if (!W || !H) return;
    const zx = S.prZoomX, zy = S.prZoomY, KW = this.KW, RH = this.RH, nK = KEY_HI - KEY_LO + 1;
    const ns = ch ? (pat.notes[ch.id] || []) : [];
    let maxEnd = pat.len; for (const n of ns) maxEnd = Math.max(maxEnd, n.t + n.len);
    const total = Math.ceil(maxEnd / 16) * 16 + 64;
    const cw = Math.max(W, KW + total * zx), chh = Math.max(H, RH + nK * zy);
    if (this.sizer._w !== cw) { this.sizer.style.width = cw + 'px'; this.sizer._w = cw; }
    if (this.sizer._h !== chh) { this.sizer.style.height = chh + 'px'; this.sizer._h = chh; }
    const ctx = fitCanvas(this.cv, W, H), sx = sc.scrollLeft, sy = sc.scrollTop;
    ctx.fillStyle = CSSV['ink-0']; ctx.fillRect(0, 0, W, H);
    const scale = SCALES[S.scale], root = S.scaleRoot;
    const kTop = KEY_HI - Math.floor(sy / zy), kBot = Math.max(KEY_LO, KEY_HI - Math.ceil((sy + H - RH) / zy));
    for (let k = kTop; k >= kBot; k--) {
      const y = RH + (KEY_HI - k) * zy - sy, pc = ((k % 12) + 12) % 12;
      const inScale = !scale || scale.includes(((pc - root) % 12 + 12) % 12);
      ctx.fillStyle = !inScale ? '#101317' : isBlack(k) ? '#181d22' : '#1e242a';
      ctx.fillRect(KW, y, W - KW, zy);
      if (scale && pc === root) { ctx.fillStyle = hexA(CSSV.verdigris, 0.07); ctx.fillRect(KW, y, W - KW, zy); }
      ctx.fillStyle = pc === 0 ? CSSV['rule-hi'] : '#151a1f'; ctx.fillRect(KW, y + zy - 1, W - KW, 1);
    }
    const s0 = Math.max(0, Math.floor(sx / zx)), s1 = Math.ceil((sx + W - KW) / zx);
    const sub = S.prSnap > 0 && S.prSnap < 1 && zx * S.prSnap >= 7 ? S.prSnap : 0;
    if (sub) { ctx.fillStyle = 'rgba(255,255,255,0.025)'; for (let t = Math.floor(s0 / sub) * sub; t <= s1; t += sub) if (Math.abs(t - Math.round(t)) > 1e-6) ctx.fillRect(KW + t * zx - sx, RH, 1, H - RH); }
    for (let s = s0; s <= s1; s++) {
      const x = KW + s * zx - sx;
      if (s % 16 === 0) ctx.fillStyle = '#3d4752'; else if (s % 4 === 0) ctx.fillStyle = '#2a3139'; else if (zx >= 9) ctx.fillStyle = '#1f252b'; else continue;
      ctx.fillRect(x, RH, 1, H - RH);
    }
    const xe = KW + pat.len * zx - sx;
    if (xe < W) { const xa = Math.max(KW, xe); ctx.fillStyle = 'rgba(5,7,9,0.55)'; ctx.fillRect(xa, RH, W - xa, H - RH); }
    ctx.save(); ctx.beginPath(); ctx.rect(KW, RH, W - KW, H - RH); ctx.clip();
    if (S.ghost) {
      for (const och of P.channels) {
        if (och === ch) continue;
        const gs = pat.notes[och.id]; if (!gs) continue;
        ctx.strokeStyle = hexA(och.color, 0.38); ctx.lineWidth = 1;
        for (const n of gs) { const x = KW + n.t * zx - sx, y = RH + (KEY_HI - n.key) * zy - sy, w = Math.max(3, n.len * zx - 1); if (x > W || x + w < KW || y > H || y + zy < RH) continue; ctx.strokeRect(x + 0.5, y + 1.5, w - 1, zy - 3); }
      }
    }
    if (ch) {
      ctx.font = '600 ' + Math.min(10, zy - 4) + 'px ' + FONT_UI; ctx.textBaseline = 'middle';
      for (const n of ns) {
        const x = KW + n.t * zx - sx, w = Math.max(4, n.len * zx - 1), y = RH + (KEY_HI - n.key) * zy - sy;
        if (x > W || x + w < KW || y > H || y + zy < RH) continue;
        const sel = this.sel.has(n), late = n.t >= pat.len;
        ctx.globalAlpha = late ? 0.4 : 1;
        ctx.fillStyle = n.mute ? '#2b3238' : mixHex(ch.color, '#0d1013', (1 - n.vel) * 0.62);
        rrect(ctx, x + 0.5, y + 1, w - 1, zy - 2, Math.min(4, zy / 3)); ctx.fill();
        if (n.mute) ctx.setLineDash([3, 2]);
        ctx.lineWidth = sel ? 2 : 1; ctx.strokeStyle = sel ? CSSV.copper : n.mute ? hexA(ch.color, 0.7) : 'rgba(0,0,0,0.45)'; ctx.stroke();
        if (n.mute) ctx.setLineDash([]);
        if (w > 30 && zy >= 11) { ctx.fillStyle = n.mute ? CSSV['text-faint'] : 'rgba(8,10,12,0.8)'; ctx.fillText(noteName(n.key), x + 5, y + zy / 2 + 0.5); }
        if (n.rep > 1) { ctx.fillStyle = 'rgba(8,10,12,0.55)'; for (let r = 1; r < n.rep; r++) ctx.fillRect(Math.round(x + w * r / n.rep), y + 3, 1, zy - 6); }
        if ((n.chance ?? 1) < 0.999) { ctx.fillStyle = CSSV.copper; ctx.beginPath(); ctx.arc(x + w - 5, y + 5, 2, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
    }
    if (this.marq) {
      const m = this.marq, xa = KW + Math.min(m.t0, m.t1) * zx - sx, xb = KW + Math.max(m.t0, m.t1) * zx - sx, ya = RH + (KEY_HI - Math.max(m.k0, m.k1)) * zy - sy, yb = RH + (KEY_HI - Math.min(m.k0, m.k1) + 1) * zy - sy;
      ctx.fillStyle = hexA(CSSV.copper, 0.1); ctx.fillRect(xa, ya, xb - xa, yb - ya); ctx.strokeStyle = CSSV.copper; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(xa + 0.5, ya + 0.5, xb - xa, yb - ya); ctx.setLineDash([]);
    }
    ctx.restore();
    // ruler
    ctx.fillStyle = CSSV['ink-1']; ctx.fillRect(0, 0, W, RH); ctx.fillStyle = CSSV['rule-hi']; ctx.fillRect(0, RH - 1, W, 1);
    ctx.font = '500 9.5px ' + FONT_MONO; ctx.textBaseline = 'middle';
    for (let s = Math.floor(s0 / 4) * 4; s <= s1; s += 4) {
      const x = KW + s * zx - sx; if (x < KW - 1) continue;
      if (s % 16 === 0) { ctx.fillStyle = '#4a5560'; ctx.fillRect(x, 6, 1, RH - 6); ctx.fillStyle = CSSV.text; ctx.fillText(String(s / 16 + 1), x + 4, RH / 2); }
      else if (zx * 4 >= 22) { ctx.fillStyle = '#353e48'; ctx.fillRect(x, RH - 7, 1, 6); ctx.fillStyle = CSSV['text-faint']; if (zx * 4 >= 40) ctx.fillText((s / 16 + 1 | 0) + '.' + ((s % 16) / 4 + 1), x + 3, RH / 2); }
    }
    if (xe > KW && xe < W) { ctx.fillStyle = CSSV.copper; ctx.beginPath(); ctx.moveTo(xe, RH - 1); ctx.lineTo(xe - 7, RH - 1); ctx.lineTo(xe, RH - 9); ctx.closePath(); ctx.fill(); }
    // keyboard
    ctx.save(); ctx.beginPath(); ctx.rect(0, RH, KW, H - RH); ctx.clip();
    const held = new Set(); if (this.kbdKey != null) held.add(this.kbdKey); for (const k of A.held.keys()) held.add(k);
    ctx.font = '600 8.5px ' + FONT_MONO;
    for (let k = kTop; k >= kBot; k--) {
      const y = RH + (KEY_HI - k) * zy - sy, blk = isBlack(k);
      ctx.fillStyle = held.has(k) && !blk ? CSSV.verdigris : '#d3dade'; ctx.fillRect(0, y, KW - 1, zy);
      if (blk) { ctx.fillStyle = held.has(k) ? CSSV['verdigris-deep'] : '#14181c'; ctx.fillRect(0, y, KW * 0.6, zy); }
      const pc = ((k % 12) + 12) % 12;
      if (pc === 0 || pc === 5) { ctx.fillStyle = '#9aa4ab'; ctx.fillRect(0, y + zy - 1, KW - 1, 1); }
      if (pc === 0 && zy >= 9) { ctx.fillStyle = '#4d5760'; ctx.fillText(noteName(k), KW - 24, y + zy / 2 + 0.5); }
      if (scale && !blk && !scale.includes(((pc - root) % 12 + 12) % 12)) { ctx.fillStyle = 'rgba(13,16,19,0.18)'; ctx.fillRect(0, y, KW - 1, zy); }
    }
    ctx.restore();
    ctx.fillStyle = CSSV['rule-hi']; ctx.fillRect(KW - 1, RH, 1, H - RH);
    ctx.fillStyle = CSSV['ink-1']; ctx.fillRect(0, 0, KW, RH);
    ctx.fillStyle = ch ? ch.color : CSSV['text-faint']; ctx.fillRect(8, RH / 2 - 3, 6, 6);
    ctx.fillStyle = CSSV['text-dim']; ctx.font = '600 9px ' + FONT_UI; ctx.fillText(SCALES[S.scale] ? NOTE_NAMES[S.scaleRoot] + ' ' + (S.scale.length > 6 ? S.scale.slice(0, 5) + '.' : S.scale) : 'Chromatic', 18, RH / 2);
    // Chord of the selection (or of the notes under the edit cursor).
    let ck = this.sel.size > 1 ? [...this.sel].map(n => n.key) : [];
    if (!ck.length && this.cursorT != null) ck = ns.filter(n => n.t <= this.cursorT + 1e-6 && n.t + n.len > this.cursorT + 1e-6).map(n => n.key);
    const cn = ck.length > 1 ? chordName(ck) : '';
    if (this.chordLbl.textContent !== cn) this.chordLbl.textContent = cn;
    this.drawVel();
  },
  drawVel() {
    const W = this.velBox.clientWidth, H = this.velBox.clientHeight; if (!W || !H) return;
    const ctx = fitCanvas(this.vcv, W, H), pat = curPat(), ch = selCh(), zx = S.prZoomX, KW = this.KW, sx = this.scroller.scrollLeft;
    ctx.fillStyle = CSSV['ink-1']; ctx.fillRect(0, 0, W, H);
    const s0 = Math.max(0, Math.floor(sx / zx)), s1 = Math.ceil((sx + W - KW) / zx);
    for (let s = Math.floor(s0 / 4) * 4; s <= s1; s += 4) { ctx.fillStyle = s % 16 === 0 ? '#323b45' : '#222930'; ctx.fillRect(KW + s * zx - sx, 0, 1, H); }
    ctx.fillStyle = '#1d2329'; ctx.fillRect(KW, 6, W - KW, 1); ctx.fillRect(KW, Math.round(H / 2), W - KW, 1);
    if (ch) {
      const ns = pat.notes[ch.id] || [];
      for (const n of ns) {
        const x = KW + n.t * zx - sx; if (x < KW - 2 || x > W) continue;
        const v = this.velMode === 'vel' ? n.vel : this.velMode === 'chance' ? (n.chance ?? 1) : Math.max(0.04, REPS.indexOf(n.rep > 1 ? n.rep : 1) / (REPS.length - 1)), top = 6 + (1 - v) * (H - 12);
        const col = this.sel.has(n) ? CSSV.copper : (this.velMode === 'vel' ? ch.color : this.velMode === 'chance' ? '#b9a0ff' : '#f2c14e');
        ctx.fillStyle = hexA(col.startsWith('#') ? col : '#ee9663', 0.35); ctx.fillRect(x, top, Math.max(2, Math.min(n.len * zx - 2, 14)), H - 6 - top);
        ctx.fillStyle = col; ctx.fillRect(x, top, 2, H - 6 - top);
        ctx.beginPath(); ctx.arc(x + 1, top, 3, 0, 7); ctx.fill();
      }
    }
    ctx.fillStyle = CSSV['ink-2']; ctx.fillRect(0, 0, KW, H); ctx.fillStyle = CSSV['rule-hi']; ctx.fillRect(KW - 1, 0, 1, H);
    ctx.font = '700 8.5px ' + FONT_UI; ctx.textBaseline = 'middle';
    ctx.fillStyle = this.velMode === 'vel' ? CSSV.verdigris : CSSV['text-faint']; ctx.fillText('VELOCITY', 8, H / 2 - 16);
    ctx.fillStyle = this.velMode === 'chance' ? '#b9a0ff' : CSSV['text-faint']; ctx.fillText('CHANCE', 8, H / 2);
    ctx.fillStyle = this.velMode === 'rep' ? '#f2c14e' : CSSV['text-faint']; ctx.fillText('REPEAT', 8, H / 2 + 16);
  },
};

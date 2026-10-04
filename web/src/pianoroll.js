/* ================================================================
   NXW STUDIO · piano roll
   ================================================================ */
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
    this.chordSel = h('select', { class: 'sel-box', id: 'prChord', 'aria-label': 'Chord stamp', 'data-hint': 'Chord stamp · new notes are placed as this chord' }, Object.keys(CHORDS).map(c => h('option', { value: c }, c)));
    this.chordSel.onchange = () => { S.chord = this.chordSel.value; scheduleSave(); };
    this.rootSel = h('select', { class: 'sel-box', id: 'prRoot', 'aria-label': 'Scale root', 'data-hint': 'Scale root' }, NOTE_NAMES.map((n, i) => h('option', { value: i }, n)));
    this.rootSel.onchange = () => { S.scaleRoot = +this.rootSel.value; scheduleSave(); this.dirty = true; };
    this.scaleSel = h('select', { class: 'sel-box', id: 'prScale', 'aria-label': 'Scale', 'data-hint': 'Scale guide · out-of-scale rows are shaded' }, Object.keys(SCALES).map(s => h('option', { value: s }, s === 'Off' ? 'No scale' : s)));
    this.scaleSel.onchange = () => { S.scale = this.scaleSel.value; scheduleSave(); this.dirty = true; };
    this.ghostBtn = h('button', { class: 'btn', 'data-hint': 'Ghost notes · show the other channels of this pattern', html: icon('ghost', 14) + '<span>Ghosts</span>', onclick: () => { S.ghost = !S.ghost; scheduleSave(); this.render(); } });
    const qBtn = h('button', { class: 'btn', 'data-hint': 'Quantize · snap note starts (selected, or all) to the grid', html: icon('quant', 14) + '<span>Quantize</span>', onclick: () => this.quantize() });
    const zo = h('button', { class: 'btn ghost', 'aria-label': 'Zoom out', 'data-hint': 'Zoom out (Ctrl+scroll)', html: icon('zout', 15), onclick: () => this.zoom(1 / 1.25) });
    const zi = h('button', { class: 'btn ghost', 'aria-label': 'Zoom in', 'data-hint': 'Zoom in (Ctrl+scroll)', html: icon('zin', 15), onclick: () => this.zoom(1.25) });
    this.chSel = h('select', { class: 'sel-box', id: 'prCh', 'aria-label': 'Channel', 'data-hint': 'Channel being edited' });
    this.chSel.onchange = () => { S.ch = this.chSel.value; this.sel.clear(); renderAll(); requestAnimationFrame(() => this.centerOnNotes()); };
    const tb = h('div', { class: 'tb' }, toolSeg, h('span', { class: 'div' }), h('span', { class: 'lbl', html: icon('magnet', 13) }), this.snapSel, this.chordSel,
      h('span', { class: 'div' }), this.rootSel, this.scaleSel, h('span', { class: 'div' }), this.ghostBtn, qBtn, zo, zi, h('span', { style: { flex: '1' } }), this.chSel);
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
    this.vcv.addEventListener('pointerdown', e => this.velDown(e));
    this.vcv.addEventListener('contextmenu', e => e.preventDefault());
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
    const t = Math.max(0, snapFloor(this.stepAt(x), S.prSnap)), k = clamp(this.keyAt(y), KEY_LO, KEY_HI);
    const len = S.prLastLen || Math.max(S.prSnap || 1, 1);
    const created = CHORDS[S.chord].map(iv => ({ t, len, key: clamp(k + iv, KEY_LO, KEY_HI), vel: this.lastVel || 0.78, chance: 1 }));
    ns.push(...created); this.sel = new Set(created);
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
        const dk = clamp(Math.round((y - p.y) / S.prZoomY), KEY_LO - minK, KEY_HI - maxK);
        for (const [n, o] of orig) { n.t = Math.max(0, o.t + dt); n.key = o.key + dk; }
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
  deleteSel() { if (!this.sel.size) return; edit(() => { const ns = this.notes(); for (const n of this.sel) { const i = ns.indexOf(n); if (i >= 0) ns.splice(i, 1); } this.sel.clear(); }); },
  quantize() {
    const ns = this.notes(); if (!ns.length) return;
    const sn = S.prSnap || 1, tgt = this.sel.size ? [...this.sel] : ns;
    edit(() => { for (const n of tgt) n.t = Math.max(0, snapRound(n.t, sn)); });
    toast('Quantized ' + tgt.length + ' notes to ' + (SNAPS.find(s => s.v === sn) || { label: 'grid' }).label.toLowerCase());
  },
  key(e) {
    const mod = e.ctrlKey || e.metaKey, ns = this.notes();
    if (e.key === 'Delete' || e.key === 'Backspace') { if (this.sel.size) { e.preventDefault(); this.deleteSel(); return true; } return false; }
    if (mod && e.code === 'KeyA') { e.preventDefault(); this.sel = new Set(ns); this.dirty = true; return true; }
    if (e.key === 'Escape' && this.sel.size) { this.sel.clear(); this.dirty = true; return true; }
    if (mod && e.code === 'KeyD' && this.sel.size) {
      e.preventDefault();
      const s = [...this.sel], t0 = Math.min(...s.map(n => n.t)), t1 = Math.max(...s.map(n => n.t + n.len)), sn = S.prSnap || 1, off = Math.ceil((t1 - t0) / sn - 1e-6) * sn;
      edit(() => { const c = s.map(n => Object.assign({}, n, { t: n.t + off })); ns.push(...c); this.sel = new Set(c); growPattern(curPat()); });
      return true;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.sel.size) {
      e.preventDefault(); const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
      const s = [...this.sel]; if (s.some(n => n.key + d < KEY_LO || n.key + d > KEY_HI)) return true;
      edit(() => { for (const n of s) n.key += d; }); this.audition(s[0].key, 0.2); return true;
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
        ctx.fillStyle = mixHex(ch.color, '#0d1013', (1 - n.vel) * 0.62);
        rrect(ctx, x + 0.5, y + 1, w - 1, zy - 2, Math.min(4, zy / 3)); ctx.fill();
        ctx.lineWidth = sel ? 2 : 1; ctx.strokeStyle = sel ? CSSV.copper : 'rgba(0,0,0,0.45)'; ctx.stroke();
        if (w > 30 && zy >= 11) { ctx.fillStyle = 'rgba(8,10,12,0.8)'; ctx.fillText(noteName(n.key), x + 5, y + zy / 2 + 0.5); }
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

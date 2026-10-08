/* ================================================================
   NXW STUDIO · playlist (arrangement)
   ================================================================ */
let PL_CLIP = null;     // playlist clipboard: clips with starts relative to the first one
/* --------------------------- arrangements --------------------------- */
/* Several arrangements of the same patterns. The current one lives in P.playlist (which is all the
   engines read); the others are kept in P.arrs. */
function arrList() {
  if (!Array.isArray(P.arrs) || !P.arrs.length) { P.arrs = [{ id: uid(), name: 'Arrangement 1' }]; P.arrCur = P.arrs[0].id; }
  if (!P.arrs.some(a => a.id === P.arrCur)) P.arrCur = P.arrs[0].id;
  return P.arrs;
}
function curArr() { return arrList().find(a => a.id === P.arrCur); }
function emptyPlaylist() { return { tracks: 16, names: [], mute: [], clips: [], loop: null, markers: [] }; }
function switchArrangement(id) {
  const cur = curArr(), nx = arrList().find(a => a.id === id); if (!nx || nx === cur) return;
  stop();
  edit(() => { cur.pl = P.playlist; P.playlist = nx.pl || emptyPlaylist(); delete nx.pl; P.arrCur = nx.id; P.playlist.names ||= []; P.playlist.mute ||= []; });
  if (UI.pl) UI.pl.sel.clear();
  A.pos = 0; hint('Arrangement: ' + nx.name);
}
function arrangementMenu(anchor) {
  const list = arrList(), cur = curArr();
  menuAt(anchor, [
    { head: 'Arrangements' },
    ...list.map(a => ({ label: a.name, checked: a === cur, action: () => switchArrangement(a.id) })),
    { sep: true },
    { label: 'New arrangement', action: () => { const a = { id: uid(), name: 'Arrangement ' + (list.length + 1), pl: emptyPlaylist() }; edit(() => { P.arrs.push(a); }); switchArrangement(a.id); } },
    { label: 'Clone this arrangement', action: () => { const a = { id: uid(), name: cur.name + ' copy', pl: JSON.parse(JSON.stringify(P.playlist)) }; for (const c of a.pl.clips) c.id = uid(); edit(() => { P.arrs.push(a); }); switchArrangement(a.id); } },
    { label: 'Rename…', action: () => askText(anchor, cur.name, v => edit(() => { cur.name = v; })) },
    { label: 'Delete this arrangement', danger: true, disabled: list.length < 2, action: () => { const other = list.find(a => a !== cur); switchArrangement(other.id); edit(() => { P.arrs = P.arrs.filter(a => a !== cur); }); } },
  ]);
}
/* --------------------------- time edits --------------------------- */
/** Splits a clip at song step `at`; the clip keeps the left part, the returned clip is the right part. */
function sliceClip(c, at) {
  const pat = patById(c.pat); if (!pat || at <= c.start || at >= c.start + c.len) return null;
  const right = Object.assign({}, c, { id: uid(), start: at, len: c.start + c.len - at, off: ((c.off | 0) + at - c.start) % pat.len });
  if (!right.off) delete right.off;
  c.len = at - c.start;
  P.playlist.clips.push(right);
  return right;
}
function insertTime(a, len) {
  const pl = P.playlist;
  for (const c of pl.clips.slice()) if (c.start < a && c.start + c.len > a) sliceClip(c, a);
  for (const c of pl.clips) if (c.start >= a) c.start += len;
  for (const m of pl.markers || []) if (m.t >= a) m.t += len;
  if (pl.loop && pl.loop.a >= a) { pl.loop.a += len; pl.loop.b += len; }
}
function deleteTime(a, b) {
  const pl = P.playlist, len = b - a;
  for (const c of pl.clips.slice()) { if (c.start < a && c.start + c.len > a) sliceClip(c, a); }
  for (const c of pl.clips.slice()) { if (c.start < b && c.start + c.len > b) sliceClip(c, b); }
  pl.clips = pl.clips.filter(c => !(c.start >= a && c.start < b));
  for (const c of pl.clips) if (c.start >= b) c.start -= len;
  pl.markers = (pl.markers || []).filter(m => m.t < a || m.t >= b);
  for (const m of pl.markers) if (m.t >= b) m.t -= len;
  if (pl.loop) { if (pl.loop.a >= b) { pl.loop.a -= len; pl.loop.b -= len; } else if (pl.loop.b > a) pl.loop = null; }
}
/** An audio file in the playlist: a sampler channel plus a pattern that plays it once (as FL Studio's audio clips do). */
async function audioClipFrom(id, track, start) {
  const s = await ensureSample(id);
  if (!s) { toast('That sound could not be decoded'); return; }
  const steps = clamp(Math.ceil(s.dur / stepDur() - 1e-6), 1, 1024);
  let ch;
  edit(() => {
    ch = makeChannel({ type: 'sampler', name: s.name, sample: id }); P.channels.push(ch);
    const m = P.mixer[ch.mixer]; if (ch.mixer > 0 && m && /^Insert \d+$/.test(m.name)) m.name = ch.name;
    const pat = newPattern(P.patterns.length + 1, ch.color); pat.name = s.name; pat.len = clamp(Math.ceil(steps / 16) * 16, 16, 1024);
    pat.notes[ch.id] = [{ t: 0, len: steps, key: 60, vel: 0.8, chance: 1 }];
    P.patterns.push(pat);
    if (track >= P.playlist.tracks) P.playlist.tracks = track + 1;
    P.playlist.clips.push({ id: uid(), pat: pat.id, track, start, len: Math.max(4, Math.ceil(steps / 4) * 4) });
  });
  if (A.ctx) syncAudio();
  return ch;
}
function deleteUnusedPatterns() {
  const used = new Set(P.playlist.clips.map(c => c.pat));
  for (const a of P.arrs || []) if (a.pl) for (const c of a.pl.clips) used.add(c.pat);
  const gone = P.patterns.filter(p => !used.has(p.id) && p.id !== S.pat);
  if (!gone.length) { toast('Every pattern is used in the playlist'); return; }
  edit(() => { P.patterns = P.patterns.filter(p => !gone.includes(p)); });
  toast('Deleted ' + gone.length + ' unused pattern' + (gone.length === 1 ? '' : 's'));
}

UI.pl = {
  HW: 132, RH: 28, TH: 46, sel: new Set(), dirty: true, drag: null, marq: null, prevCache: new Map(),
  init() {
    const w = this.w = WM.create(WIN_DEFS[0]);
    w.onResize = () => { this.dirty = true; };
    this.win = 'pl';
    w.onShow = () => { this.render(); this.dirty = true; };
    this.toolSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tool' },
      [['draw', 'pencil', 'Draw · click to place the current pattern, drag clips to move, drag either edge to trim'], ['select', 'select', 'Select · drag a box around clips'], ['slice', 'scissors', 'Slice · click a clip to cut it in two at the grid'], ['mute', 'power', 'Mute · click or drag over clips to mute or unmute them'], ['erase', 'erase', 'Erase · click or drag over clips to delete them']]
        .map(([k, ic, hn]) => h('button', { dataset: { k }, 'aria-label': k, 'data-hint': hn, html: icon(ic, 14), onclick: () => { S.plTool = k; this.render(); } })));
    this.snapSel = h('select', { class: 'sel-box', id: 'plSnap', 'aria-label': 'Snap', 'data-hint': 'Snap for clips' }, [['Bar', 16], ['Beat', 4], ['Step', 1], ['None', 0]].map(([l, v]) => h('option', { value: v }, l)));
    this.snapSel.onchange = () => { S.plSnap = +this.snapSel.value; scheduleSave(); };
    this.brush = h('button', { class: 'btn', 'data-hint': 'Pattern placed by the draw tool · click to change' }, h('i', { class: 'sw' }), h('span'));
    this.brush.onclick = () => patternMenu(this.brush);
    this.loopBtn = h('button', { class: 'btn', 'data-hint': 'Loop · loop the selected clips, or clear the loop. Drag on the ruler to draw a loop.', onclick: () => this.toggleLoop() }, 'Loop');
    const zo = h('button', { class: 'btn ghost', 'aria-label': 'Zoom out', 'data-hint': 'Zoom out (Ctrl+scroll)', html: icon('zout', 15), onclick: () => this.zoom(1 / 1.3) });
    const zi = h('button', { class: 'btn ghost', 'aria-label': 'Zoom in', 'data-hint': 'Zoom in (Ctrl+scroll)', html: icon('zin', 15), onclick: () => this.zoom(1.3) });
    this.info = h('span', { class: 'lbl', style: { fontFamily: 'var(--font-mono)', letterSpacing: '0' } });
    this.arrBtn = h('button', { class: 'btn', 'data-hint': 'Arrangement · keep several versions of the song (switch, new, clone, rename)', html: icon('playlist', 14) + '<span></span>' });
    this.arrBtn.onclick = () => arrangementMenu(this.arrBtn);
    const xp = h('button', { class: 'btn', 'data-hint': 'Export audio · WAV or MP3', html: icon('export', 14) + '<span>Export</span>', onclick: exportDialog });
    const tb = h('div', { class: 'tb' }, this.toolSeg, h('span', { class: 'lbl', html: icon('magnet', 13) }), this.snapSel, h('span', { class: 'div' }), this.arrBtn, this.brush, this.loopBtn, zo, zi, h('span', { style: { flex: '1' } }), this.info, xp);
    this.picker = h('div', { class: 'picker', 'aria-label': 'Pattern picker' });
    this.scroller = h('div', { class: 'scroller' });
    this.sizer = h('div', { class: 'sizer' });
    this.cv = h('canvas', { 'aria-label': 'Playlist arrangement' });
    this.sizer.append(this.cv); this.scroller.append(this.sizer);
    this.phEl = h('div', { class: 'phline', 'aria-hidden': 'true', style: { '--rh': this.RH + 'px', '--tri': '6px' } });
    w.body.append(tb, h('div', { class: 'pl-wrap' }, this.picker, h('div', { class: 'cv-main' }, this.scroller, this.phEl)));
    this.scroller.addEventListener('scroll', () => { this.dirty = true; });
    this.scroller.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = this.cv.getBoundingClientRect(); this.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left); } }, { passive: false });
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => { if (!this.drag) this.hover(e); });
    this.cv.addEventListener('dblclick', e => this.dbl(e));
    this.cv.addEventListener('contextmenu', e => e.preventDefault());
    this.scroller.addEventListener('dragover', e => { const t = [...e.dataTransfer.types]; if (t.includes('application/x-nxw') || t.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    this.scroller.addEventListener('drop', async e => {
      e.preventDefault();
      const { x, y } = this.local(e), at = Math.max(0, snapFloor(this.stepAt(Math.max(x, this.HW)), S.plSnap || 1));
      let tr = this.trackAt(Math.max(y, this.RH + 1)); if (tr < 0) tr = 0;
      // Audio files dropped here become audio clips (a sampler channel and a one-shot pattern each).
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) {
        const mids = files.filter(f => /\.midi?$/i.test(f.name)); for (const f of mids) await importMidiFile(f);
        const aud = files.filter(f => AUDIO_EXT.test(f.name)).slice(0, 12);
        if (!aud.length) { if (!mids.length) toast('Drop audio files (WAV, MP3, OGG, FLAC…) or MIDI files here'); return; }
        const ids = await runImport(aud.map(f => ({ file: f, name: f.name, pack: 'Imported', path: '' })), 'Importing audio');
        for (let i = 0; i < ids.length; i++) await audioClipFrom(ids[i], tr + i, at);
        if (ids.length) toast(ids.length === 1 ? 'Added an audio clip' : 'Added ' + ids.length + ' audio clips');
        return;
      }
      let o = null; try { o = JSON.parse(e.dataTransfer.getData('application/x-nxw') || 'null'); } catch (err) { o = null; }
      if (!o) return;
      if (o.kind === 'sample') { await audioClipFrom(o.id, tr, at); return; }
      if (o.kind !== 'pattern') { const sp = specFromBrowser(o); if (sp) addChannel(sp); return; }
      const pat = patById(o.id); if (!pat) return;
      if (x < this.HW || y < this.RH) return;
      if (this.trackAt(y) < 0) return;
      edit(() => { P.playlist.clips.push({ id: uid(), pat: pat.id, track: tr, start: Math.max(0, snapFloor(this.stepAt(x), S.plSnap)), len: pat.len }); S.pat = pat.id; });
    });
  },
  zoom(f, px) {
    const sc = this.scroller, old = S.plZoom, nz = clamp(old * f, 1.2, 28); if (nz === old) return;
    const anchor = px != null ? px : sc.clientWidth / 2, st = (anchor - this.HW + sc.scrollLeft) / old;
    S.plZoom = nz; this.draw(); sc.scrollLeft = st * nz - anchor + this.HW; this.dirty = true; scheduleSave();
  },
  toggleLoop() {
    if (P.playlist.loop) { edit(() => { P.playlist.loop = null; }); hint('Loop cleared'); return; }
    let a, b;
    if (this.sel.size) { const s = [...this.sel]; a = Math.min(...s.map(c => c.start)); b = Math.max(...s.map(c => c.start + c.len)); }
    else { a = 0; b = songEnd(); }
    edit(() => { P.playlist.loop = { a: snapFloor(a, 16), b: Math.max(snapFloor(a, 16) + 16, Math.ceil(b / 16) * 16) }; });
    hint('Looping bars ' + (P.playlist.loop.a / 16 + 1) + ' to ' + (P.playlist.loop.b / 16));
  },
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
  stepAt(x) { return (x - this.HW + this.scroller.scrollLeft) / S.plZoom; },
  trackAt(y) { const t = Math.floor((y - this.RH + this.scroller.scrollTop) / this.TH); return t >= 0 && t < P.playlist.tracks ? t : -1; },
  xOf(s) { return this.HW + s * S.plZoom - this.scroller.scrollLeft; },
  yOf(t) { return this.RH + t * this.TH - this.scroller.scrollTop; },
  hit(x, y) {
    const tr = this.trackAt(y); if (tr < 0) return null;
    const st = this.stepAt(x), cl = P.playlist.clips;
    for (let i = cl.length - 1; i >= 0; i--) {
      const c = cl[i];
      if (c.track === tr && st >= c.start && st < c.start + c.len) {
        const x0 = this.xOf(c.start), x1 = this.xOf(c.start + c.len), e = Math.min(8, c.len * S.plZoom / 3);
        return { c, edge: x > x1 - e, left: x < x0 + e && !this.onMenuIcon(c, x, y) };
      }
    }
    return null;
  },
  markerAt(x) {
    const ms = P.playlist.markers || [];
    for (let i = ms.length - 1; i >= 0; i--) { const m = ms[i], mx = this.xOf(m.t); if (x >= mx - 3 && x <= mx + Math.max(18, (m._w || 40) + 8)) return m; }
    return null;
  },
  addMarker(t) {
    const pl = P.playlist, n = (pl.markers || []).length + 1;
    edit(() => { pl.markers ||= []; pl.markers.push({ t: Math.max(0, t), name: 'Marker ' + n }); pl.markers.sort((a, b) => a.t - b.t); });
    hint('Marker added at bar ' + (Math.floor(t / 16) + 1) + ' · drag it, click to jump, right-click to rename');
  },
  rulerMenu(e, s) {
    const pl = P.playlist, bar = snapFloor(s, 16), L = pl.loop;
    openMenu(e.clientX, e.clientY, [
      { head: 'Bar ' + (bar / 16 + 1) },
      { label: 'Add marker here', icon: 'marker', key: 'Alt+T', action: () => this.addMarker(snapFloor(s, 4)) },
      { label: 'Loop this bar', action: () => edit(() => { pl.loop = { a: bar, b: bar + 16 }; }) },
      { label: 'Clear loop', disabled: !L, action: () => edit(() => { pl.loop = null; }) },
      { sep: true },
      { label: 'Insert a bar here', hint: 'Moves everything after this point one bar later', action: () => edit(() => insertTime(bar, 16)) },
      { label: 'Delete this bar', hint: 'Removes the bar and pulls everything after it earlier', action: () => edit(() => deleteTime(bar, bar + 16)) },
      L ? { label: 'Insert space the size of the loop', hint: 'At the start of the loop', action: () => edit(() => insertTime(L.a, L.b - L.a)) } : null,
      L ? { label: 'Delete the looped time', hint: 'Removes bars ' + (L.a / 16 + 1) + ' to ' + (L.b / 16) + ' and closes the gap', action: () => edit(() => deleteTime(L.a, L.b)) } : null,
    ]);
  },
  markerMenu(m, e) {
    const pl = P.playlist, ms = pl.markers, nx = ms.filter(o => o.t > m.t).sort((a, b) => a.t - b.t)[0];
    const anchor = { getBoundingClientRect: () => ({ left: e.clientX, top: e.clientY, width: 160, height: 24, right: e.clientX + 160, bottom: e.clientY + 24 }) };
    openMenu(e.clientX, e.clientY, [
      { head: m.name },
      { label: 'Jump here', action: () => setSongPos(m.t) },
      { label: 'Rename…', action: () => askText(anchor, m.name, v => edit(() => { m.name = v; })) },
      { label: nx ? 'Loop to the next marker' : 'Loop to the end of the song', action: () => edit(() => { pl.loop = { a: m.t, b: nx ? nx.t : Math.max(m.t + 16, songEnd()) }; }) },
      { label: 'Delete marker', danger: true, action: () => edit(() => { pl.markers = ms.filter(o => o !== m); }) },
    ]);
  },
  hover(e) {
    const { x, y } = this.local(e); let cur = 'default';
    if (y < this.RH && x > this.HW) cur = this.markerAt(x) ? 'grab' : 'col-resize';
    else if (x < this.HW) cur = 'pointer';
    else { const hh = this.hit(x, y); cur = hh ? (this.onMenuIcon(hh.c, x, y) ? 'pointer' : S.plTool === 'slice' ? 'col-resize' : S.plTool === 'mute' ? 'pointer' : hh.edge || hh.left ? 'ew-resize' : 'grab') : (S.plTool === 'erase' ? 'not-allowed' : S.plTool === 'select' ? 'crosshair' : S.plTool === 'draw' ? 'copy' : 'default'); }
    if (this.cv.style.cursor !== cur) this.cv.style.cursor = cur;
  },
  dbl(e) {
    const { x, y } = this.local(e);
    if (x < this.HW && y > this.RH) { const tr = this.trackAt(y); if (tr >= 0 && x > 30) this.renameTrack(tr, e.clientY); return; }
    const hh = this.hit(x, y); if (hh) { selectPattern(hh.c.pat); WM.show('rack'); }
  },
  // The small arrow at the top-left of a clip opens its menu (like FL Studio's clip menu).
  onMenuIcon(c, x, y) {
    const ix = Math.max(this.xOf(c.start), this.HW), iy = this.yOf(c.track) + 2;
    return c.len * S.plZoom > 18 && x >= ix && x < ix + 16 && y >= iy && y < iy + 14;
  },
  clipMenu(c, cx, cy) {
    const pat = patById(c.pat); if (!pat) return;
    const nUsed = P.channels.filter(ch => (pat.notes[ch.id] || []).length).length;
    const group = this.sel.has(c) ? [...this.sel].filter(o => o.pat === c.pat) : [c];
    const anchor = { getBoundingClientRect: () => ({ left: cx, top: cy, width: 180, height: 26, right: cx + 180, bottom: cy + 26 }) };
    openMenu(cx, cy, [
      { head: pat.name },
      { label: 'Split by channel', disabled: nUsed < 2, hint: nUsed < 2 ? 'This pattern only uses one channel' : 'One pattern per channel (' + nUsed + '), stacked on the tracks below' + (group.length > 1 ? ' · applies to the ' + group.length + ' selected clips' : ''), action: () => splitByChannel(c.pat, group) },
      { label: 'Make unique', hint: 'Give this clip its own copy of the pattern to edit separately', action: () => makeUniqueClip(c) },
      { label: c.mute ? 'Unmute clip' : 'Mute clip', key: 'Ctrl+M', action: () => edit(() => { for (const o of this.sel.has(c) ? [...this.sel] : [c]) { if (c.mute) delete o.mute; else o.mute = true; } }) },
      { label: 'Slice at the playhead', disabled: !(A.pos > c.start && A.pos < c.start + c.len), action: () => edit(() => { sliceClip(c, Math.round(A.pos)); }) },
      { label: 'Restart from the pattern start', disabled: !c.off, hint: 'Clears the offset left by trimming or slicing', action: () => edit(() => { delete c.off; }) },
      { sep: true },
      { label: 'Open in channel rack', key: 'F6', action: () => { selectPattern(c.pat); WM.show('rack'); } },
      { label: 'Open in piano roll', key: 'F7', action: () => { selectPattern(c.pat); WM.show('pr'); } },
      { label: 'Rename pattern…', action: () => askText(anchor, pat.name, v => edit(() => { pat.name = v; })) },
      { label: 'Select all clips of this pattern', action: () => { this.sel = new Set(P.playlist.clips.filter(o => o.pat === c.pat)); this.dirty = true; } },
      { label: 'Copy', key: 'Ctrl+C', action: () => { if (!this.sel.has(c)) this.sel = new Set([c]); this.copy(false); } },
      { label: 'Export pattern as MIDI file', action: () => exportPatternMidi(pat) },
      { sep: true },
      { label: 'Delete clip', danger: true, action: () => edit(() => { P.playlist.clips = P.playlist.clips.filter(o => o !== c); this.sel.delete(c); }) },
    ]);
  },
  renameTrack(tr, cy) {
    const r = this.cv.getBoundingClientRect(), fake = { getBoundingClientRect: () => ({ left: r.left + 28, top: r.top + this.yOf(tr) + 6, width: this.HW - 34, height: 28 }) };
    askText(fake, trackName(tr), v => edit(() => { P.playlist.names[tr] = v; }));
  },
  headerMenu(tr, e) {
    const pl = P.playlist;
    openMenu(e.clientX, e.clientY, [
      { head: trackName(tr) },
      { label: 'Rename…', action: () => this.renameTrack(tr) },
      { label: pl.mute[tr] ? 'Unmute' : 'Mute', action: () => edit(() => { pl.mute[tr] = !pl.mute[tr]; }) },
      { label: 'Solo track', action: () => edit(() => { const solo = !pl.mute[tr] && [...Array(pl.tracks).keys()].every(i => i === tr || pl.mute[i]); for (let i = 0; i < pl.tracks; i++) pl.mute[i] = solo ? false : i !== tr; }) },
      { label: 'Select all clips on track', action: () => { this.sel = new Set(pl.clips.filter(c => c.track === tr)); this.dirty = true; } },
      { label: 'Clear track', danger: true, action: () => edit(() => { pl.clips = pl.clips.filter(c => c.track !== tr); this.sel.clear(); }) },
    ]);
  },
  down(e) {
    const { x, y } = this.local(e);
    const pl = P.playlist;
    e.preventDefault();
    this.cv.setPointerCapture(e.pointerId);
    const finish = () => { this.cv.onpointermove = null; this.cv.onpointerup = null; this.cv.onpointercancel = null; };
    if (y < this.RH) {
      if (x < this.HW) return;
      const mk = this.markerAt(x);
      if (e.button === 2) { finish(); if (mk) this.markerMenu(mk, e); else this.rulerMenu(e, Math.max(0, this.stepAt(x))); return; }
      if (mk) {
        Hist.push(); const t0 = mk.t, s1 = this.stepAt(x); let moved = false;
        this.drag = { mode: 'marker' };
        this.cv.onpointermove = ev => { const p = this.local(ev); if (!moved && Math.abs(p.x - x) < 4) return; moved = true; mk.t = Math.max(0, snapRound(t0 + this.stepAt(p.x) - s1, ev.altKey ? 1 : 4)); this.dirty = true; hint(mk.name + ' · bar ' + (Math.floor(mk.t / 16) + 1)); };
        this.cv.onpointerup = this.cv.onpointercancel = () => { this.drag = null; finish(); if (moved) { pl.markers.sort((a, b) => a.t - b.t); touched(); } else { Hist.u.pop(); setSongPos(mk.t); if (S.mode !== 'song') setMode('song'); } this.dirty = true; };
        return;
      }
      const s0 = Math.max(0, this.stepAt(x)); let looping = false;
      this.drag = { mode: 'ruler' };
      this.cv.onpointermove = ev => {
        const p = this.local(ev);
        if (!looping && Math.abs(p.x - x) > 5) { looping = true; Hist.push(); }
        if (looping) { const s1 = Math.max(0, this.stepAt(p.x)), sn = ev.shiftKey ? 4 : 16; const a = snapFloor(Math.min(s0, s1), sn), b = Math.max(a + sn, Math.ceil(Math.max(s0, s1) / sn) * sn); pl.loop = { a, b }; this.dirty = true; hint('Loop · bars ' + (a / 16 + 1) + ' to ' + (b / 16)); }
      };
      this.cv.onpointerup = this.cv.onpointercancel = () => { this.drag = null; finish(); if (looping) touched(); else { setSongPos(snapFloor(s0, 4)); if (S.mode !== 'song') setMode('song'); } this.dirty = true; };
      return;
    }
    if (x < this.HW) {
      const tr = this.trackAt(y); if (tr < 0) return;
      if (e.button === 2) { this.headerMenu(tr, e); return; }
      if (x < 30) edit(() => { pl.mute[tr] = !pl.mute[tr]; });
      return;
    }
    let tool = S.plTool;
    if (e.button === 2) tool = 'erase'; else if (e.ctrlKey || e.metaKey) tool = 'select';
    const h0 = this.hit(x, y);
    if (h0 && e.button === 0 && !e.shiftKey && !(e.ctrlKey || e.metaKey) && this.onMenuIcon(h0.c, x, y)) { finish(); this.clipMenu(h0.c, e.clientX, e.clientY); return; }
    if (tool === 'slice' && e.button === 0 && !(e.ctrlKey || e.metaKey)) {
      finish();
      if (!h0) return;
      const at = Math.round(e.altKey ? this.stepAt(x) : snapRound(this.stepAt(x), S.plSnap || 1));
      if (at <= h0.c.start || at >= h0.c.start + h0.c.len) { hint('Slice inside the clip, away from its edges'); return; }
      edit(() => { const r = sliceClip(h0.c, at); this.sel = new Set([h0.c, r].filter(Boolean)); });
      hint('Sliced at bar ' + (Math.floor(at / 16) + 1) + ', step ' + (at % 16 + 1));
      return;
    }
    if (tool === 'mute' && e.button === 0 && !(e.ctrlKey || e.metaKey)) {
      if (!h0) { finish(); return; }
      Hist.push();
      const to = !h0.c.mute, seen = new Set();
      const mu = (xx, yy) => { const hh = this.hit(xx, yy); if (hh && !seen.has(hh.c)) { seen.add(hh.c); if (to) hh.c.mute = true; else delete hh.c.mute; VER++; this.dirty = true; } };
      mu(x, y); this.drag = { mode: 'mute' };
      this.cv.onpointermove = ev => { const p = this.local(ev); mu(p.x, p.y); };
      this.cv.onpointerup = this.cv.onpointercancel = () => { this.drag = null; finish(); refresh(); };
      return;
    }
    if (tool === 'erase') {
      Hist.push();
      const er = (xx, yy) => { const hh = this.hit(xx, yy); if (hh) { pl.clips.splice(pl.clips.indexOf(hh.c), 1); this.sel.delete(hh.c); VER++; this.dirty = true; } };
      er(x, y); this.drag = { mode: 'erase' };
      this.cv.onpointermove = ev => { const p = this.local(ev); er(p.x, p.y); };
      this.cv.onpointerup = this.cv.onpointercancel = () => { this.drag = null; finish(); refresh(); };
      return;
    }
    if (h0 && (e.ctrlKey || e.metaKey)) { if (this.sel.has(h0.c)) this.sel.delete(h0.c); else this.sel.add(h0.c); this.dirty = true; finish(); return; }
    if (h0) {
      Hist.push();
      let anchor = h0.c;
      if (!this.sel.has(anchor)) { if (!e.shiftKey) this.sel.clear(); this.sel.add(anchor); }
      if (e.shiftKey && !h0.edge) {
        const arr = [...this.sel], ai = arr.indexOf(anchor), copies = arr.map(c => Object.assign({}, c, { id: uid() }));
        pl.clips.push(...copies); this.sel = new Set(copies); anchor = copies[ai];
      }
      if (anchor.pat !== S.pat) { S.pat = anchor.pat; renderAll(); }
      this.startDrag(h0.edge ? 'resize' : h0.left && !e.shiftKey ? 'resizeL' : 'move', anchor, x, y);
      return;
    }
    if (tool === 'select') {
      const base = e.shiftKey ? new Set(this.sel) : new Set(), t0 = this.stepAt(x), r0 = (y - this.RH + this.scroller.scrollTop) / this.TH;
      this.marq = { t0, t1: t0, r0, r1: r0 }; this.drag = { mode: 'marq' };
      this.cv.onpointermove = ev => {
        const p = this.local(ev); this.marq.t1 = this.stepAt(p.x); this.marq.r1 = (p.y - this.RH + this.scroller.scrollTop) / this.TH;
        const ta = Math.min(this.marq.t0, this.marq.t1), tb = Math.max(this.marq.t0, this.marq.t1), ra = Math.min(this.marq.r0, this.marq.r1), rb = Math.max(this.marq.r0, this.marq.r1);
        this.sel = new Set(base); for (const c of pl.clips) if (c.start < tb && c.start + c.len > ta && c.track + 1 > ra && c.track < rb) this.sel.add(c);
        this.dirty = true;
      };
      this.cv.onpointerup = this.cv.onpointercancel = () => { this.marq = null; this.drag = null; this.dirty = true; finish(); if (this.sel.size) hint(this.sel.size + ' clips selected · Delete removes, Ctrl+D duplicates, Loop loops them'); };
      return;
    }
    const tr = this.trackAt(y); if (tr < 0) { finish(); return; }
    const pat = curPat();
    Hist.push();
    const c = { id: uid(), pat: pat.id, track: tr, start: Math.max(0, snapFloor(this.stepAt(x), S.plSnap)), len: pat.len };
    pl.clips.push(c); this.sel = new Set([c]); VER++;
    this.startDrag('move', c, x, y);
  },
  startDrag(mode, anchor, x, y) {
    const orig = new Map([...this.sel].map(c => [c, { start: c.start, track: c.track, len: c.len, off: c.off | 0 }]));
    const a = orig.get(anchor), st0 = this.stepAt(x), vals = [...orig.values()];
    const minS = Math.min(...vals.map(o => o.start)), minT = Math.min(...vals.map(o => o.track)), maxT = Math.max(...vals.map(o => o.track));
    let moved = false;
    this.drag = { mode };
    this.cv.onpointermove = ev => {
      const p = this.local(ev);
      if (!moved && Math.hypot(p.x - x, p.y - y) < 3) return;
      moved = true;
      const ds = this.stepAt(p.x) - st0, sn = ev.altKey ? 1 : S.plSnap;
      if (mode === 'move') {
        let dt = snapRound(a.start + ds, sn) - a.start; dt = Math.round(Math.max(dt, -minS));
        const dr = clamp(Math.round((p.y - y) / this.TH), -minT, P.playlist.tracks - 1 - maxT);
        for (const [c, o] of orig) { c.start = o.start + dt; c.track = o.track + dr; }
        hint('Bar ' + (Math.floor(anchor.start / 16) + 1) + (anchor.start % 16 ? ', step ' + (anchor.start % 16 + 1) : '') + ' · ' + trackName(anchor.track));
      } else if (mode === 'resizeL') {
        // Trim from the left: the clip keeps playing the same music where it still covers it.
        const minL = Math.max(1, sn || 1);
        let dt = Math.round(snapRound(a.start + ds, sn) - a.start);
        dt = Math.min(dt, Math.min(...vals.map(o => o.len - minL))); dt = Math.max(dt, -minS);
        for (const [c, o] of orig) {
          const pat = patById(c.pat), pl = pat ? pat.len : 16;
          c.start = o.start + dt; c.len = o.len - dt;
          const off = (((o.off + dt) % pl) + pl) % pl; if (off) c.off = off; else delete c.off;
        }
        hint('Starts at bar ' + (Math.floor(anchor.start / 16) + 1) + (anchor.start % 16 ? ', step ' + (anchor.start % 16 + 1) : '') + ' · ' + (anchor.len / 16) + ' bars');
      } else {
        const minL = Math.max(1, sn || 1), nl = Math.max(minL, Math.round(snapRound(a.start + a.len + ds, sn) - a.start)), dl = nl - a.len;
        for (const [c, o] of orig) c.len = Math.max(minL, o.len + dl);
        hint('Length ' + (anchor.len / 16) + ' bars');
      }
      VER++; this.dirty = true;
    };
    this.cv.onpointerup = this.cv.onpointercancel = () => { this.drag = null; this.cv.onpointermove = null; this.cv.onpointerup = null; this.cv.onpointercancel = null; refresh(); };
  },
  copy(cut) {
    if (!this.sel.size) return;
    const s = [...this.sel], a = Math.min(...s.map(c => c.start));
    PL_CLIP = s.map(c => Object.assign({}, c, { start: c.start - a }));
    if (cut) edit(() => { P.playlist.clips = P.playlist.clips.filter(c => !this.sel.has(c)); this.sel.clear(); });
    hint((cut ? 'Cut ' : 'Copied ') + s.length + ' clips · click the ruler where they should go, then Ctrl+V');
  },
  paste() {
    if (!PL_CLIP) return;
    const pl = P.playlist, at = Math.max(0, snapFloor(A.vis && A.vis.mode === 'song' ? A.vis.s : A.pos, S.plSnap || 1));
    let made;
    edit(() => { made = PL_CLIP.filter(c => patById(c.pat)).map(c => Object.assign({}, c, { id: uid(), start: c.start + at })); pl.clips.push(...made); });
    this.sel = new Set(made);
    const end = Math.max(...made.map(c => c.start + c.len)); setSongPos(end);
    hint('Pasted ' + made.length + ' clips · Ctrl+V again pastes after them');
  },
  key(e) {
    const mod = e.ctrlKey || e.metaKey, pl = P.playlist;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.size) { e.preventDefault(); edit(() => { pl.clips = pl.clips.filter(c => !this.sel.has(c)); this.sel.clear(); }); return true; }
    if (mod && e.code === 'KeyA') { e.preventDefault(); this.sel = new Set(pl.clips); this.dirty = true; return true; }
    if (e.key === 'Escape' && this.sel.size) { this.sel.clear(); this.dirty = true; return true; }
    if (mod && !e.shiftKey && (e.code === 'KeyC' || e.code === 'KeyX') && this.sel.size) { e.preventDefault(); this.copy(e.code === 'KeyX'); return true; }
    if (mod && !e.shiftKey && e.code === 'KeyV' && PL_CLIP) { e.preventDefault(); this.paste(); return true; }
    if (mod && e.code === 'KeyM' && this.sel.size) { e.preventDefault(); const s = [...this.sel], to = !s.every(c => c.mute); edit(() => { for (const c of s) { if (to) c.mute = true; else delete c.mute; } }); return true; }
    if (e.altKey && !mod && e.code === 'KeyT') { e.preventDefault(); this.addMarker(snapFloor(A.vis && A.vis.mode === 'song' ? A.vis.s : A.pos, 4)); return true; }
    if (mod && (e.code === 'KeyD' || e.code === 'KeyB') && this.sel.size) {
      e.preventDefault();
      const s = [...this.sel], a = Math.min(...s.map(c => c.start)), b = Math.max(...s.map(c => c.start + c.len)), off = Math.ceil((b - a) / 16) * 16;
      edit(() => { const cp = s.map(c => Object.assign({}, c, { id: uid(), start: c.start + off })); pl.clips.push(...cp); this.sel = new Set(cp); });
      return true;
    }
    return false;
  },
  preview(pat) {
    let c = this.prevCache.get(pat.id);
    if (c && c.ver === VER) return c;
    const lanes = [];
    for (const ch of P.channels) {
      const ns = pat.notes[ch.id]; if (!ns || !ns.length) continue;
      let lo = 127, hi = 0; for (const n of ns) { lo = Math.min(lo, n.key); hi = Math.max(hi, n.key); }
      lanes.push({ ns, lo, hi });
    }
    c = { ver: VER, lanes }; this.prevCache.set(pat.id, c); return c;
  },
  render() {
    for (const c of [...this.sel]) if (!P.playlist.clips.includes(c)) this.sel.delete(c);
    this.dirty = true;
    const an = curArr().name;
    if (!sigChanged(this, [S.plTool, S.plSnap, S.pat, !!P.playlist.loop, P.patterns.map(q => [q.id, q.name, q.color]), an])) return;
    this.arrBtn.querySelector('span').textContent = an;
    for (const b of this.toolSeg.children) b.classList.toggle('on', b.dataset.k === S.plTool);
    this.snapSel.value = String(S.plSnap);
    const p = curPat();
    this.brush.querySelector('.sw').style.background = p.color; this.brush.querySelector('span').textContent = p.name;
    this.loopBtn.classList.toggle('on', !!P.playlist.loop);
    this.picker.textContent = '';
    this.picker.append(h('div', { class: 'lbl' }, 'Patterns'));
    for (const q of P.patterns) {
      const b = h('button', { class: 'pk' + (q.id === S.pat ? ' on' : ''), draggable: 'true', style: { '--pc': q.color }, 'data-hint': q.name + ' · click to use it, drag into the playlist, double-click to rename' }, h('i', { class: 'sw', style: { background: q.color } }), h('span', { class: 'nm' }, q.name));
      b.onclick = () => selectPattern(q.id);
      b.ondblclick = () => askText(b, q.name, v => edit(() => { q.name = v; }));
      b.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-nxw', JSON.stringify({ kind: 'pattern', id: q.id })); e.dataTransfer.setData('text/plain', q.name); });
      this.picker.append(b);
    }
    this.picker.append(h('button', { class: 'pk new', onclick: newPatternAction, 'data-hint': 'Create an empty pattern' }, '+ New'));
  },
  frame() {
    if (!WM.shown('pl')) return;
    const v = A.vis;
    if (v && v.mode === 'song' && !this.drag) {
      const sc = this.scroller, x = this.HW + v.s * S.plZoom - sc.scrollLeft, W = sc.clientWidth;
      if (x > W - 40 || x < this.HW) sc.scrollLeft = Math.max(0, v.s * S.plZoom - 24);
    }
    if (this.dirty || this.drag) this.draw();
    this.placePh();
  },
  // The playhead is a GPU-moved overlay, so playback never repaints the arrangement canvas.
  placePh() {
    const v = A.vis, ph = v && v.mode === 'song' ? v.s : (S.mode === 'song' || !A.playing ? A.pos : null);
    const sc = this.scroller, W = sc.clientWidth, H = sc.clientHeight;
    const x = ph == null ? -9 : this.HW + ph * S.plZoom - sc.scrollLeft;
    const vis = ph != null && x >= this.HW - 1 && x <= W;
    const key = vis ? Math.round(x * 4) + '|' + H + '|' + (A.playing ? 1 : 0) : 'off';
    if (key === this._phKey) return;
    this._phKey = key;
    const e = this.phEl;
    if (!vis) { e.style.display = 'none'; return; }
    e.style.display = 'block'; e.style.height = H + 'px';
    e.style.transform = 'translate3d(' + (x - 1).toFixed(2) + 'px,0,0)';
    e.classList.toggle('dim', !A.playing);
  },
  draw() {
    this.dirty = false;
    const sc = this.scroller, W = sc.clientWidth, H = sc.clientHeight; if (!W || !H) return;
    const pl = P.playlist, zx = S.plZoom, HW = this.HW, RH = this.RH, TH = this.TH, nT = pl.tracks;
    const end = songEnd(), total = Math.max(end + 32 * 16, Math.ceil((W - HW) / zx / 16) * 16 + 16);
    const cw = Math.max(W, HW + total * zx), chh = Math.max(H, RH + nT * TH + 24);
    if (this.sizer._w !== cw) { this.sizer.style.width = cw + 'px'; this.sizer._w = cw; }
    if (this.sizer._h !== chh) { this.sizer.style.height = chh + 'px'; this.sizer._h = chh; }
    const ctx = fitCanvas(this.cv, W, H), sx = sc.scrollLeft, sy = sc.scrollTop;
    const info = 'SONG ' + (end / 16) + ' BARS · ' + Math.floor(end * stepDur() / 60) + ':' + String(Math.round(end * stepDur() % 60)).padStart(2, '0');
    if (this.info.textContent !== info) this.info.textContent = info;
    ctx.fillStyle = CSSV['ink-0']; ctx.fillRect(0, 0, W, H);
    const t0 = Math.max(0, Math.floor(sy / TH)), t1 = Math.min(nT - 1, Math.floor((sy + H - RH) / TH));
    for (let t = t0; t <= t1; t++) {
      const y = RH + t * TH - sy;
      ctx.fillStyle = pl.mute[t] ? '#0f1215' : (t % 2 ? '#191e23' : '#1c2126'); ctx.fillRect(HW, y, W - HW, TH);
      ctx.fillStyle = '#111518'; ctx.fillRect(HW, y + TH - 1, W - HW, 1);
    }
    const s0 = Math.max(0, Math.floor(sx / zx)), s1 = Math.ceil((sx + W - HW) / zx);
    const showBeats = zx * 4 >= 9, showSteps = zx >= 9;
    for (let s = s0; s <= s1; s++) {
      if (s % 16 === 0) ctx.fillStyle = '#323b45'; else if (s % 4 === 0 && showBeats) ctx.fillStyle = '#242b32'; else if (showSteps) ctx.fillStyle = '#1f252b'; else continue;
      ctx.fillRect(HW + s * zx - sx, RH, 1, H - RH);
    }
    const yMax = RH + nT * TH - sy; if (yMax < H) { ctx.fillStyle = CSSV['ink-0']; ctx.fillRect(HW, yMax, W - HW, H - yMax); }
    if (pl.loop) { const xa = HW + pl.loop.a * zx - sx, xb = HW + pl.loop.b * zx - sx; ctx.fillStyle = hexA(CSSV.copper, 0.05); ctx.fillRect(xa, RH, xb - xa, Math.min(H, yMax) - RH); ctx.fillStyle = hexA(CSSV.copper, 0.45); ctx.fillRect(xa, RH, 1, Math.min(H, yMax) - RH); ctx.fillRect(xb, RH, 1, Math.min(H, yMax) - RH); }
    // clips
    ctx.save(); ctx.beginPath(); ctx.rect(HW, RH, W - HW, H - RH); ctx.clip();
    ctx.textBaseline = 'middle'; ctx.font = '700 9.5px ' + FONT_UI;
    for (const c of pl.clips) {
      const pat = patById(c.pat); if (!pat) continue;
      const x = HW + c.start * zx - sx, w = c.len * zx, y = RH + c.track * TH - sy + 2, hh = TH - 4;
      if (x > W || x + w < HW || y > H || y + hh < RH) continue;
      const muted = pl.mute[c.track] || c.mute, sel = this.sel.has(c), col = pat.color;
      ctx.globalAlpha = muted ? 0.35 : 1;
      rrect(ctx, x + 0.5, y, w - 1, hh, 4); ctx.fillStyle = hexA(col, 0.2); ctx.fill();
      ctx.save(); rrect(ctx, x + 0.5, y, w - 1, hh, 4); ctx.clip();
      ctx.fillStyle = hexA(col, 0.92); ctx.fillRect(x, y, w, 14);
      ctx.fillStyle = 'rgba(10,12,14,0.85)';
      if (w > 18) { const ix = Math.max(x, HW) + 4; ctx.beginPath(); ctx.moveTo(ix, y + 5); ctx.lineTo(ix + 7, y + 5); ctx.lineTo(ix + 3.5, y + 9.5); ctx.closePath(); ctx.fill(); }
      ctx.fillText((c.mute ? '(muted) ' : '') + pat.name, Math.max(x, HW) + (w > 18 ? 15 : 5), y + 7.5);
      const pv = this.preview(pat), bodyY = y + 17, bodyH = hh - 20, nl = pv.lanes.length;
      if (nl && pat.len) {
        const laneH = bodyH / nl, off = (c.off | 0) % pat.len;
        ctx.fillStyle = hexA(col, 0.95);
        for (let rep = 0; rep * pat.len - off < c.len; rep++) {
          const base = rep * pat.len - off, ox = x + base * zx; if (ox > W) break;
          if (base > 0) { ctx.fillStyle = hexA(col, 0.35); ctx.fillRect(ox, y + 14, 1, hh - 14); ctx.fillStyle = hexA(col, 0.95); }
          if (ox + pat.len * zx < HW) continue;
          pv.lanes.forEach((ln, li) => {
            const ly = bodyY + li * laneH, span = ln.hi - ln.lo;
            for (const n of ln.ns) {
              const s = base + n.t; if (n.t >= pat.len || s < 0 || s >= c.len || n.mute) continue;
              const nx = x + s * zx, nw = Math.max(1, Math.min(n.len, c.len - s) * zx - 0.5);
              const ny = span === 0 ? ly + laneH / 2 - 1 : ly + (ln.hi - n.key) / span * Math.max(1, laneH - 2);
              ctx.fillRect(nx, ny, nw, Math.max(1.5, Math.min(2.5, laneH * 0.6)));
            }
          });
        }
      }
      ctx.restore();
      rrect(ctx, x + 0.5, y, w - 1, hh, 4); ctx.lineWidth = sel ? 2 : 1; ctx.strokeStyle = sel ? CSSV.copper : hexA(col, 0.75); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (this.marq) {
      const m = this.marq, xa = HW + Math.min(m.t0, m.t1) * zx - sx, xb = HW + Math.max(m.t0, m.t1) * zx - sx, ya = RH + Math.min(m.r0, m.r1) * TH - sy, yb = RH + Math.max(m.r0, m.r1) * TH - sy;
      ctx.fillStyle = hexA(CSSV.copper, 0.1); ctx.fillRect(xa, ya, xb - xa, yb - ya); ctx.strokeStyle = CSSV.copper; ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeRect(xa + 0.5, ya + 0.5, xb - xa, yb - ya); ctx.setLineDash([]);
    }
    ctx.restore();
    // ruler
    ctx.fillStyle = CSSV['ink-1']; ctx.fillRect(0, 0, W, RH); ctx.fillStyle = CSSV['rule-hi']; ctx.fillRect(0, RH - 1, W, 1);
    if (pl.loop) { const xa = HW + pl.loop.a * zx - sx, xb = HW + pl.loop.b * zx - sx; ctx.fillStyle = hexA(CSSV.copper, 0.85); ctx.fillRect(Math.max(HW, xa), 0, Math.max(0, xb - Math.max(HW, xa)), 5); }
    let every = 1; while (16 * zx * every < 30) every *= 2;
    ctx.font = '500 9.5px ' + FONT_MONO;
    for (let b = Math.floor(s0 / 16); b * 16 <= s1; b++) {
      const x = HW + b * 16 * zx - sx; if (x < HW - 1) continue;
      if (b % every === 0) { ctx.fillStyle = '#4a5560'; ctx.fillRect(x, 9, 1, RH - 9); ctx.fillStyle = CSSV.text; ctx.fillText(String(b + 1), x + 4, RH / 2 + 2); }
      else { ctx.fillStyle = '#323b45'; ctx.fillRect(x, RH - 6, 1, 5); }
    }
    const xe = HW + end * zx - sx; if (xe > HW && xe < W) { ctx.fillStyle = CSSV['text-faint']; ctx.fillRect(xe, 6, 1, RH - 6); }
    // markers
    ctx.font = '700 9px ' + FONT_UI;
    for (const m of pl.markers || []) {
      const mx = HW + m.t * zx - sx; m._w = ctx.measureText(m.name).width;
      if (mx < HW - m._w - 20 || mx > W) continue;
      ctx.fillStyle = CSSV.amber; ctx.fillRect(mx, 0, 1.5, RH);
      ctx.fillStyle = hexA(CSSV.amber, 0.9); ctx.beginPath(); ctx.moveTo(mx, 1); ctx.lineTo(mx + m._w + 10, 1); ctx.lineTo(mx + m._w + 10, 12); ctx.lineTo(mx, 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#14181c'; ctx.fillText(m.name, mx + 5, 7);
    }
    // track headers
    ctx.fillStyle = CSSV['ink-1']; ctx.fillRect(0, RH, HW, H - RH);
    ctx.save(); ctx.beginPath(); ctx.rect(0, RH, HW, H - RH); ctx.clip();
    for (let t = t0; t <= t1; t++) {
      const y = RH + t * TH - sy, muted = pl.mute[t];
      ctx.fillStyle = '#20262c'; ctx.fillRect(0, y + TH - 1, HW, 1);
      ctx.beginPath(); ctx.arc(16, y + TH / 2, 5, 0, 7); ctx.fillStyle = muted ? CSSV['ink-5'] : CSSV.verdigris; ctx.fill();
      if (!muted) { ctx.beginPath(); ctx.arc(16, y + TH / 2, 8, 0, 7); ctx.strokeStyle = hexA(CSSV.verdigris, 0.25); ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = muted ? CSSV['text-faint'] : CSSV.text; ctx.font = '600 11px ' + FONT_UI;
      let nm = trackName(t); while (nm.length > 3 && ctx.measureText(nm).width > HW - 44) nm = nm.slice(0, -2) + '…';
      ctx.fillText(nm, 30, y + TH / 2 - 5);
      ctx.fillStyle = CSSV['text-faint']; ctx.font = '500 8.5px ' + FONT_MONO; ctx.fillText(String(t + 1).padStart(2, '0'), 30, y + TH / 2 + 9);
    }
    ctx.restore();
    ctx.fillStyle = CSSV['rule-hi']; ctx.fillRect(HW - 1, RH, 1, H - RH);
    ctx.fillStyle = CSSV['ink-1']; ctx.fillRect(0, 0, HW, RH);
    ctx.fillStyle = S.mode === 'song' ? CSSV.verdigris : CSSV.copper; ctx.font = '700 9px ' + FONT_UI; ctx.fillText(S.mode === 'song' ? 'SONG MODE' : 'PATTERN MODE', 12, RH / 2);
  },
};

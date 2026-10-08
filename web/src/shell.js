/* ================================================================
   NXW STUDIO · shell: windows, transport strip, browser, menus
   ================================================================ */
const WIN_DEFS = [
  { id: 'pl', title: 'Playlist', icon: 'playlist', key: 'F5', short: 'Playlist' },
  { id: 'rack', title: 'Channel rack', icon: 'rack', key: 'F6', short: 'Rack' },
  { id: 'pr', title: 'Piano roll', icon: 'roll', key: 'F7', short: 'Piano' },
  { id: 'inst', title: 'Instrument', icon: 'synth', key: 'F8', short: 'Synth' },
  { id: 'mixer', title: 'Mixer', icon: 'mixer', key: 'F9', short: 'Mixer' },
];
const COMPACT_MQ = matchMedia('(max-width: 860px)');

const WM = {
  wins: {}, z: 20, front: null,
  get compact() { return COMPACT_MQ.matches; },
  ws() { return $('#ws'); },
  create(def) {
    const el = h('div', { class: 'win', id: 'win-' + def.id, role: 'region', 'aria-label': def.title, hidden: true });
    const head = h('div', { class: 'win-head' },
      h('span', { class: 'win-ico', html: icon(def.icon, 15) }),
      h('span', { class: 'win-title' }, def.title),
      h('span', { class: 'win-sub' }),
      h('div', { class: 'win-tools' }),
      h('button', { class: 'win-btn maxbtn', 'data-hint': 'Maximise or restore (double-click the title bar)', 'aria-label': 'Maximise', html: icon('max', 12), onclick: () => this.max(def.id) }),
      h('button', { class: 'win-btn closebtn', 'data-hint': 'Close window (' + def.key + ' toggles it)', 'aria-label': 'Close', html: icon('x', 12), onclick: () => this.hide(def.id) }));
    const body = h('div', { class: 'win-body' }), grip = h('div', { class: 'win-grip', 'data-hint': 'Resize window' });
    el.append(head, body, grip);
    this.ws().append(el);
    const w = { id: def.id, def, el, head, body, sub: head.querySelector('.win-sub'), tools: head.querySelector('.win-tools'), x: 20, y: 20, w: 640, h: 400, vis: false, maxed: false, onResize: null, onShow: null };
    this.wins[def.id] = w;
    head.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button, input, select, .win-tools')) return;
      this.focus(def.id);
      if (this.compact || w.maxed) return;
      e.preventDefault(); head.setPointerCapture(e.pointerId);
      const ox = e.clientX - w.x, oy = e.clientY - w.y, r = this.ws().getBoundingClientRect();
      el.classList.add('moving');
      let raf = 0;
      const mv = ev => { w.x = clamp(ev.clientX - ox, -w.w + 90, r.width - 90); w.y = clamp(ev.clientY - oy, 0, r.height - 34); if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.move(w); }); };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); cancelAnimationFrame(raf); raf = 0; this.move(w); el.classList.remove('moving'); this.save(); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
    head.addEventListener('dblclick', e => { if (!e.target.closest('button, input, select, .win-tools')) this.max(def.id); });
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation(); grip.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, w0 = w.w, h0 = w.h;
      let raf = 0;
      const mv = ev => { w.w = Math.max(300, w0 + ev.clientX - sx); w.h = Math.max(170, h0 + ev.clientY - sy); if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.place(w); }); };
      const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); cancelAnimationFrame(raf); raf = 0; this.place(w); this.save(); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    el.addEventListener('pointerdown', () => { if (this.front !== def.id) this.focus(def.id); }, true);
    new ResizeObserver(() => { if (w.onResize) w.onResize(); }).observe(body);
    return w;
  },
  // Windows move with a GPU transform, so dragging never triggers layout of the workspace.
  place(w) {
    const st = w.el.style;
    w.el.classList.toggle('maxed', w.maxed);
    if (w.maxed) { st.transform = 'none'; st.width = '100%'; st.height = '100%'; }
    else { st.transform = 'translate3d(' + Math.round(w.x) + 'px,' + Math.round(w.y) + 'px,0)'; st.width = w.w + 'px'; st.height = w.h + 'px'; }
  },
  move(w) { w.el.style.transform = 'translate3d(' + Math.round(w.x) + 'px,' + Math.round(w.y) + 'px,0)'; },
  defaults() {
    const r = this.ws().getBoundingClientRect(), W = Math.max(600, r.width), H = Math.max(400, r.height);
    return {
      pl: { x: 18, y: 18, w: W - 36, h: H - 36, vis: true, maxed: true },
      rack: { x: Math.round(Math.max(14, W * 0.04)), y: 26, w: Math.min(W - 28, 900), h: Math.min(H - 52, 142 + Math.max(4, P.channels.length) * 34), vis: true, maxed: false },
      pr: { x: 36, y: 44, w: W - 72, h: H - 80, vis: false, maxed: false },
      inst: { x: Math.max(14, W - 420), y: 24, w: Math.min(396, W - 28), h: Math.min(H - 44, 600), vis: false, maxed: false },
      mixer: { x: 22, y: Math.round(H * 0.3), w: W - 44, h: Math.min(460, Math.round(H * 0.68)), vis: false, maxed: false },
    };
  },
  init(reset) {
    const d = this.defaults(), saved = !reset && S.wins;
    for (const id in this.wins) {
      const w = this.wins[id], s = (saved && saved[id]) || d[id];
      Object.assign(w, { x: s.x, y: s.y, w: s.w, h: s.h, vis: !!s.vis, maxed: !!s.maxed });
      this.place(w); w.el.hidden = !w.vis;
    }
    this.clampAll();
    const order = (saved && S.winOrder) || ['pl', 'mixer', 'pr', 'inst', 'rack'];
    for (const id of order) if (this.wins[id] && this.wins[id].vis) this.focus(id, true);
    if (!this.front || !this.wins[this.front].vis) this.focus(this.compact ? 'pl' : 'rack', true);
    this.sync();
  },
  clampAll() {
    const r = this.ws().getBoundingClientRect();
    if (r.width < 50) return;
    for (const id in this.wins) {
      const w = this.wins[id];
      w.w = Math.min(w.w, Math.max(300, r.width)); w.h = Math.min(w.h, Math.max(170, r.height));
      w.x = clamp(w.x, -w.w + 90, Math.max(0, r.width - 90)); w.y = clamp(w.y, 0, Math.max(0, r.height - 34));
      this.place(w);
    }
  },
  save() {
    S.wins = {};
    for (const id in this.wins) { const w = this.wins[id]; S.wins[id] = { x: w.x, y: w.y, w: w.w, h: w.h, vis: w.vis, maxed: w.maxed }; }
    S.winOrder = Object.values(this.wins).sort((a, b) => (+a.el.style.zIndex || 0) - (+b.el.style.zIndex || 0)).map(w => w.id);
    scheduleSave();
  },
  shown(id) { const w = this.wins[id]; if (!w) return false; return this.compact ? this.front === id : w.vis; },
  show(id) {
    const w = this.wins[id]; if (!w) return;
    const was = w.vis;
    w.vis = true; w.el.hidden = false; this.focus(id, false, true);
    renderIfStale(UI[id]);
    if (w.onShow && (!was || this.compact)) w.onShow();
    this.save(); this.sync();
  },
  hide(id) {
    const w = this.wins[id]; if (!w) return;
    w.vis = false; w.el.hidden = true;
    if (this.front === id) { const top = Object.values(this.wins).filter(x => x.vis).sort((a, b) => (+b.el.style.zIndex || 0) - (+a.el.style.zIndex || 0))[0]; this.front = top ? top.id : null; if (top) top.el.classList.add('focused', 'front'); }
    this.save(); this.sync();
  },
  toggle(id) { if (this.compact) { this.show(id); return; } if (this.wins[id].vis && this.front === id) this.hide(id); else this.show(id); },
  focus(id, quiet, fromShow) {
    const w = this.wins[id]; if (!w) return;
    if (this.front !== id) {
      for (const k in this.wins) this.wins[k].el.classList.remove('focused', 'front');
      w.el.style.zIndex = ++this.z; w.el.classList.add('focused', 'front'); this.front = id;
      if (this.compact && !w.vis) { w.vis = true; w.el.hidden = false; }
      if (this.compact) { renderIfStale(UI[id]); if (w.onShow && !fromShow) w.onShow(); }
    }
    if (!quiet) this.sync();
  },
  max(id) { const w = this.wins[id]; w.maxed = !w.maxed; this.place(w); this.focus(id); this.save(); },
  sync() {
    for (const b of $$('#views .vbtn, #dock button[data-win]')) {
      const id = b.dataset.win; if (!id) continue;
      b.classList.toggle('on', this.compact ? this.front === id : !!(this.wins[id] && this.wins[id].vis));
    }
    const bb = $('#dock button[data-br]'); if (bb) bb.classList.toggle('on', $('#browser').classList.contains('open'));
  },
};

/* --------------------------- pattern + channel actions --------------------------- */
function selectPattern(id) { if (!patById(id)) return; S.pat = id; scheduleSave(); if (UI.pr) UI.pr.sel.clear(); renderAll(); }
function newPatternAction() { edit(() => { const p = newPattern(P.patterns.length + 1); P.patterns.push(p); S.pat = p.id; }); toast('New pattern created'); }
function clonePatternAction() {
  edit(() => { const src = curPat(), p = JSON.parse(JSON.stringify(src)); p.id = uid(); p.name = src.name + ' copy'; p.color = PALETTE[P.patterns.length % PALETTE.length]; P.patterns.splice(P.patterns.indexOf(src) + 1, 0, p); S.pat = p.id; });
}
function deletePatternAction() {
  if (P.patterns.length < 2) { toast('A project needs at least one pattern'); return; }
  edit(() => { const src = curPat(), i = P.patterns.indexOf(src); P.patterns.splice(i, 1); P.playlist.clips = P.playlist.clips.filter(c => c.pat !== src.id); S.pat = P.patterns[Math.max(0, i - 1)].id; });
}
/* Split by channel (as in FL Studio): one new pattern per channel that plays in the pattern.
   Its clips in the playlist are replaced by one clip per channel, stacked on the tracks below
   (skipping tracks that already have something at that time). The original pattern stays in
   the pattern list, so nothing is lost; Ctrl+Z undoes the whole split. */
function splitByChannel(patId, onlyClips) {
  const pat = patById(patId); if (!pat) return;
  const used = P.channels.filter(ch => (pat.notes[ch.id] || []).length);
  if (used.length < 2) { toast(used.length ? pat.name + ' only uses one channel, so there is nothing to split' : pat.name + ' is empty'); return; }
  const pl = P.playlist;
  const clips = pl.clips.filter(c => c.pat === pat.id && (!onlyClips || onlyClips.includes(c)));
  let made = [];
  edit(() => {
    made = used.map(ch => ({ id: uid(), name: pat.name + ' - ' + ch.name, color: ch.color || pat.color, len: pat.len, notes: { [ch.id]: JSON.parse(JSON.stringify(pat.notes[ch.id])) } }));
    P.patterns.splice(P.patterns.indexOf(pat) + 1, 0, ...made);
    const keep = pl.clips.filter(c => !clips.includes(c)), out = [];
    const busy = (t, a, b) => keep.concat(out).some(o => o.track === t && o.start < b && o.start + o.len > a);
    for (const c of clips) {
      let t = c.track;
      made.forEach((np, i) => {
        if (i) t++;
        while (t < 498 && busy(t, c.start, c.start + c.len)) t++;
        out.push({ id: uid(), pat: np.id, track: t, start: c.start, len: c.len });
      });
    }
    pl.clips = keep.concat(out);
    const need = out.reduce((m, c) => Math.max(m, c.track + 1), 0);
    if (need > pl.tracks) pl.tracks = need;
    if (UI.pl) UI.pl.sel = new Set(out);
    S.pat = made[0].id;
  });
  toast('Split ' + pat.name + ' into ' + made.length + ' patterns, one per channel' + (clips.length ? '' : ' (they are in the pattern list)'));
}
function makeUniqueClip(clip) {
  const src = patById(clip.pat); if (!src) return;
  edit(() => {
    const p = JSON.parse(JSON.stringify(src)); p.id = uid(); p.name = src.name + ' (unique)';
    P.patterns.splice(P.patterns.indexOf(src) + 1, 0, p); clip.pat = p.id; S.pat = p.id;
  });
  hint('This clip now has its own copy of the pattern');
}
function patternMenu(anchor) {
  const items = [{ head: 'Patterns' }];
  for (const p of P.patterns) items.push({ label: p.name, swatch: p.color, key: p.id === S.pat ? 'current' : (p.len / STEP) + (p.len === STEP ? ' bar' : ' bars'), action: () => selectPattern(p.id) });
  items.push({ sep: true },
    { label: 'New pattern', action: newPatternAction },
    { label: 'Clone pattern', action: clonePatternAction },
    { label: 'Split by channel', hint: 'One pattern per channel, stacked in the playlist', action: () => splitByChannel(S.pat) },
    { label: 'Rename pattern', action: () => askText(anchor, curPat().name, v => edit(() => { curPat().name = v; })) },
    { label: 'Colour', disabled: true },
    ...PALETTE.slice(0, 5).map(c => ({ label: '', swatch: c, action: () => edit(() => { curPat().color = c; }) })),
    { sep: true },
    { label: 'Clear pattern', action: () => edit(() => { curPat().notes = {}; }) },
    { label: 'Delete pattern', danger: true, action: deletePatternAction });
  menuAt(anchor, items);
}
function makeChannel(spec) {
  const color = PALETTE[P.channels.length % PALETTE.length];
  const ch = { id: uid(), name: spec.name, type: spec.type, color, vol: 0.78, pan: 0, mute: false, mixer: spec.mixer != null ? spec.mixer : nextFreeInsert(), root: 60, params: {} };
  if (spec.type === 'drum') ch.params = { kind: spec.kind, tune: spec.tune || 0, decay: spec.decay ?? 1, tone: spec.tone ?? 0.5, level: 1 };
  else if (spec.type === 'synth') { ch.params = Object.assign({}, SYNTH_DEFAULT, SYNTH_PRESETS[spec.preset] || {}); ch.preset = spec.preset; }
  else if (spec.type === 'sampler') { ch.sample = spec.sample; ch.params = { pitch: 0, start: 0, att: 0.002, rel: 0.12, gain: 0.8, rev: false, oneshot: true }; }
  else if (spec.type === 'plugin') { ch.plugin = Object.assign({}, spec.plugin); ch.params = {}; }
  return ch;
}
function addChannel(spec, quiet) {
  let ch;
  edit(() => {
    ch = makeChannel(spec); P.channels.push(ch); S.ch = ch.id;
    const m = P.mixer[ch.mixer]; if (ch.mixer > 0 && m && /^Insert \d+$/.test(m.name)) m.name = ch.name;
  });
  if (A.ctx) syncAudio();
  if (!WM.compact && !WM.wins.rack.vis) WM.show('rack');
  if (!quiet) toast('Added ' + spec.name);
  return ch;
}
function specFromBrowser(o) {
  if (o.kind === 'drum') { const d = DRUMS[o.i]; return { type: 'drum', name: d.name, kind: d.kind, tune: d.tune, decay: d.decay, tone: d.tone }; }
  if (o.kind === 'synth') return { type: 'synth', name: o.name, preset: o.name };
  if (o.kind === 'sample') { ensureSample(o.id); return { type: 'sampler', name: sampleName(o.id) || 'Sample', sample: o.id }; }
  if (o.kind === 'vsti') { const q = NATIVE.plugins.find(z => z.id === o.id); return q ? { type: 'plugin', name: q.name, plugin: NATIVE.pluginRef(q) } : null; }
  if (o.kind === 'gen') { if (o.gen === 'synth') return { type: 'synth', name: 'NX-3 Synth', preset: 'Saw Lead' }; if (o.gen === 'drum') return { type: 'drum', name: 'NX Drum', kind: 'kick', tune: 0, decay: 1, tone: 0.5 }; return { type: 'sampler', name: 'Sampler', sample: null }; }
  return null;
}
function addMenuItems() {
  return [
    { head: 'Drum synths' }, ...DRUMS.map((d, i) => ({ label: d.name, action: () => addChannel(specFromBrowser({ kind: 'drum', i })) })),
    { head: 'Synth presets' }, ...Object.keys(SYNTH_PRESETS).map(n => ({ label: n, action: () => addChannel({ type: 'synth', name: n, preset: n }) })),
    { head: 'Sampler' }, { label: 'Load audio file…', action: () => $('#fileIn').click() },
    ...(NATIVE.on ? [{ head: 'VST3 instruments' }, ...(NATIVE.plugins.some(q => q.instrument)
      ? NATIVE.plugins.filter(q => q.instrument).map(q => ({ label: q.name, hint: q.vendor, action: () => NATIVE.addPluginChannel(q.id) }))
      : [{ label: 'Scan for plugins…', action: () => NATIVE.scan(false) }])] : []),
  ];
}
function addSampleChannel(id, quiet) {
  ensureSample(id);
  return addChannel({ type: 'sampler', name: sampleName(id) || 'Sample', sample: id }, quiet);
}
/* Files dropped or picked: up to 16 loose sounds become sampler channels; bigger drops just go into the library. */
async function handleFiles(files, addAsChannels = true) {
  files = [...files];
  const mids = files.filter(f => /\.midi?$/i.test(f.name));
  for (const f of mids) await importMidiFile(f);
  files = files.filter(f => !mids.includes(f));
  if (mids.length && !files.length) return;
  const items = files.filter(f => AUDIO_EXT.test(f.name)).map(f => ({ file: f, name: f.name, pack: 'Imported', path: '' }));
  const zips = files.filter(f => /\.zip$/i.test(f.name));
  let ids = [];
  if (items.length) ids = await runImport(items, 'Importing sounds');
  for (const z of zips) await importZip(z);
  if (!items.length && !zips.length) { toast('Those files are not audio. Supported: WAV, MP3, OGG, FLAC, M4A, AIFF, or a .zip pack.'); return; }
  if (addAsChannels && ids.length && ids.length <= 16) { for (const id of ids) addSampleChannel(id, true); toast(ids.length === 1 ? 'Added ' + sampleName(ids[0]) : 'Added ' + ids.length + ' sampler channels'); }
}
async function handleDrop(dt, addAsChannels) {
  const hasDir = [...(dt.items || [])].some(i => { const e = i.webkitGetAsEntry && i.webkitGetAsEntry(); return e && e.isDirectory; });
  if (!hasDir) { await handleFiles(dt.files, addAsChannels); return; }
  const { ids, items } = await importDataTransfer(dt);
  if (addAsChannels && ids.length && ids.length <= 16) for (const id of ids) addSampleChannel(id, true);
  else if (ids.length) toast(items[0].pack + ' is in the browser under Packs');
}
/* --------------------------- project actions --------------------------- */
function newProjectAction() {
  dialog('Start a new project?', h('p', null, 'The current project is replaced with an empty one. You can still undo this with Ctrl+Z.'), [
    { label: 'Cancel' },
    { label: 'New project', primary: true, action: () => { stop(); Hist.push(); P = newProject(); P.channels.push(makeChannel({ type: 'drum', name: 'Kick Deep', kind: 'kick', mixer: 1 })); P.mixer[1].name = 'Kick Deep'; S.pat = P.patterns[0].id; S.ch = P.channels[0].id; A.pos = 0; afterLoad(); toast('New project'); } },
  ]);
}
function loadDemoAction() { stop(); Hist.push(); P = demoProject(); S.pat = P.patterns[2].id; S.ch = P.channels[0].id; S.mode = 'song'; A.pos = 0; afterLoad(); toast('Loaded the Verdigris demo'); }
function copyProjectAction() {
  const txt = JSON.stringify(P);
  const fallback = () => {
    const ta = h('textarea', { readonly: true, 'aria-label': 'Project JSON' }, txt);
    dialog('Copy project JSON', [h('p', null, 'Select all of the text below and copy it. Paste it back later with File › Import project JSON.'), ta]);
    setTimeout(() => { ta.focus(); ta.select(); }, 30);
  };
  try { navigator.clipboard.writeText(txt).then(() => toast('Project copied to the clipboard'), fallback); } catch (e) { fallback(); }
}
function importProjectAction() {
  const ta = h('textarea', { placeholder: 'Paste project JSON here', 'aria-label': 'Project JSON' });
  dialog('Import project JSON', [h('p', null, 'Paste a project you copied with File › Copy project JSON. Imported audio samples need to be loaded again.'), ta], [
    { label: 'Cancel' },
    { label: 'Import', primary: true, action: () => {
      try { const p = JSON.parse(ta.value); if (!p || p.v !== 1 || !Array.isArray(p.channels)) throw new Error('bad');
        if (NATIVE.on) { NATIVE.loadProject(p, '').then(() => toast('Project imported')); return; }
        stop(); Hist.push(); P = p; afterLoad(); toast('Project imported'); }
      catch (e) { toast('That text is not an NXW project. Copy it again and paste the whole thing.'); return false; }
    } },
  ]);
}
function shortcutsAction() {
  const rows = [
    ['Space', 'Play / stop'], ['L', 'Switch pattern and song mode'], ['F5 · F6 · F7 · F8 · F9', 'Playlist · Channel rack · Piano roll · Instrument · Mixer'],
    ['Ctrl+Z · Ctrl+Shift+Z', 'Undo · redo'], NATIVE.on ? ['Ctrl+S · Ctrl+Shift+S · Ctrl+O', 'Save · save as · open project'] : ['Ctrl+S', 'Save now (projects autosave in this browser)'],
    ['Z S X D C … M ,', 'Play notes, lower octave'], ['Q 2 W 3 E … P', 'Play notes, upper octave'], ['[ · ]', 'Typing keyboard octave down · up'],
    ['Piano roll: click · drag', 'Add note · move it; drag the right edge to resize'], ['Right-click (or eraser)', 'Delete notes, clips and steps'],
    ['Alt+click a lit step', 'Cycle its repeat: 2, 3, 4, 6 or 8 hits'], ['Right-click a channel', 'Cut itself, choke groups, fill, rotate'],
    ['Arrow at the top-left of a playlist clip', 'Clip menu: split by channel, make unique, rename'],
    ['Ctrl+drag', 'Select a group of notes or clips'], ['Shift+drag a clip or note', 'Duplicate it while moving'],
    ['Delete · Ctrl+A · Ctrl+D', 'Delete selection · select all · duplicate selection'], ['↑ ↓ (Shift = octave)', 'Transpose selected notes'],
    ['Ctrl+scroll · Alt+scroll', 'Zoom time · zoom keys'], ['Knobs and faders', 'Drag, scroll or use arrow keys; Shift for fine; double-click to reset'],
  ];
  dialog('Keyboard and mouse', h('table', { class: 'keys-tbl' }, rows.map(r => h('tr', null, h('td', null, ...r[0].split(' · ').flatMap((k, i) => i ? [' · ', h('kbd', null, k)] : [h('kbd', null, k)])), h('td', null, r[1])))));
}
function aboutAction() {
  dialog('NXW STUDIO', [
    NATIVE.on ? h('p', null, 'NXW Studio ' + ((NATIVE.info && NATIVE.info.version) || '') + ' for ' + ((NATIVE.info && NATIVE.info.platform) || 'desktop') + '. The interface is the same as the browser version; sound comes from the native audio engine, which also hosts your VST3 instruments and effects.')
      : h('p', null, 'A pattern-based studio that runs entirely in your browser. Build beats in the channel rack, write melodies in the piano roll, arrange patterns in the playlist and shape the mix with insert effects. Every sound is synthesised live with Web Audio, so the demo needs no downloads.'),
    h('ul', { class: 'feat' },
      h('li', null, h('b', null, 'Chance per step. '), 'Each step and note has a probability lane, so hats and ghost notes vary every bar.'),
      h('li', null, h('b', null, 'Velocity lane in the rack. '), 'Shape step dynamics without opening the piano roll.'),
      h('li', null, h('b', null, 'Scale guides and chord stamps. '), 'The piano roll shades the chosen scale and can place whole chords with one click.'),
      h('li', null, h('b', null, 'Tempo-locked Pump. '), 'A sidechain-style ducker driven by the sequencer clock, no routing needed.'),
      h('li', null, h('b', null, 'Ghost notes. '), 'See the other channels of the pattern while you write.'),
      h('li', null, h('b', null, 'Looping clips. '), 'Stretch a pattern clip and its content repeats to fill it.'),
      h('li', null, h('b', null, 'Unlimited undo. '), 'Every edit, knob turn and mixer move can be undone.'),
      h('li', null, h('b', null, 'Export. '), 'Render the song, a pattern or the loop to WAV or MP3, with optional stems per mixer track.'),
      h('li', null, h('b', null, 'Packs. '), 'Import drum pack folders or .zip files; they stay in this browser between visits.'),
      h('li', null, h('b', null, 'Cut itself and repeat. '), 'Right-click a channel for Cut itself and choke groups; the Repeat lane adds rolls and ratchets.')),
    NATIVE.on ? h('p', null, 'Your work autosaves every few seconds. Use File › Save project to keep named project files; they include the settings of every plugin.')
      : h('p', null, 'Projects autosave in this browser. Use File › Save project file to keep a copy or move it to another device.'),
    NATIVE.on ? h('p', null, 'Plugins are scanned in a separate process, so a broken plugin cannot take the studio down with it. Data folder: ' + ((NATIVE.info && NATIVE.info.data) || ''))
      : h('p', null, 'VST and VST3 plugins are native desktop code, which no web page can load. Install the NXW Studio desktop app to use them; the browser lists the instruments and effects built into NXW STUDIO.'),
  ]);
}

/* --------------------------- transport strip --------------------------- */
UI.top = {
  init() {
    $('#bPlay').innerHTML = icon('play', 18); $('#bStop').innerHTML = icon('stop', 16); $('#bRec').innerHTML = icon('rec', 15);
    $('#bMetro').innerHTML = icon('metro', 17); $('#bType').innerHTML = icon('keys', 18);
    $('#patPrev').innerHTML = icon('left', 14); $('#patNext').innerHTML = icon('right', 14);
    $('#bUndo').innerHTML = icon('undo', 15); $('#bRedo').innerHTML = icon('redo', 15);
    $('#bPlay').onclick = () => togglePlay();
    $('#bStop').onclick = () => stop();
    $('#bRec').onclick = () => { S.rec = !S.rec; this.render(); hint(S.rec ? 'Recording armed · press Play, then play notes on the typing keyboard' : 'Recording off'); };
    $('#bMetro').onclick = () => { S.metro = !S.metro; scheduleSave(); this.render(); };
    $('#bType').onclick = () => { S.typing = !S.typing; scheduleSave(); this.render(); hint(S.typing ? 'Typing keyboard on' : 'Typing keyboard off'); };
    $('#bUndo').onclick = () => Hist.undo(); $('#bRedo').onclick = () => Hist.redo();
    for (const b of $$('#modesw button')) b.onclick = () => setMode(b.dataset.mode);
    $('#patPrev').onclick = () => { const i = P.patterns.indexOf(curPat()); selectPattern(P.patterns[(i - 1 + P.patterns.length) % P.patterns.length].id); };
    $('#patNext').onclick = () => { const i = P.patterns.indexOf(curPat()); if (i === P.patterns.length - 1) newPatternAction(); else selectPattern(P.patterns[i + 1].id); };
    $('#patNext').dataset.hint = 'Next pattern · creates a new one after the last';
    $('#patName').onclick = e => patternMenu(e.currentTarget);
    // tempo display
    const tp = $('#tempo');
    tp.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); tp.setPointerCapture(e.pointerId); Hist.push();
      let last = e.clientY, acc = P.bpm;
      const mv = ev => { const dy = last - ev.clientY; last = ev.clientY; acc = clamp(acc + dy * (ev.shiftKey ? 0.05 : 0.5), 40, 300); const nb = ev.shiftKey ? Math.round(acc * 100) / 100 : Math.round(acc); if (nb !== P.bpm) { P.bpm = nb; onTempoChange(); this.render(); hint('Tempo: ' + P.bpm.toFixed(2) + ' BPM'); } };
      const up = () => { tp.removeEventListener('pointermove', mv); tp.removeEventListener('pointerup', up); tp.removeEventListener('pointercancel', up); touched(); };
      tp.addEventListener('pointermove', mv); tp.addEventListener('pointerup', up); tp.addEventListener('pointercancel', up);
    });
    tp.addEventListener('wheel', e => { e.preventDefault(); wheelHistory(); P.bpm = clamp(Math.round(P.bpm) + (e.deltaY < 0 ? 1 : -1), 40, 300); onTempoChange(); touched(); this.render(); }, { passive: false });
    tp.addEventListener('dblclick', () => askText(tp, String(P.bpm), v => { const n = parseFloat(v); if (n >= 40 && n <= 300) edit(() => { P.bpm = Math.round(n * 1000) / 1000; onTempoChange(); }); else toast('Tempo must be between 40 and 300 BPM'); }));
    $('#timeLcd').onclick = () => { S.timeMode = S.timeMode === 'bars' ? 'time' : 'bars'; scheduleSave(); this.lastTime = ''; $('#timeL').textContent = S.timeMode === 'bars' ? 'Bar:beat:step' : 'Min:sec.ms'; };
    $('#timeL').textContent = S.timeMode === 'bars' ? 'Bar:beat:step' : 'Min:sec.ms';
    // master volume
    this.mk = Knob({ def: { label: 'Master volume', min: 0, max: 1, def: 0.8, unit: '%' }, value: P.master, size: 30,
      onStart: () => Hist.push(), onChange: v => { P.master = v; if (A.ctx) { A.lastMaster = v; A.masterOut.gain.setTargetAtTime(v * 1.1, A.ctx.currentTime, 0.02); } }, onEnd: touched });
    $('#mvol').append(this.mk, h('small', null, 'MAIN'));
    // window buttons + dock
    const views = $('#views'), dock = $('#dock');
    views.append(h('button', { class: 'vbtn xpb', id: 'bExport', 'data-hint': 'Export audio · WAV or MP3, with optional stems', 'aria-label': 'Export audio', html: icon('export', 18), onclick: exportDialog }), h('span', { class: 'vsep' }));
    views.append(h('button', { class: 'vbtn', 'data-hint': 'Browser · instruments, presets, samples and patterns', 'aria-label': 'Browser', html: icon('browser', 18), onclick: () => toggleBrowser() }));
    for (const d of WIN_DEFS) {
      views.append(h('button', { class: 'vbtn', dataset: { win: d.id }, 'data-hint': d.title + ' (' + d.key + ')', 'aria-label': d.title, html: icon(d.icon, 18), onclick: () => WM.toggle(d.id) }));
      dock.append(h('button', { dataset: { win: d.id }, 'aria-label': d.title, onclick: () => { closeBrowserOverlay(); WM.show(d.id); } }, h('span', { html: icon(d.icon, 18) }), d.short));
    }
    dock.append(h('button', { 'data-br': '1', 'aria-label': 'Browser', onclick: () => toggleBrowser() }, h('span', { html: icon('browser', 18) }), 'Browse'));
    // menus
    for (const b of $$('#menubar .mb')) b.onclick = () => menuAt(b, this.menu(b.dataset.menu));
    this.scope = $('#scope'); this.lastTime = ''; this.scopeMQ = matchMedia('(min-width: 1421px)');
    window.addEventListener('resize', () => { this.sw = 0; });
  },
  menu(name) {
    if (name === 'file' && NATIVE.on) return [
      { label: 'New project', action: newProjectAction }, { label: 'Load demo song', action: loadDemoAction }, { sep: true },
      { label: 'Open project…', key: 'Ctrl+O', action: () => NATIVE.openProject() },
      { label: 'Save project', key: 'Ctrl+S', action: () => NATIVE.saveProject(false) },
      { label: 'Save project as…', key: 'Ctrl+⇧+S', action: () => NATIVE.saveProject(true) }, { sep: true },
      { label: 'Export audio (WAV / MP3)…', icon: 'export', action: exportDialog }, { sep: true },
      { label: 'Import drum pack folder…', action: () => $('#dirIn').click() }, { label: 'Import drum pack .zip…', action: () => $('#zipIn').click() },
      { label: 'Import audio files as channels…', action: () => $('#fileIn').click() }, { sep: true },
      { label: 'Audio and MIDI settings…', action: () => NATIVE.call('audioSettings') },
      { label: 'Scan for plugins', action: () => NATIVE.scan(false) }, { label: 'Rescan all plugins', hint: 'Also retries plugins that failed before', action: () => NATIVE.scan(true) },
      { label: 'Plugin folders…', action: () => NATIVE.foldersDialog() }, { sep: true },
      { label: 'Exit', key: 'Alt+F4', action: () => NATIVE.call('quit') },
    ];
    if (name === 'file') return [
      { label: 'New project', action: newProjectAction }, { label: 'Load demo song', action: loadDemoAction }, { sep: true },
      { label: 'Export audio (WAV / MP3)…', icon: 'export', action: exportDialog },
      { label: 'Save project file (.json)', action: saveProjectFile }, { label: 'Open project file…', action: () => $('#projIn').click() }, { sep: true },
      { label: 'Import drum pack folder…', action: () => $('#dirIn').click() }, { label: 'Import drum pack .zip…', action: () => $('#zipIn').click() }, { sep: true },
      { label: 'Save now', key: 'Ctrl+S', action: () => { saveNow(); toast('Saved in this browser'); } },
      { label: 'Copy project JSON', action: copyProjectAction }, { label: 'Import project JSON…', action: importProjectAction }, { sep: true },
      { label: 'Import audio files as channels…', action: () => $('#fileIn').click() },
    ];
    if (name === 'edit') return [
      { label: 'Undo', key: 'Ctrl+Z', action: () => Hist.undo(), disabled: !Hist.u.length }, { label: 'Redo', key: 'Ctrl+⇧+Z', action: () => Hist.redo(), disabled: !Hist.r.length }, { sep: true },
      { label: 'Clear current pattern', action: () => edit(() => { curPat().notes = {}; }) }, { sep: true },
      { label: 'Typing keyboard to piano', checked: S.typing, action: () => { S.typing = !S.typing; this.render(); } },
      { label: 'Metronome', checked: S.metro, action: () => { S.metro = !S.metro; this.render(); } },
    ];
    if (name === 'add') return [{ label: 'New pattern', action: newPatternAction }, { label: 'Clone current pattern', action: clonePatternAction }, { sep: true }, ...addMenuItems()];
    if (name === 'view') return [
      ...WIN_DEFS.map(d => ({ label: d.title, key: d.key, checked: WM.wins[d.id].vis, action: () => WM.toggle(d.id) })),
      { label: 'Browser', checked: !$('#browser').hidden && !WM.compact, action: () => toggleBrowser() }, { sep: true },
      { label: 'Reset window layout', action: () => { S.wins = null; WM.init(true); WM.save(); } },
    ];
    return [{ label: 'Keyboard and mouse', action: shortcutsAction },
      NATIVE.on ? { label: NATIVE.update ? 'Download NXW Studio ' + NATIVE.update.latest : 'Check for updates…', action: () => NATIVE.update ? NATIVE.call('openUrl', NATIVE.update.installer || NATIVE.update.url) : NATIVE.checkUpdates() } : null,
      NATIVE.on ? { label: 'Show log files', action: () => NATIVE.call('revealLogs') } : null,
      { label: 'About NXW STUDIO', action: aboutAction }];
  },
  render() {
    if (this.playIc !== A.playing) { this.playIc = A.playing; $('#bPlay').innerHTML = icon(A.playing ? 'pause' : 'play', 18); }
    $('#bPlay').classList.toggle('on', A.playing);
    $('#bRec').classList.toggle('on', S.rec);
    $('#bMetro').classList.toggle('on', S.metro);
    $('#bType').classList.toggle('on', S.typing);
    for (const b of $$('#modesw button')) b.classList.toggle('on', b.dataset.mode === S.mode);
    $('#tempoV').textContent = P.bpm.toFixed(3);
    const p = curPat();
    $('#patName').querySelector('.sw').style.background = p.color;
    $('#patName').querySelector('span').textContent = p.name;
    if (this.mk) this.mk.set(P.master);
    this.lastTime = '';
  },
  frame(pos) {
    const s = pos ? pos.s : (S.mode === 'song' ? A.pos : 0);
    let txt;
    if (S.timeMode === 'bars') { const st = Math.floor(s); txt = (Math.floor(st / 16) + 1) + ':' + (Math.floor((st % 16) / 4) + 1) + ':' + ((st % 4) + 1); }
    else { const sec = s * stepDur(); txt = Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0') + '.' + String(Math.floor((sec % 1) * 1000)).padStart(3, '0'); }
    if (txt !== this.lastTime) { (this.timeEl ||= $('#timeV')).textContent = txt; this.lastTime = txt; }
    // Oscilloscope: drawn at 30 fps, skipped entirely while the output is silent or the box is hidden.
    this.fc = (this.fc || 0) + 1;
    if (this.fc % 2 || !this.scopeMQ.matches) return;
    const vx = A.live.size + ' VOX';
    if (vx !== this.lastVox) { (this.voxEl ||= $('#voices')).textContent = vx; this.lastVox = vx; }
    const sc = this.scope;
    if (!this.sw) { this.sw = sc.clientWidth; this.sh = sc.clientHeight; this.sctx = null; this.flat = false; }
    const w = this.sw, hh = this.sh; if (!w || !hh) return;
    let buf = null, peak = 0;
    if (A.scopeAn) { buf = this.sbuf || (this.sbuf = new Float32Array(A.scopeAn.fftSize)); A.scopeAn.getFloatTimeDomainData(buf); for (let i = 0; i < 1400; i += 4) { const a = Math.abs(buf[i]); if (a > peak) peak = a; } }
    if (peak < 0.0005 && this.flat) return;
    const ctx = this.sctx || (this.sctx = fitCanvas(sc, w, hh));
    ctx.clearRect(0, 0, w, hh);
    ctx.strokeStyle = CSSV['ink-3']; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, hh / 2); ctx.lineTo(w, hh / 2); ctx.stroke();
    this.flat = peak < 0.0005;
    if (this.flat) return;
    let st = 0; for (let i = 1; i < 1024; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { st = i; break; }
    ctx.strokeStyle = CSSV.verdigris; ctx.lineWidth = 1.4; ctx.beginPath();
    const N = 240, step = 700 / N;
    for (let i = 0; i < N; i++) { const x = i / N * w, y = hh / 2 - clamp(buf[st + Math.floor(i * step)] || 0, -1, 1) * (hh / 2 - 3); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  },
};
function toggleBrowser() {
  const b = $('#browser');
  if (WM.compact) { b.classList.toggle('open'); b.hidden = false; }
  else { b.hidden = !b.hidden; S.brHidden = b.hidden; scheduleSave(); setTimeout(() => WM.clampAll(), 0); }
  renderIfStale(UI.br);
  WM.sync();
}
function closeBrowserOverlay() { $('#browser').classList.remove('open'); WM.sync(); }


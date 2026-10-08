/* ================================================================
   NXW STUDIO · browser: packs, sounds, presets, plugins, patterns
   ================================================================ */
/* Favourites and recently used items are remembered per browser (in the view settings). */
function brFavKey(k) { return /^(smp|drum|syn|gen|fx|vsti|vstfx):/.test(k) ? k : null; }
function brToggleFav(k, label) {
  S.brFav ||= {};
  if (S.brFav[k]) { delete S.brFav[k]; hint('Removed from favourites'); } else { S.brFav[k] = label || k; hint('Added to favourites'); }
  scheduleSave(); if (UI.br) { UI.br._sig = null; UI.br.render(); }
}
function brUsed(k, label) {
  if (!brFavKey(k)) return;
  S.brRecent = [{ k, l: label }].concat((S.brRecent || []).filter(r => r.k !== k)).slice(0, 15);
  scheduleSave();
}
const BR_SECS = [
  ['packs', 'Packs'], ['drums', 'Drum synths'], ['synths', 'Synth presets'], ['plugins', 'Plugin database'], ['patterns', 'Patterns'], ['projects', 'Projects'],
];
const GENERATORS = [
  { gen: 'drum', name: 'NX Drum', hint: 'Drum synthesiser · 11 models' },
  { gen: 'synth', name: 'NX-3 Synth', hint: 'Two-oscillator subtractive synth with unison' },
  { gen: 'sampler', name: 'Sampler', hint: 'Plays any sound from your packs' },
];
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function previewSampleId(id) {
  const c = audio(); if (!c) return;
  stopPreview();
  const token = (A.prevToken = (A.prevToken || 0) + 1);
  ensureSample(id).then(s => {
    if (token !== A.prevToken) return;
    if (!s) { toast('This file could not be decoded by your browser.'); return; }
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = s.buf; g.gain.value = 0.9; src.connect(g); g.connect(A.strips[0].input); src.start();
    A.prev = { src, g }; src.onended = () => { if (A.prev && A.prev.src === src) A.prev = null; };
    if (UI.br) UI.br.drawWave();
  });
}
function stopPreview() {
  if (!A.prev || !A.ctx) return;
  try { A.prev.g.gain.setTargetAtTime(0, A.ctx.currentTime, 0.008); A.prev.src.stop(A.ctx.currentTime + 0.05); } catch (e) { /* ignore */ }
  A.prev = null;
}
function addFxToInsert(type, i) {
  i = clamp(i == null ? (S.mixSel || 1) : i, 0, NINS);
  const m = P.mixer[i];
  if (m.fx.length >= FX_SLOTS) { toast(m.name + ' already has ' + FX_SLOTS + ' effects'); return; }
  edit(() => { m.fx.push(newFx(type)); S.mixSel = i; S.fxSel = m.fx.length - 1; });
  WM.show('mixer');
  toast(FX_DEFS[type].name + ' added to ' + (i ? 'insert ' + i : 'the master'));
}

UI.br = {
  filter: '', rows: [], rowEls: new Map(),
  visible() { const b = $('#browser'); return !!b && !b.hidden && (!WM.compact || b.classList.contains('open')); },
  init() {
    const el = $('#browser');
    if (S.brHidden && !WM.compact) el.hidden = true;
    S.brOpen ||= { 'sec:packs': true, 'sec:patterns': true };
    if (S.brAuto == null) S.brAuto = true;
    const inp = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search the browser', id: 'brSearch', 'data-hint': 'Search: every word must match; -word leaves things out; kick|snare finds either' });
    inp.addEventListener('input', () => { this.filter = inp.value.trim().toLowerCase(); this.render(); });
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'ArrowDown') { e.preventDefault(); this.list.focus(); this.move(1); } if (e.key === 'Escape') { inp.value = ''; this.filter = ''; this.render(); } });
    const imp = h('button', { class: 'btn primary br-imp', 'data-hint': 'Import a drum pack folder, a .zip pack or single sounds', html: icon('plus', 12) + '<span>Import</span>' });
    imp.onclick = () => menuAt(imp, [
      { head: 'Import into your library' },
      { label: 'Drum pack folder…', hint: 'Pick a folder; its subfolders are kept', action: () => $('#dirIn').click() },
      { label: 'Drum pack .zip…', action: () => $('#zipIn').click() },
      { label: 'Audio files…', action: () => { this.importOnly = true; $('#fileIn').click(); } },
    ]);
    this.list = h('div', { class: 'br-list', tabindex: 0, role: 'tree', 'aria-label': 'Browser contents' });
    this.wave = h('canvas', { class: 'br-wave', 'aria-hidden': 'true' });
    this.info = h('div', { class: 'br-info' });
    this.prevBtns = h('div', { class: 'br-pbtns' });
    this.prev = h('div', { class: 'br-prev' }, this.wave, this.info, this.prevBtns);
    this.foot = h('div', { class: 'br-foot' });
    el.append(h('div', { class: 'br-head' }, inp, imp, h('button', { class: 'win-btn br-close', 'aria-label': 'Close browser', html: icon('x', 12), onclick: closeBrowserOverlay })), this.list, this.prev, this.foot);
    const L = this.list;
    L.addEventListener('click', e => { const r = e.target.closest('.br-row'); if (!r) return; if (e.target.closest('.add')) { this.activate(r.dataset.k); return; } this.select(r.dataset.k, true); });
    L.addEventListener('dblclick', e => { const r = e.target.closest('.br-row'); if (r && !e.target.closest('.add')) this.activate(r.dataset.k); });
    L.addEventListener('contextmenu', e => { const r = e.target.closest('.br-row'); if (!r) return; e.preventDefault(); this.select(r.dataset.k, false); this.menu(r.dataset.k, e.clientX, e.clientY); });
    L.addEventListener('dragstart', e => { const r = e.target.closest('.br-row'); const d = r && this.dragData(r.dataset.k); if (!d) { e.preventDefault(); return; } this.dragKind = d.kind; e.dataTransfer.setData('application/x-nxw', JSON.stringify(d)); e.dataTransfer.setData('text/plain', r.textContent); e.dataTransfer.effectAllowed = 'copy'; });
    L.addEventListener('dragend', () => { this.dragKind = null; });
    L.addEventListener('keydown', e => this.key(e));
    el.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('br-drop'); } });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('br-drop'); });
    el.addEventListener('drop', e => { if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); el.classList.remove('br-drop'); importDataTransfer(e.dataTransfer); });
    this.render();
  },
  open(k) { return !!S.brOpen[k]; },
  toggle(k, v) { S.brOpen[k] = v == null ? !S.brOpen[k] : v; scheduleSave(); this.render(); },
  revealPack(pack) { S.brOpen['sec:packs'] = true; S.brOpen['pk:' + pack] = true; scheduleSave(); },
  tree() {
    if (this._tv === LIB.ver) return this._tree;
    const packs = new Map();
    const node = name => ({ name, dirs: new Map(), files: [], count: 0 });
    for (const m of LIB.meta.values()) {
      let n = packs.get(m.pack); if (!n) packs.set(m.pack, n = node(m.pack));
      if (m.path) for (const seg of m.path.split('/')) { let d = n.dirs.get(seg); if (!d) n.dirs.set(seg, d = node(seg)); n = d; }
      n.files.push(m);
    }
    const count = n => { n.files.sort((a, b) => natCmp(a.name, b.name)); n.count = n.files.length; for (const d of n.dirs.values()) n.count += count(d); return n.count; };
    for (const p of packs.values()) count(p);
    this._tree = [...packs.values()].sort((a, b) => natCmp(a.name, b.name)); this._tv = LIB.ver;
    return this._tree;
  },
  buildRows() {
    const rows = [], f = this.filter;
    const sec = (id, label, n) => { const k = 'sec:' + id; rows.push({ k, kind: 'sec', label, count: n, open: f ? true : this.open(k), depth: 0 }); return f ? true : this.open(k); };
    const smpSub = m => { const t = nameTags(m.name + ' ' + (m.path || '')); return t; };
    const smpRow = (m, depth, showPath) => rows.push({ k: 'smp:' + m.id, kind: 'smp', label: m.name, depth, sub: [smpSub(m), showPath ? m.pack + (m.path ? ' / ' + m.path : '') : (m.dur ? m.dur.toFixed(2) + 's' : '')].filter(Boolean).join(' · '), bad: m.bad });
    const tree = this.tree();
    const ICON_ROW = k => { const [kind, ...r] = k.split(':'), id = r.join(':'); return { k, kind, id }; };
    // Favourites and recently used come first (they survive searches too).
    const listed = (arr, depth) => { for (const { k, l } of arr) { const { kind, id } = ICON_ROW(k); if (kind === 'smp' && !LIB.meta.has(id)) continue; if ((kind === 'vsti' || kind === 'vstfx') && !NATIVE.plugins.some(q => q.id === id)) continue; rows.push({ k, kind, label: kind === 'smp' ? (LIB.meta.get(id) || {}).name || l : l, depth, fav: !!(S.brFav || {})[k], dup: true }); } };
    const favs = Object.entries(S.brFav || {}).map(([k, l]) => ({ k, l }));
    if (f) {
      const match = makeMatcher(f);
      if (favs.length) { const fm = favs.filter(x => match(x.l)); if (fm.length && sec('fav', 'Favourites', fm.length)) listed(fm, 1); }
      const hits = [...LIB.meta.values()].filter(m => match(m.name, m.path, m.pack)).sort((a, b) => natCmp(a.name, b.name));
      if (sec('packs', 'Sounds', hits.length)) hits.slice(0, 400).forEach(m => smpRow(m, 1, true));
      const dr = DRUMS.map((d, i) => [d, i]).filter(([d]) => match(d.name, d.kind));
      if (dr.length && sec('drums', 'Drum synths', dr.length)) dr.forEach(([d, i]) => rows.push({ k: 'drum:' + i, kind: 'drum', label: d.name, depth: 1 }));
      const sy = Object.keys(SYNTH_PRESETS).filter(n => match(n));
      if (sy.length && sec('synths', 'Synth presets', sy.length)) sy.forEach(n => rows.push({ k: 'syn:' + n, kind: 'syn', label: n, depth: 1 }));
      const pl = [...GENERATORS.filter(g => match(g.name)).map(g => ({ k: 'gen:' + g.gen, kind: 'gen', label: g.name, depth: 1 })), ...FX_ORDER.filter(t => match(FX_DEFS[t].name)).map(t => ({ k: 'fx:' + t, kind: 'fx', label: FX_DEFS[t].name, depth: 1 })),
        ...NATIVE.plugins.filter(q => match(q.name, q.vendor)).map(q => ({ k: (q.instrument ? 'vsti:' : 'vstfx:') + q.id, kind: q.instrument ? 'vsti' : 'vstfx', label: q.name, depth: 1, sub: q.instrument ? 'VST3 instrument' : 'VST3 effect' }))];
      if (pl.length && sec('plugins', 'Plugin database', pl.length)) rows.push(...pl);
      const chs = P.channels.filter(c => match(c.name));
      if (chs.length && sec('project', 'Current project', chs.length)) chs.forEach(c => rows.push({ k: 'chn:' + c.id, kind: 'chn', label: c.name, swatch: c.color, depth: 1, sub: 'channel' }));
      const pa = P.patterns.filter(p => match(p.name));
      if (pa.length && sec('patterns', 'Patterns', pa.length)) pa.forEach(p => rows.push({ k: 'pat:' + p.id, kind: 'pat', label: p.name, swatch: p.color, depth: 1 }));
      return rows;
    }
    if (favs.length && sec('fav', 'Favourites', favs.length)) listed(favs, 1);
    if ((S.brRecent || []).length && sec('recent', 'Recently used', S.brRecent.length)) listed(S.brRecent, 1);
    if (sec('project', 'Current project', P.channels.length)) {
      if (!P.channels.length) rows.push({ k: 'note:project', kind: 'note', depth: 1, label: 'No channels yet.' });
      P.channels.forEach(c => rows.push({ k: 'chn:' + c.id, kind: 'chn', label: c.name, swatch: c.color, depth: 1, cur: c.id === S.ch, sub: c.type === 'drum' ? 'drum' : c.type === 'synth' ? 'NX-3' : c.type === 'plugin' ? 'VST3' : 'sampler' }));
    }
    if (sec('packs', 'Packs', LIB.meta.size)) {
      if (!tree.length) rows.push({ k: 'note:packs', kind: 'note', depth: 1, label: 'Import a drum pack folder or .zip, or drop folders and sounds here. Everything you import is kept ' + (NATIVE.on ? 'on this computer.' : 'in this browser.') });
      const walk = (n, depth, key) => {
        for (const d of [...n.dirs.values()].sort((a, b) => natCmp(a.name, b.name))) {
          const k = key + '/' + d.name, open = this.open(k);
          rows.push({ k, kind: 'dir', label: d.name, count: d.count, depth, open });
          if (open) walk(d, depth + 1, k);
        }
        for (const m of n.files) smpRow(m, depth, false);
      };
      for (const p of tree) { const k = 'pk:' + p.name, open = this.open(k); rows.push({ k, kind: 'pack', label: p.name, count: p.count, depth: 1, open }); if (open) walk(p, 2, 'dir:' + p.name); }
    }
    if (sec('drums', 'Drum synths', DRUMS.length)) DRUMS.forEach((d, i) => rows.push({ k: 'drum:' + i, kind: 'drum', label: d.name, depth: 1, sub: DRUM_KIND_LABEL[d.kind] }));
    if (sec('synths', 'Synth presets', Object.keys(SYNTH_PRESETS).length)) Object.keys(SYNTH_PRESETS).forEach(n => rows.push({ k: 'syn:' + n, kind: 'syn', label: n, depth: 1 }));
    if (sec('plugins', 'Plugin database', GENERATORS.length + FX_ORDER.length + NATIVE.plugins.length)) {
      const og = this.open('dir:plugins/gen'), of = this.open('dir:plugins/fx');
      rows.push({ k: 'dir:plugins/gen', kind: 'dir', label: 'Generators', count: GENERATORS.length, depth: 1, open: og });
      if (og) GENERATORS.forEach(g => rows.push({ k: 'gen:' + g.gen, kind: 'gen', label: g.name, depth: 2, sub: 'instrument' }));
      rows.push({ k: 'dir:plugins/fx', kind: 'dir', label: 'Effects', count: FX_ORDER.length, depth: 1, open: of });
      if (of) FX_ORDER.forEach(t => rows.push({ k: 'fx:' + t, kind: 'fx', label: FX_DEFS[t].name, depth: 2, sub: 'effect' }));
      if (NATIVE.on) {
        const vi = NATIVE.plugins.filter(q => q.instrument), vf = NATIVE.plugins.filter(q => !q.instrument);
        const oi = this.open('dir:plugins/vsti'), ofx = this.open('dir:plugins/vstfx'), sc = NATIVE.scanning;
        rows.push({ k: 'dir:plugins/vsti', kind: 'dir', label: 'VST3 instruments', count: vi.length, depth: 1, open: oi });
        if (oi) vi.forEach(q => rows.push({ k: 'vsti:' + q.id, kind: 'vsti', label: q.name, depth: 2, sub: q.vendor || 'VST3' }));
        rows.push({ k: 'dir:plugins/vstfx', kind: 'dir', label: 'VST3 effects', count: vf.length, depth: 1, open: ofx });
        if (ofx) vf.forEach(q => rows.push({ k: 'vstfx:' + q.id, kind: 'vstfx', label: q.name, depth: 2, sub: q.vendor || 'VST3' }));
        rows.push({ k: 'act:scan', kind: 'act', label: sc ? 'Scanning ' + sc.done + ' of ' + (sc.total || '…') + ' · click to stop' : 'Scan for plugins', depth: 1 });
        rows.push({ k: 'act:folders', kind: 'act', label: 'Plugin folders…', depth: 1 });
      } else rows.push({ k: 'note:vst', kind: 'note', depth: 1, label: 'VST3 instruments and effects load in the NXW Studio desktop app for Windows and macOS.' });
    }
    if (sec('patterns', 'Patterns', P.patterns.length)) P.patterns.forEach(p => rows.push({ k: 'pat:' + p.id, kind: 'pat', label: p.name, swatch: p.color, depth: 1, cur: p.id === S.pat, sub: (p.len / 16) + (p.len === 16 ? ' bar' : ' bars') }));
    if (sec('projects', 'Projects', 4)) [['demo', 'Verdigris · demo song'], ['empty', 'Empty project'], ['open', 'Open project file…'], ['save', 'Save project file']].forEach(([id, l]) => rows.push({ k: 'proj:' + id, kind: 'proj', label: l, depth: 1 }));
    return rows;
  },
  render() {
    if (!this.list) return;
    if (!sigChanged(this, [this.filter, S.brOpen, LIB.ver, P.patterns.map(q => [q.id, q.name, q.color, q.len]), S.pat, S.ch, P.channels.map(c => [c.id, c.name, c.color, c.type]), LIB.persistent, NATIVE.pluginsVer, S.brFav, S.brRecent])) return;
    const st = this.list.scrollTop;
    this.rows = this.buildRows(); this.rowEls.clear();
    const frag = document.createDocumentFragment();
    const ICON = { smp: 'wave', drum: 'drum', syn: 'synth', gen: 'synth', fx: 'mixer', proj: 'file', vsti: 'piano', vstfx: 'mixer', act: 'plus' };
    const seen = new Set();
    for (const r of this.rows) {
      const folder = r.kind === 'sec' || r.kind === 'pack' || r.kind === 'dir';
      const addable = ['smp', 'drum', 'syn', 'gen', 'fx', 'vsti', 'vstfx'].includes(r.kind);
      const el = h('div', { class: 'br-row k-' + r.kind + (r.cur ? ' cur' : '') + (r.bad ? ' bad' : ''), dataset: { k: r.k }, role: r.kind === 'note' ? null : 'treeitem', 'aria-level': r.depth + 1, 'aria-expanded': folder ? String(!!r.open) : null, draggable: addable || r.kind === 'pat' ? 'true' : null, style: { '--d': r.depth } },
        folder ? h('span', { class: 'chev' + (r.open ? ' open' : ''), html: icon('chev', 11) }) : null,
        r.swatch ? h('i', { class: 'sw', style: { background: r.swatch } }) : (ICON[r.kind] ? h('span', { class: 'bi', html: icon(ICON[r.kind], 13) }) : (r.kind === 'pack' || r.kind === 'dir' ? h('span', { class: 'bi', html: icon('browser', 13) }) : null)),
        h('span', { class: 'nm' }, r.label),
        r.sub ? h('span', { class: 'sub' }, r.sub) : null,
        r.count != null && r.kind !== 'sec' ? h('span', { class: 'cnt' }, r.count) : (r.kind === 'sec' ? h('span', { class: 'cnt' }, r.count) : null),
        addable ? h('button', { class: 'add', tabindex: -1, 'aria-label': 'Add ' + r.label, 'data-hint': r.kind === 'fx' || r.kind === 'vstfx' ? 'Add to the selected mixer insert' : 'Add to the channel rack', html: icon('plus', 11) }) : null);
      if ((S.brFav || {})[r.k]) el.querySelector('.nm').append(h('span', { class: 'fav', 'aria-label': 'favourite', html: icon('starf', 10) }));
      // The same item can be listed twice (favourites, recent); the first one owns the key.
      if (seen.has(r.k)) { el.dataset.k = r.k; frag.append(el); continue; }
      seen.add(r.k);
      if (r.k === S.brSel) el.classList.add('sel');
      frag.append(el); this.rowEls.set(r.k, el);
    }
    this.list.textContent = ''; this.list.append(frag); this.list.scrollTop = st;
    const n = LIB.meta.size;
    const where = NATIVE.on ? 'on this computer' : 'in this browser';
    this.foot.textContent = LIB.persistent ? (n ? n + (n === 1 ? ' sound' : ' sounds') + ' saved ' + where : 'Imported sounds are saved ' + where) : 'Browser storage is blocked here: imports last until you close the page';
    this.showPreview();
  },
  rowOf(k) { return this.rows.find(r => r.k === k); },
  select(k, fromClick) {
    const r = this.rowOf(k); if (!r || r.kind === 'note') return;
    const prev = this.rowEls.get(S.brSel); if (prev) prev.classList.remove('sel');
    S.brSel = k; const el = this.rowEls.get(k); if (el) { el.classList.add('sel'); el.scrollIntoView({ block: 'nearest' }); }
    if (fromClick && (r.kind === 'sec' || r.kind === 'pack' || r.kind === 'dir')) { this.toggle(k); return; }
    if (fromClick && r.kind === 'act') { this.activate(k); return; }
    if (r.kind === 'smp') { if (S.brAuto && fromClick === true) previewSampleId(k.slice(4)); }
    else if (fromClick && r.kind === 'drum') { const d = DRUMS[+k.slice(5)]; previewChannel({ type: 'drum', params: { kind: d.kind, tune: d.tune, decay: d.decay, tone: d.tone } }); }
    else if (fromClick && r.kind === 'syn') this.previewSynth(k.slice(4));
    else if (fromClick && r.kind === 'pat') selectPattern(k.slice(4));
    else if (fromClick && r.kind === 'chn') { S.ch = k.slice(4); renderAll(); }
    this.showPreview();
  },
  previewSynth(n) {
    const c = audio(); if (!c) return;
    const tmp = { type: 'synth', params: Object.assign({}, SYNTH_DEFAULT, SYNTH_PRESETS[n]) }, bass = /Bass|Acid/.test(n), arp = /Pluck|Bell|Keys/.test(n);
    [0, 3, 7].forEach((k, j) => playNote(tmp, c.currentTime + 0.01 + (arp ? j * 0.09 : 0), (bass ? 36 : 57) + k, 0.75, bass ? 0.3 : 0.7, A.strips[0].input));
  },
  activate(k) {
    const [kind, ...rest] = k.split(':'), id = rest.join(':');
    const row = this.rowOf(k); brUsed(k, row ? row.label : id);
    if (kind === 'smp') addSampleChannel(id);
    else if (kind === 'drum') addChannel(specFromBrowser({ kind: 'drum', i: +id }));
    else if (kind === 'syn') addChannel({ type: 'synth', name: id, preset: id });
    else if (kind === 'gen') addChannel(specFromBrowser({ kind: 'gen', gen: id }));
    else if (kind === 'fx') addFxToInsert(id);
    else if (kind === 'vsti') NATIVE.addPluginChannel(id);
    else if (kind === 'vstfx') NATIVE.addPluginFx(id);
    else if (kind === 'act' && id === 'scan') { if (NATIVE.scanning) NATIVE.call('cancelScan'); else NATIVE.scan(false); }
    else if (kind === 'act' && id === 'folders') NATIVE.foldersDialog();
    else if (kind === 'pat') { selectPattern(id); WM.show('rack'); }
    else if (kind === 'chn') { const ch = chById(id); if (ch) { S.ch = id; if (ch.type === 'plugin' && NATIVE.on) NATIVE.openPlugin(id); else WM.show('inst'); renderAll(); } }
    else if (kind === 'proj') ({ demo: loadDemoAction, empty: newProjectAction, open: openProjectAction, save: saveProjectFile })[id]();
    else if (kind === 'sec' || kind === 'pack' || kind === 'dir') this.toggle(k);
  },
  dragData(k) {
    const [kind, ...rest] = k.split(':'), id = rest.join(':');
    return ({ smp: { kind: 'sample', id }, drum: { kind: 'drum', i: +id }, syn: { kind: 'synth', name: id }, gen: { kind: 'gen', gen: id }, fx: { kind: 'fx', type: id }, pat: { kind: 'pattern', id }, vsti: { kind: 'vsti', id }, vstfx: { kind: 'vstfx', id } })[kind] || null;
  },
  packIds(k) {
    const pre = k.startsWith('pk:') ? k.slice(3) : k.slice(4), [pack, ...path] = pre.split('/'), sub = path.join('/');
    return [...LIB.meta.values()].filter(m => m.pack === pack && (!sub || m.path === sub || m.path.startsWith(sub + '/'))).map(m => m.id);
  },
  menu(k, x, y) {
    const [kind, ...rest] = k.split(':'), id = rest.join(':'), ch = selCh(), row = this.rowOf(k);
    const fav = brFavKey(k) ? { label: (S.brFav || {})[k] ? 'Remove from favourites' : 'Add to favourites', icon: 'star', key: 'F', action: () => brToggleFav(k, row ? row.label : id) } : null;
    if (kind === 'chn') {
      const c = chById(id); if (!c) return;
      openMenu(x, y, [{ head: c.name }, { label: 'Select', action: () => { S.ch = id; renderAll(); } }, { label: 'Open settings', action: () => this.activate(k) }, { label: 'Open in piano roll', action: () => { S.ch = id; WM.show('pr'); renderAll(); } }]);
      return;
    }
    if (kind === 'smp') {
      const m = LIB.meta.get(id);
      openMenu(x, y, [{ head: m ? m.name : 'Sound' }, fav,
        { label: 'Preview', action: () => previewSampleId(id) },
        { label: 'Add to channel rack', action: () => addSampleChannel(id) },
        ch ? { label: 'Load into ' + ch.name, action: () => loadSampleInto(ch, id) } : null,
        this.filter ? { label: 'Show in its pack', action: () => { const el = $('#brSearch'); el.value = ''; this.filter = ''; this.revealPack(m.pack); if (m.path) { let acc = 'dir:' + m.pack; for (const seg of m.path.split('/')) { acc += '/' + seg; S.brOpen[acc] = true; } } this.render(); this.select(k, null); } } : null,
        { sep: true }, { label: 'Delete from library', danger: true, action: () => this.confirmDelete([id], 'this sound') }]);
    } else if (kind === 'pack' || (kind === 'dir' && !k.startsWith('dir:plugins'))) {
      const ids = this.packIds(k), name = k.split('/').pop().replace(/^pk:|^dir:/, '');
      openMenu(x, y, [{ head: name },
        { label: this.open(k) ? 'Collapse' : 'Expand', action: () => this.toggle(k) },
        { label: 'Add all ' + ids.length + ' as channels', disabled: !ids.length || ids.length > 32, hint: 'Up to 32 sounds at once', action: () => { for (const i of ids) addSampleChannel(i, true); toast('Added ' + ids.length + ' sampler channels'); } },
        kind === 'pack' ? { label: 'Rename pack…', action: () => askText(this.rowEls.get(k), name, v => this.renamePack(name, v)) } : null,
        { sep: true }, { label: 'Delete ' + (kind === 'pack' ? 'pack' : 'folder') + ' from library', danger: true, action: () => this.confirmDelete(ids, ids.length + ' sounds in ' + name) }]);
    } else if (kind === 'fx') {
      openMenu(x, y, [{ head: FX_DEFS[id].name }, fav, ...P.mixer.map((m, i) => ({ label: 'Add to ' + (i ? i + ' · ' : '') + m.name, action: () => addFxToInsert(id, i) }))]);
    } else if (kind === 'vstfx') {
      const q = NATIVE.plugins.find(z => z.id === id);
      openMenu(x, y, [{ head: q ? q.name : 'Effect' }, fav, ...P.mixer.map((m, i) => ({ label: 'Add to ' + (i ? i + ' · ' : '') + m.name, action: () => NATIVE.addPluginFx(id, i) }))]);
    } else if (kind === 'pat') patternMenu(this.rowEls.get(k));
    else if (['drum', 'syn', 'gen', 'vsti'].includes(kind)) openMenu(x, y, [{ label: 'Add to channel rack', action: () => this.activate(k) }, fav,
      ch && kind !== 'gen' ? { label: 'Replace ' + ch.name + ' with this', action: () => replaceInstrument(ch, kind === 'drum' ? specFromBrowser({ kind: 'drum', i: +id }) : kind === 'syn' ? { type: 'synth', name: id, preset: id } : specFromBrowser({ kind: 'vsti', id })) } : null]);
  },
  async renamePack(from, to) {
    if (!to || to === from) return;
    for (const m of LIB.meta.values()) if (m.pack === from) { m.pack = to; libSaveMeta(m); }
    S.brOpen['pk:' + to] = S.brOpen['pk:' + from]; LIB.ver++; this.render();
  },
  confirmDelete(ids, what) {
    const used = P.channels.filter(c => ids.includes(c.sample)).length;
    dialog('Delete ' + what + '?', h('p', null, 'The files are removed from this browser\'s library.' + (used ? ' ' + used + ' channel' + (used === 1 ? '' : 's') + ' in this project use them and will go silent.' : '') + ' This cannot be undone.'), [
      { label: 'Cancel' }, { label: 'Delete', primary: true, action: () => { libDelete(ids).then(() => { this.render(); renderAll(); toast('Deleted ' + what); }); } }]);
  },
  move(d) {
    const sel = this.rows.filter(r => r.kind !== 'note'); if (!sel.length) return;
    let i = sel.findIndex(r => r.k === S.brSel); i = i < 0 ? (d > 0 ? 0 : sel.length - 1) : clamp(i + d, 0, sel.length - 1);
    this.select(sel[i].k, false);
    const r = sel[i];
    if (r.kind === 'smp' && S.brAuto) previewSampleId(r.k.slice(4));
  },
  key(e) {
    const r = this.rowOf(S.brSel);
    const k = e.key;
    // Shift+arrows browse sounds straight into the selected sampler channel (as in FL Studio).
    if ((k === 'ArrowDown' || k === 'ArrowUp') && e.shiftKey) {
      e.preventDefault(); e.stopPropagation(); this.move(k === 'ArrowDown' ? 1 : -1);
      const nr = this.rowOf(S.brSel), ch = selCh();
      if (nr && nr.kind === 'smp' && ch && ch.type === 'sampler') { const id = nr.k.slice(4); Hist.push(); ensureSample(id); ch.sample = id; ch.name = sampleName(id) || ch.name; touched(); renderAll(); }
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this.move(k === 'ArrowDown' ? 1 : -1); return; }
    if (!r) return;
    if ((k === 'f' || k === 'F') && !e.ctrlKey && !e.metaKey && brFavKey(r.k)) { e.preventDefault(); e.stopPropagation(); brToggleFav(r.k, r.label); return; }
    const folder = r.kind === 'sec' || r.kind === 'pack' || r.kind === 'dir';
    if (k === 'ArrowRight' && folder) { e.preventDefault(); e.stopPropagation(); if (!r.open) this.toggle(r.k, true); else this.move(1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (folder && r.open) this.toggle(r.k, false); else { const i = this.rows.indexOf(r); for (let j = i - 1; j >= 0; j--) if (this.rows[j].depth < r.depth && this.rows[j].kind !== 'note') { this.select(this.rows[j].k, false); break; } } }
    else if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); this.activate(r.k); }
    else if (k === ' ') { e.preventDefault(); e.stopPropagation(); if (r.kind === 'smp') previewSampleId(r.k.slice(4)); else this.select(r.k, true); }
    else if ((k === 'Delete' || k === 'Backspace') && r.kind === 'smp') { e.preventDefault(); e.stopPropagation(); this.confirmDelete([r.k.slice(4)], 'this sound'); }
  },
  showPreview() {
    const k = S.brSel || '', r = this.rowOf(k), B = this.prevBtns;
    if (!r || r.kind !== 'smp') { this.prev.hidden = true; return; }
    this.prev.hidden = false;
    const id = k.slice(4), m = LIB.meta.get(id) || {}, ch = selCh();
    this.info.textContent = (m.file || m.name || 'Sound') + (m.dur ? ' · ' + m.dur.toFixed(2) + ' s' : '') + (m.sr ? ' · ' + (m.sr / 1000).toFixed(1) + ' kHz' : '') + (m.chans ? (m.chans > 1 ? ' · stereo' : ' · mono') : '') + (m.size ? ' · ' + fmtSize(m.size) : '');
    B.textContent = '';
    B.append(
      h('button', { class: 'btn', 'aria-label': 'Preview', 'data-hint': 'Preview (Space)', html: icon('play', 11), onclick: () => previewSampleId(id) }),
      h('button', { class: 'btn' + (S.brAuto ? ' on' : ''), 'aria-pressed': String(!!S.brAuto), 'data-hint': 'Auto-preview sounds when you select them', onclick: e => { S.brAuto = !S.brAuto; e.currentTarget.classList.toggle('on', S.brAuto); scheduleSave(); } }, 'Auto'),
      h('button', { class: 'btn', 'data-hint': 'Add as a new sampler channel (Enter)', html: icon('plus', 11) + '<span>Rack</span>', onclick: () => addSampleChannel(id) }),
      ch ? h('button', { class: 'btn', 'data-hint': 'Load this sound into ' + ch.name, onclick: () => loadSampleInto(ch, id) }, 'Load') : null);
    this.drawWave();
  },
  drawWave() {
    const k = S.brSel || ''; if (!k.startsWith('smp:') || this.prev.hidden) return;
    const id = k.slice(4), cv = this.wave, W = cv.clientWidth || 190, H = cv.clientHeight || 46, ctx = fitCanvas(cv, W, H);
    ctx.clearRect(0, 0, W, H);
    const s = A.samples.get(id);
    if (!s) { ctx.fillStyle = CSSV['text-faint']; ctx.font = '500 10px ' + FONT_UI; ctx.fillText('Loading…', 8, H / 2 + 3); ensureSample(id).then(x => { if (x && S.brSel === k) { const m = LIB.meta.get(id); if (m) m.dur = x.dur; this.showPreview(); } }); return; }
    const N = s.peaks.length / 2;
    ctx.fillStyle = CSSV.verdigris;
    for (let x = 0; x < W; x++) { const i = Math.floor(x / W * N), mn = s.peaks[i * 2], mx = s.peaks[i * 2 + 1]; ctx.fillRect(x, H / 2 - mx * (H / 2 - 2), 1, Math.max(1, (mx - mn) * (H / 2 - 2))); }
  },
};
function loadSampleInto(ch, id) {
  ensureSample(id);
  brUsed('smp:' + id, sampleName(id) || 'Sound');
  edit(() => {
    if (ch.type !== 'sampler') { ch.type = 'sampler'; ch.params = { pitch: 0, start: 0, att: 0.002, rel: 0.12, gain: 0.8, rev: false, oneshot: true }; delete ch.preset; }
    ch.sample = id; ch.name = sampleName(id) || ch.name;
  });
  toast('Loaded into ' + ch.name);
}
function saveProjectFile() { saveFile((P.name || 'NXW project') + '.json', JSON.stringify(P), 'application/json'); }
function openProjectAction() { if (NATIVE.on) NATIVE.openProject(); else $('#projIn').click(); }

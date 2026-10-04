/* ================================================================
   NXW STUDIO · desktop integration

   Runs only inside the desktop app (the JUCE web view). It swaps the browser's
   Web Audio engine for the native engine and adds what only a desktop program
   can do: VST3 plugins, real files, audio device settings, updates.
   In an ordinary browser, NATIVE.on is false and nothing here changes anything.
   ================================================================ */
const NATIVE = (() => {
  const J = window.__JUCE__;
  const fns = J && J.initialisationData && J.initialisationData.__juce__functions;
  const on = !!(J && J.backend && Array.isArray(fns) && fns.includes('nxw'));
  return {
    on, info: null, plugins: [], pluginsVer: 0, status: {}, scanning: null, tick: null, tickAt: 0,
    meters: [], red: [], voices: 0, projectPath: '', update: null, transportAt: 0,
    scope: new Float32Array(1024), lastPush: 0, pushQueued: false, exportProgress: null,
  };
})();

if (NATIVE.on) (() => {
  const J = window.__JUCE__;
  let seq = 1;
  const waiting = new Map();
  J.backend.addEventListener('__juce__complete', ({ promiseId, result }) => {
    const w = waiting.get(promiseId);
    if (w) { waiting.delete(promiseId); w(result); }
  });
  NATIVE.call = (method, ...args) => new Promise(resolve => {
    const id = seq++;
    waiting.set(id, resolve);
    J.backend.emitEvent('__juce__invoke', { name: 'nxw', params: [method, ...args], resultId: id });
  });
  J.backend.addEventListener('nxw', ev => { try { NATIVE.onEvent(ev); } catch (e) { console.error(e); } });
  window.addEventListener('error', e => NATIVE.call('log', 'error', (e.message || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0)));
  window.addEventListener('unhandledrejection', e => NATIVE.call('log', 'error', 'promise: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
})();

/* --------------------------- small helpers --------------------------- */
NATIVE.fileName = p => String(p || '').split(/[\\/]/).pop();
NATIVE.bytesToB64 = u8 => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
NATIVE.blobToB64 = blob => new Promise(res => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = () => res('');
  fr.readAsDataURL(blob instanceof Blob ? blob : new Blob([blob]));
});
/** A toast with one action button (stays a little longer). */
NATIVE.toastAction = (msg, label, fn) => {
  for (const o of $$('.toast')) o.remove();
  const b = h('button', { class: 'btn primary', style: { marginLeft: '12px', height: '24px' }, onclick: () => { t.remove(); fn(); } }, label);
  const t = h('div', { class: 'toast', role: 'status', style: { display: 'flex', alignItems: 'center' } }, h('span', null, msg), b);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 7000);
  setTimeout(() => t.remove(), 7600);
};

/* --------------------------- project sync --------------------------- */
NATIVE.projectForEngine = () => Object.assign({}, P, { ui: { pat: S.pat, mode: S.mode, metro: !!S.metro, ch: S.ch } });
/** Sends the project to the engine, at most ~30 times a second. */
NATIVE.push = () => {
  if (!NATIVE.on || !P || NATIVE.pushQueued) return;
  NATIVE.pushQueued = true;
  const wait = Math.max(0, 33 - (performance.now() - NATIVE.lastPush));
  setTimeout(() => {
    NATIVE.pushQueued = false;
    NATIVE.lastPush = performance.now();
    NATIVE.call('setProject', NATIVE.projectForEngine());
  }, wait);
};
NATIVE.pushNow = () => { NATIVE.lastPush = performance.now(); return NATIVE.call('setProject', NATIVE.projectForEngine()); };

/** Plugin states travel separately (they can be large) and never sit in the undo history. */
NATIVE.extractStates = p => {
  const out = {};
  for (const c of p.channels || []) if (c.plugin && c.plugin.state) { out[c.id] = c.plugin.state; delete c.plugin.state; }
  for (const m of p.mixer || []) for (const f of m.fx || []) if (f.plugin && f.plugin.state) { out[f.id] = f.plugin.state; delete f.plugin.state; }
  return out;
};

/* --------------------------- events from the engine --------------------------- */
NATIVE.onEvent = ev => {
  switch (ev.type) {
    case 'tick': NATIVE.onTick(ev); break;
    case 'needSample': NATIVE.sendSample(ev.id); break;
    case 'pluginStatus':
      NATIVE.status[ev.id] = ev.status;
      if (ev.status !== 'loaded') NATIVE.call('log', 'warn', 'plugin ' + ev.id + ': ' + ev.status);
      clearTimeout(NATIVE.statusTimer);
      NATIVE.statusTimer = setTimeout(() => { if (UI.rack) UI.rack._sig = null; if (UI.inst) UI.inst._sig = null; if (UI.mixer) UI.mixer._side = null; renderAll(); }, 120);
      break;
    case 'scan': NATIVE.onScan(ev); break;
    case 'export': if (NATIVE.exportProgress) NATIVE.exportProgress(ev.progress); break;
    case 'update': NATIVE.onUpdate(ev.info); break;
  }
};

NATIVE.onTick = t => {
  NATIVE.tick = t;
  NATIVE.tickAt = performance.now();
  NATIVE.meters = t.meters || [];
  NATIVE.red = t.red || [];
  NATIVE.voices = t.voices || 0;
  if (t.playing !== A.playing && performance.now() - NATIVE.transportAt > 300) {
    A.playing = t.playing;
    if (!A.playing) A.vis = null;
    if (UI.top) UI.top.render();
    if (UI.pl) UI.pl.dirty = true;
    if (UI.pr) UI.pr.dirty = true;
  }
  if (t.playing) A.playMode = t.pat ? 'pat' : 'song';
  const now = performance.now() / 1000;
  for (const id of t.hits || []) A.hits.set(id, now);
  const sc = t.scope || [];
  for (let i = 0; i < sc.length && i * 4 + 3 < NATIVE.scope.length; i++)
    NATIVE.scope[i * 4] = NATIVE.scope[i * 4 + 1] = NATIVE.scope[i * 4 + 2] = NATIVE.scope[i * 4 + 3] = sc[i];
};

/* --------------------------- samples --------------------------- */
NATIVE.sending = new Map();
/** Hands a library sound to the engine (it keeps its own copy after the first time). */
NATIVE.sendSample = id => {
  if (NATIVE.sending.has(id)) return NATIVE.sending.get(id);
  const job = (async () => {
    const blob = await libBlob(id);
    if (!blob) return false;
    const b64 = await NATIVE.blobToB64(blob);
    if (!b64) return false;
    const m = LIB.meta.get(id);
    const r = await NATIVE.call('putSample', id, b64, (m && m.file) || 'sample.wav');
    if (r && !r.ok) toast('The audio engine could not read ' + ((m && m.name) || 'this sound') + ': ' + (r.error || 'unknown format'));
    return !!(r && r.ok);
  })().finally(() => setTimeout(() => NATIVE.sending.delete(id), 1000));
  NATIVE.sending.set(id, job);
  return job;
};
NATIVE.syncSamples = async () => {
  const ids = [...new Set(P.channels.filter(c => c.type === 'sampler' && c.sample).map(c => c.sample))];
  if (!ids.length) return;
  const known = (await NATIVE.call('hasSamples', ids)) || {};
  await Promise.all(ids.filter(id => !known[id]).map(NATIVE.sendSample));
};

/* --------------------------- previews and live notes --------------------------- */
NATIVE.preview = async (ch, key, dur) => {
  const spec = { type: ch.type, params: Object.assign({}, ch.params || {}), sample: ch.sample || null, name: ch.name || '' };
  if (spec.type === 'synth') spec.params = Object.assign({}, SYNTH_DEFAULT, spec.params);
  let r = await NATIVE.call('preview', spec, key, dur);
  if (r && r.missing && spec.sample && await NATIVE.sendSample(spec.sample)) r = await NATIVE.call('preview', spec, key, dur);
};

/* --------------------------- plugins --------------------------- */
NATIVE.loadPlugins = async () => {
  const list = await NATIVE.call('plugins');
  NATIVE.plugins = Array.isArray(list) ? list.sort((a, b) => natCmp(a.name, b.name)) : [];
  NATIVE.pluginsVer++;
  if (UI.br) UI.br.render();
};
NATIVE.scan = async full => {
  NATIVE.scanning = { done: 0, total: 0, current: '' };
  NATIVE.pluginsVer++;
  if (UI.br) { S.brOpen['sec:plugins'] = true; UI.br.render(); }
  hint('Looking for VST3 plugins…');
  await NATIVE.call('scanPlugins', !!full);
};
NATIVE.onScan = ev => {
  NATIVE.scanning = ev.running ? { done: ev.done, total: ev.total, current: ev.current } : null;
  if (ev.running) hint('Scanning plugins ' + ev.done + ' of ' + ev.total + (ev.current ? ' · ' + ev.current : ''));
  else {
    if (Array.isArray(ev.plugins)) NATIVE.plugins = ev.plugins.sort((a, b) => natCmp(a.name, b.name));
    const failed = (ev.failed || []).length;
    toast('Found ' + NATIVE.plugins.length + (NATIVE.plugins.length === 1 ? ' plugin' : ' plugins') + (failed ? '. ' + failed + ' could not be opened and were skipped.' : ''));
    hint(NATIVE.plugins.length ? 'Your plugins are in the browser under Plugin database' : 'No VST3 plugins found. Add a folder under Plugin database › Plugin folders');
  }
  NATIVE.pluginsVer++;
  if (UI.br) UI.br.render();
};
NATIVE.pluginRef = p => ({ id: p.id, name: p.name, vendor: p.vendor || '', format: p.format || 'VST3', instrument: !!p.instrument });
NATIVE.addPluginChannel = id => {
  const p = NATIVE.plugins.find(x => x.id === id);
  if (!p) return null;
  const ch = addChannel({ type: 'plugin', name: p.name, plugin: NATIVE.pluginRef(p) });
  setTimeout(() => NATIVE.openPlugin(ch.id), 500);
  return ch;
};
NATIVE.addPluginFx = (id, insert) => {
  const p = NATIVE.plugins.find(x => x.id === id);
  if (!p) return;
  const i = clamp(insert == null ? (S.mixSel || 1) : insert, 0, NINS), m = P.mixer[i];
  if (m.fx.length >= 8) { toast(m.name + ' already has 8 effects'); return; }
  const f = { id: uid(), type: 'plugin', on: true, p: {}, plugin: NATIVE.pluginRef(p) };
  edit(() => { m.fx.push(f); S.mixSel = i; S.fxSel = m.fx.length - 1; });
  WM.show('mixer');
  toast(p.name + ' added to ' + (i ? 'insert ' + i : 'the master'));
  setTimeout(() => NATIVE.openPlugin(f.id), 500);
};
NATIVE.openPlugin = async ownerId => {
  const ch = chById(ownerId);
  let title = ch ? ch.name : '';
  if (!ch) for (const [i, m] of P.mixer.entries()) { const f = m.fx.find(x => x.id === ownerId); if (f) title = f.plugin.name + ' · ' + (i ? m.name : 'Master'); }
  await NATIVE.pushNow();
  const ok = await NATIVE.call('openPlugin', ownerId, title);
  if (!ok) toast(NATIVE.status[ownerId] && NATIVE.status[ownerId] !== 'loaded' ? NATIVE.status[ownerId] : 'The plugin window could not be opened');
};
NATIVE.foldersDialog = async () => {
  const list = h('div', { class: 'xp-opts' });
  const draw = folders => {
    list.textContent = '';
    if (!folders.length) list.append(h('p', { class: 'xp-sum' }, 'No extra folders yet.'));
    for (const f of folders) list.append(h('div', { class: 'xp-row', style: { justifyContent: 'space-between' } },
      h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '11px', wordBreak: 'break-all' } }, f),
      h('button', { class: 'btn ghost', onclick: async () => { await NATIVE.call('removePluginFolder', f); draw((await NATIVE.call('pluginFolders')) || []); } }, 'Remove')));
  };
  draw((await NATIVE.call('pluginFolders')) || []);
  dialog('Plugin folders', [
    h('p', null, 'NXW Studio always looks in the standard VST3 folder (on Windows, C:\\Program Files\\Common Files\\VST3). Add any other folders where you keep VST3 plugins, then scan.'),
    list,
    h('div', { class: 'xp-row', style: { marginTop: '10px' } },
      h('button', { class: 'btn', onclick: async () => draw((await NATIVE.call('addPluginFolder')) || []) }, 'Add folder…')),
  ], [{ label: 'Close' }, { label: 'Scan now', primary: true, action: () => { NATIVE.scan(false); } }]);
};

/* --------------------------- projects and files --------------------------- */
NATIVE.loadProject = async (p, path) => {
  const states = NATIVE.extractStates(p);
  stop();
  // Unload the current plugins first, so a file that reuses their ids still gets its own saved settings.
  await NATIVE.call('setProject', Object.assign(newProject(), { ui: { pat: null, mode: S.mode, metro: false, ch: null } }));
  await NATIVE.call('stashStates', states);
  Hist.push();
  P = p;
  afterLoad();
  loadProjectSamples();
  NATIVE.projectPath = path || '';
  NATIVE.pushNow();
};
NATIVE.saveProject = async saveAs => {
  await NATIVE.pushNow();
  if (!saveAs && NATIVE.projectPath) {
    const ok = await NATIVE.call('saveProjectTo', NATIVE.projectPath, P);
    toast(ok ? 'Saved ' + NATIVE.fileName(NATIVE.projectPath) : 'Could not save ' + NATIVE.projectPath);
    return;
  }
  const path = await NATIVE.call('saveProject', P, P.name || 'Project');
  if (path) { NATIVE.projectPath = path; toast('Saved ' + NATIVE.fileName(path)); }
};
NATIVE.openProject = async () => {
  const r = await NATIVE.call('openProject');
  if (!r) return;
  let p = null;
  try { p = JSON.parse(r.text); } catch (e) { p = null; }
  if (!p || p.v !== 1 || !Array.isArray(p.channels)) { toast(r.name + ' is not an NXW project file.'); return; }
  await NATIVE.loadProject(p, r.path);
  toast('Opened ' + r.name);
};

/* --------------------------- export --------------------------- */
/** Renders with the native engine. WAV is written natively; MP3 is encoded here. */
NATIVE.exportRun = async (o, pat, setP) => {
  const L = P.playlist.loop;
  let patternMode = false, fromStep = 0, steps = songEnd();
  if (o.range === 'pattern') { patternMode = true; steps = pat.len * o.loops; }
  else if (o.range === 'loop' && L) { fromStep = L.a; steps = L.b - L.a; }
  const base = safeName(P.name) + (o.range === 'pattern' ? ' - ' + safeName(pat.name) : o.range === 'loop' ? ' - loop' : '');
  const path = await NATIVE.call('chooseSavePath', base + (o.fmt === 'mp3' ? '.mp3' : '.wav'));
  if (!path) return null;
  if (o.fmt === 'mp3') { setP(0, 'Loading encoder'); await loadLame(); }
  setP(0, 'Preparing');
  await NATIVE.syncSamples();
  await NATIVE.pushNow();
  const watch = setInterval(() => { if (EXPORT.cancel) NATIVE.call('cancelExport'); }, 150);
  const share = o.fmt === 'mp3' ? 0.6 : 0.98;
  NATIVE.exportProgress = f => setP(f * share, 'Rendering');
  let r;
  try {
    r = await NATIVE.call('exportAudio', { patternMode, fromStep, steps, sr: o.sr, tail: o.tail, normalize: o.normalize, stems: o.stems,
      fmt: o.fmt, path, stemNames: P.mixer.slice(1).map(m => m.name) });
  } finally { clearInterval(watch); NATIVE.exportProgress = null; }
  if (!r || r.cancelled) return 'cancelled';
  if (r.error) throw new Error(r.error);
  if (r.token) {
    const files = [{ idx: 0, path: r.path }].concat((r.stems || []).map((p, i) => ({ idx: i + 1, path: p })));
    for (let k = 0; k < files.length; k++) {
      if (EXPORT.cancel) { NATIVE.call('releaseRender', r.token); return 'cancelled'; }
      const buf = await (await fetch('__render/' + r.token + '/' + files[k].idx)).arrayBuffer();
      const inter = new Float32Array(buf), n = inter.length >> 1, Lc = new Float32Array(n), Rc = new Float32Array(n);
      for (let i = 0; i < n; i++) { Lc[i] = inter[2 * i]; Rc[i] = inter[2 * i + 1]; }
      const f0 = 0.6 + 0.38 * k / files.length;
      const mp3 = await encodeMp3(Lc, Rc, r.sr, o.kbps, f => setP(f0 + f * 0.38 / files.length, k ? 'Encoding stems' : 'Encoding'));
      if (!(await NATIVE.call('writeFile', files[k].path, NATIVE.bytesToB64(mp3)))) throw new Error('Could not write ' + files[k].path);
    }
    NATIVE.call('releaseRender', r.token);
  }
  setP(1, 'Saved');
  NATIVE.toastAction('Exported ' + NATIVE.fileName(r.path), 'Show in folder', () => NATIVE.call('reveal', r.path));
  return true;
};

/* --------------------------- updates --------------------------- */
NATIVE.onUpdate = info => {
  NATIVE.update = info;
  NATIVE.toastAction('NXW Studio ' + info.latest + ' is available', 'Download', () => NATIVE.call('openUrl', info.installer || info.url));
};
NATIVE.checkUpdates = async () => {
  const r = await NATIVE.call('checkUpdate', true);
  if (!r || r.error) { dialog('Updates', h('p', null, (r && r.error) || 'Could not check for updates.')); return; }
  if (r.newer) dialog('Update available', h('p', null, 'NXW Studio ' + r.latest + ' is ready (you have ' + r.current + '). Download the installer and run it; your projects, sounds and settings stay where they are.'),
    [{ label: 'Later' }, { label: 'Download', primary: true, action: () => { NATIVE.call('openUrl', r.installer || r.url); } }]);
  else dialog('Updates', h('p', null, 'You have the latest version (' + r.current + ').'));
};

/* --------------------------- switching engines --------------------------- */
NATIVE.install = () => {
  const ctx = {
    get currentTime() { return performance.now() / 1000; },
    state: 'running', sampleRate: 48000, outputLatency: 0,
    resume() { return Promise.resolve(); },
  };
  A.ctx = ctx;
  A.masterOut = { gain: { setTargetAtTime() { NATIVE.push(); } } };
  A.scopeAn = { fftSize: 1024, getFloatTimeDomainData(buf) { buf.set(NATIVE.scope.subarray(0, Math.min(buf.length, NATIVE.scope.length))); } };
  A.live = { get size() { return NATIVE.voices; }, add() {}, delete() {}, has() { return false; }, [Symbol.iterator]: function* () {} };
  A.strips = [];
  for (let i = 0; i <= NINS; i++) A.strips.push({
    i, input: null,
    get units() { const m = P && P.mixer[i]; return m ? m.fx.map(f => ({ id: f.id, comp: { reduction: NATIVE.red[i] || 0 }, set() { NATIVE.push(); } })) : []; },
    level(c) { const m = NATIVE.meters[i]; return m ? m[c] || 0 : 0; },
    panTo() { NATIVE.push(); }, vol() { NATIVE.push(); }, setFx() { NATIVE.push(); }, sync() {},
  });

  audio = () => ctx;
  syncAudio = () => NATIVE.push();
  syncChannel = () => NATIVE.push();
  syncStrip = () => NATIVE.push();
  onTempoChange = () => NATIVE.push();
  applySolo = () => {};
  warmDrums = () => {};
  const baseTouched = touched;
  touched = () => { baseTouched(); NATIVE.push(); };

  play = () => {
    if (A.playing) return;
    A.playing = true; A.playMode = S.mode;
    NATIVE.transportAt = performance.now();
    NATIVE.push();
    NATIVE.call('play', S.mode === 'pat', A.pos);
    UI.top.render();
  };
  stop = () => {
    NATIVE.transportAt = performance.now();
    if (!A.playing) {
      A.pos = P.playlist.loop ? P.playlist.loop.a : 0;
      NATIVE.call('setPos', A.pos);
      UI.top.render(); UI.pl.dirty = true;
      return;
    }
    A.playing = false; A.vis = null;
    NATIVE.call('stop');
    UI.top.render(); UI.pl.dirty = UI.pr.dirty = true;
  };
  togglePlay = () => {
    if (!A.playing) { play(); return; }
    const v = A.vis;
    stop();
    if (v && A.playMode === 'song') { A.pos = Math.floor(v.s); NATIVE.call('setPos', A.pos); }
  };
  setMode = m => {
    if (S.mode === m) return;
    S.mode = m; scheduleSave();
    A.playMode = m;
    NATIVE.transportAt = performance.now();
    NATIVE.call('setMode', m === 'pat', A.pos);
    NATIVE.push();
    UI.top.render(); UI.pl.dirty = UI.pr.dirty = true;
  };
  setSongPos = s => {
    A.pos = Math.max(0, s);
    NATIVE.call('setPos', A.pos);
    UI.pl.dirty = true; UI.top.render();
  };
  curPos = () => {
    const t = NATIVE.tick;
    if (!A.playing || !t || !t.playing) return null;
    const dt = Math.min(0.25, (performance.now() - NATIVE.tickAt) / 1000);
    let s = t.pos + dt * P.bpm / 15;
    if (t.pat) s = s % Math.max(1, curPat().len);
    else {
      const L = P.playlist.loop;
      if (L) { if (t.pos < L.b && s >= L.b) s = L.a + (s - L.b); }
      else { const e = songEnd(); if (s >= e) s -= e; }
    }
    return { s, mode: t.pat ? 'pat' : 'song' };
  };
  playNote = (ch, t, key, vel, dur, dest) => {
    const wait = Math.max(0, ((t || 0) - ctx.currentTime) * 1000);
    const later = fn => (wait > 5 ? setTimeout(fn, wait) : fn());
    if (ch && ch.id && chById(ch.id) && !dest) {
      const off = () => NATIVE.call('noteOff', ch.id, key);
      later(() => NATIVE.call('noteOn', ch.id, key, vel));
      if (dur != null) { setTimeout(off, wait + Math.max(30, dur * 1000)); return null; }
      let released = false;
      return { release() { if (!released) { released = true; later(off); } } };
    }
    later(() => NATIVE.preview(ch, key, dur != null ? dur : 0.5));
    return null;
  };
  previewChannel = (ch, key = null, dur = 0.35) => { playNote(ch, 0, key == null ? rootKey(ch) : key, 0.8, dur); };
  previewSampleId = id => {
    NATIVE.preview({ type: 'sampler', sample: id, params: { gain: 0.9, oneshot: true, pitch: 0, start: 0 } }, 60, 60);
    ensureSample(id).then(() => { if (UI.br) UI.br.drawWave(); });
  };
  stopPreview = () => { NATIVE.call('stopPreview'); };
  saveFile = async (name, data) => {
    const b64 = data instanceof Blob ? await NATIVE.blobToB64(data) : NATIVE.bytesToB64(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer || data));
    const path = await NATIVE.call('saveFile', name, b64);
    if (path) toast('Saved ' + NATIVE.fileName(path));
    return !!path;
  };
  saveProjectFile = () => NATIVE.saveProject(true);
  // The project itself is autosaved by the app; the browser storage only keeps window and view settings.
  saveNow = () => { try { const { rec, ...rest } = S; localStorage.setItem(UI_KEY, JSON.stringify(rest)); } catch (e) { /* ignore */ } };

  // Any edit (VER) or a change of pattern, mode, metronome or selected channel reaches the engine.
  let seen = '';
  setInterval(() => {
    if (!P) return;
    const k = VER + '|' + S.pat + '|' + S.mode + '|' + !!S.metro + '|' + S.ch;
    if (k !== seen) { seen = k; NATIVE.push(); }
  }, 40);
};

/* Keeps browser shortcuts (reload, print, find, zoom) and the browser's own menus out of the studio. */
NATIVE.guards = () => {
  window.addEventListener('keydown', e => {
    const k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
    const browserKey = k === 'f5' || k === 'f3' || k === 'f7' || k === 'browserback' || k === 'browserforward'
      || (mod && ['r', 'p', 'f', 'g', 'j', 'u', 'h', 'n', 't', 'w', 's', 'o', '+', '-', '=', '0'].includes(k))
      || (e.altKey && (k === 'arrowleft' || k === 'arrowright' || k === 'home'));
    if (browserKey) e.preventDefault();
  }, true);
  window.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false, capture: true });
  window.addEventListener('contextmenu', e => { if (!(e.target.closest && e.target.closest('input, textarea'))) e.preventDefault(); }, true);
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());
};

/** Desktop start-up: load the autosave, switch engines, then boot the interface. */
NATIVE.start = async boot => {
  NATIVE.guards();
  let saved = null;
  try {
    NATIVE.info = await NATIVE.call('hello');
    const raw = await NATIVE.call('loadAutosave');
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.v === 1 && Array.isArray(p.channels) && Array.isArray(p.patterns)) {
        await NATIVE.call('stashStates', NATIVE.extractStates(p));
        saved = p;
      }
    }
  } catch (e) { console.error(e); }
  try { const raw = localStorage.getItem(UI_KEY); if (raw) Object.assign(S, JSON.parse(raw)); } catch (e) { /* ignore */ }
  NATIVE.install();
  boot(saved);
  NATIVE.call('log', 'info', 'interface ready (' + document.characterSet + ', ' + navigator.userAgent + ')');
  NATIVE.pushNow();
  await NATIVE.loadPlugins();
  // The first launch on a computer looks for plugins by itself.
  if (NATIVE.info && !NATIVE.info.pluginsScanned) NATIVE.scan(false);
  const a = await NATIVE.call('audioInfo');
  if (a && a.device && a.device !== 'None') hint('Audio: ' + a.device + ' · ' + Math.round(a.sampleRate / 100) / 10 + ' kHz · ' + a.buffer + ' samples (' + a.latencyMs.toFixed(1) + ' ms)');
  else NATIVE.toastAction('No audio output is open', 'Audio settings', () => NATIVE.call('audioSettings'));
  setTimeout(() => NATIVE.call('checkUpdate', false), 4000);
};

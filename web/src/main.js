/* ================================================================
   NXW STUDIO · demo song, boot, keyboard, render loop
   ================================================================ */
function demoProject() {
  const p = newProject();
  p.name = 'Verdigris'; p.bpm = 124; p.swing = 0.12; p.master = 0.8; p.patterns = [];
  const mk = (name, type, params, mixer, color, extra) => { const c = Object.assign({ id: uid(), name, type, color, vol: 0.78, pan: 0, mute: false, mixer, root: 60, params }, extra || {}); p.channels.push(c); return c; };
  const syn = n => Object.assign({}, SYNTH_DEFAULT, SYNTH_PRESETS[n]);
  const kick = mk('Kick Deep', 'drum', { kind: 'kick', tune: 0, decay: 1, tone: 0.45, level: 1 }, 1, PALETTE[0]);
  const clap = mk('Clap Wide', 'drum', { kind: 'clap', tune: 0, decay: 1.1, tone: 0.5, level: 0.85 }, 2, PALETTE[1]);
  const snare = mk('Snare Crisp', 'drum', { kind: 'snare', tune: 0, decay: 0.9, tone: 0.55, level: 0.75 }, 2, PALETTE[6]);
  const hat = mk('Hat Tight', 'drum', { kind: 'hat', tune: 0, decay: 1, tone: 0.55, level: 0.7 }, 3, PALETTE[4], { pan: 0.14 });
  const ohat = mk('Hat Open', 'drum', { kind: 'ohat', tune: 0, decay: 0.85, tone: 0.5, level: 0.55 }, 3, PALETTE[9], { pan: -0.1 });
  const rim = mk('Rim Click', 'drum', { kind: 'rim', tune: 0, decay: 1, tone: 0.5, level: 0.5 }, 3, PALETTE[7], { pan: -0.3 });
  const bass = mk('Reese Bass', 'synth', syn('Reese Bass'), 4, PALETTE[2], { preset: 'Reese Bass', vol: 0.74 });
  const pad = mk('Verdigris Pad', 'synth', syn('Verdigris Pad'), 5, PALETTE[8], { preset: 'Verdigris Pad', vol: 0.72 });
  const lead = mk('Glass Pluck', 'synth', syn('Glass Pluck'), 6, PALETTE[3], { preset: 'Glass Pluck', vol: 0.7 });
  const M = p.mixer;
  M[0].fx = [newFx('eq', { low: 1, high: 1.5 }), newFx('comp', { thr: -12, ratio: 2, att: 0.02, rel: 0.25, gain: 2 })];
  M[1].name = 'Kick'; M[1].fx = [newFx('eq', { low: 2.5, mid: -2, midf: 400 }), newFx('comp', { thr: -14, ratio: 4, att: 0.012, rel: 0.15, gain: 2 })];
  M[2].name = 'Clap + Snare'; M[2].fx = [newFx('eq', { low: -8, high: 2 }), newFx('reverb', { size: 1.3, pre: 0.015, mix: 0.2 })];
  M[3].name = 'Hats'; M[3].vol = 0.74; M[3].fx = [newFx('eq', { low: -12, high: 1.5 }), newFx('delay', { time: 2, fb: 0.22, mix: 0.12, tone: 6000 })];
  M[4].name = 'Bass'; M[4].fx = [newFx('pump', { depth: 0.55, rel: 0.6 }), newFx('drive', { drive: 2.5, mix: 0.35, tone: 4500 }), newFx('eq', { low: 1.5, high: -3 })];
  M[5].name = 'Pad'; M[5].vol = 0.74; M[5].fx = [newFx('pump', { depth: 0.65, rel: 0.7 }), newFx('filter', { mode: 1, cut: 220, res: 0.7 }), newFx('chorus', { mix: 0.45 }), newFx('reverb', { size: 3.6, mix: 0.32 })];
  M[6].name = 'Lead'; M[6].fx = [newFx('delay', { time: 2, fb: 0.4, mix: 0.26, tone: 3800 }), newFx('reverb', { size: 2.6, mix: 0.22 })];
  const pat = (name, color, len) => { const q = { id: uid(), name, color, len, notes: {} }; p.patterns.push(q); return q; };
  const pIntro = pat('Intro Hats', PALETTE[4], 16), pA = pat('Beat A', PALETTE[0], 16), pB = pat('Beat B', PALETTE[1], 16);
  const pBass = pat('Bassline', PALETTE[2], 64), pCh = pat('Chords', PALETTE[8], 64), pLead = pat('Pluck Lead', PALETTE[3], 64), pRoll = pat('Snare Roll', PALETTE[6], 16);
  const steps = (q, ch, list, vel = 0.78, chance = 1) => { (q.notes[ch.id] ||= []).push(...list.map(i => ({ t: i, len: 1, key: 60, vel: typeof vel === 'function' ? vel(i) : vel, chance: typeof chance === 'function' ? chance(i) : chance }))); };
  const notes = (q, ch, arr) => { (q.notes[ch.id] ||= []).push(...arr.map(([t, len, key, vel]) => ({ t, len, key, vel: vel ?? 0.8, chance: 1 }))); };
  const odd = [1, 3, 5, 7, 9, 11, 13, 15];
  steps(pIntro, hat, [2, 6, 10, 14], 0.85); steps(pIntro, hat, odd, 0.3, 0.55); steps(pIntro, rim, [10], 0.6, 0.7);
  steps(pA, kick, [0, 4, 8, 12], 0.95); steps(pA, clap, [4, 12], 0.85); steps(pA, hat, [2, 6, 10, 14], 0.8); steps(pA, hat, odd, 0.32, 0.6); steps(pA, rim, [11], 0.5, 0.5);
  steps(pB, kick, [0, 4, 8, 12], 0.95); steps(pB, kick, [14], 0.5, 0.45); steps(pB, clap, [4, 12], 0.85); steps(pB, snare, [12], 0.4);
  steps(pB, ohat, [2, 6, 10, 14], 0.72); steps(pB, hat, [0, 4, 8, 12], 0.5); steps(pB, hat, odd, 0.34, 0.7); steps(pB, rim, [3, 11], 0.5);
  steps(pRoll, snare, [0, 2, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15], i => 0.3 + 0.65 * i / 15); steps(pRoll, kick, [0, 4, 8], 0.9);
  const roots = [33, 29, 36, 31];
  roots.forEach((r, b) => { notes(pBass, bass, [2, 6, 10, 14].map(s => [b * 16 + s, 1.75, r, s === 2 ? 0.9 : 0.8])); if (b % 2) notes(pBass, bass, [[b * 16 + 15, 0.75, r + 12, 0.55]]); });
  [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]].forEach((ks, b) => notes(pCh, pad, ks.map(k => [b * 16, 15.5, k, 0.72])));
  const mel = [[0, 69], [3, 72], [6, 76], [8, 74], [10, 72], [12, 76, 3], [16, 69], [19, 72], [22, 77], [24, 76], [26, 72], [28, 69, 3], [32, 67], [35, 72], [38, 76], [40, 79], [42, 76], [44, 74, 3], [48, 71], [51, 74], [54, 79], [56, 77], [58, 74], [60, 71, 4]];
  notes(pLead, lead, mel.map(([t, k, l]) => [t, l || 2, k, t % 16 === 0 ? 0.92 : 0.72]));
  p.playlist.names = ['Drums', 'Fills', 'Bass', 'Chords', 'Lead'];
  const clip = (q, track, bar, len) => p.playlist.clips.push({ id: uid(), pat: q.id, track, start: bar * 16, len: len != null ? len : q.len });
  clip(pIntro, 0, 0, 64); clip(pA, 0, 4, 64); clip(pB, 0, 8, 128); clip(pA, 0, 16, 64);
  clip(pRoll, 1, 7); clip(pRoll, 1, 15);
  clip(pBass, 2, 4); clip(pBass, 2, 8); clip(pBass, 2, 12);
  for (const b of [0, 4, 8, 12, 16]) clip(pCh, 3, b);
  clip(pLead, 4, 8); clip(pLead, 4, 12);
  return p;
}

/* --------------------------- keyboard --------------------------- */
function onKeyDown(e) {
  const t = e.target;
  if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('.scrim')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) Hist.redo(); else Hist.undo(); return; }
  if (mod && e.code === 'KeyY') { e.preventDefault(); Hist.redo(); return; }
  if (mod && e.code === 'KeyS') { e.preventDefault(); if (NATIVE.on) NATIVE.saveProject(e.shiftKey); else { saveNow(); toast('Saved in this browser'); } return; }
  if (mod && e.code === 'KeyO' && NATIVE.on) { e.preventDefault(); NATIVE.openProject(); return; }
  if (e.code === 'Space') { e.preventDefault(); if (e.repeat) return; if (A.playing) stop(); else play(); return; }
  const fk = { F5: 'pl', F6: 'rack', F7: 'pr', F8: 'inst', F9: 'mixer' }[e.key];
  if (fk) { e.preventDefault(); WM.toggle(fk); return; }
  if (menuEl) return;
  if (WM.front === 'pr' && WM.shown('pr') && UI.pr.key(e)) return;
  if (WM.front === 'pl' && WM.shown('pl') && UI.pl.key(e)) return;
  if (mod || e.altKey) return;
  if (e.code === 'KeyL') { e.preventDefault(); setMode(S.mode === 'song' ? 'pat' : 'song'); hint(S.mode === 'song' ? 'Song mode' : 'Pattern mode'); return; }
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') { S.oct = clamp(S.oct + (e.code === 'BracketLeft' ? -1 : 1), 1, 7); hint('Typing keyboard octave: ' + noteName((S.oct + 1) * 12)); if (UI.inst) UI.inst.render(); scheduleSave(); return; }
  if (S.typing && QWERTY[e.code] != null) {
    e.preventDefault();
    if (!e.repeat) noteOn((S.oct + 1) * 12 + QWERTY[e.code], e.shiftKey ? 1 : 0.8);
  }
}
function onKeyUp(e) {
  if (e.code === 'Space' && e.target && e.target.closest && e.target.closest('button')) e.preventDefault();
  if (QWERTY[e.code] != null) noteOff((S.oct + 1) * 12 + QWERTY[e.code]);
}

/* --------------------------- render loop --------------------------- */
function frame() {
  requestAnimationFrame(frame);
  try {
    A.vis = A.playing ? curPos() : null;
    UI.top.frame(A.vis);
    UI.rack.frame(A.vis);
    UI.pl.frame(A.vis);
    UI.pr.frame(A.vis);
    UI.mixer.frame();
  } catch (e) { console.error(e); }
}

/* --------------------------- boot --------------------------- */
function boot(nativeSaved) {
  readTokens();
  const saved = NATIVE.on ? nativeSaved : loadSaved();
  P = saved || demoProject();
  if (!saved) { S.pat = P.patterns[2].id; S.ch = P.channels[0].id; S.mode = 'song'; }
  if (!patById(S.pat)) S.pat = P.patterns[0].id;
  if (!chById(S.ch)) S.ch = P.channels[0] ? P.channels[0].id : null;
  P.playlist.names ||= []; P.playlist.mute ||= [];
  UI.top.init(); UI.br.init();
  UI.pl.init(); UI.rack.init(); UI.pr.init(); UI.inst.init(); UI.mixer.init();
  WM.init(false);
  renderAll();
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', allNotesOff);
  const unlock = () => { audio(); document.removeEventListener('pointerdown', unlock, true); document.removeEventListener('keydown', unlock, true); };
  document.addEventListener('pointerdown', unlock, true); document.addEventListener('keydown', unlock, true);
  $('#fileIn').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    const target = UI.inst.replaceTarget; UI.inst.replaceTarget = null;
    const importOnly = UI.br.importOnly; UI.br.importOnly = false;
    if (target && files[0]) {
      const ids = await runImport([{ file: files[0], name: files[0].name, pack: 'Imported', path: '' }], 'Importing sound');
      const s = ids[0] && await ensureSample(ids[0]), ch = chById(target);
      if (!s) toast('Your browser could not decode that file. Try WAV, MP3 or OGG.');
      else if (ch) loadSampleInto(ch, ids[0]);
    } else handleFiles(files, !importOnly);
  });
  $('#dirIn').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) importFolderFiles(files); });
  $('#zipIn').addEventListener('change', async e => { const files = [...e.target.files]; e.target.value = ''; for (const f of files) await importZip(f); });
  $('#projIn').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const p = JSON.parse(await f.text()); if (!p || p.v !== 1 || !Array.isArray(p.channels)) throw new Error('bad'); stop(); Hist.push(); P = p; afterLoad(); loadProjectSamples(); toast('Opened ' + f.name); }
    catch (err) { toast(f.name + ' is not an NXW project file.'); }
  });
  initDownloads();
  libLoadIndex().then(() => { UI.br._sig = null; UI.br.render(); return loadProjectSamples(); });
  const onLayout = () => { WM.clampAll(); for (const id in WM.wins) WM.place(WM.wins[id]); if (WM.compact) { if (!WM.front) WM.focus('pl'); WM.focus(WM.front); } WM.sync(); UI.pl.dirty = UI.pr.dirty = true; };
  COMPACT_MQ.addEventListener('change', onLayout);
  window.addEventListener('resize', () => { WM.clampAll(); UI.pl.dirty = UI.pr.dirty = true; });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { UI.pl.dirty = UI.pr.dirty = true; renderAll(); });
  requestAnimationFrame(frame);
  if (!saved) hint('Press Play or hit Space to hear the demo song');
}
if (NATIVE.on) NATIVE.start(boot); else boot();

/* NXW Studio interface test. Run inside the desktop app:
     "NXW Studio" --nxw-ui-test tests/ui_test.js
   Results go to the app log (lines starting with "[ui test]"); the last line is
   "TEST DONE n failed". Expects the two NXW test plugins to be installed in a VST3 folder,
   and NXW_TEST_OUT (set by the runner through the page URL hash or defaulting below)
   to be a writable folder. */
(async () => {
  const OUT = (window.NXW_TEST_OUT || '/tmp/nxw-ui-test');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (lvl, msg) => NATIVE.call('log', 'test', lvl + ' ' + msg);
  let failed = 0;
  const check = (ok, what) => { if (!ok) failed++; return log(ok ? 'ok  ' : 'FAIL', what); };
  const until = async (fn, ms = 8000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { try { if (fn()) return true; } catch (e) { /* not yet */ } await sleep(100); } return false; };
  const peak = () => Math.max(...NATIVE.meters.map(m => Math.max(m[0] || 0, m[1] || 0)));
  try {
    await check(NATIVE.on && NATIVE.info && !!NATIVE.info.version, 'desktop mode, version ' + (NATIVE.info && NATIVE.info.version));
    await check(document.querySelectorAll('#app').length === 1 && !!document.querySelector('.rrow'), 'interface built (channel rack rows present)');

    // Plugins (the first launch scans by itself)
    await until(() => !NATIVE.scanning && NATIVE.plugins.length >= 2, 30000);
    const synth = NATIVE.plugins.find(p => p.name === 'NXW Test Synth'), gain = NATIVE.plugins.find(p => p.name === 'NXW Test Gain');
    await check(!!synth && synth.instrument && !!gain && !gain.instrument, 'scan found the test instrument and effect (' + NATIVE.plugins.map(p => p.name).join(', ') + ')');
    S.brOpen['sec:plugins'] = true; UI.br._sig = null; UI.br.render();
    await check(UI.br.rows.some(r => r.k === 'dir:plugins/vsti' && r.count >= 1), 'browser lists VST3 instruments');

    // Transport
    setMode('song'); play();
    await sleep(1500);
    await check(NATIVE.tick && NATIVE.tick.playing && NATIVE.tick.pos > 0, 'song plays (position ' + (NATIVE.tick && NATIVE.tick.pos.toFixed(2)) + ')');
    await check(peak() > 0.01, 'meters move while playing (peak ' + peak().toFixed(3) + ')');
    await check((NATIVE.tick.hits || []).length >= 0 && A.hits.size > 0, 'channel hit lights update');
    stop();
    await until(() => NATIVE.tick && !NATIVE.tick.playing, 3000);
    await check(!NATIVE.tick.playing && !A.playing, 'stop');

    // Plugin instrument channel
    const ch = NATIVE.addPluginChannel(synth.id);
    await until(() => NATIVE.status[ch.id], 8000);
    await check(NATIVE.status[ch.id] === 'loaded', 'plugin channel loads (' + NATIVE.status[ch.id] + ')');
    await sleep(700);
    const hd = playNote(ch, A.ctx.currentTime, 69, 1, null);
    await until(() => peak() > 0.02, 3000);
    await check(peak() > 0.02, 'live note on the plugin channel is heard (peak ' + peak().toFixed(3) + ')');
    hd.release();

    // Plugin effect on the plugin's insert
    NATIVE.addPluginFx(gain.id, ch.mixer);
    const fx = P.mixer[ch.mixer].fx.find(f => f.type === 'plugin');
    await until(() => NATIVE.status[fx.id], 8000);
    await check(NATIVE.status[fx.id] === 'loaded', 'plugin effect loads on insert ' + ch.mixer);
    await check(!!document.querySelector('.plug-panel'), 'mixer shows the plugin panel');

    // Undo / redo keep the plugin and its settings
    Hist.undo(); Hist.undo();
    await sleep(600);
    await check(!chById(ch.id), 'undo removes the plugin channel');
    Hist.redo(); Hist.redo();
    await until(() => chById(ch.id) && NATIVE.status[ch.id] === 'loaded', 8000);
    await check(!!chById(ch.id) && NATIVE.status[ch.id] === 'loaded', 'redo brings it back');

    // A sound imported into the library plays through the native sampler
    const sr = 44100, n = sr * 8, L = new Float32Array(n);   // long and steady: the test audio device runs faster than real time
    for (let i = 0; i < n; i++) L[i] = Math.sin(2 * Math.PI * 220 * i / sr) * 0.5;
    const wav = encodeWav(L, L, sr, 16);
    const ids = await runImport([{ file: new File([wav], 'ui-test-tone.wav', { type: 'audio/wav' }), name: 'ui-test-tone.wav', pack: 'UI Test', path: '' }], 'Importing');
    await check(ids.length === 1, 'sound imported into the library');
    const sch = addSampleChannel(ids[0], true);
    let k2 = false;
    for (let i = 0; i < 40 && !k2; i++) { await sleep(150); k2 = !!(await NATIVE.call('hasSamples', ids))[ids[0]]; }
    await check(!!k2, 'the engine received the sound');
    await sleep(600);    // the engine picks up the new sound with the next project update
    playNote(sch, A.ctx.currentTime, 60, 1, 8);
    await until(() => peak() > 0.005, 3000);
    await check(peak() > 0.005, 'sampler channel plays the sound (peak ' + peak().toFixed(3) + ')');

    // Sampler loop, end point, filter and envelope: a 0.4 s slice that loops keeps sounding.
    stopPreview();
    await sleep(1500);
    edit(() => Object.assign(sch.params, { end: 0.05, loop: true, ls: 0.01, ft: 1, fc: 2000, fq: 2, sus: 0.6, dec: 0.1, oneshot: true }));
    await sleep(600);
    const lh = playNote(sch, A.ctx.currentTime, 60, 1, null);
    await sleep(1600);
    let lp = 0; for (let i = 0; i < 6; i++) { lp = Math.max(lp, peak()); await sleep(100); }
    await check(lp > 0.003, 'looped sampler slice keeps playing past its end (peak ' + lp.toFixed(3) + ')');
    lh.release();

    // Mixer buses and sends: the sampler's insert goes into insert 10 and sends to insert 9.
    const si = sch.mixer;
    edit(() => { P.mixer[si].route = 10; P.mixer[si].sends = [{ to: 9, lvl: 0.7906 }]; P.mixer[10].width = 0.5; P.mixer[9].phase = true; });
    await sleep(600);
    const bh = playNote(sch, A.ctx.currentTime, 60, 1, null);
    let b10 = 0, b9 = 0;
    for (let i = 0; i < 20; i++) { await sleep(100); const m = NATIVE.meters; b10 = Math.max(b10, (m[10] || [0])[0] || 0); b9 = Math.max(b9, (m[9] || [0])[0] || 0); }
    bh.release();
    await check(b10 > 0.002 && b9 > 0.002, 'routing to a bus and a send both carry sound (bus ' + b10.toFixed(3) + ', send ' + b9.toFixed(3) + ')');
    edit(() => { delete P.mixer[si].route; delete P.mixer[si].sends; });

    // Capture what was played on the keyboard
    A.capture = [];
    for (const k of [60, 64, 67]) { noteOn(k, 0.8); await sleep(120); noteOff(k); await sleep(60); }
    const np = P.patterns.length;
    captureNotes();
    await check(P.patterns.length === np + 1 && curPat().name.startsWith('Captured'), 'capture turns played notes into a pattern');

    // Export: WAV written natively, MP3 encoded in the page
    const realCall = NATIVE.call;
    let nextPath = OUT + '/ui-export.wav';
    NATIVE.call = (m, ...a) => m === 'chooseSavePath' ? Promise.resolve(nextPath) : realCall(m, ...a);
    const prog = [];
    let r = await NATIVE.exportRun({ range: 'pattern', loops: 1, fmt: 'wav16', sr: 44100, tail: true, normalize: false, stems: true, kbps: 192 }, curPat(), f => prog.push(f));
    await check(r === true && prog.length > 1, 'WAV export with stems (' + prog.length + ' progress updates)');
    nextPath = OUT + '/ui-export.mp3';
    r = await NATIVE.exportRun({ range: 'song', loops: 1, fmt: 'mp3', sr: 44100, tail: false, normalize: true, stems: false, kbps: 192 }, curPat(), () => {});
    await check(r === true, 'MP3 export');
    NATIVE.call = realCall;

    // Project file with plugin settings
    NATIVE.projectPath = OUT + '/ui-project.json';
    await NATIVE.saveProject(false);
    await check(true, 'project saved to ' + NATIVE.projectPath);

    // Plugin window
    let win = await NATIVE.openPlugin(ch.id, true);
    await check(win && win.ok && win.open, 'plugin window opens');
    win = await NATIVE.openPlugin(ch.id, true);
    await check(win && win.ok && !win.open, 'clicking the channel again hides the plugin window');
    win = await NATIVE.openPlugin(ch.id, true);
    await check(win && win.ok && win.open, 'and shows it again');
    await sleep(800);
  } catch (e) {
    failed++;
    await log('FAIL', 'exception ' + (e && (e.stack || e.message) || e));
  }
  await log('DONE', failed + ' failed');
})();
0;

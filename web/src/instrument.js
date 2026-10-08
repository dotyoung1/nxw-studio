/* ================================================================
   NXW STUDIO · instrument editor
   ================================================================ */
const QWERTY = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28 };
const QWERTY_LABEL = {}; for (const [code, off] of Object.entries(QWERTY)) if (!(off in QWERTY_LABEL) || code.startsWith('Key')) QWERTY_LABEL[off] = code.replace('Key', '').replace('Digit', '').replace('Comma', ',');

UI.inst = {
  keyEls: new Map(),
  init() {
    const w = this.w = WM.create(WIN_DEFS[3]);
    this.win = 'inst';
    w.onShow = () => this.render();
    w.onResize = () => { if (this.envCv) this.drawEnv(); if (this.waveCv) this.drawWave(); };
    this.body = h('div', { class: 'inst' });
    w.body.append(this.body);
  },
  knobFor(ch, d, opts = {}) {
    return h('div', { class: 'kcell' }, Knob({ def: d, value: ch.params[d.k] ?? d.def, size: opts.size || 38, label: true, showVal: true, name: ch.name + ' ' + d.label.toLowerCase(),
      onStart: () => Hist.push(),
      onChange: v => { ch.params[d.k] = v; if (ch.type === 'synth' && ch.preset) { ch.preset = null; if (this.presetSel) this.presetSel.value = ''; } if (opts.after) opts.after(v); },
      onEnd: () => { touched(); } }));
  },
  render() {
    const sc = selCh();
    if (!sigChanged(this, [sc, P.mixer.map(m => m.name), S.oct, S.typing, sc && sc.sample ? A.samples.has(sc.sample) : 0, sc ? NATIVE.status[sc.id] || '' : ''])) return;
    const B = this.body; B.textContent = ''; this.keyEls.clear(); this.envCv = null; this.waveCv = null; this.presetSel = null;
    const ch = selCh();
    if (!ch) { this.w.sub.textContent = ''; B.append(h('p', { class: 'br-note' }, 'No channel selected. Add one from the channel rack.')); return; }
    this.w.sub.textContent = '· ' + ch.name;
    // header
    const sw = h('button', { class: 'sw', style: { background: ch.color, width: '16px', height: '16px', border: '0', padding: '0' }, 'aria-label': 'Channel colour', 'data-hint': 'Channel colour' });
    sw.onclick = () => menuAt(sw, [{ head: 'Colour' }, ...PALETTE.map(c => ({ label: c === ch.color ? 'Current' : '', swatch: c, action: () => edit(() => { ch.color = c; }) }))]);
    const nm = h('button', { class: 'inst-name', 'data-hint': 'Click to rename' }, ch.name);
    nm.onclick = () => askText(nm, ch.name, v => edit(() => { ch.name = v; }));
    const route = h('select', { class: 'sel-box', id: 'instRoute', 'aria-label': 'Mixer insert', 'data-hint': 'Mixer insert this channel plays through' }, P.mixer.map((m, i) => h('option', { value: i }, i ? i + ' · ' + m.name : 'Master')));
    route.value = String(ch.mixer | 0);
    route.onchange = () => edit(() => { ch.mixer = +route.value; });
    const aud = h('button', { class: 'btn', 'data-hint': 'Play a note', html: icon('play', 12) + '<span>Audition</span>', onclick: () => previewChannel(ch, null, 0.6) });
    B.append(h('div', { class: 'inst-head' }, sw, nm, h('span', { class: 'badge' }, ch.type === 'drum' ? 'Drum synth' : ch.type === 'synth' ? 'NX-3 synth' : ch.type === 'plugin' ? 'VST3 instrument' : 'Sampler'), h('span', { style: { flex: '1' } }), aud));
    // channel strip
    const chPanel = h('div', { class: 'panel' }, h('h5', null, 'Channel'));
    const kr = h('div', { class: 'krow' });
    kr.append(
      h('div', { class: 'kcell' }, Knob({ def: { label: 'Volume', min: 0, max: 1, def: 0.78, unit: 'vol' }, value: ch.vol, size: 38, label: true, showVal: true, name: ch.name + ' volume', onStart: () => Hist.push(), onChange: v => { ch.vol = v; syncChannel(ch); }, onEnd: () => { touched(); if (UI.rack) UI.rack.render(); } })),
      h('div', { class: 'kcell' }, Knob({ def: { label: 'Pan', min: -1, max: 1, def: 0, unit: 'pan', bipolar: true }, value: ch.pan, size: 38, label: true, showVal: true, name: ch.name + ' pan', onStart: () => Hist.push(), onChange: v => { ch.pan = v; syncChannel(ch); }, onEnd: () => { touched(); if (UI.rack) UI.rack.render(); } })),
      h('div', { class: 'kcell' }, Knob({ def: { label: 'Swing', min: 0, max: 1, def: 1, unit: '%' }, value: ch.swing ?? 1, size: 38, label: true, showVal: true, name: ch.name + ' swing amount', onStart: () => Hist.push(), onChange: v => { if (v > 0.995) delete ch.swing; else ch.swing = r2(v); }, onEnd: touched })),
      h('div', { class: 'kcell', style: { alignSelf: 'center', gap: '6px' } }, h('span', { class: 'lbl', style: { fontSize: '8.5px', letterSpacing: '.16em', color: 'var(--text-faint)' } }, 'MIXER'), route));
    const grp = h('select', { class: 'sel-box', id: 'instChoke', 'aria-label': 'Choke group', 'data-hint': 'Channels in the same choke group stop each other' }, [0, 1, 2, 3, 4].map(g => h('option', { value: g }, g ? 'Choke group ' + g : 'No choke group')));
    grp.value = String(ch.cutGroup || 0); grp.onchange = () => edit(() => { ch.cutGroup = +grp.value; });
    const cutRow = h('div', { class: 'krow', style: { alignItems: 'center', marginTop: '12px', gap: '8px' } },
      h('button', { class: 'btn' + (ch.cut ? ' on' : ''), 'aria-pressed': String(!!ch.cut), 'data-hint': 'Cut itself · each new note stops the previous one on this channel', html: icon('scissors', 13) + '<span>Cut itself</span>', onclick: () => edit(() => { ch.cut = !ch.cut; }) }), grp);
    chPanel.append(kr, cutRow); B.append(chPanel);
    if (ch.type === 'drum') this.drumUI(ch, B);
    else if (ch.type === 'synth') this.synthUI(ch, B);
    else if (ch.type === 'plugin') B.append(h('div', { class: 'panel' }, h('h5', null, (ch.plugin && ch.plugin.name) || 'Plugin'), pluginPanel(ch.id, ch.plugin)));
    else this.samplerUI(ch, B);
    this.keysUI(ch, B);
  },
  drumUI(ch, B) {
    const p = ch.params;
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Drum model', style: { flexWrap: 'wrap' } }, DRUM_KINDS.map(k => h('button', { class: p.kind === k ? 'on' : '', onclick: () => { edit(() => { p.kind = k; }); setTimeout(() => previewChannel(chById(ch.id) || ch), 30); } }, DRUM_KIND_LABEL[k])));
    const kr = h('div', { class: 'krow' }, DRUM_PARAMS.map(d => this.knobFor(ch, d)));
    B.append(h('div', { class: 'panel' }, h('h5', null, 'Drum model'), seg), h('div', { class: 'panel' }, h('h5', null, 'Shape'), kr));
  },
  synthUI(ch, B) {
    const p = ch.params;
    this.presetSel = h('select', { class: 'sel-box', id: 'instPreset', 'aria-label': 'Preset', 'data-hint': 'Load a preset' }, h('option', { value: '' }, 'Custom'), Object.keys(SYNTH_PRESETS).map(n => h('option', { value: n }, n)));
    this.presetSel.value = ch.preset || '';
    this.presetSel.onchange = () => { const n = this.presetSel.value; if (!n) return; edit(() => { Object.assign(ch.params, SYNTH_DEFAULT, SYNTH_PRESETS[n]); ch.preset = n; }); setTimeout(() => previewChannel(chById(ch.id) || ch, null, 0.5), 30); };
    const waveSeg = key => h('div', { class: 'seg', role: 'group', 'aria-label': key === 'w1' ? 'Oscillator 1 wave' : 'Oscillator 2 wave' }, WAVES.map(wv => h('button', { class: p[key] === wv ? 'on' : '', 'aria-label': wv, 'data-hint': wv, html: icon(WAVE_ICON[wv], 15), onclick: () => edit(() => { p[key] = wv; ch.preset = null; }) })));
    const grp = g => SYNTH_PARAMS.filter(d => d.grp === g);
    const stepPreset = d => { const names = Object.keys(SYNTH_PRESETS); const i = names.indexOf(ch.preset); this.presetSel.value = names[(i + d + names.length) % names.length]; this.presetSel.onchange(); };
    B.append(h('div', { class: 'panel' }, h('h5', null, 'Preset'), h('div', { class: 'krow', style: { alignItems: 'center', gap: '6px' } },
      h('button', { class: 'btn ghost', 'aria-label': 'Previous preset', 'data-hint': 'Previous preset', html: icon('left', 13), onclick: () => stepPreset(-1) }), this.presetSel,
      h('button', { class: 'btn ghost', 'aria-label': 'Next preset', 'data-hint': 'Next preset', html: icon('right', 13), onclick: () => stepPreset(1) }))));
    B.append(h('div', { class: 'panel' }, h('h5', null, 'Oscillators'),
      h('div', { class: 'krow', style: { marginBottom: '12px' } }, h('div', { class: 'kcell' }, waveSeg('w1'), h('span', { class: 'k-lab' }, 'Osc 1')), h('div', { class: 'kcell' }, waveSeg('w2'), h('span', { class: 'k-lab' }, 'Osc 2'))),
      h('div', { class: 'krow' }, grp('osc').map(d => this.knobFor(ch, d)))));
    B.append(h('div', { class: 'panel' }, h('h5', null, 'Filter'), h('div', { class: 'krow' }, grp('flt').map(d => this.knobFor(ch, d)))));
    this.envCv = h('canvas', { class: 'env-cv', 'aria-label': 'Amp envelope shape' });
    this.envCh = ch;
    B.append(h('div', { class: 'panel' }, h('h5', null, 'Amp envelope'), this.envCv, h('div', { class: 'krow' }, grp('amp').map(d => this.knobFor(ch, d, { after: () => this.drawEnv() })))));
    requestAnimationFrame(() => this.drawEnv());
  },
  drawEnv() {
    const cv = this.envCv, ch = this.envCh; if (!cv || !ch || !cv.clientWidth) return;
    const W = cv.clientWidth, H = cv.clientHeight, ctx = fitCanvas(cv, W, H), p = Object.assign({}, SYNTH_DEFAULT, ch.params);
    ctx.clearRect(0, 0, W, H);
    const hold = 0.6, T = p.att + p.dec + hold + p.rel, sx = (W - 16) / T, top = 8, bot = H - 8, yv = v => bot - v * (bot - top);
    ctx.strokeStyle = '#1f262c'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, top + i * (bot - top) / 4); ctx.lineTo(W, top + i * (bot - top) / 4); ctx.stroke(); }
    let x = 8;
    ctx.beginPath(); ctx.moveTo(x, bot);
    x += p.att * sx; ctx.lineTo(x, yv(1));
    const xd = x + p.dec * sx;
    for (let i = 1; i <= 20; i++) { const f = i / 20; ctx.lineTo(x + (xd - x) * f, yv(p.sus + (1 - p.sus) * Math.exp(-f * 3))); }
    x = xd + hold * sx; ctx.lineTo(x, yv(p.sus));
    const xr = x + p.rel * sx;
    for (let i = 1; i <= 20; i++) { const f = i / 20; ctx.lineTo(x + (xr - x) * f, yv(p.sus * Math.exp(-f * 4))); }
    ctx.lineTo(xr, bot);
    ctx.fillStyle = hexA(CSSV.verdigris, 0.12); ctx.fill('nonzero');
    ctx.strokeStyle = CSSV.verdigris; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = CSSV['text-faint']; ctx.font = '600 8px ' + FONT_MONO;
    ctx.fillText('A', 8 + p.att * sx / 2 - 2, H - 1); ctx.fillText('D', 8 + (p.att + p.dec / 2) * sx - 2, H - 1); ctx.fillText('S', 8 + (p.att + p.dec + hold / 2) * sx - 2, H - 1); ctx.fillText('R', 8 + (p.att + p.dec + hold + p.rel / 2) * sx - 2, H - 1);
  },
  samplerUI(ch, B) {
    const s = A.samples.get(ch.sample), p = ch.params;
    this.waveCv = h('canvas', { class: 'wave-cv', 'aria-label': 'Sample waveform' }); this.waveCh = ch;
    const repl = h('button', { class: 'btn', html: icon('file', 13) + '<span>' + (s ? 'Replace from file…' : 'Load from file…') + '</span>', onclick: () => { UI.inst.replaceTarget = ch.id; $('#fileIn').click(); } });
    const fromLib = h('button', { class: 'btn', 'data-hint': 'Open your packs in the browser; drag a sound onto this channel or use Load', html: icon('browser', 13) + '<span>Packs</span>', onclick: () => { const b = $('#browser'); if (b.hidden || (WM.compact && !b.classList.contains('open'))) toggleBrowser(); S.brOpen['sec:packs'] = true; scheduleSave(); UI.br.render(); } });
    const loading = !s && ch.sample && LIB.meta.has(ch.sample) && !LIB.missing.has(ch.sample);
    if (loading) ensureSample(ch.sample).then(() => { this._sig = null; this.render(); });
    const tog = (k, label, hn) => h('button', { class: 'btn' + (p[k] ? ' on' : ''), 'aria-pressed': String(!!p[k]), 'data-hint': hn, onclick: () => edit(() => { p[k] = !p[k]; }) }, label);
    B.append(h('div', { class: 'panel' }, h('h5', null, s ? s.name + ' · ' + s.dur.toFixed(2) + ' s' : loading ? 'Loading sound…' : 'No sound loaded'),
      s ? this.waveCv : h('p', { class: 'br-note', style: { padding: '0 0 10px' } }, loading ? 'Reading it from your library.' : 'Drag a sound from your packs onto this channel, or load a file.'),
      s ? h('p', { class: 'br-note', style: { padding: '0 0 8px' } }, 'Drag the markers: start (copper), end (white)' + (p.loop ? ' and loop start (green)' : '') + '.') : null,
      h('div', { class: 'krow', style: { alignItems: 'center', flexWrap: 'wrap', gap: '6px' } }, repl, fromLib, tog('rev', 'Reverse', 'Play the sample backwards'), tog('oneshot', 'One-shot', 'On: play the whole sample. Off: stop when the note ends.'),
        tog('loop', 'Loop', 'Loop between the loop start and the end marker while the note is held'), tog('norm', 'Normalize', 'Play the sample as loud as it can go without clipping'))));
    const after = { after: () => this.drawWave() };
    B.append(h('div', { class: 'panel' }, h('h5', null, 'Playback'), h('div', { class: 'krow' }, SAMPLER_PARAMS.map(d => this.knobFor(ch, d, after)), p.loop ? this.knobFor(ch, SAMPLER_LOOP, after) : null)));
    B.append(h('div', { class: 'panel' }, h('h5', null, 'Envelope'), h('div', { class: 'krow' }, SAMPLER_ENV.map(d => this.knobFor(ch, d)))));
    const ft = p.ft | 0;
    const fseg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter type' }, SAMPLER_FILTER_TYPES.map((l, i) => h('button', { class: ft === i ? 'on' : '', onclick: () => edit(() => { if (i) p.ft = i; else delete p.ft; }) }, l)));
    B.append(h('div', { class: 'panel' }, h('h5', null, 'Filter'), h('div', { class: 'krow', style: { alignItems: 'center' } }, fseg, ...(ft ? SAMPLER_FILTER.map(d => this.knobFor(ch, d)) : []))));
    if (s) requestAnimationFrame(() => this.drawWave());
    if (s) this.waveCv.addEventListener('pointerdown', e => this.waveDown(e, ch));
  },
  /* Start, end and loop-start markers can be dragged on the waveform. */
  waveDown(e, ch) {
    const cv = this.waveCv, r = cv.getBoundingClientRect(), W = r.width, p = ch.params;
    const sp = samplerSpan(p), x = e.clientX - r.left;
    const marks = [['start', sp.st], ['end', sp.en]].concat(p.loop ? [['ls', sp.ls]] : []);
    let best = null, bd = 1e9;
    for (const [k, v] of marks) { const d = Math.abs(v * W - x); if (d < bd) { bd = d; best = k; } }
    if (bd > 14) best = x / W < sp.st + (sp.en - sp.st) / 2 ? 'start' : 'end';
    e.preventDefault(); cv.setPointerCapture(e.pointerId); Hist.push();
    const lim = { start: [0, 0.95], end: [0.05, 1], ls: [0, 0.95] }[best];
    const mv = ev => { const v = r2(clamp((ev.clientX - r.left) / W, lim[0], lim[1]) * 1000) / 1000; p[best] = Math.round(v * 1000) / 1000; this.drawWave(); hint({ start: 'Start', end: 'End', ls: 'Loop start' }[best] + ' ' + Math.round(v * 100) + '%'); };
    mv(e);
    const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); this._sig = null; touched(); this.render(); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  },
  drawWave() {
    const cv = this.waveCv, ch = this.waveCh; if (!cv || !ch || !cv.clientWidth) return;
    const s = A.samples.get(ch.sample); if (!s) return;
    const W = cv.clientWidth, H = cv.clientHeight, ctx = fitCanvas(cv, W, H), N = s.peaks.length / 2, rev = ch.params.rev;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = hexA(ch.color, 0.9);
    for (let x = 0; x < W; x++) {
      let i = Math.floor(x / W * N); if (rev) i = N - 1 - i;
      const mn = s.peaks[i * 2], mx = s.peaks[i * 2 + 1];
      ctx.fillRect(x, H / 2 - mx * (H / 2 - 4), 1, Math.max(1, (mx - mn) * (H / 2 - 4)));
    }
    const sp = samplerSpan(ch.params), st = sp.st * W, en = sp.en * W;
    ctx.fillStyle = 'rgba(9,12,14,0.6)'; ctx.fillRect(0, 0, st, H); ctx.fillRect(en, 0, W - en, H);
    if (ch.params.loop) { const lx = sp.ls * W; ctx.fillStyle = hexA(CSSV.verdigris, 0.12); ctx.fillRect(lx, 0, en - lx, H); ctx.fillStyle = CSSV.verdigris; ctx.fillRect(lx, 0, 1.5, H); ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx + 7, 0); ctx.lineTo(lx, 7); ctx.fill(); }
    ctx.fillStyle = CSSV.text; ctx.fillRect(en - 1.5, 0, 1.5, H); ctx.beginPath(); ctx.moveTo(en, H); ctx.lineTo(en - 7, H); ctx.lineTo(en, H - 7); ctx.fill();
    ctx.fillStyle = CSSV.copper; ctx.fillRect(st, 0, 1.5, H); ctx.beginPath(); ctx.moveTo(st, 0); ctx.lineTo(st + 7, 0); ctx.lineTo(st, 7); ctx.fill();
  },
  keysUI(ch, B) {
    const lo = (S.oct + 1) * 12, hi = lo + 24;
    const bar = h('div', { class: 'kb-bar' },
      h('span', { class: 'lbl' }, 'Keyboard'),
      h('button', { class: 'btn ghost', 'aria-label': 'Octave down', 'data-hint': 'Octave down ( [ )', html: icon('left', 13), onclick: () => { S.oct = clamp(S.oct - 1, 1, 7); this.render(); } }),
      h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', whiteSpace: 'nowrap' } }, noteName(lo) + '–' + noteName(hi)),
      h('button', { class: 'btn ghost', 'aria-label': 'Octave up', 'data-hint': 'Octave up ( ] )', html: icon('right', 13), onclick: () => { S.oct = clamp(S.oct + 1, 1, 7); this.render(); } }),
      h('span', { class: 'br-note', style: { padding: '0', marginLeft: 'auto' } }, S.typing ? 'Your computer keyboard plays too' : 'Typing keyboard is off'));
    const keys = h('div', { class: 'pkeys', role: 'group', 'aria-label': 'On-screen keyboard' });
    const whites = []; for (let k = lo; k <= hi; k++) if (!isBlack(k)) whites.push(k);
    const ww = 100 / whites.length;
    for (const k of whites) { const el = h('div', { class: 'wk', dataset: { k } }, QWERTY_LABEL[k - lo] != null ? h('small', null, QWERTY_LABEL[k - lo]) : (k % 12 === 0 ? h('small', null, noteName(k)) : null)); keys.append(el); this.keyEls.set(k, el); }
    for (let k = lo; k <= hi; k++) if (isBlack(k)) {
      const wi = whites.indexOf(k - 1);
      const el = h('div', { class: 'bk', dataset: { k }, style: { left: ((wi + 1) * ww - ww * 0.32) + '%', width: (ww * 0.64) + '%' } }, QWERTY_LABEL[k - lo] != null ? h('small', null, QWERTY_LABEL[k - lo]) : null);
      keys.append(el); this.keyEls.set(k, el);
    }
    let down = null;
    const keyAt = ev => { const el = document.elementFromPoint(ev.clientX, ev.clientY); const kk = el && el.closest && el.closest('[data-k]'); return kk && keys.contains(kk) ? +kk.dataset.k : null; };
    keys.addEventListener('pointerdown', e => {
      const k = keyAt(e); if (k == null) return;
      e.preventDefault(); keys.setPointerCapture(e.pointerId); down = k; noteOn(k, 0.8);
      const mv = ev => { const k2 = keyAt(ev); if (k2 != null && k2 !== down) { noteOff(down); down = k2; noteOn(k2, 0.8); } };
      const up = () => { keys.removeEventListener('pointermove', mv); keys.removeEventListener('pointerup', up); keys.removeEventListener('pointercancel', up); if (down != null) noteOff(down); down = null; };
      keys.addEventListener('pointermove', mv); keys.addEventListener('pointerup', up); keys.addEventListener('pointercancel', up);
    });
    B.append(h('div', { class: 'panel', style: { paddingBottom: '10px' } }, bar, h('div', { style: { height: '8px' } }), keys));
  },
  keyState(k, on) { const el = this.keyEls.get(k); if (el) el.classList.toggle('dn', on); },
};

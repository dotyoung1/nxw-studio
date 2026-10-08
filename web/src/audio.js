/* ================================================================
   NXW STUDIO · audio engine (Web Audio)
   ================================================================ */
const A = {
  ctx: null, noise: null, curve: null, strips: [], ch: new Map(), live: new Set(), held: new Map(),
  chv: new Map(), playing: false, pos: 0, step: 0, nextTime: 0, timer: 0, queue: [], cur: null, vis: null, hits: new Map(),
  masterOut: null, scopeAn: null, samples: new Map(), playMode: 'song',
};

/* --------------------------- instruments: definitions --------------------------- */
const DRUM_KINDS = ['kick', '808', 'snare', 'clap', 'hat', 'ohat', 'rim', 'tom', 'bell', 'shaker', 'crash'];
const DRUM_KIND_LABEL = { kick: 'Kick', '808': '808', snare: 'Snare', clap: 'Clap', hat: 'Hat', ohat: 'Open hat', rim: 'Rim', tom: 'Tom', bell: 'Bell', shaker: 'Shaker', crash: 'Crash' };
const DRUMS = [
  { name: 'Kick Deep', kind: 'kick', tune: 0, decay: 1, tone: 0.45 },
  { name: 'Kick Punch', kind: 'kick', tune: 2, decay: 0.6, tone: 0.85 },
  { name: '808 Boom', kind: '808', tune: 0, decay: 1, tone: 0.35 },
  { name: 'Snare Crisp', kind: 'snare', tune: 0, decay: 1, tone: 0.55 },
  { name: 'Clap Wide', kind: 'clap', tune: 0, decay: 1, tone: 0.5 },
  { name: 'Hat Tight', kind: 'hat', tune: 0, decay: 1, tone: 0.5 },
  { name: 'Hat Open', kind: 'ohat', tune: 0, decay: 1, tone: 0.5 },
  { name: 'Rim Click', kind: 'rim', tune: 0, decay: 1, tone: 0.5 },
  { name: 'Tom Low', kind: 'tom', tune: -3, decay: 1, tone: 0.5 },
  { name: 'Cowbell', kind: 'bell', tune: 0, decay: 1, tone: 0.5 },
  { name: 'Shaker', kind: 'shaker', tune: 0, decay: 1, tone: 0.5 },
  { name: 'Crash Wash', kind: 'crash', tune: 0, decay: 1, tone: 0.5 },
];
const DRUM_PARAMS = [
  { k: 'tune', label: 'Tune', min: -24, max: 24, def: 0, step: 1, unit: 'st', bipolar: true },
  { k: 'decay', label: 'Decay', min: 0.2, max: 3, def: 1, unit: 'x', log: true },
  { k: 'tone', label: 'Tone', min: 0, max: 1, def: 0.5, unit: '%' },
  { k: 'level', label: 'Level', min: 0, max: 1.5, def: 1, unit: '%' },
];
const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];
const WAVE_ICON = { sine: 'wsine', triangle: 'wtri', sawtooth: 'wsaw', square: 'wsq' };
const SYNTH_PARAMS = [
  { k: 'semi2', label: 'Osc 2 pitch', min: -24, max: 24, def: 0, step: 1, unit: 'st', bipolar: true, grp: 'osc' },
  { k: 'det', label: 'Detune', min: 0, max: 50, def: 7, unit: 'ct', grp: 'osc' },
  { k: 'mix', label: 'Osc mix', min: 0, max: 1, def: 0.5, unit: '%', grp: 'osc' },
  { k: 'sub', label: 'Sub', min: 0, max: 1, def: 0, unit: '%', grp: 'osc' },
  { k: 'uni', label: 'Unison', min: 1, max: 7, def: 1, step: 1, unit: 'v', grp: 'osc' },
  { k: 'spread', label: 'Spread', min: 0, max: 60, def: 18, unit: 'ct', grp: 'osc' },
  { k: 'cut', label: 'Cutoff', min: 40, max: 18000, def: 3000, log: true, unit: 'Hz', grp: 'flt' },
  { k: 'res', label: 'Resonance', min: 0.3, max: 20, def: 1, log: true, unit: 'q', grp: 'flt' },
  { k: 'env', label: 'Env amount', min: -1, max: 1, def: 0.3, bipolar: true, unit: '±%', grp: 'flt' },
  { k: 'fatt', label: 'Env attack', min: 0.001, max: 2, def: 0.005, log: true, unit: 's', grp: 'flt' },
  { k: 'fdec', label: 'Env decay', min: 0.01, max: 4, def: 0.4, log: true, unit: 's', grp: 'flt' },
  { k: 'att', label: 'Attack', min: 0.001, max: 4, def: 0.004, log: true, unit: 's', grp: 'amp' },
  { k: 'dec', label: 'Decay', min: 0.01, max: 4, def: 0.3, log: true, unit: 's', grp: 'amp' },
  { k: 'sus', label: 'Sustain', min: 0, max: 1, def: 0.7, unit: '%', grp: 'amp' },
  { k: 'rel', label: 'Release', min: 0.01, max: 6, def: 0.25, log: true, unit: 's', grp: 'amp' },
  { k: 'gain', label: 'Level', min: 0, max: 1, def: 0.6, unit: '%', grp: 'amp' },
];
const SYNTH_DEFAULT = { w1: 'sawtooth', w2: 'square' };
for (const d of SYNTH_PARAMS) SYNTH_DEFAULT[d.k] = d.def;
const SYNTH_PRESETS = {
  'Saw Lead': { w1: 'sawtooth', w2: 'square', semi2: 0, det: 9, mix: 0.4, sub: 0, uni: 3, spread: 14, cut: 2600, res: 2.5, env: 0.45, fatt: 0.003, fdec: 0.35, att: 0.004, dec: 0.3, sus: 0.75, rel: 0.22, gain: 0.5 },
  'Reese Bass': { w1: 'sawtooth', w2: 'sawtooth', semi2: 0, det: 18, mix: 0.5, sub: 0.55, uni: 1, spread: 0, cut: 620, res: 1.8, env: 0.4, fatt: 0.004, fdec: 0.22, att: 0.003, dec: 0.4, sus: 0.85, rel: 0.1, gain: 0.62 },
  'Verdigris Pad': { w1: 'sawtooth', w2: 'sawtooth', semi2: 12, det: 6, mix: 0.3, sub: 0, uni: 5, spread: 24, cut: 2200, res: 0.9, env: 0.2, fatt: 0.6, fdec: 1.6, att: 0.32, dec: 1.2, sus: 0.8, rel: 1.3, gain: 0.4 },
  'Glass Pluck': { w1: 'square', w2: 'triangle', semi2: 12, det: 4, mix: 0.45, sub: 0, uni: 2, spread: 10, cut: 850, res: 4, env: 0.75, fatt: 0.001, fdec: 0.18, att: 0.002, dec: 0.35, sus: 0, rel: 0.3, gain: 0.55 },
  'Acid Line': { w1: 'sawtooth', w2: 'square', semi2: 0, det: 0, mix: 0, sub: 0, uni: 1, spread: 0, cut: 420, res: 13, env: 0.7, fatt: 0.002, fdec: 0.22, att: 0.002, dec: 0.25, sus: 0.6, rel: 0.08, gain: 0.45 },
  'Soft Keys': { w1: 'triangle', w2: 'sine', semi2: 12, det: 3, mix: 0.35, sub: 0, uni: 1, spread: 0, cut: 3500, res: 0.7, env: 0.25, fatt: 0.002, fdec: 0.6, att: 0.004, dec: 1.1, sus: 0.25, rel: 0.5, gain: 0.6 },
  'Sub Bass': { w1: 'sine', w2: 'triangle', semi2: 0, det: 0, mix: 0.15, sub: 0, uni: 1, spread: 0, cut: 900, res: 0.7, env: 0, fatt: 0.005, fdec: 0.4, att: 0.004, dec: 0.2, sus: 1, rel: 0.1, gain: 0.75 },
  'Hollow Bell': { w1: 'sine', w2: 'square', semi2: 19, det: 0, mix: 0.22, sub: 0, uni: 1, spread: 0, cut: 5200, res: 1, env: 0.2, fatt: 0.002, fdec: 0.5, att: 0.002, dec: 1.4, sus: 0, rel: 1.2, gain: 0.5 },
  'Brass Stab': { w1: 'sawtooth', w2: 'sawtooth', semi2: 0, det: 12, mix: 0.5, sub: 0, uni: 3, spread: 12, cut: 700, res: 1.2, env: 0.6, fatt: 0.06, fdec: 0.3, att: 0.03, dec: 0.4, sus: 0.6, rel: 0.2, gain: 0.5 },
};
const SAMPLER_PARAMS = [
  { k: 'pitch', label: 'Pitch', min: -24, max: 24, def: 0, step: 1, unit: 'st', bipolar: true },
  { k: 'start', label: 'Start', min: 0, max: 0.95, def: 0, unit: '%' },
  { k: 'end', label: 'End', min: 0.05, max: 1, def: 1, unit: '%' },
  { k: 'gain', label: 'Level', min: 0, max: 1.5, def: 0.8, unit: '%' },
];
const SAMPLER_ENV = [
  { k: 'att', label: 'Attack', min: 0.001, max: 2, def: 0.002, log: true, unit: 's' },
  { k: 'dec', label: 'Decay', min: 0.01, max: 4, def: 0.3, log: true, unit: 's' },
  { k: 'sus', label: 'Sustain', min: 0, max: 1, def: 1, unit: '%' },
  { k: 'rel', label: 'Release', min: 0.01, max: 4, def: 0.12, log: true, unit: 's' },
];
const SAMPLER_LOOP = { k: 'ls', label: 'Loop start', min: 0, max: 0.95, def: 0, unit: '%' };
const SAMPLER_FILTER = [
  { k: 'fc', label: 'Cutoff', min: 30, max: 20000, def: 18000, log: true, unit: 'Hz' },
  { k: 'fq', label: 'Resonance', min: 0.3, max: 18, def: 0.8, log: true, unit: 'q' },
];
const SAMPLER_FILTER_TYPES = ['Off', 'Low-pass', 'High-pass', 'Band-pass'];
/* Start, end and loop start as the sampler uses them (start < end, loop start < end). */
function samplerSpan(p) {
  const st = clamp(p.start || 0, 0, 0.95), en = clamp(p.end ?? 1, Math.min(1, st + 0.01), 1);
  return { st, en, ls: clamp(p.ls || 0, 0, en - 0.01) };
}

/* --------------------------- mixer effects --------------------------- */
const DELAY_STEPS = [1, 2, 3, 4, 6, 8];
const FX_DEFS = {
  eq: { name: 'Shelf EQ', params: [
    { k: 'low', label: 'Low', min: -15, max: 15, def: 0, unit: 'dB', bipolar: true },
    { k: 'mid', label: 'Mid', min: -15, max: 15, def: 0, unit: 'dB', bipolar: true },
    { k: 'midf', label: 'Mid freq', min: 200, max: 8000, def: 1200, unit: 'Hz', log: true },
    { k: 'high', label: 'High', min: -15, max: 15, def: 0, unit: 'dB', bipolar: true } ] },
  filter: { name: 'Sweep Filter', params: [
    { k: 'mode', label: 'Mode', options: ['Low-pass', 'High-pass', 'Band-pass'], def: 0 },
    { k: 'cut', label: 'Cutoff', min: 30, max: 20000, def: 18000, unit: 'Hz', log: true },
    { k: 'res', label: 'Resonance', min: 0.3, max: 18, def: 0.8, unit: 'q', log: true },
    { k: 'rate', label: 'LFO rate', min: 0.05, max: 8, def: 0.4, unit: 'Hz', log: true },
    { k: 'lfo', label: 'LFO depth', min: 0, max: 1, def: 0, unit: '%' } ] },
  drive: { name: 'Tube Drive', params: [
    { k: 'drive', label: 'Drive', min: 1, max: 30, def: 4, unit: 'x', log: true },
    { k: 'tone', label: 'Tone', min: 600, max: 16000, def: 7000, unit: 'Hz', log: true },
    { k: 'mix', label: 'Mix', min: 0, max: 1, def: 1, unit: '%' },
    { k: 'out', label: 'Output', min: -18, max: 6, def: 0, unit: 'dB', bipolar: false } ] },
  comp: { name: 'Glue Comp', params: [
    { k: 'thr', label: 'Threshold', min: -50, max: 0, def: -18, unit: 'dB' },
    { k: 'ratio', label: 'Ratio', min: 1, max: 20, def: 4, unit: ':1', log: true },
    { k: 'att', label: 'Attack', min: 0.001, max: 0.2, def: 0.01, unit: 's', log: true },
    { k: 'rel', label: 'Release', min: 0.03, max: 1, def: 0.2, unit: 's', log: true },
    { k: 'gain', label: 'Makeup', min: 0, max: 18, def: 3, unit: 'dB' } ] },
  pump: { name: 'Pump', params: [
    { k: 'rate', label: 'Rate', options: ['Every beat', 'Every 1/8'], def: 0 },
    { k: 'depth', label: 'Depth', min: 0, max: 1, def: 0.6, unit: '%' },
    { k: 'rel', label: 'Recovery', min: 0.05, max: 1, def: 0.55, unit: 'beat' } ] },
  chorus: { name: 'Dual Chorus', params: [
    { k: 'rate', label: 'Rate', min: 0.05, max: 4, def: 0.35, unit: 'Hz', log: true },
    { k: 'depth', label: 'Depth', min: 0, max: 1, def: 0.5, unit: '%' },
    { k: 'mix', label: 'Mix', min: 0, max: 1, def: 0.5, unit: '%' } ] },
  delay: { name: 'Echo Pong', params: [
    { k: 'time', label: 'Time', options: ['1/16', '1/8', '3/16', '1/4', '3/8', '1/2'], def: 2 },
    { k: 'fb', label: 'Feedback', min: 0, max: 0.92, def: 0.38, unit: '%' },
    { k: 'tone', label: 'Tone', min: 500, max: 14000, def: 4200, unit: 'Hz', log: true },
    { k: 'mix', label: 'Mix', min: 0, max: 1, def: 0.28, unit: '%' } ] },
  reverb: { name: 'Plate Hall', params: [
    { k: 'size', label: 'Decay', min: 0.3, max: 7, def: 2.2, unit: 's', log: true },
    { k: 'pre', label: 'Pre-delay', min: 0, max: 0.12, def: 0.02, unit: 's' },
    { k: 'tone', label: 'Damping', min: 1000, max: 16000, def: 6500, unit: 'Hz', log: true },
    { k: 'mix', label: 'Mix', min: 0, max: 1, def: 0.25, unit: '%' } ] },
};
const FX_ORDER = ['eq', 'filter', 'drive', 'comp', 'pump', 'chorus', 'delay', 'reverb'];
function newFx(type, over) {
  const p = {}; for (const d of FX_DEFS[type].params) p[d.k] = d.def;
  return { id: uid(), type, on: true, p: Object.assign(p, over || {}) };
}

/* --------------------------- context bootstrap --------------------------- */
function makeCurve(k) {
  const n = 2048, c = new Float32Array(n), t = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / t; }
  return c;
}
function softClipCurve() {
  const n = 4096, out = new Float32Array(n), k = 0.86;
  for (let i = 0; i < n; i++) { const u = (i / (n - 1) * 2 - 1) * 2, m = Math.abs(u); out[i] = Math.sign(u) * (m < k ? m : k + (1 - k) * Math.tanh((m - k) / (1 - k))); }
  return out;
}
function initShared(c) {
  const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  A.noise = b; A.curve = makeCurve(1.6);
}
function audio() {
  if (A.ctx) { if (A.ctx.state !== 'running') A.ctx.resume().catch(() => {}); return A.ctx; }
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) { toast('Web Audio is not available in this browser'); return null; }
  let c;
  try { c = A.ctx = new C({ latencyHint: 'interactive' }); } catch (e) { toast('Audio could not start: ' + e.message); return null; }
  initShared(c);
  for (let i = 0; i <= NINS; i++) A.strips.push(new Strip(i));
  syncAudio();
  setTimeout(warmDrums, 50);
  if (c.state !== 'running') c.resume().catch(() => {});
  return c;
}

/* --------------------------- mixer strip --------------------------- */
class Strip {
  constructor(i) {
    const c = A.ctx; this.i = i;
    this.input = c.createGain(); this.post = c.createGain(); this.pan = c.createStereoPanner();
    this.fader = c.createGain(); this.mute = c.createGain();
    // Stereo tool after the effects: polarity, stereo separation and L/R swap as one 2x2 matrix.
    this.post.channelCount = 2; this.post.channelCountMode = 'explicit'; this.post.channelInterpretation = 'speakers';
    this.stSplit = c.createChannelSplitter(2); this.stMerge = c.createChannelMerger(2);
    this.gLL = c.createGain(); this.gRL = c.createGain(); this.gLR = c.createGain(); this.gRR = c.createGain();
    this.gRL.gain.value = 0; this.gLR.gain.value = 0;
    this.stSplit.connect(this.gLL, 0); this.stSplit.connect(this.gLR, 0); this.stSplit.connect(this.gRL, 1); this.stSplit.connect(this.gRR, 1);
    this.gLL.connect(this.stMerge, 0, 0); this.gRL.connect(this.stMerge, 0, 0); this.gLR.connect(this.stMerge, 0, 1); this.gRR.connect(this.stMerge, 0, 1);
    this.post.connect(this.stSplit); this.stMerge.connect(this.pan);
    this.pan.connect(this.fader); this.fader.connect(this.mute);
    this.out = c.createGain(); this.dest = -1; this.sendNodes = new Map(); this.sendSig = '';
    if (i > 0) this.mute.connect(this.out);
    this.split = c.createChannelSplitter(2);
    this.anL = c.createAnalyser(); this.anR = c.createAnalyser(); this.anL.fftSize = this.anR.fftSize = 512;
    this.mute.connect(this.split); this.split.connect(this.anL, 0); this.split.connect(this.anR, 1);
    this.buf = new Float32Array(512); this.units = []; this.sig = '';
    this.input.connect(this.post);
    if (i === 0) {
      const lim = c.createDynamicsCompressor();
      lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
      A.masterOut = c.createGain(); A.scopeAn = c.createAnalyser(); A.scopeAn.fftSize = 2048;
      const pre = c.createGain(), clip = c.createWaveShaper(); pre.gain.value = 0.5; clip.curve = softClipCurve(); clip.oversample = '2x';
      this.mute.connect(lim); lim.connect(A.masterOut); A.masterOut.connect(pre); pre.connect(clip); clip.connect(A.scopeAn); clip.connect(c.destination);
      A.limiter = lim; A.clipOut = clip;
    }
    this.disp = [0, 0]; this.hold = [0, 0]; this.holdT = [0, 0];
  }
  // Parameters are only pushed to the audio thread when they actually changed.
  sync(m) {
    this.panTo(m.pan); this.vol(m.vol); this.stereo(m);
    const j = JSON.stringify(m.fx) + (m.fxOff ? '|off' : '');
    if (j !== this.fxJson) { this.fxJson = j; this.setFx(m.fx, !!m.fxOff); }
  }
  panTo(v) { if (v === this.lp) return; this.lp = v; this.pan.pan.setTargetAtTime(v, A.ctx.currentTime, 0.012); }
  vol(v) { if (v === this.lv) return; this.lv = v; this.fader.gain.setTargetAtTime(faderGain(v), A.ctx.currentTime, 0.012); }
  stereo(m) {
    const [ll, rl, lr, rr] = stereoMatrix(m), key = ll + ',' + rl + ',' + lr + ',' + rr;
    if (key === this.stKey) return;
    this.stKey = key; const t = A.ctx.currentTime;
    this.gLL.gain.setTargetAtTime(ll, t, 0.012); this.gRL.gain.setTargetAtTime(rl, t, 0.012);
    this.gLR.gain.setTargetAtTime(lr, t, 0.012); this.gRR.gain.setTargetAtTime(rr, t, 0.012);
  }
  /** Output to the master or another insert, plus post-fader sends. */
  routeTo(r, sends) {
    if (this.i === 0) return;
    if (r !== this.dest) { if (this.dest >= 0) { try { this.out.disconnect(); } catch (e) { /* ignore */ } } this.out.connect(A.strips[r].input); this.dest = r; }
    const sig = sends.map(s => s.to).join(',');
    if (sig !== this.sendSig) {
      this.sendSig = sig;
      for (const g of this.sendNodes.values()) { try { this.mute.disconnect(g); } catch (e) { /* ignore */ } try { g.disconnect(); } catch (e) { /* ignore */ } }
      this.sendNodes.clear();
      for (const s of sends) { const g = A.ctx.createGain(); g.gain.value = faderGain(s.lvl); this.mute.connect(g); g.connect(A.strips[s.to].input); this.sendNodes.set(s.to, g); }
    }
    const t = A.ctx.currentTime;
    for (const s of sends) { const g = this.sendNodes.get(s.to); if (g && g._lv !== s.lvl) { g._lv = s.lvl; g.gain.setTargetAtTime(faderGain(s.lvl), t, 0.012); } }
  }
  setFx(list, allOff) {
    const sig = list.map(f => f.id + ':' + f.type + ':' + (f.on ? 1 : 0)).join('|') + (allOff ? '|X' : '');
    const t = A.ctx.currentTime;
    if (sig === this.sig) { list.forEach((f, i) => this.units[i].set(f.p, t)); return; }
    this.sig = sig;
    const old = new Map(this.units.map(u => [u.id, u]));
    const next = [];
    for (const f of list) {
      let u = old.get(f.id);
      if (u && u.type === f.type) old.delete(f.id);
      else { u = makeFx(f.type); u.id = f.id; u.type = f.type; }
      u.set(f.p, t); next.push(u);
    }
    for (const u of old.values()) { try { u.output.disconnect(); } catch (e) {} u.dispose && u.dispose(); }
    this.input.disconnect();
    for (const u of next) { try { u.output.disconnect(); } catch (e) {} }
    let prev = this.input;
    next.forEach((u, i) => { if (list[i].on && !allOff) { prev.connect(u.input); prev = u.output; } });
    prev.connect(this.post);
    this.units = next;
  }
  level(side) {
    const an = side ? this.anR : this.anL; an.getFloatTimeDomainData(this.buf);
    let p = 0; for (let i = 0; i < this.buf.length; i++) { const a = Math.abs(this.buf[i]); if (a > p) p = a; }
    return p;
  }
}
/* --------------------------- mixer routing --------------------------- */
/* Each insert goes to the master or to one other insert, and can also send to others.
   The routes form no loops (the mixer refuses a connection that would close one; a project
   that has one anyway sends the offending inserts straight to the master). The desktop
   engine builds the same graph in Model.cpp. */
function mixGraph(mixer = P.mixer) {
  const n = mixer.length, route = [], sends = [], out = [];
  for (let i = 0; i < n; i++) {
    const m = mixer[i] || {};
    const r = m.route | 0;
    route.push(i > 0 && r > 0 && r < n && r !== i ? r : 0);
    const seen = new Set();
    sends.push(i > 0 && Array.isArray(m.sends) ? m.sends.filter(s => s && Number.isInteger(s.to) && s.to >= 0 && s.to < n && s.to !== i && s.to !== route[i] && !seen.has(s.to) && seen.add(s.to)).map(s => ({ to: s.to, lvl: clamp(+s.lvl || 0, 0, 1) })) : []);
  }
  // Kahn's algorithm over inserts 1..n-1; whatever is left in a loop loses its routing.
  const edges = i => [route[i], ...sends[i].map(s => s.to)].filter(t => t > 0);
  const indeg = new Array(n).fill(0);
  for (let i = 1; i < n; i++) for (const t of edges(i)) indeg[t]++;
  const order = [], q = [];
  for (let i = 1; i < n; i++) if (!indeg[i]) q.push(i);
  while (q.length) { const i = q.shift(); order.push(i); for (const t of edges(i)) if (--indeg[t] === 0) q.push(t); }
  if (order.length < n - 1) for (let i = 1; i < n; i++) if (!order.includes(i)) { route[i] = 0; sends[i] = sends[i].filter(s => s.to === 0); order.push(i); }
  for (let i = 0; i < n; i++) out.push(i === 0 ? [] : [route[i], ...sends[i].map(s => s.to)]);
  return { route, sends, order, out };
}
/** True if audio leaving insert `from` can reach insert `to`. */
function mixReaches(g, from, to) {
  const seen = new Set([from]), st = [from];
  while (st.length) { const x = st.pop(); if (x === to) return true; for (const y of g.out[x] || []) if (!seen.has(y)) { seen.add(y); st.push(y); } }
  return false;
}
/** Which inserts are audible: solo keeps the soloed inserts, everything feeding them and their path to the master. */
function mixActive(g, mixer = P.mixer) {
  const any = mixer.some((m, i) => i > 0 && m.solo);
  return mixer.map((m, i) => {
    if (m.mute) return false;
    if (i === 0 || !any || m.solo) return true;
    for (let j = 1; j < mixer.length; j++) if (mixer[j].solo && (mixReaches(g, i, j) || mixReaches(g, j, i))) return true;
    return false;
  });
}
/** Gains (ll, rl, lr, rr) of the stereo tool: polarity, separation 0 (mono) to 2 (extra wide), swap. */
function stereoMatrix(m) {
  const w = clamp(m.width ?? 1, 0, 2), p = m.phase ? -1 : 1, a = (1 + w) / 2 * p, b = (1 - w) / 2 * p;
  return m.swap ? [b, a, a, b] : [a, b, b, a];
}
function applySolo() {
  if (!A.ctx) return;
  const g = mixGraph(), t = A.ctx.currentTime;
  for (let i = 1; i <= NINS; i++) A.strips[i].routeTo(g.route[i], g.sends[i]);
  const ons = mixActive(g);
  const key = ons.join();
  if (key === A.soloKey) return;
  A.soloKey = key;
  ons.forEach((on, i) => A.strips[i].mute.gain.setTargetAtTime(on ? 1 : 0, t, 0.01));
}
function wetDry(c) {
  const input = c.createGain(), output = c.createGain(), dry = c.createGain(), wet = c.createGain();
  input.connect(dry); dry.connect(output); wet.connect(output);
  return { input, output, dry, wet, mix(m, t) { dry.gain.setTargetAtTime(Math.cos(m * Math.PI / 2), t, 0.02); wet.gain.setTargetAtTime(Math.sin(m * Math.PI / 2), t, 0.02); } };
}
function impulse(c, sec) {
  const sr = c.sampleRate, len = Math.max(1, Math.floor(sr * sec)), b = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) { const x = i / len; d[i] = (Math.random() * 2 - 1) * Math.exp(-x * 5.5) * (1 - x) * (i < sr * 0.004 ? i / (sr * 0.004) : 1); }
  }
  return b;
}
function makeFx(type) {
  const c = A.ctx;
  const bq = (tp, f, q) => { const b = c.createBiquadFilter(); b.type = tp; b.frequency.value = f; if (q != null) b.Q.value = q; return b; };
  switch (type) {
    case 'eq': {
      const lo = bq('lowshelf', 140), mid = bq('peaking', 1200, 0.9), hi = bq('highshelf', 7000);
      lo.connect(mid); mid.connect(hi);
      return { input: lo, output: hi, set(p, t) { lo.gain.setTargetAtTime(p.low, t, 0.02); mid.gain.setTargetAtTime(p.mid, t, 0.02); mid.frequency.setTargetAtTime(p.midf, t, 0.02); hi.gain.setTargetAtTime(p.high, t, 0.02); } };
    }
    case 'filter': {
      const f = bq('lowpass', 18000, 0.8), lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 0.4; lg.gain.value = 0; lfo.connect(lg); lg.connect(f.detune); lfo.start();
      return { input: f, output: f, set(p, t) { f.type = ['lowpass', 'highpass', 'bandpass'][p.mode | 0]; f.frequency.setTargetAtTime(p.cut, t, 0.02); f.Q.setTargetAtTime(p.res, t, 0.02); lfo.frequency.setTargetAtTime(p.rate, t, 0.05); lg.gain.setTargetAtTime(p.lfo * 2400, t, 0.05); },
        dispose() { try { lfo.stop(); } catch (e) {} } };
    }
    case 'drive': {
      const w = wetDry(c), pre = c.createGain(), sh = c.createWaveShaper(), tone = bq('lowpass', 7000, 0.6), post = c.createGain();
      sh.curve = A.curve; sh.oversample = '2x';
      w.input.connect(pre); pre.connect(sh); sh.connect(tone); tone.connect(post); post.connect(w.wet);
      return { input: w.input, output: w.output, set(p, t) { pre.gain.setTargetAtTime(p.drive, t, 0.02); post.gain.setTargetAtTime(dbToGain(p.out) / Math.pow(p.drive, 0.35), t, 0.02); tone.frequency.setTargetAtTime(p.tone, t, 0.02); w.mix(p.mix, t); } };
    }
    case 'comp': {
      const cp = c.createDynamicsCompressor(), mk = c.createGain(); cp.knee.value = 6; cp.connect(mk);
      return { input: cp, output: mk, comp: cp, set(p, t) { cp.threshold.setTargetAtTime(p.thr, t, 0.02); cp.ratio.setTargetAtTime(p.ratio, t, 0.02); cp.attack.setTargetAtTime(p.att, t, 0.02); cp.release.setTargetAtTime(p.rel, t, 0.02); mk.gain.setTargetAtTime(dbToGain(p.gain), t, 0.02); } };
    }
    case 'pump': {
      const g = c.createGain(); let par = { rate: 0, depth: 0.6, rel: 0.55 };
      return { input: g, output: g, set(p) { par = p; },
        step(s, t, sd) { const every = (par.rate | 0) === 1 ? 2 : 4; if (s % every) return; const beat = sd * every;
          g.gain.setTargetAtTime(1 - par.depth, t, 0.004); g.gain.setTargetAtTime(1, t + 0.025, Math.max(0.01, par.rel * beat / 3)); },
        halt(t) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(1, t, 0.03); } };
    }
    case 'chorus': {
      const w = wetDry(c), d1 = c.createDelay(0.1), d2 = c.createDelay(0.1), l1 = c.createOscillator(), l2 = c.createOscillator(), g1 = c.createGain(), g2 = c.createGain(), p1 = c.createStereoPanner(), p2 = c.createStereoPanner();
      d1.delayTime.value = 0.017; d2.delayTime.value = 0.023; p1.pan.value = -0.85; p2.pan.value = 0.85; l2.detune.value = 0;
      l1.connect(g1); g1.connect(d1.delayTime); l2.connect(g2); g2.connect(d2.delayTime);
      w.input.connect(d1); w.input.connect(d2); d1.connect(p1); d2.connect(p2); p1.connect(w.wet); p2.connect(w.wet);
      l1.start(); l2.start();
      return { input: w.input, output: w.output, set(p, t) { l1.frequency.setTargetAtTime(p.rate, t, 0.05); l2.frequency.setTargetAtTime(p.rate * 1.17, t, 0.05); g1.gain.setTargetAtTime(p.depth * 0.005, t, 0.05); g2.gain.setTargetAtTime(p.depth * 0.0062, t, 0.05); w.mix(p.mix, t); },
        dispose() { try { l1.stop(); l2.stop(); } catch (e) {} } };
    }
    case 'delay': {
      const w = wetDry(c), sum = c.createGain(), dl = c.createDelay(4), dr = c.createDelay(4), fbl = c.createGain(), fbr = c.createGain(), tone = bq('lowpass', 4200, 0.5), hp = bq('highpass', 180, 0.5), mer = c.createChannelMerger(2);
      sum.channelCount = 1; sum.channelCountMode = 'explicit'; sum.channelInterpretation = 'speakers';
      w.input.connect(sum); sum.connect(hp); hp.connect(dl);
      dl.connect(tone); tone.connect(fbl); fbl.connect(dr); dr.connect(fbr); fbr.connect(dl);
      dl.connect(mer, 0, 0); dr.connect(mer, 0, 1); mer.connect(w.wet);
      let last = null;
      const u = { input: w.input, output: w.output, set(p, t) { last = p; const tm = DELAY_STEPS[p.time | 0] * stepDur(); dl.delayTime.setTargetAtTime(tm, t, 0.04); dr.delayTime.setTargetAtTime(tm, t, 0.04); fbl.gain.setTargetAtTime(p.fb, t, 0.02); fbr.gain.setTargetAtTime(p.fb, t, 0.02); tone.frequency.setTargetAtTime(p.tone, t, 0.02); w.mix(p.mix, t); },
        tempo() { if (last) u.set(last, A.ctx.currentTime); } };
      return u;
    }
    case 'reverb': {
      const w = wetDry(c), pre = c.createDelay(0.5), conv = c.createConvolver(), damp = bq('lowpass', 6500, 0.5), lowcut = bq('highpass', 160, 0.5);
      w.input.connect(pre); pre.connect(lowcut); lowcut.connect(conv); conv.connect(damp); damp.connect(w.wet);
      let size = -1, timer = 0;
      return { input: w.input, output: w.output, set(p, t) {
          pre.delayTime.setTargetAtTime(p.pre, t, 0.02); damp.frequency.setTargetAtTime(p.tone, t, 0.02); w.mix(p.mix, t);
          if (Math.abs(p.size - size) > 0.005) { size = p.size; clearTimeout(timer); const fn = () => { conv.buffer = impulse(c, size); }; if (conv.buffer) timer = setTimeout(fn, 140); else fn(); }
        }, dispose() { clearTimeout(timer); } };
    }
  }
  const g = c.createGain(); return { input: g, output: g, set() {} };
}

/* --------------------------- channel strips --------------------------- */
class ChStrip {
  constructor() { const c = A.ctx; this.g = c.createGain(); this.p = c.createStereoPanner(); this.g.connect(this.p); this.route = -1; }
  sync(ch) {
    const t = A.ctx.currentTime, g = ch.mute ? 0 : volGain(ch.vol);
    if (g !== this.lg) { this.lg = g; this.g.gain.setTargetAtTime(g, t, 0.01); }
    if (ch.pan !== this.lp) { this.lp = ch.pan; this.p.pan.setTargetAtTime(ch.pan, t, 0.01); }
    const r = clamp(ch.mixer | 0, 0, NINS);
    if (r !== this.route) { if (this.route >= 0) this.p.disconnect(); this.p.connect(A.strips[r].input); this.route = r; }
  }
  dispose() { try { this.p.disconnect(); this.g.disconnect(); } catch (e) {} }
}
function syncAudio() {
  if (!A.ctx) return;
  P.mixer.forEach((m, i) => A.strips[i].sync(m));
  applySolo();
  const ids = new Set(P.channels.map(c => c.id));
  for (const [id, cs] of A.ch) if (!ids.has(id)) { cs.dispose(); A.ch.delete(id); }
  for (const ch of P.channels) { let cs = A.ch.get(ch.id); if (!cs) { cs = new ChStrip(); A.ch.set(ch.id, cs); } cs.sync(ch); }
  if (A.lastMaster !== P.master) { A.lastMaster = P.master; A.masterOut.gain.setTargetAtTime(P.master * 1.1, A.ctx.currentTime, 0.02); }
}
function syncChannel(ch) { if (!A.ctx) return; const cs = A.ch.get(ch.id); if (cs) cs.sync(ch); else syncAudio(); }
function syncStrip(i) { if (!A.ctx) return; A.strips[i].sync(P.mixer[i]); applySolo(); }
function onTempoChange() { if (!A.ctx) return; for (const s of A.strips) for (const u of s.units) if (u.tempo) u.tempo(); }

/* --------------------------- voice handles --------------------------- */
function mkHandle(out, srcs, t0, end) {
  const hd = { out, srcs, t0, end, relAt: null, release: null, chId: null };
  const live = A.live, chv = A.chv;
  live.add(hd);
  if (srcs.length) srcs[0].onended = () => { live.delete(hd); if (hd.chId) { const s = chv.get(hd.chId); if (s) s.delete(hd); } try { out.disconnect(); } catch (e) {} };
  return hd;
}
/* Cut itself / choke groups: a new note silences earlier notes of the same channel or group. */
function choke(hd, t) {
  if (hd.choked != null && hd.choked <= t) return;
  hd.choked = t; hd.relAt = -1; hd.end = t + 0.08;
  try { hd.out.gain.cancelScheduledValues(t); hd.out.gain.setTargetAtTime(0, t, 0.006); } catch (e) {}
  for (const s of hd.srcs) { try { s.stop(t + 0.08); } catch (e) {} }
}
function chokeFor(ch, t) {
  const ids = [];
  if (ch.cut) ids.push(ch.id);
  if (ch.cutGroup) for (const o of P.channels) if (o.cutGroup === ch.cutGroup && o.id !== ch.id) ids.push(o.id);
  for (const id of ids) {
    const set = A.chv.get(id); if (!set) continue;
    for (const hd of set) if (hd.t0 < t - 0.0005 && hd.end > t) choke(hd, t);
  }
}
function killHandle(hd, now) {
  for (const s of hd.srcs) { try { s.stop(now); } catch (e) {} }
  A.live.delete(hd);
  try { hd.out.disconnect(); } catch (e) {}
}

/* --------------------------- drum synthesis --------------------------- */
function expEnv(g, t, peak, a, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
/* Drum hits are synthesised live the first time, then rendered once to a buffer in the background.
   Repeat hits play that buffer: one node instead of up to ten, so busy patterns cost almost nothing. */
const DRUM_CACHE = new Map(), DRUM_SEEN = new Map(), DRUM_QUEUE = [], NOISY_DRUMS = new Set(['snare', 'clap', 'hat', 'ohat', 'shaker', 'crash']);
const DRUM_LEN = { kick: 0.5, '808': 1.2, snare: 0.3, clap: 0.36, hat: 0.07, ohat: 0.36, crash: 1.55, tom: 0.42, rim: 0.06, bell: 0.34, shaker: 0.14 };
let drumRR = 0, drumBusy = false;
const drumKeyOf = (p, key, v) => p.kind + '|' + (p.tune || 0) + '|' + (+(p.decay ?? 1)).toFixed(3) + '|' + (+(p.tone ?? 0.5)).toFixed(3) + '|' + key + '|' + v;
// Renders every drum sound the project uses ahead of time, so the first bar already plays from the cache.
function warmDrums() {
  if (!A.ctx) return;
  for (const ch of P.channels) {
    if (ch.type !== 'drum') continue;
    const keys = new Set([rootKey(ch)]);
    for (const pat of P.patterns) for (const n of pat.notes[ch.id] || []) keys.add(n.key);
    const nv = NOISY_DRUMS.has(ch.params.kind) ? 3 : 1;
    for (const key of keys) for (let v = 0; v < nv; v++) {
      const k = drumKeyOf(ch.params, key, v);
      if (!DRUM_CACHE.has(k) && !DRUM_SEEN.has(k)) { DRUM_SEEN.set(k, 1); DRUM_QUEUE.push({ p: Object.assign({}, ch.params), key, k }); }
    }
  }
  pumpDrumQueue();
}
function drum(ch, t, key, vel, dest) {
  const p = ch.params, nv = NOISY_DRUMS.has(p.kind) ? 3 : 1, v = nv > 1 ? (drumRR = (drumRR + 1) % nv) : 0;
  const k = drumKeyOf(p, key, v);
  const buf = DRUM_CACHE.get(k);
  if (buf && buf.sampleRate === A.ctx.sampleRate) {
    const c = A.ctx, src = c.createBufferSource(), out = c.createGain();
    src.buffer = buf; out.gain.value = vel * (p.level ?? 1);
    src.connect(out); out.connect(dest); src.start(t);
    return mkHandle(out, [src], t, t + buf.duration);
  }
  const n = (DRUM_SEEN.get(k) || 0) + 1;
  if (DRUM_SEEN.size > 600) DRUM_SEEN.clear();
  DRUM_SEEN.set(k, n);
  if (n === 1 && !A.exporting) { DRUM_QUEUE.push({ p: Object.assign({}, p), key, k }); pumpDrumQueue(); }
  return drumSynth(ch, t, key, vel, dest, false);
}
function pumpDrumQueue() {
  if (drumBusy || !DRUM_QUEUE.length || !A.ctx || typeof OfflineAudioContext === 'undefined') return;
  drumBusy = true;
  const job = DRUM_QUEUE.shift(), sr = A.ctx.sampleRate, real = A.ctx;
  const done = () => { drumBusy = false; setTimeout(pumpDrumQueue, 8); };
  let oc;
  try {
    oc = new OfflineAudioContext(1, Math.ceil(sr * ((DRUM_LEN[job.p.kind] || 1) * Math.max(0.2, job.p.decay ?? 1) + 0.12)), sr);
    A.ctx = oc;
    drumSynth({ params: Object.assign({}, job.p, { level: 1 }) }, 0, job.key, 1, oc.destination, true);
  } catch (e) { A.ctx = real; done(); return; }
  A.ctx = real;
  oc.startRendering().then(buf => {
    const d = buf.getChannelData(0); let end = d.length;
    while (end > 64 && Math.abs(d[end - 1]) < 0.0001) end--;
    const out = real.createBuffer(1, end, sr); out.copyToChannel(d.subarray(0, end), 0);
    DRUM_CACHE.set(job.k, out);
    if (DRUM_CACHE.size > 260) DRUM_CACHE.delete(DRUM_CACHE.keys().next().value);
    done();
  }, done);
}
function drumSynth(ch, t, key, vel, dest, offline) {
  const c = A.ctx, p = ch.params, out = c.createGain();
  out.gain.value = vel * (p.level ?? 1);
  out.connect(dest);
  const pm = Math.pow(2, ((p.tune || 0) + key - 60) / 12), dm = p.decay ?? 1, tn = p.tone ?? 0.5;
  const oscs = [], noises = [];
  const osc = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; oscs.push(o); return o; };
  const noise = () => { const s = c.createBufferSource(); s.buffer = A.noise; s.loop = true; noises.push(s); return s; };
  const gain = v => { const g = c.createGain(); if (v != null) g.gain.value = v; return g; };
  const filt = (type, f, q) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = Math.min(f, 20000); if (q != null) b.Q.value = q; return b; };
  let end = t + 0.5;
  switch (p.kind) {
    case 'kick': {
      const o = osc('sine', 50), g = gain(), sh = c.createWaveShaper(); sh.curve = A.curve;
      const fEnd = 46 * pm, fStart = fEnd * (3 + tn * 6), d = 0.42 * dm;
      o.frequency.setValueAtTime(fStart, t); o.frequency.exponentialRampToValueAtTime(fEnd, t + 0.045 + 0.05 * (1 - tn));
      expEnv(g, t, 1, 0.002, d);
      o.connect(sh); sh.connect(g); g.connect(out);
      const n = noise(), nf = filt('highpass', 2600), ng = gain(); expEnv(ng, t, 0.2 + 0.45 * tn, 0.001, 0.012);
      n.connect(nf); nf.connect(ng); ng.connect(out);
      end = t + d + 0.06; break;
    }
    case '808': {
      const f = mtof(key - 24 + (p.tune || 0)), o = osc('sine', f), g = gain(), sh = c.createWaveShaper(), pre = gain(1 + tn * 5);
      sh.curve = A.curve;
      o.frequency.setValueAtTime(f * 2.2, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
      const d = 1.15 * dm; expEnv(g, t, 0.85, 0.003, d);
      o.connect(pre); pre.connect(sh); sh.connect(g); g.connect(out);
      end = t + d + 0.06; break;
    }
    case 'snare': {
      const o = osc('triangle', 190 * pm), og = gain();
      o.frequency.setValueAtTime(250 * pm, t); o.frequency.exponentialRampToValueAtTime(175 * pm, t + 0.05);
      expEnv(og, t, 0.75, 0.001, 0.11 * dm); o.connect(og); og.connect(out);
      const n = noise(), nf = filt('highpass', 900 + tn * 1600, 0.7), pk = filt('peaking', 5200, 1.2), ng = gain();
      pk.gain.value = 5;
      const d = (0.14 + 0.1 * tn) * dm; expEnv(ng, t, 0.72, 0.001, d);
      n.connect(nf); nf.connect(pk); pk.connect(ng); ng.connect(out);
      end = t + Math.max(d, 0.12 * dm) + 0.06; break;
    }
    case 'clap': {
      const n = noise(), bp = filt('bandpass', 1150 * pm, 1.1), hp = filt('highpass', 520), g = gain();
      g.gain.setValueAtTime(0.0001, t);
      for (let i = 0; i < 3; i++) { const ti = t + i * 0.0105; g.gain.setValueAtTime(3, ti); g.gain.exponentialRampToValueAtTime(0.3, ti + 0.0095); }
      const tail = t + 0.032, d = (0.16 + 0.16 * tn) * dm;
      g.gain.setValueAtTime(2.7, tail); g.gain.exponentialRampToValueAtTime(0.0001, tail + d);
      n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
      end = tail + d + 0.06; break;
    }
    case 'hat': case 'ohat': case 'crash': {
      const crash = p.kind === 'crash', freqs = [205.3, 304.4, 369.6, 522.7, 540, 800], mul = (crash ? 1.45 : 1) * pm;
      const mix = gain(0.55);
      for (const f of freqs) osc('square', f * mul).connect(mix);
      const bp = filt('bandpass', crash ? 8200 : 9000 + 3000 * tn, 0.75), hp = filt('highpass', crash ? 4200 : 6800, 0.7);
      const n = noise(), ng = gain(0.6 + 0.5 * tn); n.connect(ng); ng.connect(bp);
      mix.connect(bp); bp.connect(hp);
      const g = gain(); hp.connect(g); g.connect(out);
      const d = (p.kind === 'hat' ? 0.055 : p.kind === 'ohat' ? 0.34 : 1.5) * dm;
      expEnv(g, t, crash ? 1.1 : 1.5, 0.001, d);
      end = t + d + 0.06; break;
    }
    case 'tom': {
      const o = osc('sine', 150 * pm), g = gain(), d = 0.4 * dm;
      o.frequency.setValueAtTime(200 * pm, t); o.frequency.exponentialRampToValueAtTime(105 * pm, t + 0.28 * dm);
      expEnv(g, t, 1, 0.002, d); o.connect(g); g.connect(out);
      const n = noise(), nf = filt('bandpass', 2500, 0.8), ng = gain(); expEnv(ng, t, 0.25 * (0.5 + tn), 0.001, 0.02);
      n.connect(nf); nf.connect(ng); ng.connect(out);
      end = t + d + 0.06; break;
    }
    case 'rim': {
      const o = osc('square', 820 * pm), o2 = osc('triangle', 1650 * pm), bp = filt('bandpass', 1900 * pm, 3.5), g = gain(), d = 0.05 * dm;
      o.connect(bp); o2.connect(bp); bp.connect(g); g.connect(out); expEnv(g, t, 1.6, 0.0006, d);
      end = t + d + 0.05; break;
    }
    case 'bell': {
      const m = gain(0.5), o1 = osc('square', 540 * pm), o2 = osc('square', 800 * pm), bp = filt('bandpass', 2640 * pm, 1.4), g = gain();
      o1.connect(m); o2.connect(m); m.connect(bp); bp.connect(g); g.connect(out);
      const d = 0.32 * dm;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.6, t + 0.002); g.gain.exponentialRampToValueAtTime(0.5, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      end = t + d + 0.05; break;
    }
    case 'shaker': {
      const n = noise(), bp = filt('bandpass', 6500 * pm, 1.4), hp = filt('highpass', 3200), g = gain(), d = 0.1 * dm;
      n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.7, t + 0.012 + 0.025 * tn); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + d);
      end = t + d + 0.08; break;
    }
  }
  for (const o of oscs) { o.start(t); o.stop(end); }
  for (const n of noises) { n.start(t, Math.random() * 1.5); n.stop(end); }
  if (offline) return null;
  return mkHandle(out, oscs.concat(noises), t, end);
}

/* --------------------------- subtractive synth --------------------------- */
function synth(ch, t, key, vel, dest) {
  const c = A.ctx, p = Object.assign({}, SYNTH_DEFAULT, ch.params);
  const f = mtof(key), vca = c.createGain(), flt = c.createBiquadFilter(), out = c.createGain();
  vca.gain.value = 0; flt.type = 'lowpass'; flt.Q.value = p.res;
  flt.connect(vca); vca.connect(out); out.connect(dest);
  const srcs = [], uni = Math.max(1, Math.round(p.uni)), nrm = 1 / Math.sqrt(uni);
  // Oscillators share level buses and at most two panners per voice, instead of a gain + panner each.
  const buses = {}, pans = {};
  const bus = (name, g, pan) => {
    const side = pan < -0.01 ? 'L' : pan > 0.01 ? 'R' : 'C', key = name + side;
    let b = buses[key]; if (b) return b;
    b = buses[key] = c.createGain(); b.gain.value = g;
    if (side === 'C') b.connect(flt);
    else { let pn = pans[side]; if (!pn) { pn = pans[side] = c.createStereoPanner(); pn.pan.value = side === 'L' ? -0.7 : 0.7; pn.connect(flt); } b.connect(pn); }
    return b;
  };
  const add = (type, freq, cents, g, pan, name) => {
    if (g <= 0.0005) return;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = cents;
    o.connect(bus(name || type, g, pan));
    srcs.push(o);
  };
  const f2 = f * Math.pow(2, p.semi2 / 12);
  for (let u = 0; u < uni; u++) {
    const s = uni === 1 ? 0 : (u / (uni - 1)) * 2 - 1;
    add(p.w1, f, s * p.spread, (1 - p.mix) * nrm, s, 'a');
    add(p.w2, f2, p.det + s * p.spread * 0.85, p.mix * nrm, -s, 'b');
  }
  add('sine', f / 2, 0, p.sub * 0.8, 0, 'sub');
  const kt = Math.pow(2, ((key - 60) / 12) * 0.35);
  const base = clamp(p.cut * kt, 30, 20000), peakF = clamp(base * Math.pow(2, p.env * 6), 30, 20000);
  flt.frequency.setValueAtTime(base, t);
  if (Math.abs(p.env) > 0.01) { flt.frequency.exponentialRampToValueAtTime(peakF, t + p.fatt); flt.frequency.setTargetAtTime(base, t + p.fatt, p.fdec / 3); }
  const peak = vel * p.gain * 0.8;
  vca.gain.setValueAtTime(0, t); vca.gain.linearRampToValueAtTime(peak, t + p.att); vca.gain.setTargetAtTime(peak * p.sus, t + p.att, Math.max(0.003, p.dec / 3));
  for (const o of srcs) o.start(uni > 1 ? t + Math.random() * 0.003 : t);
  const hd = mkHandle(out, srcs, t, t + 600);
  hd.release = te => {
    te = Math.max(te, t + p.att + 0.001);
    if (hd.relAt != null && hd.relAt <= te) return;
    hd.relAt = te;
    vca.gain.setTargetAtTime(0, te, Math.max(0.004, p.rel / 4));
    const stopAt = te + p.rel * 2 + 0.06; hd.end = stopAt;
    for (const o of srcs) { try { o.stop(stopAt); } catch (e) {} }
  };
  return hd;
}

/* --------------------------- sampler --------------------------- */
function sampler(ch, t, key, vel, dest) {
  const s = A.samples.get(ch.sample);
  if (!s) { if (ch.sample && typeof ensureSample === 'function') ensureSample(ch.sample); return null; }
  const c = A.ctx, p = ch.params, src = c.createBufferSource();
  src.buffer = p.rev ? (s.rev || (s.rev = reverseBuffer(s.buf))) : s.buf;
  const rate = Math.pow(2, (key - 60 + (p.pitch || 0)) / 12); src.playbackRate.value = rate;
  const g = c.createGain(), out = c.createGain();
  if (p.ft > 0) {
    const f = c.createBiquadFilter(); f.type = ['lowpass', 'highpass', 'bandpass'][(p.ft | 0) - 1] || 'lowpass';
    f.frequency.value = clamp(p.fc ?? 18000, 30, 20000); f.Q.value = p.fq ?? 0.8;
    src.connect(f); f.connect(g);
  } else src.connect(g);
  g.connect(out); out.connect(dest);
  const att = p.att || 0.002, peak = vel * (p.gain ?? 0.8) * (p.norm ? (s.normGain || 1) : 1), sus = clamp(p.sus ?? 1, 0, 1);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + att);
  if (sus < 0.999) g.gain.setTargetAtTime(peak * sus, t + att, Math.max(0.003, (p.dec ?? 0.3) / 3));
  const dur = src.buffer.duration, sp = samplerSpan(p), off = sp.st * dur, loop = !!p.loop;
  let end = t + (sp.en * dur - off) / rate;
  if (loop) { src.loop = true; src.loopStart = sp.ls * dur; src.loopEnd = sp.en * dur; end = t + 600; }
  src.start(t, off);
  if (!loop && sp.en < 0.999) src.stop(end);
  const hd = mkHandle(out, [src], t, end);
  hd.release = te => {
    if (p.oneshot && !loop) return;
    te = Math.max(te, t + att + 0.001);
    if (hd.relAt != null && hd.relAt <= te) return;
    hd.relAt = te; g.gain.setTargetAtTime(0, te, Math.max(0.004, (p.rel || 0.1) / 4));
    try { src.stop(te + (p.rel || 0.1) * 2 + 0.05); } catch (e) {}
  };
  return hd;
}
/* --------------------------- note dispatch --------------------------- */
function playNote(ch, t, key, vel, dur, dest) {
  if (!A.ctx) return null;
  dest = dest || (A.ch.get(ch.id) && A.ch.get(ch.id).g);
  if (!dest) return null;
  let hd = null;
  if (ch.id && (ch.cut || ch.cutGroup)) chokeFor(ch, t);
  try {
    if (ch.type === 'drum') hd = drum(ch, t, key, vel, dest);
    else if (ch.type === 'synth') hd = synth(ch, t, key, vel, dest);
    else if (ch.type === 'sampler') hd = sampler(ch, t, key, vel, dest);
  } catch (e) { console.error(e); }
  if (hd && dur != null && hd.release) hd.release(t + dur);
  if (hd && ch.id) { hd.chId = ch.id; let set = A.chv.get(ch.id); if (!set) A.chv.set(ch.id, set = new Set()); set.add(hd); }
  if (ch.id) A.hits.set(ch.id, t);
  return hd;
}
function previewChannel(ch, key = null, dur = 0.35) {
  const c = audio(); if (!c) return;
  const k = key == null ? rootKey(ch) : key;
  const dest = ch.id && A.ch.get(ch.id) ? null : A.strips[0].input;
  playNote(ch, c.currentTime + 0.01, k, 0.8, dur, dest);
}

/* --------------------------- transport + scheduler --------------------------- */
const LOOKAHEAD = 0.15;
function startTimer() {
  if (A.worker === undefined) {
    try {
      const src = 'let id=0;onmessage=e=>{clearInterval(id);id=0;if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
      A.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      A.worker.onmessage = () => tick();
      A.worker.onerror = () => { A.worker = null; if (A.playing && !A.timer) A.timer = setInterval(tick, 25); };
    } catch (e) { A.worker = null; }
  }
  if (A.worker) A.worker.postMessage(25); else A.timer = setInterval(tick, 25);
}
function stopTimer() { if (A.worker) A.worker.postMessage(0); clearInterval(A.timer); A.timer = 0; }
const stepDur = () => 60 / P.bpm / 4;
function songEnd() { let e = 0; for (const c of P.playlist.clips) e = Math.max(e, c.start + c.len); return Math.max(STEP * 4, Math.ceil(e / STEP) * STEP); }
function play() {
  const c = audio(); if (!c) return;
  if (A.playing) return;
  A.playing = true; A.playMode = S.mode; A.queue = []; A.cur = null;
  warmDrums();
  A.step = S.mode === 'pat' ? 0 : A.pos;
  if (S.mode === 'song' && P.playlist.loop && (A.step >= P.playlist.loop.b)) A.step = P.playlist.loop.a;
  A.nextTime = c.currentTime + 0.06;
  tick(); startTimer();
  if (UI.top) UI.top.render();
}
function tick() {
  if (!A.playing) return;
  const c = A.ctx;
  if (A.nextTime < c.currentTime - 0.3) A.nextTime = c.currentTime + 0.02;
  while (A.nextTime < c.currentTime + LOOKAHEAD) {
    const sd = stepDur();
    scheduleStep(A.step, A.nextTime, sd);
    A.queue.push({ t: A.nextTime, s: A.step, d: sd, mode: A.playMode });
    A.nextTime += sd;
    A.step = nextStep(A.step);
  }
}
function nextStep(s) {
  s++;
  if (A.playMode === 'pat') { if (s >= curPat().len) s = 0; }
  else { const L = P.playlist.loop; if (L && s >= L.b) s = L.a; else if (!L && s >= songEnd()) s = 0; }
  return s;
}
function scheduleStep(s, t, sd) {
  if (S.metro && s % 4 === 0) metroClick(t, s % 16 === 0);
  for (const st of A.strips) for (const u of st.units) if (u.step) u.step(s, t, sd);
  if (A.playMode === 'pat') { const p = curPat(); schedPat(p, s % p.len, t, sd); }
  else {
    for (const cl of P.playlist.clips) {
      if (s < cl.start || s >= cl.start + cl.len || cl.mute || P.playlist.mute[cl.track]) continue;
      const pat = patById(cl.pat); if (!pat || !pat.len) continue;
      schedPat(pat, clipLocal(cl, pat, s), t, sd);
    }
  }
}
/** Step inside the pattern that a clip plays at song step s (clips can start part-way into their pattern). */
function clipLocal(cl, pat, s) { return (((s - cl.start + (cl.off | 0)) % pat.len) + pat.len) % pat.len; }
function schedPat(pat, ls, t, sd) {
  for (const ch of P.channels) {
    if (ch.mute) continue;
    const ns = pat.notes[ch.id]; if (!ns || !ns.length) continue;
    const sw = P.swing * (ch.swing ?? 1);
    for (const n of ns) {
      if (n.t < ls || n.t >= ls + 1 || n.mute) continue;
      if (n.chance != null && n.chance < 1 && Math.random() >= n.chance) continue;
      let off = (n.t - ls) * sd;
      if (Math.floor(n.t + 1e-6) % 2 === 1) off += sw * sd * 0.66;
      const rep = n.rep > 1 ? n.rep : 1;
      if (rep === 1) playNote(ch, t + off, n.key, n.vel, n.len * sd);
      else { const sub = n.len / rep * sd; for (let r = 0; r < rep; r++) playNote(ch, t + off + r * sub, n.key, n.vel * (r ? 0.9 : 1), sub * 0.92); }
    }
  }
}
function metroClick(t, acc) {
  const c = A.ctx, o = c.createOscillator(), g = c.createGain();
  o.frequency.value = acc ? 1760 : 1245; o.type = 'sine';
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(acc ? 0.45 : 0.28, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g); g.connect(A.masterOut); o.start(t); o.stop(t + 0.06);
}
function killFuture() {
  const now = A.ctx.currentTime;
  for (const hd of [...A.live]) if (hd.t0 > now + 0.004) killHandle(hd, now);
}
function stop() {
  if (!A.playing) {
    A.pos = P.playlist.loop ? P.playlist.loop.a : 0;
    if (UI.top) UI.top.render(); if (UI.pl) UI.pl.dirty = true;
    return;
  }
  A.playing = false; stopTimer();
  const now = A.ctx.currentTime;
  killFuture();
  for (const hd of A.live) if (hd.release && !A.heldSet?.has(hd)) hd.release(now);
  for (const st of A.strips) for (const u of st.units) if (u.halt) u.halt(now);
  A.queue = []; A.cur = null; A.vis = null;
  if (UI.top) UI.top.render(); if (UI.pl) UI.pl.dirty = true; if (UI.pr) UI.pr.dirty = true;
}
function togglePlay() { if (A.playing) { const v = A.vis; stop(); if (v && A.playMode === 'song') A.pos = Math.floor(v.s); } else play(); }
function setMode(m) {
  if (S.mode === m) return;
  S.mode = m; scheduleSave();
  if (A.playing) { killFuture(); for (const st of A.strips) for (const u of st.units) if (u.halt) u.halt(A.ctx.currentTime); A.playMode = m; A.step = m === 'pat' ? 0 : A.pos; A.queue = []; A.cur = null; A.nextTime = A.ctx.currentTime + 0.03; }
  if (UI.top) UI.top.render(); if (UI.pl) UI.pl.dirty = true; if (UI.pr) UI.pr.dirty = true;
}
function setSongPos(s) {
  A.pos = Math.max(0, s);
  if (A.playing && A.playMode === 'song') { killFuture(); A.step = A.pos; A.queue = []; A.cur = null; A.nextTime = A.ctx.currentTime + 0.03; }
  if (UI.pl) UI.pl.dirty = true; if (UI.top) UI.top.render();
}
function curPos() {
  if (!A.playing || !A.ctx) return null;
  const now = A.ctx.currentTime - (A.ctx.outputLatency || 0);
  while (A.queue.length && A.queue[0].t <= now) A.cur = A.queue.shift();
  if (!A.cur) return null;
  return { s: A.cur.s + clamp((now - A.cur.t) / A.cur.d, 0, 0.999), mode: A.cur.mode };
}
function patLocalPos(patId) {
  const v = A.vis; if (!v) return null;
  if (v.mode === 'pat') return S.pat === patId ? v.s : null;
  const pat = patById(patId); if (!pat) return null;
  for (const c of P.playlist.clips) if (c.pat === patId && !c.mute && !P.playlist.mute[c.track] && v.s >= c.start && v.s < c.start + c.len) return clipLocal(c, pat, v.s);
  return null;
}

/* --------------------------- live playing + recording --------------------------- */
A.heldSet = new Set();
A.capture = [];
/* external: a note the desktop engine already played (hardware MIDI); only recording and capture use it.
   Its `ago` says how many milliseconds ago it was played. */
function noteOn(key, vel = 0.8, external) {
  const ch = selCh(); if (!ch) { if (!external) hint('Add a channel first to play notes'); return; }
  const c = audio(); if (!c) return;
  if (A.held.has(key)) return;
  const lag = external ? (external.ago || 0) / 1000 : 0;
  const t = c.currentTime + 0.004;
  const hd = external ? null : playNote(ch, t, key, vel, null);
  if (hd) A.heldSet.add(hd);
  let rec = null, local = null;
  const v = A.playing ? curPos() : null;
  if (v) {
    const s = v.s - lag / stepDur();
    if (v.mode === 'pat') local = ((s % curPat().len) + curPat().len) % curPat().len;
    else { const pat = curPat(); for (const cl of P.playlist.clips) if (cl.pat === pat.id && s >= cl.start && s < cl.start + cl.len) { local = clipLocal(cl, pat, s); break; } }
  }
  if (S.rec && A.playing && v) {
    if (local != null) rec = { local, t0: c.currentTime - lag, chId: ch.id, patId: S.pat };
    else hint('Recording: place the current pattern under the playhead, or switch to PAT mode');
  }
  A.held.set(key, { hd, rec, vel, cap: { key, vel, t0: performance.now() - lag * 1000, local, patId: S.pat, bpm: P.bpm } });
  if (UI.inst) UI.inst.keyState(key, true);
  if (UI.pr) UI.pr.dirty = true;
}
function noteOff(key, external) {
  const e = A.held.get(key); if (!e) return;
  A.held.delete(key);
  const lag = external ? (external.ago || 0) / 1000 : 0;
  if (e.hd) { A.heldSet.delete(e.hd); if (e.hd.release) e.hd.release(A.ctx.currentTime); }
  if (UI.inst) UI.inst.keyState(key, false);
  if (UI.pr) UI.pr.dirty = true;
  if (e.cap) {
    e.cap.t1 = Math.max(e.cap.t0 + 20, performance.now() - lag * 1000);
    A.capture.push(e.cap);
    if (A.capture.length > 1024) A.capture.splice(0, A.capture.length - 1024);
  }
  if (e.rec) {
    const pat = patById(e.rec.patId), ch = chById(e.rec.chId); if (!pat || !ch) return;
    const sn = S.prSnap || 0.25, lenSteps = (A.ctx.currentTime - lag - e.rec.t0) / stepDur();
    let t0 = snapRound(e.rec.local, sn); if (t0 >= pat.len) t0 -= pat.len;
    const len = Math.max(sn || 0.25, snapRound(lenSteps, sn) || sn);
    Hist.push();
    patNotes(pat, ch).push({ t: t0, len, key, vel: e.vel, chance: 1 });
    refresh();
  }
}
function allNotesOff() { for (const k of [...A.held.keys()]) noteOff(k); }

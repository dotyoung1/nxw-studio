'use strict';
/* ================================================================
   NXW STUDIO · core utilities, data model, history, UI primitives
   ================================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const s in v) { if (s.startsWith('--')) e.style.setProperty(s, v[s]); else e.style[s] = v[s]; } }
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = k => NOTE_NAMES[((k % 12) + 12) % 12] + (Math.floor(k / 12) - 1);
const isBlack = k => [1, 3, 6, 8, 10].includes(((k % 12) + 12) % 12);
const mtof = k => 440 * Math.pow(2, (k - 69) / 12);
const dbToGain = d => Math.pow(10, d / 20);
const volGain = v => v <= 0 ? 0 : 1.25 * v * v;          // channel volume (0..1)
const faderGain = v => v <= 0 ? 0 : 1.6 * v * v;         // mixer fader (0..1), unity at 0.7906
const toDb = g => g <= 0.00001 ? -Infinity : 20 * Math.log10(g);
const fmtDb = g => { const d = toDb(g); return d === -Infinity ? '-inf dB' : (d >= 0 ? '+' : '') + d.toFixed(1) + ' dB'; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PALETTE = ['#3dd0ae', '#ee9663', '#7ea6ff', '#d987d4', '#f2c14e', '#7fd36d', '#ff8090', '#5cc6e6', '#b9a0ff', '#cdd65e'];
const STEP = 16;            // steps per bar
const NINS = 10;            // mixer inserts (plus master)
const KEY_LO = 24, KEY_HI = 107;  // piano-roll range C1..B7

const SCALES = {
  'Off': null, 'Major': [0, 2, 4, 5, 7, 9, 11], 'Minor': [0, 2, 3, 5, 7, 8, 10], 'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10], 'Lydian': [0, 2, 4, 6, 7, 9, 11], 'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Harmonic minor': [0, 2, 3, 5, 7, 8, 11], 'Pentatonic minor': [0, 3, 5, 7, 10], 'Pentatonic major': [0, 2, 4, 7, 9], 'Blues': [0, 3, 5, 6, 7, 10],
};
const CHORDS = {
  'Single note': [0], 'Major': [0, 4, 7], 'Minor': [0, 3, 7], 'Sus2': [0, 2, 7], 'Sus4': [0, 5, 7], 'Major 7': [0, 4, 7, 11],
  'Minor 7': [0, 3, 7, 10], 'Dominant 7': [0, 4, 7, 10], 'Minor 9': [0, 3, 7, 10, 14], 'Power': [0, 7, 12], 'Octave': [0, 12],
};
const SNAPS = [
  { label: 'Bar', v: 16 }, { label: 'Beat', v: 4 }, { label: '1/2 beat', v: 2 }, { label: 'Step', v: 1 },
  { label: '1/2 step', v: 0.5 }, { label: '1/4 step', v: 0.25 }, { label: '1/3 beat', v: 4 / 3 }, { label: '1/6 beat', v: 2 / 3 }, { label: 'None', v: 0 },
];
const snapRound = (v, s) => s > 0 ? Math.round(v / s) * s : v;
const snapFloor = (v, s) => s > 0 ? Math.floor(v / s + 1e-6) * s : v;

/* ------------------------- parameter formatting ------------------------- */
function fmtParam(d, v) {
  if (d.options) return d.options[Math.round(v)] ?? '';
  switch (d.unit) {
    case 'Hz': return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz';
    case 'dB': return (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';
    case '%': return Math.round(v * 100) + '%';
    case '±%': return (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
    case 's': return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s';
    case 'st': return (v > 0 ? '+' : '') + Math.round(v) + ' st';
    case 'ct': return Math.round(v) + ' ct';
    case 'v': return Math.round(v) + (Math.round(v) === 1 ? ' voice' : ' voices');
    case 'q': return v.toFixed(1);
    case ':1': return v.toFixed(1) + ':1';
    case 'x': return v.toFixed(1) + 'x';
    case 'beat': return Math.round(v * 100) + '% beat';
    case 'pan': return Math.abs(v) < 0.01 ? 'Centred' : Math.round(Math.abs(v) * 100) + '% ' + (v < 0 ? 'left' : 'right');
    case 'vol': return fmtDb(volGain(v));
    case 'fader': return fmtDb(faderGain(v));
    default: return (+v).toFixed(2);
  }
}
const normOf = (d, v) => d.log ? Math.log(v / d.min) / Math.log(d.max / d.min) : (v - d.min) / (d.max - d.min);
function denorm(d, n) {
  n = clamp(n, 0, 1);
  let v = d.log ? d.min * Math.pow(d.max / d.min, n) : d.min + n * (d.max - d.min);
  if (d.step) v = Math.round(v / d.step) * d.step;
  return v;
}

/* ------------------------------ icons ------------------------------ */
const IC = {
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<rect x="7" y="5.5" width="3.6" height="13" rx="1" fill="currentColor"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1" fill="currentColor"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/>',
  rec: '<circle cx="12" cy="12" r="5.5" fill="currentColor"/>',
  metro: '<path d="M9 4.5h6l3 15H6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 15.5l5-8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8 15.5h8" stroke="currentColor" stroke-width="1.4"/>',
  keys: '<rect x="3" y="6.5" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7 14h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  playlist: '<rect x="3" y="5" width="8" height="4" rx="1" fill="currentColor"/><rect x="12.5" y="10" width="8.5" height="4" rx="1" fill="currentColor" opacity=".7"/><rect x="6" y="15" width="10" height="4" rx="1" fill="currentColor" opacity=".85"/>',
  rack: '<rect x="3.5" y="5" width="4" height="3" rx="1" fill="currentColor"/><rect x="9.5" y="5" width="3" height="3" rx=".8" fill="currentColor" opacity=".55"/><rect x="14" y="5" width="3" height="3" rx=".8" fill="currentColor"/><rect x="18.5" y="5" width="2.5" height="3" rx=".8" fill="currentColor" opacity=".55"/><rect x="3.5" y="10.5" width="4" height="3" rx="1" fill="currentColor"/><rect x="9.5" y="10.5" width="3" height="3" rx=".8" fill="currentColor"/><rect x="14" y="10.5" width="3" height="3" rx=".8" fill="currentColor" opacity=".55"/><rect x="18.5" y="10.5" width="2.5" height="3" rx=".8" fill="currentColor"/><rect x="3.5" y="16" width="4" height="3" rx="1" fill="currentColor"/><rect x="9.5" y="16" width="3" height="3" rx=".8" fill="currentColor" opacity=".55"/><rect x="14" y="16" width="3" height="3" rx=".8" fill="currentColor" opacity=".55"/><rect x="18.5" y="16" width="2.5" height="3" rx=".8" fill="currentColor"/>',
  piano: '<rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 4.5v15M15 4.5v15" stroke="currentColor" stroke-width="1.3"/><rect x="7.3" y="4.5" width="3.4" height="8" rx=".6" fill="currentColor"/><rect x="13.3" y="4.5" width="3.4" height="8" rx=".6" fill="currentColor"/>',
  roll: '<rect x="3" y="5" width="7" height="3" rx="1" fill="currentColor"/><rect x="9" y="10.5" width="10" height="3" rx="1" fill="currentColor" opacity=".8"/><rect x="5" y="16" width="5" height="3" rx="1" fill="currentColor" opacity=".6"/><rect x="13" y="16" width="7" height="3" rx="1" fill="currentColor"/>',
  mixer: '<path d="M6 4v16M12 4v16M18 4v16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".5"/><rect x="3.8" y="13" width="4.4" height="3.4" rx="1" fill="currentColor"/><rect x="9.8" y="7" width="4.4" height="3.4" rx="1" fill="currentColor"/><rect x="15.8" y="11" width="4.4" height="3.4" rx="1" fill="currentColor"/>',
  synth: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 12.5c1.2-3.5 2.4-3.5 3.6 0s2.4 3.5 3.6 0 2.4-3.5 3.6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  browser: '<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  redo: '<path d="M15 7l4.5 4.5L15 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 11.5h-9a5 5 0 0 0 0 10h2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  max: '<rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>',
  pencil: '<path d="M5 19l1-4L16 5l3 3L9 18z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 7l3 3" stroke="currentColor" stroke-width="1.7"/>',
  select: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="3 2.2"/>',
  erase: '<path d="M4 15.5L13.5 6l6 6-6.5 6.5H7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.5 10l6 6M11 19h8.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  chev: '<path d="M7 9.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  left: '<path d="M14.5 6.5L9 12l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  right: '<path d="M9.5 6.5L15 12l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  drum: '<ellipse cx="12" cy="8.5" rx="7.5" ry="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 8.5v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-7" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  wave: '<path d="M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  file: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3.5V8h4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  pattern: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 9h3M13 9h3M8 15h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  power: '<path d="M12 4.5v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7.5 7.5a6.5 6.5 0 1 0 9 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  dots: '<circle cx="6.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="17.5" cy="12" r="1.6" fill="currentColor"/>',
  zin: '<circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15 15l4.5 4.5M8 10.5h5M10.5 8v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  zout: '<circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15 15l4.5 4.5M8 10.5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  magnet: '<path d="M6 4.5v7a6 6 0 0 0 12 0v-7h-3.5v7a2.5 2.5 0 0 1-5 0v-7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  ghost: '<rect x="3.5" y="6" width="9" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 1.5"/><rect x="10" y="13" width="10" height="4" rx="1" fill="currentColor"/>',
  quant: '<path d="M4 19V5M9 19V5M14 19V5M19 19V5" stroke="currentColor" stroke-width="1.2" opacity=".5"/><rect x="4" y="8" width="5" height="3" rx=".8" fill="currentColor"/><rect x="14" y="13" width="5" height="3" rx=".8" fill="currentColor"/>',
  dup: '<rect x="4" y="8" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 5h9a1.5 1.5 0 0 1 1.5 1.5V15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  wsine: '<path d="M3 12c2.3-7 4.7-7 7 0s4.7 7 7 0" transform="translate(2 0)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  wtri: '<path d="M3 15l4.5-8 9 10 4.5-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  wsaw: '<path d="M3 17l9-10v10l9-10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  wsq: '<path d="M3 16V8h6v8h6V8h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  scissors: '<circle cx="6.5" cy="17.5" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.5" cy="17.5" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.6 15.4L18 4M15.4 15.4L6 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  export: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 15.5V19h14v-3.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
};
const icon = (n, s = 16) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${IC[n] || ''}</svg>`;

/* ------------------------------ data model ------------------------------ */
let P = null;           // project
let VER = 0;            // edit counter, invalidates caches
const S = {             // UI/session state (not part of undo history)
  pat: null, ch: null, lane: 'steps', prTool: 'draw', plTool: 'draw', prSnap: 1, plSnap: 16,
  chord: 'Single note', scaleRoot: 9, scale: 'Minor', ghost: true, mixSel: 1, fxSel: 0, oct: 4,
  typing: true, rec: false, metro: false, mode: 'song', prZoomX: 22, prZoomY: 14, plZoom: 5, prLastLen: 1,
  timeMode: 'bars', brClosed: {},
};

function newPattern(n, color) {
  return { id: uid(), name: 'Pattern ' + n, color: color || PALETTE[(n - 1) % PALETTE.length], len: 16, notes: {} };
}
function defaultMixer() {
  const m = [];
  for (let i = 0; i <= NINS; i++) m.push({ name: i === 0 ? 'Master' : 'Insert ' + i, vol: 0.7906, pan: 0, mute: false, solo: false, fx: [] });
  return m;
}
function newProject() {
  const p = {
    v: 1, name: 'Untitled', bpm: 128, swing: 0, master: 0.8,
    channels: [], patterns: [newPattern(1)],
    playlist: { tracks: 16, names: [], mute: [], clips: [], loop: null },
    mixer: defaultMixer(),
  };
  return p;
}
const curPat = () => P.patterns.find(p => p.id === S.pat) || P.patterns[0];
const chById = id => P.channels.find(c => c.id === id);
const patById = id => P.patterns.find(p => p.id === id);
const selCh = () => chById(S.ch) || P.channels[0] || null;
const trackName = i => P.playlist.names[i] || 'Track ' + (i + 1);
function rootKey(ch) { return ch && ch.root != null ? ch.root : 60; }
function patNotes(pat, ch) { return (pat.notes[ch.id] ||= []); }
function nextFreeInsert() {
  const used = new Set(P.channels.map(c => c.mixer));
  for (let i = 1; i <= NINS; i++) if (!used.has(i)) return i;
  return 0;
}
function growPattern(pat) {
  let end = 0;
  for (const id in pat.notes) for (const n of pat.notes[id]) end = Math.max(end, n.t + Math.min(n.len, 0.999));
  const need = Math.ceil(end / STEP) * STEP;
  if (need > pat.len) pat.len = Math.min(need, 256);
}

/* ------------------------------ persistence ------------------------------ */
const STORE_KEY = 'nxw-studio-project-v1', UI_KEY = 'nxw-studio-ui-v1';
let saveTimer = 0;
function saveNow() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(P)); } catch (e) { /* storage unavailable */ }
  try { const { rec, ...rest } = S; localStorage.setItem(UI_KEY, JSON.stringify(rest)); } catch (e) { /* ignore */ }
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = 0; saveNow(); }, 700); }
// A refresh or tab close right after an edit still keeps it.
for (const ev of ['pagehide', 'beforeunload']) window.addEventListener(ev, () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; saveNow(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) { clearTimeout(saveTimer); saveTimer = 0; saveNow(); } });
function loadSaved() {
  let p = null;
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) p = JSON.parse(raw); } catch (e) { p = null; }
  try { const raw = localStorage.getItem(UI_KEY); if (raw) Object.assign(S, JSON.parse(raw)); } catch (e) { /* ignore */ }
  return p && p.v === 1 && Array.isArray(p.channels) && Array.isArray(p.patterns) ? p : null;
}

/* ------------------------------ history ------------------------------ */
const Hist = {
  u: [], r: [],
  push() { this.u.push(JSON.stringify(P)); if (this.u.length > 160) this.u.shift(); this.r.length = 0; },
  undo() {
    if (!this.u.length) { toast('Nothing left to undo'); return; }
    this.r.push(JSON.stringify(P)); P = JSON.parse(this.u.pop()); afterLoad(); hint('Undo');
  },
  redo() {
    if (!this.r.length) { toast('Nothing to redo'); return; }
    this.u.push(JSON.stringify(P)); P = JSON.parse(this.r.pop()); afterLoad(); hint('Redo');
  },
};

/* --------------------------- change propagation --------------------------- */
const UI = {};
let refreshQueued = false;
function touched() { VER++; scheduleSave(); for (const k in UI) if (UI[k] && UI[k].dirty !== undefined) UI[k].dirty = true; }
function refresh() {
  touched();
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => { refreshQueued = false; renderAll(); });
}
// Only windows the user can see are rebuilt; hidden ones are marked stale and rebuilt when shown.
function uiVisible(u) { return u.visible ? u.visible() : (u.win ? WM.shown(u.win) : true); }
function renderAll() {
  if (A.ctx) { try { syncAudio(); } catch (e) { console.error('sync', e); } }
  for (const k in UI) {
    const u = UI[k]; if (!u || !u.render) continue;
    if (!uiVisible(u)) { u.stale = true; continue; }
    u.stale = false;
    try { u.render(); } catch (e) { console.error('render ' + k, e); }
  }
}
function renderIfStale(u) { if (u && u.stale && uiVisible(u)) { u.stale = false; try { u.render(); } catch (e) { console.error(e); } } }
// Returns true when the signature differs from the last one, so a render can skip unchanged rebuilds.
function sigChanged(u, parts) { const s = JSON.stringify(parts); if (s === u._sig) return false; u._sig = s; return true; }
function edit(fn) { Hist.push(); fn(); refresh(); }
function afterLoad() {
  if (!P.patterns.length) P.patterns.push(newPattern(1));
  if (!patById(S.pat)) S.pat = P.patterns[0].id;
  if (!chById(S.ch)) S.ch = P.channels[0] ? P.channels[0].id : null;
  P.playlist.names ||= []; P.playlist.mute ||= [];
  if (UI.pr) UI.pr.sel.clear();
  if (UI.pl) UI.pl.sel.clear();
  if (typeof syncAudio === 'function') syncAudio();
  refresh();
}

/* ------------------------------ hint bar ------------------------------ */
function hint(t) { const e = document.getElementById('hint'); if (e && e.textContent !== t) e.textContent = t; }
document.addEventListener('pointerover', e => {
  const t = e.target && e.target.closest && e.target.closest('[data-hint]');
  if (t && !document.querySelector('.knob.drag, .fader.drag')) hint(t.dataset.hint);
});

/* ------------------------------ knob ------------------------------ */
function arcPath(cx, cy, r, a0, a1) {
  const p = a => [cx + r * Math.sin(a * Math.PI / 180), cy - r * Math.cos(a * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
let wheelPushAt = 0;
function wheelHistory() { const n = performance.now(); if (n - wheelPushAt > 700) Hist.push(); wheelPushAt = n; }
function Knob(o) {
  const d = o.def, sz = o.size || 32;
  const el = h('div', { class: 'knob', tabindex: 0, role: 'slider', 'aria-label': d.label });
  el.innerHTML = `<svg viewBox="0 0 40 40" width="${sz}" height="${sz}"><circle class="k-body" cx="20" cy="20" r="12"/><path class="k-track"/><path class="k-val"/><line class="k-ptr" x1="20" y1="20" x2="20" y2="11"/></svg>`
    + (o.label ? `<span class="k-lab">${esc(o.labelText || d.label)}</span>` : '') + (o.showVal ? `<span class="k-val-t"></span>` : '');
  if (o.color) el.style.setProperty('--kc', o.color);
  const track = el.querySelector('.k-track'), val = el.querySelector('.k-val'), ptr = el.querySelector('.k-ptr'), vt = el.querySelector('.k-val-t');
  track.setAttribute('d', arcPath(20, 20, 16, -135, 135));
  let v = o.value;
  const txt = () => (o.name || d.label) + ': ' + fmtParam(d, v);
  const show = () => {
    const n = clamp(normOf(d, v), 0, 1), a = -135 + 270 * n, a0 = d.bipolar ? 0 : -135;
    val.setAttribute('d', Math.abs(a - a0) < 0.6 ? 'M0 0' : arcPath(20, 20, 16, Math.min(a0, a), Math.max(a0, a)));
    const r = a * Math.PI / 180;
    ptr.setAttribute('x2', (20 + 9 * Math.sin(r)).toFixed(2)); ptr.setAttribute('y2', (20 - 9 * Math.cos(r)).toFixed(2));
    el.setAttribute('aria-valuetext', fmtParam(d, v));
    el.dataset.hint = txt();
    if (vt) vt.textContent = fmtParam(d, v);
  };
  const setV = nv => { if (nv === v) return; v = nv; show(); o.onChange(v); hint(txt()); };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    if (o.onStart) o.onStart();
    let lastY = e.clientY, n = clamp(normOf(d, v), 0, 1);
    el.classList.add('drag'); hint(txt());
    const mv = ev => { const dy = lastY - ev.clientY; lastY = ev.clientY; n = clamp(n + dy / (ev.shiftKey ? 700 : 160), 0, 1); setV(denorm(d, n)); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.classList.remove('drag'); if (o.onEnd) o.onEnd(); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', e => { e.stopPropagation(); if (o.onStart) o.onStart(); setV(d.def); if (o.onEnd) o.onEnd(); });
  el.addEventListener('wheel', e => {
    e.preventDefault(); e.stopPropagation();
    wheelHistory();
    const n = clamp(normOf(d, v) + (e.deltaY < 0 ? 1 : -1) * (d.step ? (d.step / (d.max - d.min)) * (d.log ? 0 : 1) || 0.02 : 0.02), 0, 1);
    setV(denorm(d, n)); if (o.onEnd) o.onEnd();
  }, { passive: false });
  el.addEventListener('keydown', e => {
    const k = e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) return;
    e.preventDefault(); e.stopPropagation();
    if (o.onStart) o.onStart();
    let n = clamp(normOf(d, v), 0, 1);
    const st = d.step ? Math.max(0.02, d.step / (d.max - d.min)) : (e.shiftKey ? 0.005 : 0.03);
    if (k === 'ArrowUp' || k === 'ArrowRight') n += st; else if (k === 'ArrowDown' || k === 'ArrowLeft') n -= st; else if (k === 'Home') n = 0; else n = 1;
    setV(denorm(d, n)); if (o.onEnd) o.onEnd();
  });
  el.set = nv => { if (nv === v) return; v = nv; show(); };
  show();
  return el;
}

/* ------------------------------ fader ------------------------------ */
function Fader(o) {
  const el = h('div', { class: 'fader', tabindex: 0, role: 'slider', 'aria-label': o.label || 'Volume' });
  const unity = h('div', { class: 'unity' }), cap = h('div', { class: 'cap' });
  el.append(unity, cap);
  let v = o.value;
  const CAP = 14;
  const place = () => {
    const H = el.clientHeight || 120;
    cap.style.top = ((1 - v) * (H - CAP)) + 'px';
    unity.style.top = ((1 - 0.7906) * (H - CAP) + CAP / 2) + 'px';
    el.setAttribute('aria-valuetext', fmtDb(faderGain(v)));
    el.dataset.hint = (o.name || 'Volume') + ': ' + fmtDb(faderGain(v));
  };
  const setV = nv => { nv = clamp(nv, 0, 1); if (nv === v) return; v = nv; place(); o.onChange(v); hint(el.dataset.hint); };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId); if (o.onStart) o.onStart();
    el.classList.add('drag');
    const H = el.clientHeight - CAP;
    const r = el.getBoundingClientRect();
    const capTop = (1 - v) * H;
    let grab = e.clientY - r.top - capTop;
    if (grab < 0 || grab > CAP) { grab = CAP / 2; setV(1 - (e.clientY - r.top - grab) / H); }
    const mv = ev => { const fine = ev.shiftKey ? 0.25 : 1; const target = 1 - (ev.clientY - r.top - grab) / H; setV(v + (target - v) * fine); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.classList.remove('drag'); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', e => { e.stopPropagation(); if (o.onStart) o.onStart(); setV(0.7906); });
  el.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); wheelHistory(); setV(v + (e.deltaY < 0 ? 0.015 : -0.015)); }, { passive: false });
  el.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault(); e.stopPropagation(); if (o.onStart) o.onStart(); setV(v + (e.key === 'ArrowUp' ? 0.02 : -0.02));
  });
  el.set = nv => { if (nv === v) return; v = nv; place(); };
  el.place = place;
  requestAnimationFrame(place);
  return el;
}

/* ------------------------------ menus ------------------------------ */
let menuEl = null, menuOwner = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } if (menuOwner) { menuOwner.classList.remove('open'); menuOwner = null; } }
function openMenu(x, y, items, owner) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { m.append(h('div', { class: 'mi-sep' })); continue; }
    if (it.head) { m.append(h('div', { class: 'mi-head' }, it.head)); continue; }
    const b = h('button', { class: 'mi' + (it.danger ? ' danger' : ''), role: 'menuitem', disabled: !!it.disabled, 'data-hint': it.hint || null },
      it.swatch ? h('i', { class: 'sw', style: { background: it.swatch } }) : it.icon ? h('span', { class: 'mi-ic' + (it.checked ? ' on' : ''), html: icon(it.icon, 13) }) : h('i', { class: 'tick' }, it.checked ? '✓' : ''),
      h('span', { class: 'mi-l' }, it.label), it.key ? h('span', { class: 'mi-k' }, it.key) : (it.icon && it.checked ? h('span', { class: 'mi-k on' }, 'On') : null));
    b.addEventListener('click', ev => { ev.stopPropagation(); closeMenu(); if (it.action) it.action(); });
    m.append(b);
  }
  m.addEventListener('keydown', e => {
    const bs = $$('.mi:not([disabled])', m), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (bs[i + 1] || bs[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (bs[i - 1] || bs[bs.length - 1]).focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
  });
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = clamp(x, 4, innerWidth - r.width - 4) + 'px';
  m.style.top = (y + r.height > innerHeight - 6 ? Math.max(6, innerHeight - r.height - 6) : y) + 'px';
  menuEl = m;
  if (owner) { menuOwner = owner; owner.classList.add('open'); }
  const first = m.querySelector('.mi:not([disabled])');
  if (first) first.focus({ preventScroll: true });
}
function menuAt(el, items) { const r = el.getBoundingClientRect(); openMenu(r.left, r.bottom + 3, items, el); }
document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
window.addEventListener('resize', closeMenu);

/* ------------------------------ inline text input ------------------------------ */
function askText(anchor, value, onOk) {
  const r = anchor.getBoundingClientRect();
  const inp = h('input', { class: 'ask', value, maxlength: 40, 'aria-label': 'Name' });
  inp.style.left = clamp(r.left, 4, innerWidth - 200) + 'px';
  inp.style.top = clamp(r.top + (r.height - 28) / 2, 4, innerHeight - 34) + 'px';
  inp.style.width = Math.max(170, r.width) + 'px';
  document.body.append(inp);
  inp.focus(); inp.select();
  let done = false;
  const fin = ok => { if (done) return; done = true; const v = inp.value.trim(); inp.remove(); if (ok && v) onOk(v); };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); });
  inp.addEventListener('blur', () => fin(true));
}

/* ------------------------------ toast + dialog ------------------------------ */
function toast(msg) {
  for (const o of $$('.toast')) o.remove();
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 1900);
  setTimeout(() => t.remove(), 2400);
}
function dialog(title, body, buttons) {
  const scrim = h('div', { class: 'scrim' });
  const close = () => scrim.remove();
  const f = h('div', { class: 'dlg-f' });
  for (const b of buttons || [{ label: 'Close', primary: true }]) {
    f.append(h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => { if (!b.action || b.action() !== false) close(); } }, b.label));
  }
  const dlg = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', null, title), h('div', { class: 'dlg-b' }, body), f);
  scrim.append(dlg);
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim) close(); });
  scrim.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  document.body.append(scrim);
  const fb = dlg.querySelector('textarea, .btn.primary'); if (fb) fb.focus();
  return close;
}

/* ------------------------------ canvas helpers ------------------------------ */
const DPR = () => Math.min(2, window.devicePixelRatio || 1);
function fitCanvas(cv, w, h) {
  const d = DPR(), W = Math.max(1, Math.round(w * d)), H = Math.max(1, Math.round(h * d));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
  const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); return ctx;
}
function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const COLOR_MEMO = new Map();
function hexA(hex, a) {
  const key = hex + a; let v = COLOR_MEMO.get(key); if (v) return v;
  const n = parseInt(hex.slice(1), 16);
  v = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  if (COLOR_MEMO.size > 4000) COLOR_MEMO.clear();
  COLOR_MEMO.set(key, v); return v;
}
function mixHex(hex, other, t) {
  t = Math.round(t * 50) / 50;
  const key = hex + other + t; let v = COLOR_MEMO.get(key); if (v) return v;
  const a = parseInt(hex.slice(1), 16), b = parseInt(other.slice(1), 16);
  const m = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  v = `rgb(${m(16)},${m(8)},${m(0)})`;
  if (COLOR_MEMO.size > 4000) COLOR_MEMO.clear();
  COLOR_MEMO.set(key, v); return v;
}
const CSSV = {};
function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['ink-0', 'ink-1', 'ink-2', 'ink-3', 'ink-4', 'ink-5', 'rule', 'rule-hi', 'text', 'text-dim', 'text-faint', 'verdigris', 'verdigris-deep', 'copper', 'alert', 'amber', 'lcd'])
    CSSV[k] = cs.getPropertyValue('--' + k).trim() || '#888888';
}
const FONT_UI = "'Archivo', system-ui, sans-serif", FONT_MONO = "'Martian Mono', ui-monospace, monospace";

/* ================================================================
   NXW STUDIO · note tools, chords, progressions, MIDI files, search
   Pure helpers shared by the piano roll, channel rack, playlist and browser.
   ================================================================ */

/* --------------------------- scales --------------------------- */
const pcOf = k => ((k % 12) + 12) % 12;
function curScale() { return SCALES[S.scale] || null; }
function inScale(k, sc = curScale(), root = S.scaleRoot) { return !sc || sc.includes(pcOf(k - root)); }
/** Nearest key in the scale (ties go down). */
function snapToScale(k, sc = curScale(), root = S.scaleRoot) {
  if (!sc) return k;
  for (let d = 0; d < 12; d++) { if (inScale(k - d, sc, root)) return k - d; if (inScale(k + d, sc, root)) return k + d; }
  return k;
}
/** The scale used for chords and progressions: the chosen one if it has seven notes, otherwise major or minor. */
function chordScale() {
  const sc = curScale();
  if (sc && sc.length === 7) return sc;
  return /minor|Blues/i.test(S.scale) ? SCALES.Minor : SCALES.Major;
}
/** Diatonic chord on the scale degree of key k: notes stacked in thirds inside the scale. */
function scaleChordKeys(k, size, sc = chordScale(), root = S.scaleRoot) {
  const base = snapToScale(k, sc, root), notes = [];
  for (let x = base; notes.length < size * 2 && x <= base + 48; x++) if (inScale(x, sc, root)) notes.push(x);
  const out = [];
  for (let i = 0; i < size; i++) out.push(notes[i * 2]);
  return out.filter(x => x != null);
}

/* --------------------------- chord names --------------------------- */
const CHORD_SHAPES = [
  [[0, 4, 7], ''], [[0, 3, 7], 'm'], [[0, 3, 6], 'dim'], [[0, 4, 8], 'aug'], [[0, 2, 7], 'sus2'], [[0, 5, 7], 'sus4'], [[0, 7], '5'],
  [[0, 4, 7, 11], 'maj7'], [[0, 3, 7, 10], 'm7'], [[0, 4, 7, 10], '7'], [[0, 3, 6, 10], 'm7b5'], [[0, 3, 6, 9], 'dim7'], [[0, 3, 7, 11], 'mMaj7'],
  [[0, 4, 7, 9], '6'], [[0, 3, 7, 9], 'm6'], [[0, 2, 4, 7], 'add9'], [[0, 2, 3, 7], 'm(add9)'], [[0, 5, 7, 10], '7sus4'],
  [[0, 2, 4, 7, 10], '9'], [[0, 2, 3, 7, 10], 'm9'], [[0, 2, 4, 7, 11], 'maj9'], [[0, 4, 10], '7'], [[0, 3, 10], 'm7'], [[0, 4, 11], 'maj7'],
];
function chordName(keys) {
  if (!keys.length) return '';
  const pcs = [...new Set(keys.map(pcOf))];
  const bass = pcOf(Math.min(...keys));
  if (pcs.length === 1) return NOTE_NAMES[pcs[0]];
  let best = null;
  for (const r of pcs) {
    const set = pcs.map(p => pcOf(p - r)).sort((a, b) => a - b).join();
    for (const [iv, suf] of CHORD_SHAPES) {
      if (iv.join() !== set) continue;
      const score = (r === bass ? 4 : 0) + (iv.length >= 3 ? 1 : 0) - suf.length * 0.01;
      if (!best || score > best.score) best = { r, suf, score };
    }
  }
  if (!best) return '';
  return NOTE_NAMES[best.r] + best.suf + (best.r !== bass ? '/' + NOTE_NAMES[bass] : '');
}

/* --------------------------- note transforms --------------------------- */
/* Each takes the notes to change (and the channel's whole list when it adds or removes notes)
   and edits them in place. The piano roll wraps them in undo and refresh. */
const NT = {
  groups(ns) {                       // notes that start together (chords), in time order
    const m = new Map();
    for (const n of ns) { const k = Math.round(n.t * 1000); if (!m.has(k)) m.set(k, []); m.get(k).push(n); }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1].sort((a, b) => a.key - b.key));
  },
  legato(ns) {
    const g = NT.groups(ns);
    for (let i = 0; i < g.length - 1; i++) { const nt = g[i + 1][0].t; for (const n of g[i]) n.len = Math.max(0.05, nt - n.t); }
  },
  quantize(ns, sn, ends) {
    for (const n of ns) {
      const t = Math.max(0, snapRound(n.t, sn));
      if (ends) { const e = Math.max(t + sn, snapRound(n.t + n.len, sn)); n.len = e - t; }
      n.t = t;
    }
  },
  glue(ns, all) {
    const byKey = new Map();
    for (const n of ns) { if (!byKey.has(n.key)) byKey.set(n.key, []); byKey.get(n.key).push(n); }
    let removed = 0;
    for (const list of byKey.values()) {
      list.sort((a, b) => a.t - b.t);
      for (let i = 0; i < list.length - 1;) {
        const a = list[i], b = list[i + 1];
        if (b.t <= a.t + a.len + 1e-4) { a.len = Math.max(a.len, b.t + b.len - a.t); all.splice(all.indexOf(b), 1); list.splice(i + 1, 1); removed++; }
        else i++;
      }
    }
    return removed;
  },
  chop(ns, all, sn) {
    const made = [];
    for (const n of ns) {
      if (n.len <= sn + 1e-4) continue;
      const end = n.t + n.len; n.len = sn;
      for (let t = n.t + sn; t < end - 1e-4; t += sn) { const c = Object.assign({}, n, { t, len: Math.min(sn, end - t) }); all.push(c); made.push(c); }
    }
    return made;
  },
  arp(ns, all, rate, mode) {
    const made = [];
    for (const g of NT.groups(ns)) {
      if (g.length < 2) continue;
      const t0 = g[0].t, end = Math.max(...g.map(n => n.t + n.len)), up = g.map(n => n.key);
      let seq = mode === 'down' ? up.slice().reverse() : mode === 'updown' ? up.concat(up.slice(1, -1).reverse()) : up;
      const tmpl = g[0];
      for (const n of g) all.splice(all.indexOf(n), 1);
      let i = 0;
      for (let t = t0; t < end - 1e-4; t += rate, i++) {
        const key = mode === 'random' ? up[Math.floor(Math.random() * up.length)] : seq[i % seq.length];
        const c = Object.assign({}, tmpl, { t, len: Math.min(rate, end - t), key });
        all.push(c); made.push(c);
      }
    }
    return made;
  },
  strum(ns, amount, down) {
    for (const g of NT.groups(ns)) {
      const order = down ? g.slice().reverse() : g;
      order.forEach((n, i) => { const d = i * amount, end = n.t + n.len; n.t += d; n.len = Math.max(0.05, end - n.t); });
    }
  },
  flam(ns, all) {
    const made = [];
    for (const n of ns) { if (n.t < 0.25) continue; const c = Object.assign({}, n, { t: n.t - 0.25, len: 0.25, vel: r2(Math.max(0.05, n.vel * 0.6)) }); all.push(c); made.push(c); }
    return made;
  },
  toScale(ns) { for (const n of ns) n.key = clamp(snapToScale(n.key), KEY_LO, KEY_HI); },
  flipV(ns) { const lo = Math.min(...ns.map(n => n.key)), hi = Math.max(...ns.map(n => n.key)); for (const n of ns) n.key = lo + hi - n.key; },
  reverse(ns) { const a = Math.min(...ns.map(n => n.t)), b = Math.max(...ns.map(n => n.t + n.len)); for (const n of ns) n.t = Math.max(0, a + b - (n.t + n.len)); },
  humanize(ns, time, vel) {
    for (const n of ns) {
      if (time) n.t = Math.max(0, n.t + (Math.random() * 2 - 1) * time);
      if (vel) n.vel = r2(clamp(n.vel * (1 + (Math.random() * 2 - 1) * vel), 0.05, 1));
    }
  },
  velocity(ns, how) {
    const s = ns.slice().sort((a, b) => a.t - b.t || a.key - b.key), N = s.length;
    s.forEach((n, i) => {
      const f = N > 1 ? i / (N - 1) : 1;
      if (how === 'up') n.vel = r2(0.3 + 0.7 * f);
      else if (how === 'down') n.vel = r2(1 - 0.7 * f);
      else if (how === 'compress') n.vel = r2(0.78 + (n.vel - 0.78) * 0.5);
      else if (how === 'expand') n.vel = r2(clamp(0.78 + (n.vel - 0.78) * 1.6, 0.05, 1));
      else if (how === 'sine') n.vel = r2(0.6 + 0.35 * Math.sin(n.t / 16 * Math.PI * 2));
      else if (how === 'full') n.vel = 1;
    });
  },
  // Ableton-style transformations: keep the rhythm, rearrange the pitches.
  pitches(ns, how) {
    const s = ns.slice().sort((a, b) => a.t - b.t || a.key - b.key), keys = s.map(n => n.key);
    if (how === 'shuffle') for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
    else if (how === 'retro') keys.reverse();
    else if (how === 'rotate') keys.push(keys.shift());
    s.forEach((n, i) => { n.key = keys[i]; });
  },
  invert(ns) {   // lowest note of each chord up an octave
    for (const g of NT.groups(ns)) if (g.length > 1 && g[0].key + 12 <= KEY_HI) g[0].key += 12;
  },
  stretch(ns, f) { const a = Math.min(...ns.map(n => n.t)); for (const n of ns) { n.t = a + (n.t - a) * f; n.len = Math.max(0.05, n.len * f); } },
  dedupe(ns, all) {
    const seen = new Set(); let removed = 0;
    for (const n of ns.slice().sort((a, b) => b.len - a.len)) { const k = Math.round(n.t * 1000) + ':' + n.key; if (seen.has(k)) { all.splice(all.indexOf(n), 1); removed++; } else seen.add(k); }
    return removed;
  },
};

/* --------------------------- chord progressions --------------------------- */
const PROGRESSIONS = {
  'Pop · I V vi IV': [0, 4, 5, 3], 'Doo-wop · I vi IV V': [0, 5, 3, 4], 'Emotional · vi IV I V': [5, 3, 0, 4],
  'Royal road · IV V iii vi': [3, 4, 2, 5], 'Dreamy · I iii vi IV': [0, 2, 5, 3], 'Circle · vi ii V I': [5, 1, 4, 0],
  'Jazz · ii V I I': [1, 4, 0, 0], 'Epic · i VI III VII': [0, 5, 2, 6], 'Andalusian · i VII VI V': [0, 6, 5, 4],
  'Minor groove · i iv v i': [0, 3, 4, 0], 'Trap · i VI VII i': [0, 5, 6, 0], 'Drill · i iv VI v': [0, 3, 5, 4],
  'Lo-fi · ii vi I IV': [1, 5, 0, 3], 'Gospel · I IV vi V': [0, 3, 5, 4], 'Rock · I bVII IV I': [0, 6, 3, 0],
};
/** Builds chords for a progression in the current key. Voice leading keeps each chord close to the previous one. */
function buildProgression(degs, o) {
  const sc = chordScale(), root = S.scaleRoot, size = o.sevenths ? 4 : 3;
  const tonic = (o.octave + 1) * 12 + root;
  const scaleKeys = []; for (let x = tonic - 24; x <= tonic + 36; x++) if (inScale(x, sc, root)) scaleKeys.push(x);
  const ti = scaleKeys.indexOf(tonic);
  const out = []; let prev = null;
  degs.forEach((d, ci) => {
    const base = ti + d;
    let keys = []; for (let i = 0; i < size; i++) keys.push(scaleKeys[base + i * 2]);
    keys = keys.filter(k => k != null);
    if (o.lead && prev) {      // smallest movement: try inversions and octave shifts
      let best = keys, bestCost = Infinity;
      for (let inv = 0; inv < keys.length; inv++) for (const sh of [-12, 0, 12]) {
        const c = keys.map((k, i) => k + (i < inv ? 12 : 0) + sh).sort((a, b) => a - b);
        const avg = c.reduce((a, b) => a + b, 0) / c.length, pavg = prev.reduce((a, b) => a + b, 0) / prev.length;
        const cost = Math.abs(avg - pavg) + Math.abs(c[0] - prev[0]) * 0.5;
        if (cost < bestCost && c[0] >= KEY_LO && c[c.length - 1] <= KEY_HI) { bestCost = cost; best = c; }
      }
      keys = best;
    }
    if (o.voicing === 'open' && keys.length >= 3) keys = [keys[0], keys[2], keys[1] + 12, ...keys.slice(3)].sort((a, b) => a - b);
    if (o.voicing === 'spread' && keys.length >= 3) keys = [keys[0] - 12, ...keys.slice(1), keys[0] + 12].sort((a, b) => a - b);
    prev = keys.slice();
    const t = ci * o.len;
    for (const k of keys) out.push({ t, len: o.len, key: clamp(k, KEY_LO, KEY_HI), vel: o.vel, chance: 1 });
    if (o.bass) out.push({ t, len: o.len, key: clamp(scaleKeys[base] - 12, KEY_LO, KEY_HI), vel: o.vel, chance: 1 });
  });
  return out;
}

/* --------------------------- euclidean rhythms --------------------------- */
/** Evenly spread hits (Bjorklund spacing): a hit wherever floor(i*k/n) steps up. */
function euclid(hits, steps, rot = 0) {
  hits = clamp(hits | 0, 0, steps);
  const p = []; for (let i = 0; i < steps; i++) p.push(hits > 0 && Math.floor(i * hits / steps) !== Math.floor((i - 1) * hits / steps));
  const r = ((rot % steps) + steps) % steps;
  return p.map((_, i) => p[(i - r + steps) % steps]);
}

/* --------------------------- MIDI files --------------------------- */
const MIDI_PPQ = 96, TICKS_PER_STEP = MIDI_PPQ / 4;
function vlq(n) { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; }
/** tracks: [{ name, notes: [{t, len, key, vel}] }] in steps. Returns a type-1 .mid file. */
function writeMidi(tracks, bpm) {
  const chunk = (id, data) => [...id].map(c => c.charCodeAt(0)).concat([(data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255], data);
  const text = s => [...unescape(encodeURIComponent(s))].map(c => c.charCodeAt(0) & 255);
  const mpq = Math.round(60000000 / bpm);
  const tempo = [0, 0xff, 0x51, 3, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255, 0, 0xff, 0x58, 4, 4, 2, 24, 8, 0, 0xff, 0x2f, 0];
  const out = chunk('MThd', [0, 1, 0, tracks.length + 1, 0, MIDI_PPQ]).concat(chunk('MTrk', tempo));
  tracks.forEach((tr, ti) => {
    const chn = ti % 16 === 9 ? 10 % 16 : ti % 16;
    const ev = [];
    for (const n of tr.notes) {
      if (n.mute) continue;
      const a = Math.round(n.t * TICKS_PER_STEP), b = Math.max(a + 1, Math.round((n.t + n.len) * TICKS_PER_STEP));
      ev.push([a, 1, 0x90 | chn, n.key & 127, clamp(Math.round(n.vel * 127), 1, 127)], [b, 0, 0x80 | chn, n.key & 127, 0]);
    }
    ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const nm = text(tr.name || 'Track ' + (ti + 1)).slice(0, 120);
    const d = [0, 0xff, 0x03, ...vlq(nm.length), ...nm];
    let last = 0;
    for (const e of ev) { d.push(...vlq(e[0] - last), e[2], e[3], e[4]); last = e[0]; }
    d.push(0, 0xff, 0x2f, 0);
    out.push(...chunk('MTrk', d));
  });
  return new Uint8Array(out);
}
/** Reads a .mid file. Returns { bpm, tracks: [{ name, notes: [{t, len, key, vel}] }] } with times in steps. */
function readMidi(buf) {
  const u = new Uint8Array(buf);
  let p = 0;
  const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u[p + i]); return s; };
  const u32 = () => { const v = (u[p] << 24 | u[p + 1] << 16 | u[p + 2] << 8 | u[p + 3]) >>> 0; p += 4; return v; };
  const u16 = () => { const v = u[p] << 8 | u[p + 1]; p += 2; return v; };
  if (str(4) !== 'MThd') throw new Error('not a MIDI file');
  p = 4; const hl = u32();
  const start = p; u16(); const ntr = u16(), div = u16(); p = start + hl;
  if (div & 0x8000) throw new Error('SMPTE timing is not supported');
  const tps = div / 4;
  let bpm = 0;
  const tracks = [];
  for (let ti = 0; ti < ntr && p + 8 <= u.length; ti++) {
    const id = str(4); p += 4; const len = u32(), end = Math.min(u.length, p + len);
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0, status = 0, name = '';
    const open = new Map(), notes = [];
    const rd = () => { let v = 0, b; do { b = u[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v; };
    while (p < end) {
      tick += rd();
      let st = u[p];
      if (st & 0x80) { p++; if (st < 0xf0) status = st; } else st = status;
      if (st === 0xff) {
        const type = u[p++], l = rd();
        if (type === 0x03 && !name) { name = ''; for (let i = 0; i < l; i++) name += String.fromCharCode(u[p + i]); }
        if (type === 0x51 && !bpm && l === 3) bpm = 60000000 / (u[p] << 16 | u[p + 1] << 8 | u[p + 2]);
        p += l; continue;
      }
      if (st === 0xf0 || st === 0xf7) { p += rd(); continue; }
      const hi = st & 0xf0, chn = st & 15;
      const d1 = u[p++], d2 = hi === 0xc0 || hi === 0xd0 ? 0 : u[p++];
      if (hi === 0x90 && d2 > 0) { const k = chn * 128 + d1; if (!open.has(k)) open.set(k, []); open.get(k).push({ tick, vel: d2 / 127 }); }
      else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
        const q = open.get(chn * 128 + d1); const o = q && q.shift();
        if (o) notes.push({ t: o.tick / tps, len: Math.max(0.05, (tick - o.tick) / tps), key: d1, vel: r2(clamp(o.vel, 0.05, 1)), chance: 1, chn });
      }
    }
    for (const [k, q] of open) for (const o of q) notes.push({ t: o.tick / tps, len: 1, key: k % 128, vel: r2(o.vel), chance: 1, chn: k >> 7 });
    p = end;
    if (notes.length) tracks.push({ name: name.trim() || 'Track ' + (tracks.length + 1), notes: notes.sort((a, b) => a.t - b.t) });
  }
  return { bpm: bpm || 0, tracks };
}

/* --------------------------- search --------------------------- */
/** "kick -808 snare|clap": every word must match, -word must not, a|b matches either. */
function makeMatcher(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).map(w => w.startsWith('-') && w.length > 1 ? { not: true, alts: w.slice(1).split('|').filter(Boolean) } : { not: false, alts: w.split('|').filter(Boolean) });
  return (...fields) => {
    const s = fields.filter(Boolean).join(' ').toLowerCase();
    for (const t of terms) { const hit = t.alts.some(a => s.includes(a)); if (t.not ? hit : !hit) return false; }
    return true;
  };
}
/** Tempo and key written in a file name, such as "Loop 140bpm Am" or "chords_C#min_90_BPM". */
function nameTags(name) {
  const s = String(name || '');
  const b = s.match(/(?:^|[^\d])(\d{2,3})\s?_?bpm/i) || s.match(/bpm\s?_?(\d{2,3})(?!\d)/i);
  const k = s.match(/(?:^|[\s_\-(\[])([A-G](?:#|b|♯|♭)?)\s?(maj(?:or)?|min(?:or)?|m)(?=$|[\s_\-)\].\d])/);
  const tags = [];
  if (b && +b[1] >= 50 && +b[1] <= 250) tags.push(b[1] + ' BPM');
  if (k) tags.push(k[1].replace('♯', '#').replace('♭', 'b') + (/^m(in)?/i.test(k[2]) && !/^maj/i.test(k[2]) ? 'm' : ''));
  return tags.join(' · ');
}

/* --------------------------- capture (as in Ableton Live) --------------------------- */
/** Turns what was just played on the keyboard, with or without recording armed, into a new pattern. */
function captureNotes() {
  const ch = selCh(); if (!ch) { toast('Select a channel first'); return; }
  const now = performance.now(), list = A.capture.filter(n => now - n.t1 < 300000).sort((a, b) => a.t0 - b.t0);
  if (!list.length) { toast('Nothing to capture yet. Play some notes on the typing keyboard, the on-screen keys or a MIDI keyboard first.'); return; }
  // The last phrase: back from the latest note until a pause of more than four seconds.
  let i = list.length - 1;
  while (i > 0 && list[i].t0 - Math.max(...list.slice(0, i).map(n => n.t1)) < 4000) i--;
  const phrase = list.slice(i);
  const sd = 60 / phrase[0].bpm / 4, sn = S.prSnap || 0.25;
  const synced = phrase.every(n => n.local != null && n.patId === phrase[0].patId);
  const first = phrase[0];
  let notes;
  if (synced) {
    // Played along with the pattern: keep each note where it fell in the pattern.
    notes = phrase.map(n => ({ t: Math.max(0, snapRound(n.local, sn)), len: Math.max(sn, snapRound((n.t1 - n.t0) / 1000 / sd, sn) || sn), key: n.key, vel: r2(n.vel), chance: 1 }));
    // Notes that wrapped past the end of the pattern continue in the next bar.
    let base = 0, last = -1;
    phrase.forEach((n, j) => { const lp = n.local; if (last >= 0 && lp + 0.5 < last && n.t0 - phrase[j - 1].t0 > 200) base += patById(n.patId) ? patById(n.patId).len : 16; last = lp; notes[j].t += base; });
  } else {
    notes = phrase.map(n => ({ t: Math.max(0, snapRound((n.t0 - first.t0) / 1000 / sd, sn)), len: Math.max(sn, snapRound((n.t1 - n.t0) / 1000 / sd, sn) || sn), key: n.key, vel: r2(n.vel), chance: 1 }));
  }
  let pat;
  edit(() => {
    pat = newPattern(P.patterns.length + 1, ch.color);
    pat.name = 'Captured ' + (P.patterns.filter(q => /^Captured/.test(q.name)).length + 1);
    pat.notes[ch.id] = notes; growPattern(pat);
    P.patterns.push(pat); S.pat = pat.id;
  });
  if (UI.pr) UI.pr.sel = new Set(pat.notes[ch.id]);
  WM.show('pr');
  toast('Captured ' + notes.length + ' notes into ' + pat.name + (synced ? '' : ' at ' + Math.round(phrase[0].bpm) + ' BPM'));
}

/* --------------------------- MIDI file actions --------------------------- */
function exportPatternMidi(pat) {
  const tracks = P.channels.filter(ch => (pat.notes[ch.id] || []).some(n => !n.mute)).map(ch => ({ name: ch.name, notes: pat.notes[ch.id] }));
  if (!tracks.length) { toast(pat.name + ' has no notes to export'); return; }
  saveFile(safeName(pat.name) + '.mid', writeMidi(tracks, P.bpm), 'audio/midi');
}
let midiInput = null;
function pickMidiFile() {
  if (!midiInput) {
    midiInput = h('input', { type: 'file', accept: '.mid,.midi,audio/midi,audio/x-midi', hidden: true });
    midiInput.addEventListener('change', () => { const f = midiInput.files[0]; midiInput.value = ''; if (f) importMidiFile(f); });
    document.body.append(midiInput);
  }
  midiInput.click();
}
/* A MIDI file becomes a new pattern: one track goes to the selected channel; several tracks can
   go to the selected channel together or to one new NX-3 synth channel each. */
async function importMidiFile(file) {
  let mid;
  try { mid = readMidi(await file.arrayBuffer()); } catch (e) { toast(file.name + ' could not be read: ' + e.message); return; }
  if (!mid.tracks.length) { toast(file.name + ' has no notes'); return; }
  const base = file.name.replace(/\.midi?$/i, '');
  const clampNotes = ns => ns.map(n => ({ t: r2(n.t * 1000) / 1000, len: Math.max(0.05, r2(n.len * 1000) / 1000), key: clamp(n.key, KEY_LO, KEY_HI), vel: n.vel, chance: 1 }));
  const tempoNote = mid.bpm && Math.abs(mid.bpm - P.bpm) > 0.5 ? ' (the file is at ' + Math.round(mid.bpm) + ' BPM; the project stays at ' + P.bpm + ')' : '';
  const intoNew = perTrack => {
    let pat;
    edit(() => {
      pat = newPattern(P.patterns.length + 1); pat.name = base;
      if (perTrack) {
        mid.tracks.forEach((tr, i) => {
          const drum = tr.notes.every(n => n.chn === 9);
          const ch = makeChannel(drum ? { type: 'drum', name: tr.name, kind: 'kick' } : { type: 'synth', name: tr.name, preset: i === 0 ? 'Soft Keys' : 'Saw Lead' });
          P.channels.push(ch); pat.notes[ch.id] = clampNotes(tr.notes);
        });
      } else {
        const ch = selCh() || (() => { const c = makeChannel({ type: 'synth', name: base, preset: 'Soft Keys' }); P.channels.push(c); S.ch = c.id; return c; })();
        pat.notes[ch.id] = clampNotes(mid.tracks.flatMap(t => t.notes)).sort((a, b) => a.t - b.t);
      }
      growPattern(pat); P.patterns.push(pat); S.pat = pat.id;
    });
    if (perTrack && A.ctx) syncAudio();
    WM.show('pr');
    toast('Imported ' + file.name + ' as ' + pat.name + tempoNote);
  };
  if (mid.tracks.length === 1 || !selCh()) { intoNew(mid.tracks.length > 1); return; }
  const ch = selCh();
  dialog('Import ' + file.name, h('p', null, 'This file has ' + mid.tracks.length + ' tracks: ' + mid.tracks.map(t => t.name).join(', ') + '.'), [
    { label: 'Cancel' },
    { label: 'All into ' + ch.name, action: () => intoNew(false) },
    { label: 'One channel per track', primary: true, action: () => intoNew(true) },
  ]);
}

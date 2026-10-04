/* ================================================================
   NXW STUDIO · audio export (WAV / MP3 / stems) and file saving
   ================================================================ */
const EXPORT = { dl: undefined, busy: false };
function initDownloads() {
  try {
    if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then(d => { EXPORT.dl = d || null; }, () => { EXPORT.dl = null; });
    else EXPORT.dl = null;
  } catch (e) { EXPORT.dl = null; }
}
async function downloadsReady() {
  for (let i = 0; i < 40 && EXPORT.dl === undefined; i++) await new Promise(r => setTimeout(r, 100));
  return EXPORT.dl || null;
}
/* Hands a file to the viewer. Inside Claude the viewer confirms the save; elsewhere a normal download starts. */
async function saveFile(name, data, mime) {
  const dl = await downloadsReady();
  if (dl) {
    try { await dl.save({ filename: name, data }); toast('Saved ' + name); return true; }
    catch (e) {
      const code = e && e.code;
      if (code === 'declined') toast('Save cancelled');
      else if (code === 'rate_limited') toast('A save prompt is already open. Finish it, then try again.');
      else if (code === 'too_large') toast('That file is too large to save here. Try MP3 or a shorter range.');
      else if (code === 'rejected_extension' || code === 'extension_not_enabled') toast('This viewer cannot save ' + name.split('.').pop().toUpperCase() + ' files.');
      else toast('The file could not be saved here (' + (code || 'unavailable') + ').');
      return false;
    }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('Downloading ' + name);
    return true;
  } catch (e) { toast('Saving files is not available in this view.'); return false; }
}

/* --------------------------- offline render --------------------------- */
async function renderMix(o, onProg) {
  if (!audio()) throw new Error('Audio is not available in this browser');
  if (A.playing) stop();
  await Promise.all(P.channels.filter(c => c.type === 'sampler' && c.sample).map(c => ensureSample(c.sample)));
  const sd = stepDur();
  let mode = 'song', s0 = 0, s1 = songEnd();
  if (o.range === 'pattern') { mode = 'pat'; s1 = curPat().len * o.loops; }
  else if (o.range === 'loop' && P.playlist.loop) { s0 = P.playlist.loop.a; s1 = P.playlist.loop.b; }
  const sr = o.sr, dur = (s1 - s0) * sd + (o.tail ? 2.5 : 0.08);
  const nCh = o.stems ? 2 + 2 * NINS : 2;
  const oc = new OfflineAudioContext(nCh, Math.ceil(dur * sr), sr);
  oc.destination.channelInterpretation = 'discrete';
  const keys = ['ctx', 'strips', 'ch', 'masterOut', 'scopeAn', 'limiter', 'clipOut', 'live', 'hits', 'chv', 'soloKey', 'lastMaster', 'playMode', 'exporting'];
  const keep = {}; for (const k of keys) keep[k] = A[k];
  const metro = S.metro;
  try {
    Object.assign(A, { ctx: oc, strips: [], ch: new Map(), live: new Set(), hits: new Map(), chv: new Map(), soloKey: null, lastMaster: undefined, exporting: true });
    for (let i = 0; i <= NINS; i++) A.strips.push(new Strip(i));
    syncAudio();
    if (o.stems) {
      const mg = oc.createChannelMerger(nCh), sp = oc.createChannelSplitter(2);
      A.clipOut.disconnect(oc.destination); A.clipOut.connect(sp); sp.connect(mg, 0, 0); sp.connect(mg, 1, 1);
      for (let i = 1; i <= NINS; i++) { A.strips[i].split.connect(mg, 0, 2 * i); A.strips[i].split.connect(mg, 1, 2 * i + 1); }
      mg.connect(oc.destination);
    }
    A.playMode = mode; S.metro = false;
    const plen = curPat().len;
    for (let s = s0; s < s1; s++) scheduleStep(mode === 'pat' ? s % plen : s, 0.02 + (s - s0) * sd, sd);
  } finally { Object.assign(A, keep); S.metro = metro; }
  const chunk = Math.max(0.5, dur / 50);
  for (let t = chunk; t < dur - 0.1; t += chunk) oc.suspend(t).then(() => { onProg && onProg(t / dur); oc.resume(); });
  const buf = await oc.startRendering();
  const ch = i => buf.getChannelData(i);
  const out = { sr, dur, master: [ch(0), ch(1)], stems: [] };
  if (o.stems) for (let i = 1; i <= NINS; i++) {
    const L = ch(2 * i), R = ch(2 * i + 1); let pk = 0;
    for (let j = 0; j < L.length; j += 7) { const a = Math.max(Math.abs(L[j]), Math.abs(R[j])); if (a > pk) pk = a; }
    if (pk > 0.0002) out.stems.push({ i, name: P.mixer[i].name, L, R });
  }
  if (o.normalize) {
    let pk = 0; for (const c of out.master) for (let j = 0; j < c.length; j++) { const a = Math.abs(c[j]); if (a > pk) pk = a; }
    if (pk > 0.0001) { const g = 0.966 / pk; for (const c of out.master) for (let j = 0; j < c.length; j++) c[j] *= g; }
  }
  return out;
}

/* --------------------------- encoders --------------------------- */
function encodeWav(L, R, sr, bits) {
  const n = L.length, bps = bits / 8, align = 2 * bps, len = n * align;
  const buf = new ArrayBuffer(44 + len), v = new DataView(buf), u8 = new Uint8Array(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * align, true); v.setUint16(32, align, true); v.setUint16(34, bits, true); str(36, 'data'); v.setUint32(40, len, true);
  let o = 44;
  if (bits === 16) {
    const lsb = 1 / 32768;
    for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) {
      let s = (c ? R[i] : L[i]) + (Math.random() - Math.random()) * lsb;
      s = s < -1 ? -1 : s > 1 ? 1 : s; v.setInt16(o, Math.round(s * 32767), true); o += 2;
    }
  } else {
    for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) {
      let s = c ? R[i] : L[i]; s = s < -1 ? -1 : s > 1 ? 1 : s;
      const x = Math.round(s * 8388607); u8[o] = x & 255; u8[o + 1] = (x >> 8) & 255; u8[o + 2] = (x >> 16) & 255; o += 3;
    }
  }
  return u8;
}
let lameP = null;
function loadLame() { return lameP || (lameP = window.lamejs ? Promise.resolve() : loadScript(NATIVE.on ? 'vendor/lame.min.js' : 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js').catch(e => { lameP = null; throw e; })); }
async function encodeMp3(L, R, sr, kbps, onProg) {
  await loadLame();
  const enc = new window.lamejs.Mp3Encoder(2, sr, kbps), BLK = 1152, n = L.length;
  const toI16 = (src, off, len) => { const a = new Int16Array(len); for (let i = 0; i < len; i++) { let s = src[off + i]; s = s < -1 ? -1 : s > 1 ? 1 : s; a[i] = s < 0 ? s * 32768 : s * 32767; } return a; };
  const parts = []; let total = 0;
  for (let i = 0, k = 0; i < n; i += BLK, k++) {
    const len = Math.min(BLK, n - i), b = enc.encodeBuffer(toI16(L, i, len), toI16(R, i, len));
    if (b.length) { const u = new Uint8Array(b); parts.push(u); total += u.length; }
    if (k % 150 === 0) { onProg && onProg(i / n); await new Promise(r => setTimeout(r, 0)); }
  }
  const e = enc.flush(); if (e.length) { const u = new Uint8Array(e); parts.push(u); total += u.length; }
  const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* --------------------------- zip (stored) --------------------------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/* --------------------------- export dialog --------------------------- */
const safeName = s => String(s || 'NXW project').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'NXW project';
function exportDialog() {
  if (EXPORT.busy) { toast('An export is already running'); return; }
  if (!audio()) return;
  const o = { range: S.mode === 'pat' ? 'pattern' : 'song', fmt: S.expFmt || 'wav16', kbps: S.expKbps || 320, sr: S.expSr || 44100, loops: 1, tail: S.expTail !== false, normalize: !!S.expNorm, stems: false };
  const sd = stepDur(), pat = curPat(), L = P.playlist.loop;
  const lenOf = () => { const steps = o.range === 'pattern' ? pat.len * o.loops : o.range === 'loop' && L ? L.b - L.a : songEnd(); return steps * sd + (o.tail ? 2.5 : 0); };
  const seg = (items, cur, onPick) => { const s = h('div', { class: 'seg', role: 'group' }); for (const [v, label, dis] of items) { const b = h('button', { class: v === cur() ? 'on' : '', disabled: !!dis, onclick: () => { onPick(v); for (const x of s.children) x.classList.toggle('on', x === b); upd(); } }, label); s.append(b); } return s; };
  const chk = (label, key, hint) => { const i = h('input', { type: 'checkbox', id: 'xp-' + key }); i.checked = !!o[key]; i.onchange = () => { o[key] = i.checked; upd(); }; return h('label', { class: 'xp-chk', for: 'xp-' + key, 'data-hint': hint }, i, h('span', null, label)); };
  const loopsSel = h('select', { class: 'sel-box', id: 'xpLoops', 'aria-label': 'Pattern repeats' }, [1, 2, 4, 8].map(n => h('option', { value: n }, n === 1 ? 'Play once' : n + ' times')));
  loopsSel.onchange = () => { o.loops = +loopsSel.value; upd(); };
  const kbpsSel = h('select', { class: 'sel-box', id: 'xpKbps', 'aria-label': 'MP3 bitrate' }, [128, 192, 256, 320].map(k => h('option', { value: k }, k + ' kbps')));
  kbpsSel.value = String(o.kbps); kbpsSel.onchange = () => { o.kbps = +kbpsSel.value; upd(); };
  const srSel = h('select', { class: 'sel-box', id: 'xpSr', 'aria-label': 'Sample rate' }, [[44100, '44.1 kHz'], [48000, '48 kHz']].map(([v, l]) => h('option', { value: v }, l)));
  srSel.value = String(o.sr); srSel.onchange = () => { o.sr = +srSel.value; upd(); };
  const summary = h('p', { class: 'xp-sum' }), bar = h('i'), prog = h('div', { class: 'xp-prog', hidden: true }, h('div', { class: 'xp-bar' }, bar), h('span', null, '')), pLabel = prog.lastChild;
  const kbRow = h('div', { class: 'xp-row' }, h('span', { class: 'xp-l' }, 'MP3 quality'), kbpsSel);
  const loopRow = h('span', null, loopsSel);
  function upd() {
    kbRow.hidden = o.fmt !== 'mp3'; loopRow.hidden = o.range !== 'pattern';
    const d = lenOf(), bytes = o.fmt === 'mp3' ? d * o.kbps * 125 : d * o.sr * (o.fmt === 'wav24' ? 6 : 4);
    const ext = o.fmt === 'mp3' ? 'MP3' : 'WAV';
    summary.textContent = 'Length ' + Math.floor(d / 60) + ':' + String(Math.round(d % 60)).padStart(2, '0') + ' · about ' + fmtSize(bytes) + (o.stems ? ' plus one ' + ext + ' per mixer track' : '') + '. '
      + (EXPORT.dl ? 'Your ' + ext + (o.stems ? ' files arrive' : ' arrives') + ' inside a .zip, because this viewer only saves a few file types.' : '')
      + (NATIVE.on && o.stems ? 'Stems go into a folder next to the file.' : '');
  }
  const body = h('div', { class: 'xp' },
    h('div', { class: 'xp-row' }, h('span', { class: 'xp-l' }, 'Source'), seg([['song', 'Song'], ['pattern', 'Pattern: ' + pat.name], ['loop', 'Loop region', !L]], () => o.range, v => { o.range = v; }), loopRow),
    h('div', { class: 'xp-row' }, h('span', { class: 'xp-l' }, 'Format'), seg([['wav16', 'WAV 16-bit'], ['wav24', 'WAV 24-bit'], ['mp3', 'MP3']], () => o.fmt, v => { o.fmt = v; })),
    kbRow,
    h('div', { class: 'xp-row' }, h('span', { class: 'xp-l' }, 'Sample rate'), srSel),
    h('div', { class: 'xp-opts' },
      chk('Include the reverb and delay tail', 'tail', 'Adds 2.5 seconds after the last bar'),
      chk('Normalise to −0.3 dB', 'normalize', 'Raises the export so its loudest peak sits just under full scale'),
      chk('Also export each mixer track as a stem', 'stems', 'One extra file per mixer insert that has sound')),
    summary, prog);
  const close = dialog('Export audio', body, [
    { label: 'Cancel', action: () => { if (EXPORT.busy) { EXPORT.cancel = true; return false; } } },
    { label: 'Export', primary: true, action: () => { run(); return false; } },
  ]);
  const dlg = body.closest('.dlg'), btns = dlg.querySelectorAll('.dlg-f .btn');
  upd();
  async function run() {
    if (EXPORT.busy) return;
    EXPORT.busy = true; EXPORT.cancel = false;
    S.expFmt = o.fmt; S.expKbps = o.kbps; S.expSr = o.sr; S.expTail = o.tail; S.expNorm = o.normalize; scheduleSave();
    btns[1].disabled = true; btns[0].textContent = 'Stop'; prog.hidden = false;
    const setP = (f, label) => { bar.style.width = Math.round(clamp(f, 0, 1) * 100) + '%'; pLabel.textContent = label + ' ' + Math.round(clamp(f, 0, 1) * 100) + '%'; };
    try {
      setP(0, 'Rendering');
      if (NATIVE.on) {
        const r = await NATIVE.exportRun(o, pat, setP);
        if (r === 'cancelled') { toast('Export stopped'); close(); }
        else if (r) close();
        else pLabel.textContent = 'Not saved';
        return;
      }
      const mix = await renderMix(o, f => setP(f * 0.6, 'Rendering'));
      if (EXPORT.cancel) throw new Error('cancelled');
      const base = safeName(P.name) + (o.range === 'pattern' ? ' - ' + safeName(pat.name) : o.range === 'loop' ? ' - loop' : '');
      const ext = o.fmt === 'mp3' ? '.mp3' : '.wav';
      const enc = async (Lc, Rc, f0, f1, label) => o.fmt === 'mp3' ? encodeMp3(Lc, Rc, mix.sr, o.kbps, f => setP(f0 + f * (f1 - f0), label)) : (await new Promise(r => setTimeout(r, 0)), encodeWav(Lc, Rc, mix.sr, o.fmt === 'wav24' ? 24 : 16));
      const files = [];
      const total = 1 + mix.stems.length;
      files.push({ name: base + ext, data: await enc(mix.master[0], mix.master[1], 0.6, 0.6 + 0.38 / total, 'Encoding') });
      for (let k = 0; k < mix.stems.length; k++) {
        if (EXPORT.cancel) throw new Error('cancelled');
        const st = mix.stems[k], f0 = 0.6 + 0.38 * (k + 1) / total;
        setP(f0, 'Encoding stems');
        files.push({ name: 'Stems/' + String(st.i).padStart(2, '0') + ' ' + safeName(st.name) + ext, data: await enc(st.L, st.R, f0, f0 + 0.38 / total, 'Encoding stems') });
      }
      if (EXPORT.cancel) throw new Error('cancelled');
      setP(1, 'Saving');
      const dl = await downloadsReady();
      let ok;
      if (dl || files.length > 1) ok = await saveFile(base + '.zip', makeZip(files));
      else ok = await saveFile(files[0].name, new Blob([files[0].data], { type: o.fmt === 'mp3' ? 'audio/mpeg' : 'audio/wav' }));
      if (ok) close();
      else { pLabel.textContent = 'Not saved'; }
    } catch (e) {
      if (e && e.message === 'cancelled') { toast('Export stopped'); close(); }
      else { console.error(e); pLabel.textContent = /lame|load/i.test(e && e.message) ? 'The MP3 encoder could not load. Check your connection or export WAV.' : 'Export failed: ' + (e && e.message || e); }
    } finally {
      EXPORT.busy = false; btns[1].disabled = false; btns[0].textContent = 'Cancel';
    }
  }
}

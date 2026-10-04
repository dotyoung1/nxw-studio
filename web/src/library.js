/* ================================================================
   NXW STUDIO · sample library (IndexedDB) and drum-pack import
   Imported audio is kept in this browser, so it survives a refresh.
   ================================================================ */
const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|opus|flac|m4a|aac|aif|aiff|webm)$/i;
const LIB = { db: null, ready: null, meta: new Map(), mem: new Map(), decoding: new Map(), missing: new Set(), ver: 0, persistent: false };
const idbReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbDone = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
const natCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function libOpen() {
  if (LIB.ready) return LIB.ready;
  LIB.ready = new Promise(res => {
    let req;
    try { req = indexedDB.open('nxw-sample-library', 1); } catch (e) { res(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => { LIB.db = req.result; LIB.persistent = true; res(LIB.db); };
    req.onerror = () => res(null);
    req.onblocked = () => res(null);
    setTimeout(() => res(null), 4000);
  });
  return LIB.ready;
}
async function libLoadIndex() {
  const db = await libOpen(); if (!db) return;
  try {
    const all = await idbReq(db.transaction('meta').objectStore('meta').getAll());
    for (const m of all) LIB.meta.set(m.id, m);
    LIB.ver++;
  } catch (e) { console.warn('library index', e); }
}
async function libBlob(id) {
  if (LIB.mem.has(id)) return LIB.mem.get(id);
  const db = await libOpen(); if (!db) return null;
  try { return await idbReq(db.transaction('blobs').objectStore('blobs').get(id)); } catch (e) { return null; }
}
function libSaveMeta(m) {
  if (!LIB.db) return;
  try { LIB.db.transaction('meta', 'readwrite').objectStore('meta').put(m); } catch (e) { /* ignore */ }
}
/* Adds files to the library. items: [{file, pack, path}]. Returns the new ids. */
async function libAdd(items, onProgress) {
  const db = await libOpen(), ids = [];
  for (let i = 0; i < items.length; i += 40) {
    const chunk = items.slice(i, i + 40), metas = [];
    for (const it of chunk) {
      const id = uid(), f = it.file;
      const m = { id, name: (it.name || f.name || 'Sample').replace(/\.[^.]+$/, ''), file: it.name || f.name || 'sample.wav', pack: it.pack || 'Imported', path: it.path || '', size: f.size || 0, added: Date.now() };
      metas.push([m, f]); ids.push(id);
    }
    if (db) {
      try {
        const tx = db.transaction(['meta', 'blobs'], 'readwrite');
        for (const [m, f] of metas) { tx.objectStore('meta').put(m); tx.objectStore('blobs').put(f, m.id); }
        await idbDone(tx);
      } catch (e) { for (const [m, f] of metas) LIB.mem.set(m.id, f); toast('Browser storage is full or blocked. These sounds stay until you close the page.'); }
    } else for (const [m, f] of metas) LIB.mem.set(m.id, f);
    for (const [m] of metas) LIB.meta.set(m.id, m);
    if (onProgress) onProgress(Math.min(items.length, i + chunk.length), items.length);
  }
  LIB.ver++;
  return ids;
}
async function libDelete(ids) {
  const db = await libOpen();
  if (db) { try { const tx = db.transaction(['meta', 'blobs'], 'readwrite'); for (const id of ids) { tx.objectStore('meta').delete(id); tx.objectStore('blobs').delete(id); } await idbDone(tx); } catch (e) { /* ignore */ } }
  for (const id of ids) { LIB.meta.delete(id); LIB.mem.delete(id); A.samples.delete(id); if (NATIVE.on) NATIVE.call('forgetSample', id); }
  LIB.ver++;
}
function reverseBuffer(buf) {
  const rev = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let i = 0; i < buf.numberOfChannels; i++) { const s = buf.getChannelData(i), d = rev.getChannelData(i); for (let j = 0, n = s.length; j < n; j++) d[j] = s[n - 1 - j]; }
  return rev;
}
function peaksOf(buf, N = 400) {
  const peaks = new Float32Array(N * 2), d0 = buf.getChannelData(0), per = Math.max(1, Math.floor(d0.length / N));
  for (let i = 0; i < N; i++) { let mn = 0, mx = 0; for (let j = i * per, e = Math.min(d0.length, (i + 1) * per); j < e; j++) { const v = d0[j]; if (v < mn) mn = v; if (v > mx) mx = v; } peaks[i * 2] = mn; peaks[i * 2 + 1] = mx; }
  return peaks;
}
function decodeCtx() { return (A.ctx && A.ctx.decodeAudioData ? A.ctx : null) || LIB.dctx || (LIB.dctx = new OfflineAudioContext(2, 1, 48000)); }
function decodeData(ab) { const c = decodeCtx(); return new Promise((res, rej) => { const pr = c.decodeAudioData(ab, res, rej); if (pr && pr.catch) pr.catch(rej); }); }
/* Decodes a library sample on first use; later calls share the same promise or the cached buffer. */
function ensureSample(id) {
  if (!id) return Promise.resolve(null);
  if (A.samples.has(id)) return Promise.resolve(A.samples.get(id));
  const m0 = LIB.meta.get(id);
  if ((m0 && m0.bad) || LIB.missing.has(id)) return Promise.resolve(null);
  if (LIB.decoding.has(id)) return LIB.decoding.get(id);
  const p = (async () => {
    const blob = await libBlob(id); if (!blob) { LIB.missing.add(id); return null; }
    const buf = await decodeData(await blob.arrayBuffer());
    const m = LIB.meta.get(id) || { name: 'Sample' };
    const s = { id, name: m.name, buf, rev: null, peaks: peaksOf(buf), dur: buf.duration };
    A.samples.set(id, s);
    if (m.id && !m.dur) { m.dur = buf.duration; m.sr = buf.sampleRate; m.chans = buf.numberOfChannels; libSaveMeta(m); }
    clearTimeout(LIB.rt); LIB.rt = setTimeout(renderAll, 80);   // channels waiting on this sound update their state
    return s;
  })().catch(e => { const m = LIB.meta.get(id); if (m) { m.bad = true; } return null; }).finally(() => LIB.decoding.delete(id));
  LIB.decoding.set(id, p);
  return p;
}
function sampleName(id) { const s = A.samples.get(id); if (s) return s.name; const m = LIB.meta.get(id); return m ? m.name : null; }
async function loadProjectSamples() {
  const ids = [...new Set(P.channels.filter(c => c.type === 'sampler' && c.sample).map(c => c.sample))];
  await Promise.all(ids.map(ensureSample));
  if (ids.length) { VER++; renderAll(); }
}

/* --------------------------- importing --------------------------- */
let importBusy = false;
async function runImport(items, label) {
  if (!items.length) { toast('No audio files found. Supported: WAV, MP3, OGG, FLAC, M4A, AIFF.'); return []; }
  importBusy = true;
  const t = h('div', { class: 'toast', role: 'status' }, label + ' · 0 of ' + items.length);
  for (const o of $$('.toast')) o.remove();
  document.body.append(t);
  try {
    const ids = await libAdd(items, (n, all) => { t.textContent = label + ' · ' + n + ' of ' + all; });
    t.textContent = label + ' · ' + items.length + (items.length === 1 ? ' sound added' : ' sounds added') + (LIB.persistent ? ', saved in this browser' : '');
    setTimeout(() => t.classList.add('out'), 2200); setTimeout(() => t.remove(), 2700);
    if (UI.br) { UI.br.revealPack(items[0].pack); UI.br.render(); }
    return ids;
  } finally { importBusy = false; }
}
/* A folder chosen with the folder picker: the top folder becomes the pack, subfolders are kept. */
async function importFolderFiles(fileList) {
  const items = [];
  for (const f of fileList) {
    if (!AUDIO_EXT.test(f.name) || f.name.startsWith('.')) continue;
    const parts = (f.webkitRelativePath || f.name).split('/').filter(Boolean);
    const pack = parts.length > 1 ? parts[0] : 'Imported';
    items.push({ file: f, name: f.name, pack, path: parts.slice(1, -1).join('/') });
  }
  return runImport(items, 'Importing ' + (items[0] ? items[0].pack : 'pack'));
}
let jszipP = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(s); });
}
function loadJSZip() { return jszipP || (jszipP = window.JSZip ? Promise.resolve() : loadScript(NATIVE.on ? 'vendor/jszip.min.js' : 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js').catch(e => { jszipP = null; throw e; })); }
async function importZip(file) {
  try { await loadJSZip(); } catch (e) { toast('The zip reader could not load. Unzip the pack and import the folder instead.'); return []; }
  let zip;
  try { zip = await window.JSZip.loadAsync(file); } catch (e) { toast(file.name + ' is not a readable zip file.'); return []; }
  const entries = [];
  zip.forEach((rel, entry) => {
    if (entry.dir || /(^|\/)(__MACOSX|\.)/.test(rel)) return;
    if (AUDIO_EXT.test(rel)) entries.push([rel, entry]);
  });
  const tops = new Set(entries.map(([rel]) => rel.split('/')[0]));
  const single = tops.size === 1 && entries.every(([rel]) => rel.includes('/'));
  const pack = single ? [...tops][0] : file.name.replace(/\.zip$/i, '');
  const items = [];
  for (const [rel, entry] of entries) {
    const parts = rel.split('/').filter(Boolean), name = parts[parts.length - 1];
    const blob = await entry.async('blob');
    items.push({ file: new File([blob], name), name, pack, path: parts.slice(single ? 1 : 0, -1).join('/') });
  }
  return runImport(items, 'Importing ' + pack);
}
/* Drag and drop from the desktop: folders, zip packs and loose audio files. */
async function readEntryTree(entry, base, out) {
  if (entry.isFile) {
    await new Promise(res => entry.file(f => { out.push({ file: f, rel: base + f.name }); res(); }, () => res()));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise(res => reader.readEntries(res, () => res([])));
      if (!batch.length) break;
      for (const e of batch) await readEntryTree(e, base + entry.name + '/', out);
    }
  }
}
async function importDataTransfer(dt) {
  const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const files = [];
  if (entries.length) for (const e of entries) await readEntryTree(e, '', files);
  else for (const f of dt.files || []) files.push({ file: f, rel: f.name });
  const zips = files.filter(x => /\.zip$/i.test(x.file.name));
  const items = [];
  for (const { file, rel } of files) {
    if (!AUDIO_EXT.test(file.name) || file.name.startsWith('.')) continue;
    const parts = rel.split('/').filter(Boolean);
    items.push({ file, name: file.name, pack: parts.length > 1 ? parts[0] : 'Imported', path: parts.slice(1, -1).join('/') });
  }
  let ids = [];
  if (items.length) ids = await runImport(items, 'Importing ' + (items[0].pack === 'Imported' ? 'sounds' : items[0].pack));
  for (const z of zips) await importZip(z.file);
  return { ids, items };
}

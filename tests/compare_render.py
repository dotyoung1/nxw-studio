#!/usr/bin/env python3
"""Compares the desktop engine with the browser engine on the same project.

Renders the project twice, once with the web version (Chromium's Web Audio, through
Playwright) and once with the desktop app's headless renderer, then compares loudness
over time and tone (energy per frequency band) for the master and for every mixer stem.
The engines use random noise and free-running oscillators, so the waveforms are never
identical; matching envelopes and spectra within a dB or two means they sound the same.

  python tests/compare_render.py "build/linux/NXWStudio_artefacts/Release/NXW Studio" [project.json]
"""
import asyncio, json, pathlib, subprocess, sys, tempfile
import numpy as np
from scipy.io import wavfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
BANDS = [(20, 120), (120, 400), (400, 1500), (1500, 5000), (5000, 16000)]
PRE_ROLL = 0.02


async def browser_render(project, sr):
    from playwright.async_api import async_playwright
    subprocess.run([sys.executable, str(ROOT / 'web/build.py'), 'browser'], check=True, stdout=subprocess.DEVNULL)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page()
        await pg.route('https://**', lambda r: r.abort())
        await pg.goto((ROOT / 'web/dist/test.html').as_uri())
        await pg.wait_for_timeout(400)
        out = await pg.evaluate('''async ([proj, sr]) => {
            P = proj; S.pat = proj.ui.pat; S.mode = proj.ui.mode; afterLoad();
            const mix = await renderMix({ range: proj.ui.mode === 'pat' ? 'pattern' : 'song', loops: 1, sr, tail: true, normalize: false, stems: true });
            const enc = a => { const u = new Uint8Array(new Float32Array(a).buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
            return { master: [enc(mix.master[0]), enc(mix.master[1])], stems: mix.stems.map(s => ({ i: s.i, L: enc(s.L), R: enc(s.R) })) };
        }''', [project, sr])
        await b.close()
    import base64
    dec = lambda s: np.frombuffer(base64.b64decode(s), dtype=np.float32)
    master = np.stack([dec(out['master'][0]), dec(out['master'][1])], axis=1)
    stems = {s['i']: np.stack([dec(s['L']), dec(s['R'])], axis=1) for s in out['stems']}
    return master, stems


def native_render(exe, project_path, tmp):
    out = pathlib.Path(tmp) / 'native.wav'
    r = subprocess.run([exe, '--nxw-render', str(project_path), str(out), '--stems'], capture_output=True, text=True, timeout=600)
    print(r.stdout.strip())
    if r.returncode != 0:
        raise SystemExit('native render failed: ' + r.stderr)
    _, master = wavfile.read(out)
    stems = {}
    for f in sorted(pathlib.Path(tmp).glob('native-stem*.wav')):
        stems[int(f.stem[-2:])] = wavfile.read(f)[1]
    return master, stems


def envelope_db(x, sr, win=0.5):
    n = int(sr * win)
    m = x.mean(axis=1) if x.ndim > 1 else x
    frames = len(m) // n
    rms = np.sqrt(np.mean(m[:frames * n].reshape(frames, n) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms + 1e-9)


def band_db(x, sr):
    m = x.mean(axis=1) if x.ndim > 1 else x
    spec = np.abs(np.fft.rfft(m * np.hanning(len(m)))) ** 2
    f = np.fft.rfftfreq(len(m), 1 / sr)
    tot = spec.sum() + 1e-20
    return [10 * np.log10(spec[(f >= a) & (f < b)].sum() / tot + 1e-12) for a, b in BANDS]


def compare(name, a, b, sr, lead=0.0):
    a = a[int(round((PRE_ROLL + lead) * sr)):]   # the browser export starts its first step 20 ms in
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    ea, eb = envelope_db(a, sr), envelope_db(b, sr)
    loud = ea > -50
    env_err = float(np.median(np.abs(ea[loud] - eb[loud]))) if loud.any() else 0.0
    ra, rb = 20 * np.log10(np.sqrt(np.mean(a ** 2)) + 1e-12), 20 * np.log10(np.sqrt(np.mean(b ** 2)) + 1e-12)
    ba, bb = band_db(a, sr), band_db(b, sr)
    band_err = max(abs(x - y) for x, y in zip(ba, bb) if x > -40 or y > -40)
    ok = abs(ra - rb) < 1.5 and env_err < 2.0 and band_err < 3.0
    print(f'{name:<16} browser {ra:6.1f} dB  desktop {rb:6.1f} dB  envelope diff {env_err:4.1f} dB  tone diff {band_err:4.1f} dB  {"OK" if ok else "CHECK"}')
    print('                 bands browser ' + ' '.join(f'{v:6.1f}' for v in ba))
    print('                 bands desktop ' + ' '.join(f'{v:6.1f}' for v in bb))
    return ok


def main():
    exe = sys.argv[1]
    project_path = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'tests/demo.json')
    project = json.loads(project_path.read_text())
    sr = 44100
    with tempfile.TemporaryDirectory() as tmp:
        bm, bs = asyncio.run(browser_render(project, sr))
        nm, ns = native_render(exe, project_path, tmp)
    print(f'lengths: browser {len(bm) / sr:.2f} s, desktop {len(nm) / sr:.2f} s')
    # The browser's master also carries the limiter's 6 ms look-ahead; the desktop export removes it.
    results = [compare('master', bm, nm, sr, lead=int(0.006 * sr) / sr)]
    for i in sorted(set(bs) | set(ns)):
        if i not in bs or i not in ns:
            print(f'insert {i}: only in {"browser" if i in bs else "desktop"}')
            results.append(False)
            continue
        results.append(compare(project['mixer'][i]['name'][:16], bs[i], ns[i], sr))
    print('ALL OK' if all(results) else 'DIFFERENCES FOUND')
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Builds the NXW Studio interface.

  python web/build.py            both flavours
  python web/build.py browser    dist/nxw-studio.html (the web version) and dist/test.html
  python web/build.py desktop    dist/desktop/index.html, bundled into the desktop app

The two flavours share every line of interface code. The desktop page loads its fonts
and helper libraries from inside the app instead of the internet, and native.js swaps
the Web Audio engine for the app's native engine.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / 'src'
DIST = ROOT / 'dist'
ORDER = ['core.js', 'native.js', 'audio.js', 'tools.js', 'library.js', 'export.js', 'shell.js', 'browser.js', 'rack.js',
         'pianoroll.js', 'playlist.js', 'mixer.js', 'instrument.js', 'main.js']

FONT_FACES = """
@font-face { font-family: 'Archivo'; src: url(fonts/archivo.woff2) format('woff2'); font-weight: 400 800; font-stretch: 62% 125%; font-display: block; }
@font-face { font-family: 'Martian Mono'; src: url(fonts/martian-mono.woff2) format('woff2'); font-weight: 400 600; font-stretch: 75% 112.5%; font-display: block; }
@font-face { font-family: 'Unbounded'; src: url(fonts/unbounded-600.woff2) format('woff2'); font-weight: 600; font-display: block; }
@font-face { font-family: 'Unbounded'; src: url(fonts/unbounded-700.woff2) format('woff2'); font-weight: 700; font-display: block; }
"""
BASE = ":root{color-scheme:dark}html,body{margin:0;height:100%;background:#14181c;overflow:hidden}body{font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}"


def script():
    return '\n'.join((SRC / f).read_text(encoding='utf-8') for f in ORDER)


def head():
    return (SRC / 'head.html').read_text(encoding='utf-8')


def browser():
    js, html = script(), head() + '\n<script>\n' + script() + '\n</script>\n'
    DIST.mkdir(exist_ok=True)
    (DIST / 'app.js').write_text(js, encoding='utf-8')
    (DIST / 'nxw-studio.html').write_text(html, encoding='utf-8')
    page = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
            '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>'
            '</head><body>' + html + '</body></html>')
    (DIST / 'test.html').write_text(page, encoding='utf-8')
    print('browser:', len(html), 'bytes')


def js_ascii(s):
    """Non-ASCII characters as \\u escapes (they only occur in strings, regexes and comments)."""
    out = []
    for ch in s:
        o = ord(ch)
        if o < 128: out.append(ch)
        elif o <= 0xFFFF: out.append('\\u%04x' % o)
        else:
            o -= 0x10000
            out.append('\\u%04x\\u%04x' % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)))
    return ''.join(out)


def html_ascii(s):
    """Character references in markup, CSS escapes inside <style>."""
    def css(m):
        return re.sub(r'[^\x00-\x7f]', lambda c: '\\%x ' % ord(c.group()), m.group())
    parts = re.split(r'(<style[^>]*>.*?</style>)', s, flags=re.S)
    return ''.join(css(re.match(r'.*', p, re.S)) if p.startswith('<style') else
                   re.sub(r'[^\x00-\x7f]', lambda c: '&#x%x;' % ord(c.group()), p) for p in parts)


def desktop(out=None):
    body = re.sub(r'<link [^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*', '', head())
    if 'fonts.googleapis' in body:
        raise SystemExit('desktop build: an online font link is still in head.html')
    # Pure ASCII, so no web view can get the text encoding wrong.
    page = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<title>NXW Studio</title><style>' + FONT_FACES + BASE + '</style></head><body>\n'
            + html_ascii(body) + '\n<script>\n' + js_ascii(script()) + '\n</script>\n</body></html>\n')
    if any(ord(c) > 127 for c in page):
        raise SystemExit('desktop build: non-ASCII text left in the page')
    out = pathlib.Path(out) if out else DIST / 'desktop' / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding='utf-8')
    print('desktop:', len(page), 'bytes ->', out)


if __name__ == '__main__':
    args = sys.argv[1:]
    what = args[0] if args else 'all'
    if what in ('all', 'browser'): browser()
    if what in ('all', 'desktop'): desktop(args[1] if len(args) > 1 else None)

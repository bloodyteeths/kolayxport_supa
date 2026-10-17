"""
Builds the KolayXport logo set as clean SVG (GTM Phase 2). Reproducible:

    python3 -m venv .venv-brand && .venv-brand/bin/pip install uharfbuzz fonttools
    .venv-brand/bin/python scripts/brand/build-logo.py

The wordmark is "KolayXport" set in Fraunces (OFL), shaped with HarfBuzz (real kerning) and
converted to outlines, so the SVGs need no font. The symbol is drawn by hand below.
Outputs go to public/brand/. Colours are the brand tokens in docs/brand.md.
"""
import io, os, urllib.request
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'brand')
CACHE = os.path.join(ROOT, '.cache', 'fonts')
FRAUNCES_URL = 'https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf'

INK, PAPER, ACCENT = '#0E1A2B', '#FAF7F0', '#2B45E0'
AXES = {'wght': 640, 'opsz': 72, 'SOFT': 100, 'WONK': 0}


def font_bytes():
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, 'Fraunces.ttf')
    if not os.path.exists(p):
        urllib.request.urlretrieve(FRAUNCES_URL, p)
    vf = TTFont(p)
    inst = instantiateVariableFont(vf, AXES)
    buf = io.BytesIO(); inst.save(buf)
    return buf.getvalue()


def shape(text, data):
    face = hb.Face(data); f = hb.Font(face)
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(f, buf, {'kern': True, 'liga': True})
    return buf.glyph_infos, buf.glyph_positions, face.upem


def wordmark_paths(text, colors, size, x0, baseline, tracking=-0.01):
    """Returns (svg, width). colors: list per character."""
    data = font_bytes()
    tt = TTFont(io.BytesIO(data)); gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
    infos, poss, upem = shape(text, data)
    scale = size / upem
    x = x0; parts = []
    for info, pos in zip(infos, poss):
        name = order[info.codepoint]
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (scale, 0, 0, -scale, x + pos.x_offset * scale, baseline - pos.y_offset * scale))
        gs[name].draw(tp)
        d = pen.getCommands()
        if d:
            parts.append(f'<path fill="{colors[info.cluster]}" d="{d}"/>')
        x += pos.x_advance * scale + tracking * size
    return '\n  '.join(parts), x - x0


def symbol(tile=INK, arm=PAPER, arrow=ACCENT, x=0, y=0, s=64):
    k = s / 64
    g = lambda v: round(v * k, 3)
    return f'''<g transform="translate({x} {y})">
    <rect width="{g(64)}" height="{g(64)}" rx="{g(15)}" fill="{tile}"/>
    <path d="M{g(18)} {g(18)}L{g(46)} {g(46)}" stroke="{arm}" stroke-width="{g(8.5)}" stroke-linecap="round"/>
    <path d="M{g(25)} {g(39)}L{g(39)} {g(25)}" stroke="{tile}" stroke-width="{g(14)}" stroke-linecap="butt"/>
    <path d="M{g(18.5)} {g(45.5)}L{g(44)} {g(20)}M{g(30)} {g(19)}H{g(45)}V{g(34)}" stroke="{arrow}" stroke-width="{g(8.5)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>'''


def symbol_mono(x=0, y=0, s=64):
    k = s / 64
    g = lambda v: round(v * k, 3)
    return f'''<defs><mask id="kx-cut" maskUnits="userSpaceOnUse">
    <rect x="{x}" y="{y}" width="{g(64)}" height="{g(64)}" fill="#fff"/>
    <g transform="translate({x} {y})" stroke="#000" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M{g(18)} {g(18)}L{g(26)} {g(26)}M{g(38)} {g(38)}L{g(46)} {g(46)}" stroke-width="{g(8.5)}"/>
      <path d="M{g(18.5)} {g(45.5)}L{g(44)} {g(20)}M{g(30)} {g(19)}H{g(45)}V{g(34)}" stroke-width="{g(8.5)}"/>
    </g></mask></defs>
  <rect x="{x}" y="{y}" width="{g(64)}" height="{g(64)}" rx="{g(15)}" fill="currentColor" mask="url(#kx-cut)"/>'''


def svg(w, h, body, title='KolayXport'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {round(w,2)} {round(h,2)}" width="{round(w,2)}" height="{round(h,2)}" role="img" aria-label="{title}">\n  <title>{title}</title>\n  {body}\n</svg>\n'


def main():
    os.makedirs(OUT, exist_ok=True)
    text = 'KolayXport'
    def cols(ink, accent):
        return [accent if ch == 'X' else ink for ch in text]

    # Symbol
    open(os.path.join(OUT, 'kolayxport-symbol.svg'), 'w').write(svg(64, 64, symbol()))
    open(os.path.join(OUT, 'kolayxport-symbol-dark.svg'), 'w').write(svg(64, 64, symbol(tile=PAPER, arm=INK, arrow=ACCENT)))
    open(os.path.join(OUT, 'kolayxport-symbol-mono.svg'), 'w').write(svg(64, 64, symbol_mono()))

    # Favicon: the export arrow alone, thicker, readable at 16px
    fav = f'''<rect width="64" height="64" rx="14" fill="{INK}"/>
  <path d="M17 47L45 19M27 18H46V37" stroke="{PAPER}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'''
    open(os.path.join(OUT, 'favicon.svg'), 'w').write(svg(64, 64, fav))

    # Horizontal logo: symbol 64 + gap 16 + wordmark (cap height ~ 0.55 of symbol)
    size = 46
    for name, ink, tile, arm, accent in (
        ('kolayxport-logo.svg', INK, INK, PAPER, ACCENT),
        ('kolayxport-logo-dark.svg', PAPER, PAPER, INK, '#8EA0FF'),
    ):
        wm, w = wordmark_paths(text, cols(ink, accent), size, 80, 47)
        body = symbol(tile=tile, arm=arm, arrow=ACCENT if name == 'kolayxport-logo.svg' else ACCENT) + '\n  ' + wm
        open(os.path.join(OUT, name), 'w').write(svg(80 + w + 2, 64, body))

    # Wordmark only
    wm, w = wordmark_paths(text, cols(INK, ACCENT), 46, 0, 40)
    open(os.path.join(OUT, 'kolayxport-wordmark.svg'), 'w').write(svg(w + 2, 52, wm))
    # Mono horizontal (currentColor) for single-colour use (stamps, partner pages)
    wm, w = wordmark_paths(text, ['currentColor'] * len(text), size, 80, 47)
    open(os.path.join(OUT, 'kolayxport-logo-mono.svg'), 'w').write(svg(80 + w + 2, 64, symbol_mono() + '\n  ' + wm))
    print('written to', OUT)


if __name__ == '__main__':
    main()

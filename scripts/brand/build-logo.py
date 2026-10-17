"""
Builds the KolayXport logo set as clean SVG ("Blade", approved 2026-10-17). Reproducible:

    python3 -m venv .venv-brand && .venv-brand/bin/pip install uharfbuzz fonttools
    .venv-brand/bin/python scripts/brand/build-logo.py

Concept: Kolay Export -> kolayXport. "kolay" and "port" are set in Plus Jakarta Sans ExtraBold (OFL),
shaped with HarfBuzz (real kerning) and converted to outlines, so the SVGs need no font. The X is drawn:
its "\\" stroke is ink, its "/" stroke is a blade that shoots up and out of the word (the hit point),
in the brand gradient. Outputs go to public/brand/. Colours are the brand tokens in docs/brand.md.
"""
import io, math, os, urllib.request
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'brand')
CACHE = os.path.join(ROOT, '.cache', 'fonts')
JAKARTA_URL = 'https://github.com/google/fonts/raw/main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf'

INK, WHITE = '#0B1220', '#FFFFFF'
BLUE, CYAN = '#2F5BFF', '#00C6FF'
SIZE = 100          # font size in SVG units
TAIL = 0.6          # how far the blade shoots past the X, in cap heights


def font_bytes():
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, 'PlusJakartaSans.ttf')
    if not os.path.exists(p):
        urllib.request.urlretrieve(JAKARTA_URL, p)
    inst = instantiateVariableFont(TTFont(p), {'wght': 800})
    buf = io.BytesIO(); inst.save(buf)
    return buf.getvalue()


class BoundsAcc:
    def __init__(self): self.b = None
    def add(self, x, y):
        self.b = (x, y, x, y) if self.b is None else (min(self.b[0], x), min(self.b[1], y), max(self.b[2], x), max(self.b[3], y))
    def add_box(self, box):
        if box: self.add(box[0], box[1]); self.add(box[2], box[3])
    def merge(self, other):
        if other.b: self.add_box(other.b)


class Text:
    def __init__(self, data):
        self.data = data
        self.tt = TTFont(io.BytesIO(data)); self.gs = self.tt.getGlyphSet(); self.order = self.tt.getGlyphOrder()
        upem = self.tt['head'].unitsPerEm
        self.cap = self.tt['OS/2'].sCapHeight * SIZE / upem
        bp = BoundsPen(self.gs); self.gs[self.tt.getBestCmap()[ord('l')]].draw(bp)
        self.stem = (bp.bounds[2] - bp.bounds[0]) * SIZE / upem

    def run(self, text, x0, base, fill, track=-0.02):
        """Outlined text; returns (svg, advance, bounds)."""
        face = hb.Face(self.data); f = hb.Font(face); buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
        hb.shape(f, buf, {'kern': True})
        sc = SIZE / face.upem; x = x0; out = []; bounds = BoundsAcc()
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            g = self.gs[self.order[info.codepoint]]
            t = (sc, 0, 0, -sc, x + pos.x_offset * sc, base)
            pen = SVGPathPen(self.gs); g.draw(TransformPen(pen, t))
            bp = BoundsPen(self.gs); g.draw(TransformPen(bp, t)); bounds.add_box(bp.bounds)
            d = pen.getCommands()
            if d: out.append(d)
            x += pos.x_advance * sc + track * SIZE
        return f'<path fill="{fill}" d="{" ".join(out)}"/>', x - x0, bounds


def f1(v): return f'{v:.1f}'.rstrip('0').rstrip('.')


def poly_d(p): return 'M' + ' L'.join(f'{f1(x)} {f1(y)}' for x, y in p) + ' Z'


def stroke_poly(x1, y1, x2, y2, w0, w1):
    dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy); nx, ny = -dy / L, dx / L
    return [(x1 + nx * w0 / 2, y1 + ny * w0 / 2), (x2 + nx * w1 / 2, y2 + ny * w1 / 2),
            (x2 - nx * w1 / 2, y2 - ny * w1 / 2), (x1 - nx * w0 / 2, y1 - ny * w0 / 2)]


def clip_y(points, y, keep_below):
    """Sutherland–Hodgman clip of a polygon against a horizontal line."""
    out = []
    for i in range(len(points)):
        a, b = points[i], points[(i + 1) % len(points)]
        ina = (a[1] >= y) if keep_below else (a[1] <= y)
        inb = (b[1] >= y) if keep_below else (b[1] <= y)
        if ina: out.append(a)
        if ina != inb:
            t = (y - a[1]) / (b[1] - a[1]); out.append((a[0] + t * (b[0] - a[0]), y))
    return out


def blade_x(L, base, cap, s, ink, blade_fill, tail=TAIL):
    """The X: ink '\\' stroke cut flat at cap height and baseline, plus a tapering blade for '/'.
    Returns (svg, width, bounds, (blade_start, blade_end))."""
    w = cap * 0.9; R = L + w; T = base - cap
    dx, dy = (R - L - s * 0.64), cap
    k = s / cap  # extend past the cut lines so the flat cuts are full width
    back = stroke_poly(L + s * 0.32 - dx * k, T - dy * k, R - s * 0.32 + dx * k, base + dy * k, s, s)
    back = clip_y(clip_y(back, T, True), base, False)
    start = (L + s * 0.32, base)
    end = (R + cap * tail, T - cap * tail * 0.66)
    bx, by = end[0] - start[0], end[1] - start[1]
    blade = stroke_poly(start[0] - bx * 0.08, start[1] - by * 0.08, end[0], end[1], s * 1.04, s * 0.04)
    blade = clip_y(blade, base, False)
    b = BoundsAcc()
    for x, y in back + blade: b.add(x, y)
    return f'<path fill="{ink}" d="{poly_d(back)}"/><path fill="{blade_fill}" d="{poly_d(blade)}"/>', w, b, (start, end)


def gradient(gid, start, end):
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{f1(start[0])}" y1="{f1(start[1])}" '
            f'x2="{f1(end[0])}" y2="{f1(end[1])}"><stop offset="0" stop-color="{BLUE}"/><stop offset="1" stop-color="{CYAN}"/></linearGradient>')


def svg_doc(box, body, defs='', pad=2.0):
    x0, y0, x1, y1 = box
    vb = f'{f1(x0 - pad)} {f1(y0 - pad)} {f1(x1 - x0 + 2 * pad)} {f1(y1 - y0 + 2 * pad)}'
    d = f'<defs>{defs}</defs>' if defs else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="KolayXport"><title>KolayXport</title>{d}{body}</svg>\n'


def fill_for(blade, gid): return f'url(#{gid})' if blade == 'gradient' else blade


def lockup(t, ink, blade, gid):
    """The logo: 'kolayXport'. blade = 'gradient' or a solid colour (mono versions)."""
    a, wa, ba = t.run('kolay', 0, 0, ink)
    xl = wa + SIZE * 0.13
    xs, wx, bx, (st, en) = blade_x(xl, 0, t.cap, t.stem * 1.08, ink, fill_for(blade, gid))
    b, _, bb = t.run('port', xl + wx + SIZE * 0.07, 0, ink)
    box = BoundsAcc(); box.merge(ba); box.merge(bx); box.merge(bb)
    return svg_doc(box.b, a + xs + b, gradient(gid, st, en) if blade == 'gradient' else '')


def mark(ink, blade, gid, tile=None, radius=23):
    """The X alone. tile=None -> bare mark (transparent); else a 100x100 app tile."""
    if tile is None:
        xs, _, bx, (st, en) = blade_x(0, 48, 48, 13, ink, fill_for(blade, gid), tail=0.42)
        return svg_doc(bx.b, xs, gradient(gid, st, en) if blade == 'gradient' else '')
    xs, _, _, (st, en) = blade_x(22, 74, 48, 13, ink, fill_for(blade, gid), tail=0.42)
    rx = f' rx="{radius}"' if radius else ''
    rect = f'<rect width="100" height="100"{rx} fill="{tile}"/>'
    return svg_doc((0, 0, 100, 100), rect + xs, gradient(gid, st, en) if blade == 'gradient' else '', pad=0)


def main():
    os.makedirs(OUT, exist_ok=True)
    t = Text(font_bytes())
    files = {
        'kolayxport-logo.svg': lockup(t, INK, 'gradient', 'kxg'),             # light backgrounds (default)
        'kolayxport-logo-dark.svg': lockup(t, WHITE, 'gradient', 'kxg'),       # dark backgrounds
        'kolayxport-logo-mono.svg': lockup(t, INK, INK, 'kxg'),                # one colour, dark
        'kolayxport-logo-mono-white.svg': lockup(t, WHITE, WHITE, 'kxg'),      # one colour, white
        'kolayxport-symbol.svg': mark(WHITE, 'gradient', 'kxs', tile=INK),     # app icon (rounded tile)
        'kolayxport-symbol-light.svg': mark(INK, 'gradient', 'kxs', tile=WHITE),
        'kolayxport-symbol-square.svg': mark(WHITE, 'gradient', 'kxs', tile=INK, radius=0),  # avatars (platform crops)
        'kolayxport-mark.svg': mark(INK, 'gradient', 'kxm'),                   # bare X on light
        'kolayxport-mark-dark.svg': mark(WHITE, 'gradient', 'kxm'),            # bare X on dark
        'kolayxport-mark-mono.svg': mark(INK, INK, 'kxm'),
        'favicon.svg': mark(WHITE, 'gradient', 'kxf', tile=INK),
    }
    for name, content in files.items():
        with open(os.path.join(OUT, name), 'w') as fh: fh.write(content)
    for old in ['kolayxport-wordmark.svg', 'kolayxport-symbol-dark.svg', 'kolayxport-symbol-mono.svg']:
        p = os.path.join(OUT, old)
        if os.path.exists(p): os.remove(p)
    print('\n'.join(sorted(files)))


if __name__ == '__main__':
    main()

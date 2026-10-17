"""
Builds the marketing web fonts as tight subsets (GTM perf budget: LCP < 2 s on mobile 4G).

    .venv-brand/bin/pip install fonttools brotli uharfbuzz
    .venv-brand/bin/python scripts/brand/subset-fonts.py

- Fraunces: SOFT pinned to 100 (the logo's rounded serifs), opsz pinned to 72, weight range 500–600.
- Instrument Sans: width pinned to 100, weight range 400–600.
- Glyphs: Basic Latin + Latin-1 + Turkish (ğ Ğ ı İ ş Ş) + the punctuation/symbols the copy uses (₺ – — ' ' " " … • → ·).
Writes public/fonts/*.woff2, loaded by components/site/fonts.ts (next/font/local).
"""
import io, os, urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, '.cache', 'fonts')
OUT = os.path.join(ROOT, 'public', 'fonts')
SRC = {
    'Fraunces.ttf': 'https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf',
    'InstrumentSans.ttf': 'https://github.com/google/fonts/raw/main/ofl/instrumentsans/InstrumentSans%5Bwdth,wght%5D.ttf',
}
UNICODES = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) +
    [0x011E, 0x011F, 0x0130, 0x0131, 0x015E, 0x015F, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x2022, 0x20BA, 0x2192, 0x00B7, 0x2212]
)

def fetch(name):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        urllib.request.urlretrieve(SRC[name], p)
    return p

def build(name, axes, out):
    f = TTFont(fetch(name))
    f = instantiateVariableFont(f, axes)
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['kern', 'liga', 'calt', 'locl', 'case', 'tnum', 'lnum']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(f)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, out)
    f.flavor = 'woff2'
    f.save(path)
    print(out, os.path.getsize(path), 'bytes')

build('Fraunces.ttf', {'SOFT': 100, 'WONK': 0, 'opsz': 72, 'wght': (500, 600)}, 'fraunces-soft-500-600.woff2')
build('InstrumentSans.ttf', {'wdth': 100, 'wght': (400, 600)}, 'instrument-sans-400-600.woff2')

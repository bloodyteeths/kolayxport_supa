// Marketing fonts (docs/brand.md §4), self-hosted subsets built by scripts/brand/subset-fonts.py:
// Fraunces with SOFT 100 / opsz 72 baked in (weights 500–600) and Instrument Sans (400–600), Latin +
// Turkish glyphs only — ~28 KB each instead of ~160 KB of Google subsets (GTM perf budget).
import localFont from 'next/font/local';

export const fraunces = localFont({
  src: '../../public/fonts/fraunces-soft-500-600.woff2',
  weight: '500 600',
  style: 'normal',
  display: 'swap',
  variable: '--font-fraunces',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

export const instrument = localFont({
  src: '../../public/fonts/instrument-sans-400-600.woff2',
  weight: '400 600',
  style: 'normal',
  display: 'swap',
  variable: '--font-instrument',
  fallback: ['ui-sans-serif', 'system-ui', 'Arial', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

export const siteFontClass = `${fraunces.variable} ${instrument.variable}`;

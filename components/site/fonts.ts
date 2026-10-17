// Marketing fonts (docs/brand.md §4), self-hosted subsets built by scripts/brand/subset-fonts.py:
// Plus Jakarta Sans 700–800 (the logo face, headings) and Instrument Sans (400–600, body), Latin +
// Turkish glyphs only — small self-hosted subsets instead of Google's (GTM perf budget).
import localFont from 'next/font/local';

export const jakarta = localFont({
  src: '../../public/fonts/jakarta-700-800.woff2',
  weight: '700 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-jakarta',
  fallback: ['ui-sans-serif', 'system-ui', 'Arial', 'sans-serif'],
  adjustFontFallback: 'Arial',
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

export const siteFontClass = `${jakarta.variable} ${instrument.variable}`;

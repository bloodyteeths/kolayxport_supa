// Marketing fonts (docs/brand.md §4), self-hosted by next/font. latin-ext covers ş ğ ı İ ç ö ü.
import { Fraunces, Instrument_Sans } from 'next/font/google';

export const fraunces = Fraunces({
  subsets: ['latin', 'latin-ext'],
  // SOFT keeps the rounded serifs of the logo wordmark; the optical-size axis (opsz) is dropped to keep
  // the font files small (it roughly doubles them for no visible gain at heading sizes).
  axes: ['SOFT'],
  display: 'swap',
  variable: '--font-fraunces',
});

export const instrument = Instrument_Sans({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-instrument',
});

export const siteFontClass = `${fraunces.variable} ${instrument.variable}`;

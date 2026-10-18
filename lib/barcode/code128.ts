/**
 * Code 128 encoder (no dependency). Returns bar/space module widths for drawing (lib/shipping/cargoLabelPdf.ts).
 *
 * Uses code set C for even runs of digits (cargo numbers are long digit strings, so the barcode stays short and
 * scans on small labels) and code set B otherwise, with a mod-103 check symbol and the stop pattern.
 */

// Patterns for values 0..106 (106 = stop, 13 modules incl. final bar). Each digit is a bar/space width in modules.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

/** Symbol values for `text` (printable ASCII 32..126). Throws on other characters. */
export function code128Values(text: string): number[] {
  if (!text) throw new Error('code128: empty text');
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`code128: unsupported character ${JSON.stringify(ch)}`);
  }
  const values: number[] = [];
  const digitRun = (i: number) => {
    let n = 0;
    while (i + n < text.length && /\d/.test(text[i + n])) n++;
    return n;
  };
  let i = 0;
  // An even digit run of 4+ starts in C; an odd one starts in B for one digit, then switches to C (below).
  let set: 'B' | 'C' = digitRun(0) >= 4 && digitRun(0) % 2 === 0 ? 'C' : 'B';
  values.push(set === 'C' ? START_C : START_B);
  while (i < text.length) {
    const run = digitRun(i);
    if (set === 'B' && run >= 4 && run % 2 === 0) {
      values.push(CODE_C);
      set = 'C';
    }
    if (set === 'C') {
      if (run >= 2) {
        values.push(Number(text.slice(i, i + 2)));
        i += 2;
        continue;
      }
      values.push(CODE_B);
      set = 'B';
    }
    values.push(text.charCodeAt(i) - 32);
    i++;
    // After an odd leading digit in B, switch to C for the even remainder.
    if (set === 'B' && digitRun(i) >= 4 && digitRun(i) % 2 === 0) {
      values.push(CODE_C);
      set = 'C';
    }
  }
  const check = values.reduce((sum, v, idx) => sum + v * (idx === 0 ? 1 : idx), 0) % 103;
  values.push(check, STOP);
  return values;
}

/** Module widths, alternating bar/space starting with a bar. Total = 11 per symbol + 13 for stop. */
export function code128Modules(text: string): number[] {
  return code128Values(text).flatMap((v) => PATTERNS[v].split('').map(Number));
}

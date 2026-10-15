// components/ds/inputs/_countries.ts — ISO 3166-1 alpha-2 codes with E.164 calling codes. Data only:
// names come from Intl.DisplayNames in the UI locale (no hard-coded strings), flags are regional indicators.
const RAW =
  'AD376 AE971 AF93 AG1268 AI1264 AL355 AM374 AO244 AR54 AS1684 AT43 AU61 AW297 AX358 AZ994 ' +
  'BA387 BB1246 BD880 BE32 BF226 BG359 BH973 BI257 BJ229 BL590 BM1441 BN673 BO591 BQ599 BR55 BS1242 BT975 BW267 BY375 BZ501 ' +
  'CA1 CC61 CD243 CF236 CG242 CH41 CI225 CK682 CL56 CM237 CN86 CO57 CR506 CU53 CV238 CW599 CX61 CY357 CZ420 ' +
  'DE49 DJ253 DK45 DM1767 DO1809 DZ213 EC593 EE372 EG20 EH212 ER291 ES34 ET251 FI358 FJ679 FK500 FM691 FO298 FR33 ' +
  'GA241 GB44 GD1473 GE995 GF594 GG44 GH233 GI350 GL299 GM220 GN224 GP590 GQ240 GR30 GT502 GU1671 GW245 GY592 ' +
  'HK852 HN504 HR385 HT509 HU36 ID62 IE353 IL972 IM44 IN91 IO246 IQ964 IR98 IS354 IT39 JE44 JM1876 JO962 JP81 ' +
  'KE254 KG996 KH855 KI686 KM269 KN1869 KP850 KR82 KW965 KY1345 KZ7 LA856 LB961 LC1758 LI423 LK94 LR231 LS266 LT370 LU352 LV371 LY218 ' +
  'MA212 MC377 MD373 ME382 MF590 MG261 MH692 MK389 ML223 MM95 MN976 MO853 MP1670 MQ596 MR222 MS1664 MT356 MU230 MV960 MW265 MX52 MY60 MZ258 ' +
  'NA264 NC687 NE227 NF672 NG234 NI505 NL31 NO47 NP977 NR674 NU683 NZ64 OM968 PA507 PE51 PF689 PG675 PH63 PK92 PL48 PM508 PR1787 PS970 PT351 PW680 PY595 ' +
  'QA974 RE262 RO40 RS381 RU7 RW250 SA966 SB677 SC248 SD249 SE46 SG65 SH290 SI386 SJ47 SK421 SL232 SM378 SN221 SO252 SR597 SS211 ST239 SV503 SX1721 SY963 SZ268 ' +
  'TC1649 TD235 TG228 TH66 TJ992 TK690 TL670 TM993 TN216 TO676 TR90 TT1868 TV688 TW886 TZ255 UA380 UG256 US1 UY598 UZ998 ' +
  'VA39 VC1784 VE58 VG1284 VI1340 VN84 VU678 WF681 WS685 XK383 YE967 YT262 ZA27 ZM260 ZW263';

export const COUNTRY_DIAL: Record<string, string> = Object.fromEntries(
  RAW.split(/\s+/).filter(Boolean).map((e) => [e.slice(0, 2), e.slice(2)]),
);
export const COUNTRY_CODES: string[] = Object.keys(COUNTRY_DIAL);

/** "TR" → 🇹🇷 (regional indicator symbols). */
export function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...code.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Longest calling-code match for an E.164 string ("+90532…" → TR). Shared codes prefer `preferred`. */
export function countryFromE164(e164: string, preferred?: string): string | null {
  const digits = e164.replace(/[^\d]/g, '');
  if (!e164.trim().startsWith('+') || !digits) return null;
  if (preferred && COUNTRY_DIAL[preferred] && digits.startsWith(COUNTRY_DIAL[preferred])) return preferred;
  let best: string | null = null;
  let bestLen = 0;
  for (const [code, dial] of Object.entries(COUNTRY_DIAL)) {
    if (digits.startsWith(dial) && dial.length > bestLen) { best = code; bestLen = dial.length; }
  }
  // Codes shared by several countries (+1, +7, +44…): prefer the main one.
  const main: Record<string, string> = { '1': 'US', '7': 'RU', '44': 'GB', '61': 'AU', '39': 'IT', '47': 'NO', '358': 'FI', '590': 'GP', '599': 'CW', '212': 'MA', '262': 'RE' };
  if (best) {
    const dial = COUNTRY_DIAL[best];
    const shared = Object.values(COUNTRY_DIAL).filter((d) => d === dial).length > 1;
    if (shared && main[dial]) return main[dial];
  }
  return best;
}

/** Common seller currencies, in the order the pickers show them after the pinned one. */
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'NZD', 'SGD', 'HKD', 'CNY', 'INR', 'MXN', 'BRL', 'ZAR', 'AED', 'SAR', 'ILS', 'KRW', 'MYR', 'PHP', 'THB', 'IDR', 'VND', 'RUB', 'UAH', 'EGP', 'MAD', 'TWD', 'CLP', 'COP', 'ARS', 'PEN'];

export function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

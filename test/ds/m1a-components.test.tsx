import { describe, expect, it } from 'vitest';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { CopyText, DateText, Kbd, Money, Num, ShipBy, TermHint, formatKeys, truncateText } from '@/components/ds/format';
import { STATUS_DOMAINS, STATUS_VOCABULARY, type StatusDomain } from '@/lib/ds/status';
import { M1A_KEYS } from './m1a-i18n';
import { html, text } from './m1a-render';

const NOW = new Date('2026-10-15T09:00:00Z'); // 12:00 Istanbul
const msg = (ns: string, key: string, locale: 'en' | 'tr') => M1A_KEYS.find((k) => k.namespace === ns && k.key === key)![locale];

describe('StatusPill', () => {
  it.each(['en', 'tr'] as const)('renders every vocabulary key from i18n (%s)', (locale) => {
    for (const domain of STATUS_DOMAINS) {
      for (const key of Object.keys(STATUS_VOCABULARY[domain])) {
        const out = text(<StatusPill domain={domain as StatusDomain} status={key as never} />, locale);
        expect(out, `${domain}.${key}`).toBe(msg('status', `${domain}.${key}`, locale));
      }
    }
  });

  it('carries domain, status, tone and dot style as data attributes', () => {
    const out = html(<StatusPill domain="sync" status="pending" data-testid="pill" className="x" />, 'en');
    expect(out).toContain('data-testid="pill"');
    expect(out).toContain('data-status="pending"');
    expect(out).toContain('data-tone="attention"');
    expect(out).toContain('class="');
    expect(html(<StatusPill domain="order" status="delivered" />, 'tr')).toContain('data-dot="hollow"');
    expect(html(<StatusPill domain="order" status="label_created" />, 'tr')).toContain('data-dot="accent"');
    expect(html(<StatusPill domain="run" status="running" />, 'en')).toContain('data-dot="pulse"');
  });

  it('renders nothing for null or unknown keys', () => {
    expect(html(<StatusPill domain="sync" status={null} />, 'en')).toBe('');
    expect(html(<StatusPill domain="order" status={'paid' as never} />, 'en')).toBe('');
  });

  it('shows the raw marketplace value as a tooltip description, keeping the visible label as the name', () => {
    const out = html(<StatusPill domain="order" status="to_ship" raw="Etsy: paid, unshipped" />, 'en');
    expect(out).toContain('title="Etsy: paid, unshipped"');
    expect(out).not.toContain('aria-label');
    expect(out).toContain('To ship');
  });
});

describe('Money', () => {
  it('formats per UI locale with the data currency', () => {
    expect(text(<Money amount={1109.3} currency="TRY" />, 'tr')).toBe('₺1.109,30');
    expect(text(<Money amount={1109.3} currency="TRY" />, 'en')).toBe('₺1,109.30');
    expect(text(<Money amount={169.99} currency="USD" />, 'tr')).toBe('$169,99');
    expect(text(<Money amount={null} currency="USD" />, 'en')).toBe('—');
  });

  it('compact keeps the full value in the tooltip; approx uses the fx note', () => {
    const c = html(<Money amount={1070860.03} currency="TRY" compact />, 'en');
    expect(c).toContain('₺1.07M');
    expect(c).toContain('title="₺1,070,860.03"');
    expect(c).not.toContain('aria-label');
    const a = html(<Money amount={1070860.03} currency="TRY" approx fxNote="Converted from USD at exchangerate-api.com rates" />, 'tr');
    expect(a).toContain('≈ ₺1.070.860');
    expect(a).toContain('title="Converted from USD at exchangerate-api.com rates"');
    expect(a).not.toContain('aria-label');
    expect(html(<Money amount={10} currency="USD" approx />, 'tr')).toContain(`title="${msg('ds', 'format.approx', 'tr')}"`);
    expect(html(<Money amount={10} currency="USD" approx />, 'en')).toContain('title="Converted amount"');
  });

  it('sign colours positive and negative amounts, wholeIfIntegral drops ,00', () => {
    expect(text(<Money amount={-12} currency="USD" sign />, 'en')).toBe('-$12.00');
    expect(text(<Money amount={12} currency="USD" sign />, 'tr')).toBe('+$12,00');
    expect(text(<Money amount={2499} currency="TRY" wholeIfIntegral />, 'tr')).toBe('₺2.499');
    expect(html(<Money amount={5} currency="USD" data-testid="m" />, 'en')).toContain('data-testid="m"');
  });
});

describe('Num', () => {
  it.each([
    ['en', '12,480', '4.2%'],
    ['tr', '12.480', '%4,2'],
  ] as const)('formats numbers and percents (%s)', (locale, num, pct) => {
    expect(text(<Num value={12480} />, locale)).toBe(num);
    expect(text(<Num value={0.042} percent />, locale)).toBe(pct);
    expect(text(<Num value={undefined} />, locale)).toBe('—');
  });

  it('compact shows the full number in the tooltip', () => {
    const out = html(<Num value={1070860} compact />, 'tr');
    expect(out).toContain('1,07 Mn');
    expect(out).toContain('title="1.070.860"');
    expect(out).not.toContain('aria-label');
  });
});

describe('DateText', () => {
  const at = new Date('2026-10-15T19:59:00Z');
  it.each([
    ['en', 'Oct 15', 'Oct 15, 10:59 PM', '10:59 PM', 'Thursday, Oct 15'],
    ['tr', '15 Eki', '15 Eki 22:59', '22:59', '15 Eki Perşembe'],
  ] as const)('modes in the seller timezone (%s)', (locale, date, datetime, time, weekday) => {
    expect(text(<DateText value={at} now={NOW} />, locale)).toBe(date);
    expect(text(<DateText value={at} mode="datetime" now={NOW} />, locale)).toBe(datetime);
    expect(text(<DateText value={at} mode="time" now={NOW} />, locale)).toBe(time);
    expect(text(<DateText value={at} mode="weekday" now={NOW} />, locale)).toBe(weekday);
  });

  it('relative shows the absolute value in the tooltip and a machine-readable dateTime', () => {
    const fourMin = new Date(NOW.getTime() - 4 * 60_000);
    const en = html(<DateText value={fourMin} mode="relative" now={NOW} />, 'en');
    expect(en).toContain('4 min ago');
    expect(en).toContain('title="Oct 15, 11:56 AM"');
    expect(en).not.toContain('aria-label');
    expect(en).toContain(`dateTime="${fourMin.toISOString()}"`);
    expect(text(<DateText value={fourMin} mode="relative" now={NOW} />, 'tr')).toBe('4 dk önce');
  });

  it('follows the FormatProvider timezone and renders — for missing values', () => {
    expect(text(<DateText value={at} mode="time" now={NOW} />, 'tr', 'UTC')).toBe('19:59');
    expect(text(<DateText value={null} />, 'en')).toBe('—');
  });
});

describe('ShipBy', () => {
  it.each(['en', 'tr'] as const)('one phrase per state (%s)', (locale) => {
    const today = html(<ShipBy date={new Date('2026-10-15T19:59:00Z')} now={NOW} />, locale);
    expect(today).toContain('data-tone="warning"');
    expect(today).toContain(locale === 'en' ? 'Ship by today 10:59 PM' : 'Son gönderim: bugün 22:59');

    const overdue = html(<ShipBy date={new Date(NOW.getTime() - 26 * 3_600_000)} now={NOW} />, locale);
    expect(overdue).toContain('data-tone="danger"');
    expect(overdue).toContain(locale === 'en' ? 'Overdue 1 day' : '1 gün gecikti');
    expect(overdue).not.toContain('aria-label');

    const hours = text(<ShipBy date={new Date(NOW.getTime() - 3 * 3_600_000)} now={NOW} />, locale);
    expect(hours).toBe(locale === 'en' ? 'Overdue 3 hours' : '3 saat gecikti');

    const later = html(<ShipBy date={new Date('2026-10-18T09:00:00Z')} now={NOW} />, locale);
    expect(later).toContain('data-tone="neutral"');
    expect(later).toContain(locale === 'en' ? 'Ship by Oct 18' : 'Son gönderim: 18 Eki');

    const shipped = text(<ShipBy date={new Date('2026-10-13T09:00:00Z')} shippedAt={new Date('2026-10-14T09:00:00Z')} now={NOW} />, locale);
    expect(shipped).toBe(locale === 'en' ? 'Shipped Oct 14' : 'Kargoya verildi: 14 Eki');

    const unknown = html(<ShipBy date={null} now={NOW} />, locale);
    expect(unknown).toContain('—');
    expect(unknown).toContain(`title="${msg('ds', 'shipBy.unknown', locale)}"`);
    expect(text(<ShipBy date={null} now={NOW} />, locale)).toBe(`—${msg('ds', 'shipBy.unknown', locale)}`);
    expect(unknown).not.toContain('aria-label');
  });
});

describe('CopyText', () => {
  it.each(['en', 'tr'] as const)('renders the value and a labelled copy button (%s)', (locale) => {
    const out = html(<CopyText value="1Z999AA10123456784" mono truncate={14} />, locale);
    expect(out).toContain('1Z999AA101234…');
    expect(out).toContain('title="1Z999AA10123456784"');
    expect(out).toContain(locale === 'en' ? 'aria-label="Copy 1Z999AA10123456784"' : 'aria-label="Kopyala: 1Z999AA10123456784"');
    expect(out).toContain('role="status"');
  });

  it('display overrides the visible text, value is what gets copied', () => {
    const out = text(<CopyText value="buyer@example.com" display="Buyer email" />, 'en');
    expect(out).toContain('Buyer email');
    expect(truncateText('abcdef', 4)).toBe('abc…');
    expect(truncateText('abc', 4)).toBe('abc');
  });
});

describe('Kbd', () => {
  it('renders Ctrl on the server, ⌘ on Apple after mount (pure formatter)', () => {
    expect(text(<Kbd keys="mod+k" />, 'en')).toBe('Ctrl K');
    expect(text(<Kbd keys="g h" />, 'tr')).toBe('gh');
    expect(html(<Kbd keys="g h" />, 'tr').match(/<kbd/g)).toHaveLength(2);
    expect(formatKeys('mod+k', true)).toEqual([['⌘', 'K']]);
    expect(formatKeys('mod+enter', false)).toEqual([['Ctrl', '↵']]);
    expect(formatKeys('shift+x', true)).toEqual([['⇧', 'X']]);
    expect(formatKeys('?', true)).toEqual([['?']]);
    expect(formatKeys('esc', false)).toEqual([['Esc']]);
  });

  it('word-labelled keys come from ds.kbd.* (TR), symbols stay glyphs', () => {
    expect(text(<Kbd keys="space" />, 'tr')).toBe(msg('ds', 'kbd.space', 'tr'));
    expect(text(<Kbd keys="space" />, 'en')).toBe('Space');
    expect(text(<Kbd keys="delete" />, 'tr')).toBe(msg('ds', 'kbd.delete', 'tr'));
    expect(text(<Kbd keys="mod+enter" />, 'tr')).toBe(`${msg('ds', 'kbd.ctrl', 'tr')} ↵`);
    expect(formatKeys('space', true, { ctrl: 'C', win: 'W', shift: 'S', alt: 'A', esc: 'E', tab: 'T', space: 'Boşluk', delete: 'Sil' })).toEqual([['Boşluk']]);
  });
});

describe('TermHint', () => {
  it.each(['en', 'tr'] as const)('glossary terms come from i18n (%s)', (locale) => {
    for (const term of ['etgb', 'ioss', 'hs', 'sku', 'gtin'] as const) {
      const out = html(<TermHint term={term} />, locale);
      expect(out).toContain(`aria-label="${msg('ds', 'termHint.label', locale).replace('{term}', msg('ds', `termNames.${term}`, locale))}"`);
    }
  });

  it('the explanation is the button description (describeChild), not lost behind the aria-label', () => {
    const out = html(<TermHint term="ioss" />, 'tr');
    expect(out).toContain(`title="${msg('ds', 'terms.ioss', 'tr')}"`);
  });

  it('accepts an already-translated label and body', () => {
    const out = html(<TermHint label="Orders" body="An order counts once, when it's imported." />, 'en');
    expect(out).toContain('aria-label="What is Orders?"');
  });
});

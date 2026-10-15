// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KpiTile, deltaTone } from '@/components/ds/data/KpiTile';
import { makeDsFormat } from '@/components/ds/data/fmt';
import { Thumb } from '@/components/ds/data/Thumb';
import { LogoTile, resolveBrand, tileRadius } from '@/components/ds/data/LogoTile';
import { PlanTag, PlanTagProvider } from '@/components/ds/data/PlanTag';
import { UsageMeter, usageLevel } from '@/components/ds/data/UsageMeter';
import { Avatar, initialsOf } from '@/components/ds/data/Avatar';
import { KeyValueList } from '@/components/ds/data/KeyValueList';
import { Timeline } from '@/components/ds/data/Timeline';
import { ShareBar } from '@/components/ds/data/ShareBar';
import { LOCALES, Providers, html, intlErrors, text } from './m1d-render';

afterEach(cleanup);
beforeEach(() => { intlErrors.length = 0; });
afterEach(() => { expect(intlErrors).toEqual([]); });

describe('KpiTile day comparison', () => {
  it('compares calendar days in the seller timezone, not the runtime zone', () => {
    const late = new Date('2026-10-14T21:30:00Z'); // 00:30 on Oct 15 in Istanbul
    const morning = new Date('2026-10-15T08:00:00Z');
    expect(makeDsFormat('en', 'Europe/Istanbul').sameDay(late, morning)).toBe(true);
    expect(makeDsFormat('en', 'UTC').sameDay(late, morning)).toBe(false);
  });
});

describe.each(LOCALES)('KpiTile (%s)', (locale) => {
  it('label, value, caption, delta and source line', () => {
    const asOf = new Date();
    const out = text(
      <KpiTile
        label="Revenue"
        value="₺86.400"
        caption="Excludes product cost for 14 products"
        delta={{ value: 0.124, period: 'vs previous 14 days', goodWhen: 'up' }}
        source="Etsy + eBay"
        asOf={asOf}
      />,
      locale,
    );
    expect(out).toContain('Revenue');
    expect(out).toContain('Excludes product cost');
    expect(out).toContain(locale === 'en' ? '▲ 12.4%' : '▲ %12,4');
    expect(out).toContain(locale === 'en' ? 'as of' : 'itibarıyla');
    expect(out).toContain('Etsy + eBay');
  });

  it('delta tone follows goodWhen; danger value tone; href renders a link', () => {
    expect(deltaTone({ value: 0.1, period: '', goodWhen: 'up' })).toBe('success');
    expect(deltaTone({ value: 0.1, period: '', goodWhen: 'down' })).toBe('danger');
    expect(deltaTone({ value: 0, period: '', goodWhen: 'up' })).toBe('neutral');
    const out = html(<KpiTile label="Overdue" value={3} valueTone="danger" source="Orders" asOf={new Date()} href="/app/labels?view=overdue" />, locale);
    expect(out).toContain('href="/app/labels?view=overdue"');
  });

  it('loading shows a skeleton instead of the value', () => {
    const out = html(<KpiTile label="Orders" value="142" source="Etsy" asOf={new Date()} loading />, locale);
    expect(out).toContain('aria-busy="true"');
    expect(out).not.toContain('142');
  });
});

describe.each(LOCALES)('Thumb / LogoTile / Avatar (%s)', (locale) => {
  it('Thumb renders the image, or the placeholder glyph (never "-")', () => {
    expect(html(<Thumb src="/a.jpg" alt="Blanket" size={48} />, locale)).toContain('src="/a.jpg"');
    const ph = html(<Thumb alt="Blanket" size={64} badge="+2" />, locale);
    expect(ph).toContain('aria-label="Blanket"');
    expect(ph).toContain('+2');
    expect(ph).not.toContain('>-<');
    expect(ph).toContain('role="img"');
    const deco = html(<Thumb alt="" size={48} />, locale);
    expect(deco).not.toContain('role="img"');
    expect(deco).toContain('aria-hidden="true"');
  });

  it('Thumb falls back to the placeholder on a broken image', () => {
    render(<Providers locale={locale}><Thumb src="/broken.jpg" alt="Broken" size={48} /></Providers>);
    fireEvent.error(document.querySelector('img') as HTMLImageElement);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Broken' })).toBeTruthy();
  });

  it('LogoTile reads lib/ds/logos.ts and falls back to a monogram on error', () => {
    const out = html(<LogoTile brand="etsy" size={20} />, locale);
    expect(out).toContain('src="/logos/etsy.svg"');
    expect(out).toContain('aria-label="Etsy"');
    render(<Providers locale={locale}><LogoTile brand="MNG Kargo" size={24} withName /></Providers>);
    const tile = screen.getByRole('img', { name: 'DHL eCommerce' });
    fireEvent.error(tile.querySelector('img') as HTMLImageElement);
    expect(tile.getAttribute('data-monogram')).toBe('true');
    expect(tile.textContent).toBe('D');
  });

  it('LogoTile without a registry asset renders the monogram on the brand color', () => {
    const out = html(<LogoTile brand="n11" size={16} />, locale);
    expect(out).toContain('data-monogram="true"');
    expect(resolveBrand('n11').color).toBe('#6E2C91');
    expect(tileRadius(16)).toBe(4);
    expect(tileRadius(40)).toBe(8);
    expect(html(<LogoTile brand="ups" tone="mono" />, locale)).toContain('ups-mono.svg');
  });

  it('Avatar shows initials (locale-aware) with an optional brand badge', () => {
    expect(initialsOf('Ayşe Kaya')).toBe('AK');
    expect(initialsOf('irem', 'tr')).toBe('İ');
    expect(initialsOf('irem', 'en')).toBe('I');
    const out = html(<Avatar name="Sarah Miller" size={32} brand="wix" />, locale);
    expect(out).toContain('SM');
    expect(out).toContain('aria-label="Wix"');
  });
});

describe.each(LOCALES)('PlanTag (%s)', (locale) => {
  it('returns null unless stripeUpsell is true (shopify_free, unknown)', () => {
    expect(html(<PlanTag plan="pro" />, locale)).toBe('');
    expect(html(<PlanTagProvider stripeUpsell={false}><PlanTag plan="pro" /></PlanTagProvider>, locale)).toBe('');
    expect(html(<PlanTagProvider stripeUpsell={null}><PlanTag plan="pro" /></PlanTagProvider>, locale)).toBe('');
  });

  it('renders "Pro" with the trial / plan tooltip for Stripe accounts', () => {
    const pro = html(<PlanTagProvider stripeUpsell><PlanTag plan="pro" /></PlanTagProvider>, locale);
    expect(pro).toContain('>Pro<');
    expect(pro).toContain(locale === 'en' ? 'Part of the Pro plan' : 'Pro planına dahil');
    const trial = html(<PlanTag plan="pro" stripeUpsell trialEndsAt={new Date('2026-11-01T12:00:00Z')} />, locale);
    expect(trial).toContain(locale === 'en' ? 'Included in your trial until Nov 1' : '1 Kas tarihine kadar deneme sürenize dahil');
  });
});

describe.each(LOCALES)('UsageMeter (%s)', (locale) => {
  it('levels: ok < 80 %, near ≥ 80 %, over ≥ 100 %, unlimited', () => {
    expect(usageLevel(10, 100)).toBe('ok');
    expect(usageLevel(80, 100)).toBe('near');
    expect(usageLevel(100, 100)).toBe('over');
    expect(usageLevel(5, null)).toBe('unlimited');
  });

  it('renders used / limit with a meter, or "Unlimited" with no bar', () => {
    const out = html(<UsageMeter label="Orders" used={1442} limit={2000} />, locale);
    expect(out).toContain(locale === 'en' ? '1,442 / 2,000' : '1.442 / 2.000');
    expect(out).toContain('role="meter"');
    expect(out).toContain('data-level="ok"');
    const unl = html(<UsageMeter label="Orders" used={1442} limit={null} />, locale);
    expect(unl).toContain(locale === 'en' ? 'Unlimited' : 'Sınırsız');
    expect(unl).not.toContain('role="meter"');
    expect(html(<UsageMeter label="Labels" used={30} limit={30} />, locale)).toContain('data-level="over"');
  });
});

describe.each(LOCALES)('KeyValueList / Timeline / ShareBar (%s)', (locale) => {
  it('KeyValueList renders dt/dd pairs and a copyable value', () => {
    const out = html(<KeyValueList columns={2} items={[{ label: 'Barcode', value: '8690000', copy: '8690000', mono: true }, { label: 'In stock', value: '12' }]} />, locale);
    expect(out).toContain('<dt');
    expect(out).toContain('Barcode');
    expect(out).toContain('8690000');
  });

  it('Timeline renders events with dates', () => {
    const out = text(<Timeline events={[{ at: new Date('2026-10-14T10:00:00Z'), label: 'Label created', tone: 'success' }, { at: new Date('2026-10-13T09:00:00Z'), label: 'Ordered' }]} />, locale);
    expect(out).toContain('Label created');
    expect(out).toContain(locale === 'en' ? 'Oct 14' : '14 Eki');
  });

  it('ShareBar shows the percent (bar hidden in compact)', () => {
    const out = html(<ShareBar value={0.425} />, locale);
    expect(out).toContain(locale === 'en' ? '42.5%' : '%42,5');
    expect(html(<ShareBar value={null} />, locale)).toContain('—');
  });
});

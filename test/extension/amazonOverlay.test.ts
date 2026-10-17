// Amazon search + product overlays rendered in jsdom against current-markup
// fixtures: real content scripts, stubbed chrome.runtime (never the network).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const root = path.join(__dirname, '../../chrome-extension/src');
const src = (f: string) => readFileSync(path.join(root, f), 'utf8');
const fixture = (f: string) => readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

type Handler = (msg: { type: string; params: Record<string, unknown> }) => unknown;
const doms: JSDOM[] = [];

function boot(url: string, html: string, onMsg: Handler) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  doms.push(dom);
  const w = dom.window as unknown as Record<string, any> & { eval: (s: string) => unknown };
  const calls: Array<{ type: string; params: Record<string, unknown> }> = [];
  w.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (msg: { type: string; params: Record<string, unknown> }, cb: (r: unknown) => void) => {
        calls.push(msg);
        setTimeout(() => cb(onMsg(msg)), 0);
      },
    },
  };
  w.open = () => null;
  w.eval(src('lib/amazonMath.js'));
  w.eval(src('content-amazon-shared.js'));
  return { dom, w, calls, run: (f: string) => w.eval(src(f)) };
}

async function waitFor<T>(fn: () => T | null | undefined | false, ms = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}

// Windows are not closed: the overlays' MutationObservers would fire on a
// torn-down window and log noise. jsdom instances are dropped with the worker.
afterEach(() => {
  doms.length = 0;
});

describe('Amazon search parsing (current markup)', () => {
  it('finds only real result cards and reads each field correctly', () => {
    const { w } = boot('https://www.amazon.com/s?k=turkish+towel', fixture('amazon-search-us.html'), () => null);
    const S = w.__kxAmzShared;
    const cards = S.extractSearchCards();
    expect(cards.map((c: Element) => c.getAttribute('data-asin'))).toEqual([
      'B0SPONSOR1', 'B0ORGANIC1', 'B0ORGANIC2', 'B0ORGANIC3', 'B0ORGANIC4', 'B0ORGANIC5',
    ]);
    const parsed = cards.map((c: Element) => S.parseSearchCard(c, 'US'));
    expect(parsed.map((p: any) => p.sponsored)).toEqual([true, false, false, false, false, false]);
    expect(parsed.map((p: any) => p.reviews)).toEqual([12843, 633, 1200, null, 4521, 2210]);
    expect(parsed.map((p: any) => p.rating)).toEqual([4.5, 4.4, 4.3, null, 4.6, 4.2]);
    expect(parsed.map((p: any) => p.price)).toEqual([29.99, 24.99, 19.99, 149, 32.5, 5.99]);
    expect(parsed[0].bought).toEqual({ min: 5000, label: '5K+' });
    expect(parsed[1].bought).toEqual({ min: 100, label: '100+' });
    expect(parsed[2].bought).toBeNull();
    expect(S.extractTotalResults()).toEqual({ total: 3000, isLowerBound: true });
  });
});

describe('Amazon search overlay', () => {
  it('labels Amazon figures vs estimates and uses SP-API ranks when available', async () => {
    const { w, calls, run } = boot('https://www.amazon.com/s?k=turkish+towel', fixture('amazon-search-us.html'), (msg) =>
      msg.type === 'kx_amazon_enrich'
        ? {
            available: true,
            items: { B0ORGANIC2: { asin: 'B0ORGANIC2', bsr: 1234, bsrCategory: 'Home & Kitchen', offerCountAny: 3 } },
          }
        : null,
    );
    run('content-amazon-search.js');
    const doc = w.document as Document;
    const bar = await waitFor(() => doc.getElementById('kx-amz-research-summary'));
    expect(bar.textContent).toContain('6 results on this page');
    expect(bar.textContent).toContain('of over 3,000');
    expect(bar.textContent).toContain('Ads: 1/6');

    const rowOf = (asin: string) => doc.querySelector(`[data-asin="${asin}"] .kx-amz-research-row`)?.textContent || '';
    expect(rowOf('B0ORGANIC1')).toContain('Amazon: 100+ bought/mo');
    expect(rowOf('B0ORGANIC1')).toContain('≥$2.5K/mo');
    expect(rowOf('B0SPONSOR1')).toContain('Ad');

    // SP-API answer arrives → card 3 switches from "no data" to a labelled estimate.
    await waitFor(() => rowOf('B0ORGANIC2').includes('est. ~'));
    expect(rowOf('B0ORGANIC2')).toContain('BSR #1,234');
    expect(rowOf('B0ORGANIC2')).toContain('3 offers');
    expect(rowOf('B0ORGANIC5')).toContain('sales: no data');
    expect(calls[0].type).toBe('kx_amazon_enrich');
    expect(calls[0].params.asins).not.toContain('B0SPONSOR1');
    await waitFor(() => (doc.getElementById('kx-amz-research-summary')?.textContent || '').includes('official Amazon data (SP-API) for 1 product'));
  });

  it('says why official data is missing instead of inventing it', async () => {
    const { w, run } = boot('https://www.amazon.com/s?k=turkish+towel', fixture('amazon-search-us.html'), () => ({ available: false, reason: 'access_denied' }));
    run('content-amazon-search.js');
    const doc = w.document as Document;
    await waitFor(() => (doc.getElementById('kx-amz-research-summary')?.textContent || '').includes('Official Amazon data off'));
    expect(doc.querySelector('[data-asin="B0ORGANIC2"] .kx-amz-research-row')?.textContent).toContain('sales: no data');
  });
});

describe('Amazon product overlay', () => {
  it('amazon.com: Amazon floor first, BSR model shown only as comparison', async () => {
    const { w, run } = boot('https://www.amazon.com/Turkish-Towel/dp/B0ORGANIC1', fixture('amazon-product-us.html'), () => ({ available: false, reason: 'not_connected' }));
    expect(w.__kxAmzShared.extractBsrInfo()).toEqual({ rank: 1234, category: 'Home & Kitchen', sub: [{ rank: 5, category: 'Bath Towels' }] });
    expect(w.__kxAmzShared.extractReviewCount('US')).toBe(15234);
    expect(w.__kxAmzShared.extractRating()).toBe(4.4);
    expect(w.__kxAmzShared.extractPriceFromPage('US')).toEqual({ value: 24.99, currency: 'USD' });
    run('content-amazon-listing.js');
    const widget = await waitFor(() => w.document.getElementById('kx-amz-research-widget'));
    const t = widget.textContent || '';
    expect(t).toContain('5K+');
    expect(t).toContain('Bought last month (Amazon)');
    expect(t).toContain('≥$120K');
    expect(t).toContain('BSR model for comparison: est. ~110/mo');
    expect(t).toContain('BSR #1,234');
    expect(t).toContain('15,234 ratings');
  });

  it('amazon.de: German number formats, € prices, uncalibrated-estimate warning', async () => {
    const { w, run } = boot('https://www.amazon.de/dp/B0DEPRODUC', fixture('amazon-product-de.html'), () => ({ available: false, reason: 'not_connected' }));
    const S = w.__kxAmzShared;
    expect(S.extractBsrInfo()?.rank).toBe(2345);
    expect(S.extractReviewCount('DE')).toBe(1234);
    expect(S.extractRating()).toBe(4.3);
    expect(S.extractPriceFromPage('DE')).toEqual({ value: 24.99, currency: 'EUR' });
    run('content-amazon-listing.js');
    const widget = await waitFor(() => w.document.getElementById('kx-amz-research-widget'));
    const t = widget.textContent || '';
    expect(t).toContain('Est. sales/mo');
    expect(t).toContain('likely overstates this marketplace');
    expect(t).toContain('€');
    expect(t).not.toContain('$');
  });
});

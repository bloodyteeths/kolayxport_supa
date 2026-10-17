// The research-limit card: a 429 { error: 'research_limit', … } from the server reaches the
// content scripts through background-simple.js and every overlay (Etsy search / listing / shop,
// eBay search / listing, Amazon search / product) plus the popup shows one card instead of
// numbers. jsdom, real content scripts, stubbed chrome.* (never the network).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';
import { JSDOM } from 'jsdom';

const root = path.join(__dirname, '../../chrome-extension/src');
const src = (f: string) => readFileSync(path.join(root, f), 'utf8');
const fixture = (f: string) => readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

const RESET = '2026-10-19T21:00:00.000Z';
const limitBody = (reason: string, extra: Record<string, unknown> = {}) => ({
  error: 'research_limit',
  reason,
  limit: 150,
  used: 150,
  resetAt: RESET,
  upgradeUrl: reason === 'signed_out' ? 'https://kolayxport.com/login?mode=signup&utm_source=extension&utm_medium=limit' : 'https://kolayxport.com/plan',
  ...extra,
});
/** What background-simple.js hands the content script for a 429 research-limit answer. */
const bg429 = (reason = 'user_daily') => ({ error: 'research_limit', status: 429, limit: limitBody(reason) });

type Msg = { type?: string; action?: string; params?: Record<string, unknown>; pv?: string; [k: string]: unknown };
const doms: JSDOM[] = [];

/** `lang`: the popup choice stored as kx_lang ('en' | 'tr'); null = nothing stored (→ Turkish). */
function boot(url: string, html: string, scripts: string[], onMsg: (m: Msg) => unknown, lang: 'tr' | 'en' | null = 'en') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  doms.push(dom);
  const w = dom.window as unknown as Record<string, any> & { eval: (s: string) => unknown };
  const calls: Msg[] = [];
  const opened: string[] = [];
  w.chrome = {
    storage: { local: { get: (_k: unknown, cb: (r: object) => void) => cb(lang ? { kx_lang: lang } : {}) } },
    runtime: {
      lastError: undefined,
      sendMessage: (msg: Msg, cb?: (r: unknown) => void) => {
        calls.push(msg);
        setTimeout(() => cb && cb(onMsg(msg)), 0);
      },
    },
  };
  w.open = (u: string) => { opened.push(u); return null; };
  w.__KX_CACHE = { getOrFetch: (_k: string, _t: string, fetcher: () => Promise<unknown>) => fetcher() };
  w.eval(src('lib/lang.js'));
  w.eval(src('lib/limitCard.js'));
  for (const s of scripts) w.eval(src(s));
  return { dom, w, calls, opened, doc: w.document as Document };
}

async function waitFor<T>(fn: () => T | null | undefined | false, ms = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const cardIn = (rootNode: ParentNode | null | undefined) => rootNode?.querySelector('.kx-limit-card') as HTMLElement | null;
const shadowOf = (doc: Document, id: string) => doc.getElementById(id)?.shadowRoot || null;
const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

afterEach(() => { doms.length = 0; });

const ETSY = ['lib/etsyMath.js', 'content-shared.js'];
const EBAY = ['lib/ebayMath.js', 'content-ebay-shared.js'];
const AMZ = ['lib/amazonMath.js', 'content-amazon-shared.js'];

describe('Etsy overlays', () => {
  it('search bar: 429 → card (EN), button opens upgradeUrl and sends telemetry; no numbers', async () => {
    const { doc, calls, opened } = boot('https://www.etsy.com/search?q=linen+dress', '<div class="wt-grid"></div>',
      [...ETSY, 'content-search.js'], (m) => (m.type === 'kx_research' ? bg429() : null));
    const card = await waitFor(() => cardIn(shadowOf(doc, 'kx-search-overlay')));
    expect(card.getAttribute('data-kx-limit')).toBe('user_daily');
    expect(norm(card.textContent)).toContain('Daily research limit reached');
    expect(norm(card.textContent)).toContain('Resets at 00:00 tomorrow.');
    const bar = shadowOf(doc, 'kx-search-overlay')!.querySelector('.kx-bar')!;
    expect(norm(bar.textContent)).not.toMatch(/Median|Results/);

    // Page-view id rides on the research message.
    expect(calls[0]).toMatchObject({ type: 'kx_research', action: 'search_enrich' });
    expect(String(calls[0].pv)).toMatch(/^pv[0-9a-f]{24}$/);

    const btn = card.querySelector('.kx-limit-upgrade') as HTMLButtonElement;
    expect(btn.textContent).toBe('Upgrade plan');
    btn.click();
    expect(opened).toEqual(['https://kolayxport.com/plan']);
    expect(calls.find((c) => c.type === 'kx_telemetry_event')).toMatchObject({ event: 'research_upgrade_click', reason: 'user_daily', surface: 'etsy_search' });
  });

  it('Turkish copy by default (nothing stored)', async () => {
    const { doc } = boot('https://www.etsy.com/search?q=keten', '', [...ETSY, 'content-search.js'],
      (m) => (m.type === 'kx_research' ? bg429() : null), null);
    const card = await waitFor(() => cardIn(shadowOf(doc, 'kx-search-overlay')));
    expect(norm(card.textContent)).toContain('Günlük araştırma hakkınız doldu');
    expect(norm(card.textContent)).toContain("Yarın 00:00'da yenilenir.");
    expect(card.querySelector('.kx-limit-upgrade')!.textContent).toBe('Planınızı yükseltin');
  });

  it('listing panel: 429 → card; signed out (401) → free-trial card', async () => {
    const html = '<div data-buy-box-region="price"><p>$12.00</p></div>';
    const a = boot('https://www.etsy.com/listing/1234567/linen', html, [...ETSY, 'content-listing.js'],
      (m) => (m.type === 'kx_listing_stats' ? bg429() : null));
    const card = await waitFor(() => cardIn(a.doc.getElementById('kx-listing-stats')));
    expect(card.getAttribute('data-kx-limit')).toBe('user_daily');
    expect(a.calls[0].pv).toMatch(/^pv/);

    const b = boot('https://www.etsy.com/listing/1234567/linen', html, [...ETSY, 'content-listing.js'],
      (m) => (m.type === 'kx_listing_stats' ? { error: 'NOT_AUTHENTICATED', status: 401 } : null), null);
    const so = await waitFor(() => cardIn(b.doc.getElementById('kx-listing-stats')));
    expect(so.getAttribute('data-kx-limit')).toBe('signed_out');
    expect(norm(so.textContent)).toContain('Araştırma için ücretsiz deneyin');
    const btn = so.querySelector('.kx-limit-upgrade') as HTMLButtonElement;
    expect(btn.textContent).toBe('14 gün ücretsiz deneyin');
    btn.click();
    expect(b.opened).toEqual(['https://kolayxport.com/login?mode=signup&utm_source=extension&utm_medium=limit']);
  });

  it('shop bar: global brake → busy card without an upgrade button', async () => {
    const { doc } = boot('https://www.etsy.com/shop/MyShop', '', [...ETSY, 'content-shop.js'],
      (m) => (m.type === 'kx_research' ? bg429('global_brake') : null), 'tr');
    const card = await waitFor(() => cardIn(shadowOf(doc, 'kx-shop-overlay')));
    expect(card.getAttribute('data-kx-limit')).toBe('global_brake');
    expect(norm(card.textContent)).toContain('Yoğunluk nedeniyle şu an yalnızca önbellekteki veriler gösteriliyor, birazdan tekrar deneyin');
    expect(card.querySelector('.kx-limit-upgrade')).toBeNull();
  });

  it('a successful answer still renders numbers (no card)', async () => {
    const { doc } = boot('https://www.etsy.com/search?q=linen+dress', '', [...ETSY, 'content-search.js'], (m) =>
      m.type === 'kx_research'
        ? { summary: { totalResults: 1200, medianPrice: 20, currency: 'USD', uniqueShops: 40, competition: 'medium', used: 80 }, quota: { used: 3, limit: 150 } }
        : null);
    await waitFor(() => norm(shadowOf(doc, 'kx-search-overlay')?.querySelector('.kx-bar')?.textContent).includes('1.2K'));
    expect(cardIn(shadowOf(doc, 'kx-search-overlay'))).toBeNull();
  });
});

describe('eBay overlays', () => {
  it('search bar: 429 → card instead of page-derived numbers', async () => {
    const { doc, calls } = boot('https://www.ebay.com/sch/i.html?_nkw=turkish+cotton+towel', fixture('ebay-search-new.html'),
      [...EBAY, 'content-ebay-search.js'], (m) => (m.type === 'kx_ebay_research' ? bg429() : null));
    const card = await waitFor(() => cardIn(shadowOf(doc, 'kx-ebay-search-overlay')));
    expect(norm(card.textContent)).toContain('Daily research limit reached');
    expect(norm(shadowOf(doc, 'kx-ebay-search-overlay')!.querySelector('.kx-bar')!.textContent)).not.toContain('Median');
    expect(calls[0].pv).toMatch(/^pv/);
  });

  it('item panel: 429 → card', async () => {
    const html = '<div id="mainContent"><div class="x-item-title"><h1 class="x-item-title__mainTitle"><span>Turkish Cotton Bath Towel</span></h1></div></div>';
    const { doc } = boot('https://www.ebay.com/itm/256789012345', html, [...EBAY, 'content-ebay-listing.js'],
      (m) => (m.type === 'kx_ebay_research' ? bg429() : null));
    const card = await waitFor(() => cardIn(doc.getElementById('kx-ebay-listing-stats')));
    expect(card.getAttribute('data-kx-limit')).toBe('user_daily');
  });
});

describe('Amazon overlays', () => {
  it('search bar: 429 → card', async () => {
    const { doc, calls } = boot('https://www.amazon.com/s?k=turkish+towel', fixture('amazon-search-us.html'),
      AMZ, (m) => (m.type === 'kx_amazon_enrich' ? bg429() : null));
    (doc.defaultView as any).eval(src('content-amazon-search.js'));
    const card = await waitFor(() => cardIn(doc.getElementById('kx-amz-research-summary')));
    expect(norm(card.textContent)).toContain('Daily research limit reached');
    expect(norm(doc.getElementById('kx-amz-research-summary')!.textContent)).not.toContain('Median price');
    expect(calls[0].pv).toMatch(/^pv/);
  });

  it('product panel: 429 → card', async () => {
    const { doc } = boot('https://www.amazon.com/dp/B0ORGANIC1', fixture('amazon-product-us.html'),
      AMZ, (m) => (m.type === 'kx_amazon_enrich' ? bg429() : null));
    (doc.defaultView as any).eval(src('content-amazon-listing.js'));
    const card = await waitFor(() => cardIn(doc.getElementById('kx-amz-research-widget')));
    expect(card.getAttribute('data-kx-limit')).toBe('user_daily');
    expect(norm(doc.getElementById('kx-amz-research-widget')!.textContent)).not.toContain('Product Intelligence');
  });
});

describe('popup', () => {
  function bootPopup(stored: Record<string, unknown>) {
    const html = readFileSync(path.join(root, 'popup.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
    const dom = new JSDOM(html, { url: 'chrome-extension://abc/src/popup.html', runScripts: 'outside-only' });
    doms.push(dom);
    const w = dom.window as any;
    const created: string[] = [];
    const sent: Msg[] = [];
    const changeListeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];
    const fire = (key: string) => changeListeners.forEach((l) => l({ [key]: {} }, 'local'));
    w.chrome = {
      runtime: {
        lastError: undefined,
        getManifest: () => ({ version: '9.7.1' }),
        sendMessage: (msg: Msg, cb?: (r: unknown) => void) => { sent.push(msg); setTimeout(() => cb && cb(msg.action === 'getAuthStatus' ? { authenticated: true } : {}), 0); },
      },
      storage: { local: {
        get: (k: string | string[], cb: (r: object) => void) => {
          const out: Record<string, unknown> = {};
          for (const key of ([] as string[]).concat(k)) if (key in stored) out[key] = stored[key];
          cb(out);
        },
        set: (o: Record<string, unknown>) => { Object.assign(stored, o); Object.keys(o).forEach(fire); },
        remove: (k: string) => { delete stored[k]; fire(k); },
      }, onChanged: { addListener: (l: (changes: Record<string, unknown>, area: string) => void) => changeListeners.push(l) } },
      tabs: { create: ({ url }: { url: string }) => created.push(url), query: () => {} },
    };
    w.eval(src('lib/lang.js'));
    w.eval(src('lib/limitCard.js'));
    w.eval(src('popup.js'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    return { doc: w.document as Document, created, sent, stored };
  }

  it('language selector: Otomatik by default; picking English stores kx_lang and re-renders live', async () => {
    const { doc, stored } = bootPopup({ kx_account_lang: 'tr' });
    const sel = await waitFor(() => (doc.getElementById('langSelect') as HTMLSelectElement | null));
    await waitFor(() => doc.getElementById('authStatus')!.textContent === 'Bağlı'); // popup initialised
    expect(doc.getElementById('langHint')!.textContent).toContain('Hesap dilinizi');
    expect(sel.value).toBe('auto');
    expect(norm(sel.options[0].textContent)).toBe('Otomatik');
    expect(doc.querySelector('[data-i18n="status"]')!.textContent).toBe('Durum');

    sel.value = 'en';
    sel.dispatchEvent(new (doc.defaultView as any).Event('change'));
    expect(stored.kx_lang).toBe('en');
    await waitFor(() => doc.querySelector('[data-i18n="status"]')!.textContent === 'Status');
    expect(norm(sel.options[0].textContent)).toBe('Automatic');
    expect(doc.getElementById('authStatus')!.textContent).toBe('Connected');
    expect(doc.documentElement.lang).toBe('en');

    sel.value = 'auto';
    sel.dispatchEvent(new (doc.defaultView as any).Event('change'));
    expect('kx_lang' in stored).toBe(false);
    await waitFor(() => doc.querySelector('[data-i18n="status"]')!.textContent === 'Durum'); // account language
  });

  it('account language English, no explicit choice → English popup', async () => {
    const { doc } = bootPopup({ kx_account_lang: 'en' });
    await waitFor(() => doc.querySelector('[data-i18n="status"]')!.textContent === 'Status');
    expect((doc.getElementById('langSelect') as HTMLSelectElement).value).toBe('auto');
  });

  it('shows "Bugün: X / Y araştırma" from the last research answer', async () => {
    const { doc } = bootPopup({ kx_research_quota: { used: 12, limit: 150, resetAt: '2999-01-01T21:00:00.000Z', reason: null } });
    await waitFor(() => doc.getElementById('researchUsage')!.textContent!.includes('Bugün'));
    expect(doc.getElementById('researchUsage')!.textContent).toBe('Bugün: 12 / 150 araştırma');
    expect(cardIn(doc.getElementById('researchLimit'))).toBeNull();
  });

  it('shows the upgrade card when blocked, opening the plan page in a new tab', async () => {
    const { doc, created, sent } = bootPopup({ kx_research_quota: { used: 150, limit: 150, resetAt: '2999-01-01T21:00:00.000Z', reason: 'user_daily', upgradeUrl: 'https://kolayxport.com/plan' } });
    const card = await waitFor(() => cardIn(doc.getElementById('researchLimit')));
    expect(norm(card.textContent)).toContain('Günlük araştırma hakkınız doldu');
    (card.querySelector('.kx-limit-upgrade') as HTMLButtonElement).click();
    expect(created).toEqual(['https://kolayxport.com/plan']);
    expect(sent.find((m) => m.type === 'kx_telemetry_event')).toMatchObject({ surface: 'popup', reason: 'user_daily' });
  });

  it('a state from before the reset counts as a fresh day', async () => {
    const { doc } = bootPopup({ kx_lang: 'en', kx_research_quota: { used: 150, limit: 150, resetAt: '2000-01-01T21:00:00.000Z', reason: 'user_daily' } });
    await waitFor(() => doc.getElementById('researchUsage')!.textContent!.includes('Today'));
    expect(doc.getElementById('researchUsage')!.textContent).toBe('Today: 0 / 150 lookups');
    expect(cardIn(doc.getElementById('researchLimit'))).toBeNull();
  });
});

describe('background worker', () => {
  function bootBackground(fetchImpl: (url: string, init: any) => Promise<any>) {
    let listener: any = null;
    const storage: Record<string, unknown> = { kx_auth_token: 'tok', kx_auth_token_expires_at: Date.now() + 3600e3 };
    const chrome = {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener: (l: any) => { listener = l; } }, getManifest: () => ({ version: '9.7.1' }) },
      storage: { local: {
        get: (keys: any, cb?: any) => { const out: any = {}; for (const k of [].concat(keys)) if (k in storage) out[k] = storage[k]; if (cb) cb(out); return Promise.resolve(out); },
        set: (o: any) => { Object.assign(storage, o); return Promise.resolve(); },
        remove: () => Promise.resolve(),
      } },
      action: { setBadgeBackgroundColor() {}, setBadgeText() {} },
      contextMenus: { create() {}, onClicked: { addListener() {} } },
      alarms: { create() {}, onAlarm: { addListener() {} } },
      tabs: { query: async () => [] },
      cookies: { getAll: async () => [] },
    };
    const ctx = vm.createContext({ chrome, fetch: fetchImpl, self: { addEventListener() {} }, console, setTimeout, clearTimeout, Date, URLSearchParams, encodeURIComponent, Promise, JSON });
    vm.runInContext(src('background-simple.js'), ctx);
    const send = (msg: Msg, senderUrl = 'https://www.etsy.com/search') => new Promise<any>((resolve) => listener(msg, { url: senderUrl }, resolve));
    return { send, storage };
  }

  it('stores the account language from /api/auth/extension as kx_account_lang', async () => {
    const { send, storage } = bootBackground(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await send({ action: 'authTokenFromPage', token: 't2', expiresIn: 3600, user: { email: 'a@b.c', name: 'A', locale: 'en' } }, 'https://kolayxport.com/app');
    expect(storage.kx_account_lang).toBe('en');
    expect(storage.kx_user).toEqual({ email: 'a@b.c', name: 'A' });
    // Unknown / missing locale leaves the stored value alone.
    await send({ action: 'authTokenFromPage', token: 't3', expiresIn: 3600, user: { email: 'a@b.c', name: 'A', locale: 'de' } }, 'https://kolayxport.com/app');
    expect(storage.kx_account_lang).toBe('en');
  });

  it('forwards the whole 429 body to the content script and tags research calls', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const { send, storage } = bootBackground(async (url, init) => {
      seen.push({ url, headers: init.headers });
      if (url.includes('/api/ext/research')) return { ok: false, status: 429, json: async () => limitBody('user_daily') };
      return { ok: true, status: 200, json: async () => ({ success: true, pending: [] }) };
    });
    await new Promise((r) => setTimeout(r, 10)); // token restore
    const resp = await send({ type: 'kx_research', action: 'search_enrich', params: { query: 'x' }, pv: 'pvabcdef0123456789abcdef' });
    expect(resp).toEqual({ error: 'research_limit', status: 429, limit: limitBody('user_daily') });
    expect(seen[0].headers['X-KX-Client']).toBe('ext/9.7.1');
    expect(seen[0].headers['X-KX-Page-View']).toBe('pvabcdef0123456789abcdef');
    expect(storage.kx_research_quota).toMatchObject({ used: 150, limit: 150, reason: 'user_daily' });

    // Exempt order/tracking calls are not tagged as research.
    await send({ action: 'fetchPendingTracking' });
    await send({ action: 'syncOrders', orders: [], source: 'test', timestamp: 1 });
    for (const c of seen.slice(1)) expect(c.headers['X-KX-Client']).toBeUndefined();
  });

  it('keeps `quota` from successful answers for the popup', async () => {
    const { send, storage } = bootBackground(async () => ({ ok: true, status: 200, json: async () => ({ items: [], quota: { used: 7, limit: 500, resetAt: RESET } }) }));
    await new Promise((r) => setTimeout(r, 10));
    const resp = await send({ type: 'kx_ebay_research', action: 'search_enrich', params: { query: 'x', marketplace: 'EBAY_US' } });
    expect(resp.quota).toEqual({ used: 7, limit: 500, resetAt: RESET });
    expect(storage.kx_research_quota).toMatchObject({ used: 7, limit: 500, reason: null });
  });
});

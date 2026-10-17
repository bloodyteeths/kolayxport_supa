// lib/lang.js — the extension's one language resolver:
// kx_lang (popup choice) → kx_account_lang (KolayXport account) → 'tr'. Never the browser language.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const LANG_SRC = readFileSync(path.join(__dirname, '../../chrome-extension/src/lib/lang.js'), 'utf8');

type Listener = (changes: Record<string, unknown>, area: string) => void;

function load(stored: Record<string, unknown> | null, opts: { navigatorLang?: string; uiLang?: string; silent?: boolean } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const w = dom.window as unknown as Record<string, any> & { eval: (s: string) => unknown };
  if (opts.navigatorLang) Object.defineProperty(w.navigator, 'language', { value: opts.navigatorLang });
  const listeners: Listener[] = [];
  const reads: unknown[] = [];
  if (stored) {
    w.chrome = {
      i18n: { getUILanguage: () => opts.uiLang || 'en-US' },
      storage: {
        local: {
          get: (keys: unknown, cb: (r: object) => void) => {
            reads.push(keys);
            if (opts.silent) return; // storage never answers
            const out: Record<string, unknown> = {};
            for (const k of ([] as string[]).concat(keys as string[])) if (k in stored) out[k] = stored[k];
            setTimeout(() => cb(out), 1);
          },
        },
        onChanged: { addListener: (l: Listener) => listeners.push(l) },
      },
    };
  }
  w.eval(LANG_SRC);
  const L = w.__KX_LANG;
  const change = (patch: Record<string, unknown>, area = 'local') => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete stored![k]; else stored![k] = v;
    }
    listeners.forEach((l) => l(Object.fromEntries(Object.keys(patch).map((k) => [k, {}])), area));
  };
  return { L, change, reads };
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe('resolve() order', () => {
  const { L } = load({});
  it('explicit choice first', () => {
    expect(L.resolve({ kx_lang: 'en', kx_account_lang: 'tr' })).toBe('en');
    expect(L.resolve({ kx_lang: 'tr', kx_account_lang: 'en' })).toBe('tr');
  });
  it('then the account language', () => {
    expect(L.resolve({ kx_account_lang: 'en' })).toBe('en');
    expect(L.resolve({ kx_lang: 'auto', kx_account_lang: 'en' })).toBe('en'); // invalid choice ignored
    expect(L.resolve({ kx_account_lang: 'EN-us' })).toBe('en');
  });
  it("then 'tr'", () => {
    expect(L.resolve({})).toBe('tr');
    expect(L.resolve(null)).toBe('tr');
    expect(L.resolve({ kx_lang: 'de', kx_account_lang: 'fr' })).toBe('tr');
  });
});

describe('__KX_LANG in a page', () => {
  it("defaults to Turkish even when the browser and Chrome UI are English", async () => {
    const { L, reads } = load({}, { navigatorLang: 'en-US', uiLang: 'en-US' });
    expect(await L.ready).toBe('tr');
    expect(L.get()).toBe('tr');
    expect(L.locale()).toBe('tr-TR');
    expect(reads[0]).toEqual(['kx_lang', 'kx_account_lang']);
  });

  it('uses the account language, and the explicit choice over it', async () => {
    expect(await load({ kx_account_lang: 'en' }).L.ready).toBe('en');
    expect(await load({ kx_account_lang: 'en', kx_lang: 'tr' }).L.ready).toBe('tr');
    const en = load({ kx_lang: 'en' }, { navigatorLang: 'tr-TR', uiLang: 'tr' }).L;
    expect(await en.ready).toBe('en');
    expect(en.locale()).toBe('en-US');
  });

  it('works without chrome.storage (tests, odd contexts) and when storage never answers', async () => {
    expect(await load(null).L.ready).toBe('tr');
    const silent = load({ kx_lang: 'en' }, { silent: true }).L;
    expect(await silent.ready).toBe('tr'); // 1.5 s safety timeout
  });

  it('onChange fires when the popup changes the choice or the account language arrives', async () => {
    const { L, change } = load({});
    await L.ready;
    const seen: string[] = [];
    L.onChange((l: string) => seen.push(l));

    change({ kx_account_lang: 'en' });
    await tick();
    expect(L.get()).toBe('en');

    change({ kx_lang: 'tr' }); // explicit beats account
    await tick();
    expect(L.get()).toBe('tr');

    change({ kx_lang: undefined }); // back to "Otomatik" → account language
    await tick();
    expect(L.get()).toBe('en');

    change({ kx_overlays_enabled: false }); // unrelated key: no event
    change({ kx_lang: 'tr' }, 'sync'); // other storage area: ignored
    await tick();
    expect(seen).toEqual(['en', 'tr', 'en']);
  });
});

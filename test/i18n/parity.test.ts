// BUILD_PLAN §0.2 / §2 integrator test: messages/en.json and messages/tr.json must have exactly the same
// keys and the same ICU arguments, and Turkish copy must use real Turkish letters (no ASCII-folded
// "Oluştur", "Gönder", "Sipariş", "Ödeme" in either case, and no dotless capital "Iptal"; lowercase "iptal"
// is correct Turkish). Legacy strings that predate the check are frozen in LEGACY_ASCII_TR below: the list
// may only shrink (fix the copy, then delete the key here); a new offender fails the test, and so does an
// allowlisted key that no longer offends.
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

type Tree = { [key: string]: unknown };

function flatten(tree: Tree, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Tree, path, out);
    else out[path] = v;
  }
  return out;
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  return [];
}

/** Case-insensitive for olustur/gonder/siparis/odeme; capital-only for Iptal (lowercase "iptal" is correct). */
const ASCII_TURKISH = /([Oo]lustur|[Gg]onder|[Ss]iparis|[Oo]deme|Iptal)/;

/** Pre-existing ASCII-folded tr.json strings (2026-10-15). Shrink only. */
const LEGACY_ASCII_TR = new Set<string>([]);

/**
 * Known en/tr ICU argument differences (argument and rich-text tag names), keyed by message key, valued by the
 * exact "missing:…|extra:…" signature. ds.syncMeta.* is intentional: Turkish picks the ablative suffix with a
 * `key` select, and SyncMeta passes `key` alongside `source`. The other two are legacy (shrink only).
 */
const ICU_ARG_EXCEPTIONS: Record<string, string> = {
  'ds.syncMeta.failed': 'missing:|extra:key',
  'ds.syncMeta.pull': 'missing:|extra:key',
  'ds.syncMeta.refreshed': 'missing:|extra:key',
  'ds.syncMeta.refreshing': 'missing:|extra:key',
  'ebayListings.bulk.deleteDialogDesc': 'missing:b|extra:',
  'integrations.trendyolStep3Desc': 'missing:|extra:settingsLink',
  // Turkish picks the dative/locative suffix per marketplace with {mp, select, …}
  'reports.error.refresh': 'missing:|extra:mp',
  'reports.meta.refreshFrom': 'missing:|extra:mp',
  'reports.meta.refreshingFrom': 'missing:|extra:mp',
  'reports.toast.newTransactions': 'missing:|extra:mp',
  // (Etsy'ye / eBay'e); English just names it with {marketplace}.
  'listingEditor.action.deactivate': 'missing:marketplace|extra:mp',
  'listingEditor.action.publish': 'missing:marketplace|extra:mp',
  'listingEditor.action.renew': 'missing:marketplace|extra:mp',
  'listingEditor.action.send': 'missing:marketplace|extra:mp',
  'listingEditor.action.sendCount': 'missing:marketplace|extra:mp',
  'listingEditor.action.sendShort': 'missing:marketplace|extra:mp',
  'listingEditor.action.viewOn': 'missing:marketplace|extra:mp',
  'listingEditor.banner.conflict': 'missing:marketplace|extra:mp',
  'listingEditor.banner.failed': 'missing:marketplace|extra:mp',
  'listingEditor.banner.fixFields': 'missing:marketplace|extra:mp',
  'listingEditor.banner.queued.deactivate': 'missing:marketplace|extra:mp',
  'listingEditor.banner.queued.publish': 'missing:marketplace|extra:mp',
  'listingEditor.banner.queued.renew': 'missing:marketplace|extra:mp',
  'listingEditor.banner.queuedDelete': 'missing:marketplace|extra:mp',
  'listingEditor.banner.sending': 'missing:marketplace|extra:mp',
  'listingEditor.confirm.deleteBody': 'missing:marketplace|extra:mp',
  'listingEditor.confirm.discardBody': 'missing:marketplace|extra:mp',
  'listingEditor.confirm.publishBody': 'missing:marketplace|extra:mp',
  'listingEditor.page.idMeta': 'missing:marketplace|extra:mp',
  'listingEditor.save.conflict': 'missing:marketplace|extra:mp',
  'listingEditor.save.savedNew': 'missing:marketplace|extra:mp',
  'listingEditor.save.sending': 'missing:marketplace|extra:mp',
  'listingEditor.state.loadFailed': 'missing:marketplace|extra:mp',
  'listingEditor.state.notFound': 'missing:marketplace|extra:mp',
  'listingEditor.toast.deleted': 'missing:marketplace|extra:mp',
  'listingEditor.toast.sent': 'missing:marketplace|extra:mp',
};

function icuArgs(message: string): Set<string> {
  const out = new Set<string>();
  const walk = (els: MessageFormatElement[]) => {
    for (const el of els) {
      if (el.type === TYPE.literal || el.type === TYPE.pound) continue;
      out.add(el.value);
      if ('options' in el) for (const opt of Object.values(el.options)) walk(opt.value);
      if (el.type === TYPE.tag) walk(el.children);
    }
  };
  walk(parse(message));
  return out;
}

function argSignature(enMsg: string, trMsg: string): string | null {
  const e = icuArgs(enMsg);
  const t = icuArgs(trMsg);
  const missing = [...e].filter((a) => !t.has(a)).sort();
  const extra = [...t].filter((a) => !e.has(a)).sort();
  return missing.length || extra.length ? `missing:${missing.join(',')}|extra:${extra.join(',')}` : null;
}

/** Namespaces written for the redesign: zero tolerance, no legacy exceptions. */
const DS_NAMESPACES = ['ds', 'status', 'listingScore', 'pro'];

const enFlat = flatten(en as Tree);
const trFlat = flatten(tr as Tree);

describe('i18n parity (messages/en.json ↔ messages/tr.json)', () => {
  it('every en key exists in tr', () => {
    const missing = Object.keys(enFlat).filter((k) => !(k in trFlat));
    expect(missing).toEqual([]);
  });

  it('every tr key exists in en', () => {
    const extra = Object.keys(trFlat).filter((k) => !(k in enFlat));
    expect(extra).toEqual([]);
  });

  it('a key is a string in one file only if it is a string in the other (same leaf shape)', () => {
    const shape = (v: unknown) => (Array.isArray(v) ? 'array' : typeof v);
    const mismatched = Object.keys(enFlat).filter((k) => k in trFlat && shape(enFlat[k]) !== shape(trFlat[k]));
    expect(mismatched).toEqual([]);
  });

  it('no empty tr strings where en has text', () => {
    const empty = Object.keys(enFlat).filter(
      (k) => typeof enFlat[k] === 'string' && (enFlat[k] as string).trim() && typeof trFlat[k] === 'string' && !(trFlat[k] as string).trim(),
    );
    expect(empty).toEqual([]);
  });

  it('both locales parse as ICU and use the same arguments ({count}, {date}, rich-text tags)', () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const k of Object.keys(enFlat)) {
      const e = enFlat[k];
      const t = trFlat[k];
      if (typeof e !== 'string' || typeof t !== 'string') continue;
      let sig: string | null;
      try {
        sig = argSignature(e, t);
      } catch (err) {
        problems.push(`${k}: ICU parse error (${(err as Error).message})`);
        continue;
      }
      if (sig) seen.add(k);
      if (sig !== (ICU_ARG_EXCEPTIONS[k] ?? null)) problems.push(`${k}: ${sig ?? 'no difference'} (expected ${ICU_ARG_EXCEPTIONS[k] ?? 'none'})`);
    }
    // An exception whose key vanished or became a non-string is stale too.
    for (const k of Object.keys(ICU_ARG_EXCEPTIONS)) if (!seen.has(k) && !problems.some((p) => p.startsWith(`${k}:`))) problems.push(`${k}: stale exception`);
    expect(problems).toEqual([]);
  });
});

describe('ASCII-Turkish check (tr.json)', () => {
  const offenders = Object.keys(trFlat).filter((k) => strings(trFlat[k]).some((s) => ASCII_TURKISH.test(s)));

  it('no new ASCII-folded Turkish (olustur|gonder|siparis|odeme, any case; capital Iptal)', () => {
    expect(offenders.filter((k) => !LEGACY_ASCII_TR.has(k))).toEqual([]);
  });

  it('redesign namespaces have no ASCII-folded Turkish at all', () => {
    expect(offenders.filter((k) => DS_NAMESPACES.some((ns) => k === ns || k.startsWith(`${ns}.`)))).toEqual([]);
  });

  it('the legacy allowlist only lists keys that still exist and still offend (shrink it when copy is fixed)', () => {
    const stale = [...LEGACY_ASCII_TR].filter((k) => !(k in trFlat) || !offenders.includes(k));
    expect(stale).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import {
  cropBox,
  descriptionLead,
  descriptionSrcDoc,
  mobileTitleCut,
  plainDescriptionLines,
  previewText,
  sanitizeDescriptionHtml,
} from '@/components/domain/preview/types';
import {
  FIX_FIELD_SECTION,
  computeListingHealth,
  etsyScoreInputFromSource,
  fixTarget,
} from '@/components/domain/listing-editor/RailHealth';
import { CHANGE_GROUPS, QUEUED_ACTIONS, orderChanges, queuedActionKind } from '@/components/domain/listing-editor/RailChanges';
import { attemptCauseKey, buildHistory, parseSentDrafts } from '@/components/domain/listing-editor/RailHistory';
import { etsyChecks } from '@/lib/listingScore/etsy';
import { ebayChecks } from '@/lib/listingScore/ebay';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { eEn, eTr } from './e-messages';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

function lookup(tree: unknown, key: string): string | undefined {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

describe('preview helpers', () => {
  it('decodes entities (never shows "one&#39;s")', () => {
    expect(previewText('Baby&#39;s first &amp; only blanket  ')).toBe("Baby's first & only blanket");
    expect(previewText(null)).toBe('');
  });

  it('mobile title cut at ~55 chars without a dangling comma', () => {
    const title = 'Personalized Baby Blanket, Custom Name Blanket, Newborn Gift, Monogram';
    const cut = mobileTitleCut(title);
    expect(cut.cut).toBe(true);
    expect(cut.visible.length).toBeLessThanOrEqual(55);
    expect(cut.visible.endsWith(',')).toBe(false);
    expect(title.startsWith(cut.visible)).toBe(true);
    expect(mobileTitleCut('Short title')).toEqual({ cut: false, visible: 'Short title' });
  });

  it('plain description keeps line breaks, decodes, trims blank edges, ignores HTML meaning', () => {
    expect(plainDescriptionLines('\n\nLine one\r\n\nIt&#39;s <b>soft</b>\n\n')).toEqual(['Line one', '', "It's <b>soft</b>"]);
    expect(descriptionLead('a\n\nb\nc\nd')).toEqual({ lines: ['a', 'b', 'c'], more: true });
    expect(descriptionLead('a\nb')).toEqual({ lines: ['a', 'b'], more: false });
    expect(descriptionLead(null)).toEqual({ lines: [], more: false });
  });

  it('crop box of a 4:3 card over square, tall and wide photos', () => {
    expect(cropBox(1)).toEqual({ widthPct: 100, heightPct: 75 });
    expect(cropBox(4 / 3)).toEqual({ widthPct: 100, heightPct: 100 });
    expect(cropBox(2)).toEqual({ widthPct: 66.7, heightPct: 100 });
    expect(cropBox(0)).toEqual({ widthPct: 100, heightPct: 100 });
  });

  it('eBay description HTML loses scripts, handlers and script URLs', () => {
    const dirty = '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">l</a><img src=x onerror=alert(1)><iframe src="//e"></iframe><style>p{}</style>';
    const clean = sanitizeDescriptionHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|onerror|javascript:|iframe|<style/i);
    expect(clean).toContain('<p>Hi</p>');
    expect(descriptionSrcDoc('<b>x</b>', { font: 'Inter', color: '#000', size: 13 })).toContain('<body><b>x</b></body>');
  });
});

describe('listing health (rail)', () => {
  const draft = { title: 'Personalized Baby Blanket, Custom Name Gift for Newborn Girls and Boys, Soft Knit Nursery Throw Keepsake', tags: Array(13).fill('baby gift idea'), images: Array(10).fill({ alt: 'x' }) };
  const sent = { title: 'Blanket', tags: [], images: [{ alt: '' }] };

  it('header shows the sent score and the draft score after send', () => {
    const h = computeListingHealth('etsy', draft, sent);
    expect(h.sentResult).not.toBeNull();
    expect(h.score).toBe(h.sentResult?.score);
    expect(h.afterScore).toBe(h.result.score);
    expect(h.afterScore).not.toBe(h.score);
  });

  it('create mode: draft score, no after score; empty draft is unscored', () => {
    const h = computeListingHealth('etsy', draft, null);
    expect(h.score).toBe(h.result.score);
    expect(h.afterScore).toBeNull();
    expect(computeListingHealth('etsy', {}, null).score).toBeNull();
  });

  it('same draft and sent → no after score', () => {
    expect(computeListingHealth('etsy', draft, draft).afterScore).toBeNull();
  });

  it('every fix field the Etsy and eBay scorers emit maps to an editor section', () => {
    const fields = new Set<string>();
    const allNa = [...etsyChecks({}), ...ebayChecks({})];
    const some = [
      ...etsyChecks({ shipping: { hasProfile: true, hasProcessing: false, hasWeight: true } }),
      ...etsyChecks({ shipping: { hasProfile: true, hasProcessing: true, hasWeight: false } }),
      ...ebayChecks({ condition: 'USED_GOOD', conditionDescription: '' }),
    ];
    for (const c of [...allNa, ...some]) if (c.fix?.field) fields.add(c.fix.field);
    for (const f of fields) expect(FIX_FIELD_SECTION[f], f).toBeTruthy();
    const sections = new Set(Object.values(FIX_FIELD_SECTION));
    for (const s of sections) expect(['photos', 'title', 'tags', 'specifics', 'price', 'variations', 'details', 'personalization', 'shipping']).toContain(s);
  });

  it('fixTarget: field → section, action → proposal action, none → null', () => {
    expect(fixTarget({ fix: { label: 'x', field: 'weight' } })).toEqual({ kind: 'field', section: 'shipping', field: 'weight' });
    expect(fixTarget({ fix: { label: 'x', action: 'ai_title' } })).toEqual({ kind: 'action', action: 'ai_title' });
    expect(fixTarget({ fix: { label: 'x', field: 'nope' } })).toBeNull();
    expect(fixTarget({})).toBeNull();
  });

  it('source → scorer input: decodes, drops staged deletes, unloaded parts stay na', () => {
    const input = etsyScoreInputFromSource({
      title: 'One&#39;s blanket',
      tags: ['mom&amp;baby'],
      photos: [{ alt: 'a' }, { alt: null, removed: true }, { alt: '' }],
      shippingLoaded: false,
      price: 20,
      market: null,
    });
    expect(input.title).toBe("One's blanket");
    expect(input.tags).toEqual(['mom&baby']);
    expect(input.images).toEqual([{ alt: 'a' }, { alt: '' }]);
    expect(input.shipping).toBeUndefined();
    expect(input.hasVideo).toBeUndefined();
    expect(input.market).toBeUndefined();
    const checks = etsyChecks(input);
    expect(checks.find((c) => c.id === 'price_market')?.status).toBe('na');
    expect(checks.find((c) => c.id === 'shipping_ready')?.status).toBe('na');
    expect(checks.find((c) => c.id === 'video')?.status).toBe('na');
  });

  it('processing counts as set from a readiness state or a shipping profile', () => {
    const a = etsyScoreInputFromSource({ shippingProfileId: '', readinessStateId: 77, itemWeight: 1 });
    expect(a.shipping).toEqual({ hasProfile: false, hasProcessing: true, hasWeight: true });
    const b = etsyScoreInputFromSource({ shippingProfileId: 123, itemWeight: 0 });
    expect(b.shipping).toEqual({ hasProfile: true, hasProcessing: true, hasWeight: false });
  });
});

describe('changes list (rail)', () => {
  it('queued action kinds', () => {
    expect(queuedActionKind('create_listing')).toBe('create');
    expect(queuedActionKind('DELETE')).toBe('delete');
    expect(queuedActionKind('copy')).toBe('copy');
    expect(queuedActionKind('create_shop_section')).toBe('createShopSection');
    expect(queuedActionKind('create_shipping_profile')).toBe('createShippingProfile');
    expect(queuedActionKind('create_return_policy')).toBe('createReturnPolicy');
    expect(queuedActionKind('withdraw')).toBe('withdraw');
    expect(queuedActionKind('something_new')).toBe('other');
    expect(queuedActionKind(undefined)).toBe('other');
  });

  it('queued delete is always first, others keep their order', () => {
    const ordered = orderChanges([
      { id: 'a', group: 'title' },
      { id: 'b', queuedAction: 'deactivate' },
      { id: 'c', queuedAction: 'delete' },
      { id: 'd', group: 'tags' },
    ]);
    expect(ordered.map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('recent sends (rail)', () => {
  it('maps raw English errors to cause keys; only listings.sendError.* keys pass through', () => {
    expect(attemptCauseKey('Etsy API 401 invalid_grant')).toBe('listings.sendError.reconnect');
    expect(attemptCauseKey('Refresh token expired')).toBe('listings.sendError.reconnect');
    expect(attemptCauseKey('Interrupted (process restarted mid-sync)')).toBe('listings.sendError.interrupted');
    expect(attemptCauseKey('Invalid taxonomy_id')).toBe('listings.sendError.rejected');
    // Etsy returned HTML: a parse failure, not a broken connection.
    expect(attemptCauseKey('Unexpected token < in JSON at position 0')).toBe('listings.sendError.generic');
    // Key-looking text outside listings.sendError.* is never handed to t() (it would print the raw key).
    expect(attemptCauseKey('etsy.draftSync.mediaFailed')).toBe('listings.sendError.generic');
    expect(attemptCauseKey('draftSync.x')).toBe('listings.sendError.generic');
    expect(attemptCauseKey('etsy.com')).toBe('listings.sendError.generic');
    expect(attemptCauseKey('listings.sendError.rateLimited')).toBe('listings.sendError.rateLimited');
    expect(attemptCauseKey('listings.sendError.nope')).toBe('listings.sendError.generic');
    expect(attemptCauseKey('')).toBe('listings.sendError.generic');
    expect(attemptCauseKey('boom')).toBe('listings.sendError.generic');
  });

  it('prefers the structured result code over the error text', () => {
    expect(attemptCauseKey('Something odd', { code: 'ETSY_REAUTH_REQUIRED', key: 'draftSync.reauthRequired' })).toBe('listings.sendError.reconnect');
    expect(attemptCauseKey('Unexpected token < in JSON', { code: 'INVALID_FIELDS' })).toBe('listings.sendError.rejected');
    expect(attemptCauseKey('x', { code: 'REMOTE_CHANGED' })).toBe('listings.sendError.conflict');
    expect(attemptCauseKey('Too many requests', { code: 'UNKNOWN_CODE' })).toBe('listings.sendError.rateLimited');
    expect(buildHistory([{ id: '1', status: 'failed', startedAt: '2026-10-11T10:00:00Z', error: 'Unexpected token <', result: { code: 'SHOP_NOT_FOUND' } }])[0].causeKey)
      .toBe('listings.sendError.reconnect');
  });

  it("a sent draft replaces its own successful attempt (no double 'Sent')", () => {
    const items = buildHistory(
      [
        { id: 'a1', draftId: 'd1', status: 'success', startedAt: '2026-10-12T09:00:00Z', finishedAt: '2026-10-12T09:00:03Z' },
        { id: 'a0', draftId: 'd1', status: 'failed', startedAt: '2026-10-12T08:00:00Z', error: 'boom' },
      ],
      [{ id: 'd1', syncedAt: '2026-10-12T09:00:03Z', changedKeys: ['title'] }],
    );
    expect(items.map((i) => [i.id, i.kind])).toEqual([['d:d1', 'sent'], ['a:a0', 'failed']]);
  });

  it('merges attempts and sent drafts newest first, limit 3', () => {
    const items = buildHistory(
      [
        { id: '1', status: 'failed', startedAt: '2026-10-11T10:00:00Z', finishedAt: '2026-10-11T10:00:05Z', error: 'Invalid taxonomy' },
        { id: '2', status: 'running', startedAt: '2026-10-14T10:00:00Z' },
        { id: '3', status: 'conflict', startedAt: '2026-10-13T10:00:00Z' },
        { id: '4', status: 'success', startedAt: 'not a date' },
      ],
      [{ id: 'd1', syncedAt: '2026-10-12T09:00:00Z', changedKeys: ['title', 'tags', 'tags'] }],
    );
    expect(items.map((i) => [i.id, i.kind])).toEqual([['a:2', 'running'], ['a:3', 'conflict'], ['d:d1', 'sent']]);
    expect(items[2].fieldCount).toBe(2);
    const failed = buildHistory([{ id: '1', status: 'failed', startedAt: '2026-10-11T10:00:00Z', error: 'Invalid taxonomy' }]);
    expect(failed[0]).toMatchObject({ kind: 'failed', causeKey: 'listings.sendError.rejected' });
  });

  it('parses the history response tolerantly', () => {
    expect(parseSentDrafts({ drafts: [{ id: 'x', syncedAt: '2026-10-12T09:00:00Z', changedKeys: ['title', 3] }, { id: 'bad' }] }))
      .toEqual([{ id: 'x', syncedAt: '2026-10-12T09:00:00Z', changedKeys: ['title'] }]);
    expect(parseSentDrafts([{ draftId: 7, synced_at: '2026-10-12T09:00:00Z', fields: ['price'] }]))
      .toEqual([{ id: '7', syncedAt: '2026-10-12T09:00:00Z', changedKeys: ['price'] }]);
    expect(parseSentDrafts(null)).toEqual([]);
  });
});

describe('Group E i18n keys', () => {
  const enFlat = flatten(eEn as unknown as Tree);
  const trFlat = flatten(eTr as unknown as Tree);

  it('EN and TR have the same keys and parse as ICU with matching arguments', () => {
    expect(Object.keys(trFlat).sort()).toEqual(Object.keys(enFlat).sort());
    for (const key of Object.keys(enFlat)) {
      const e = new IntlMessageFormat(enFlat[key], 'en');
      const t = new IntlMessageFormat(trFlat[key], 'tr');
      expect(e).toBeTruthy();
      expect(t).toBeTruthy();
      const args = (s: string) => Array.from(new Set(Array.from(s.matchAll(/\{(\w+)/g), (m) => m[1]))).sort();
      expect(args(trFlat[key]), key).toEqual(args(enFlat[key]));
    }
  });

  it('Turkish has real characters, no ASCII-Turkish, no "{marketplace}\'e"', () => {
    for (const v of Object.values(trFlat)) {
      expect(v).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme/);
      expect(v).not.toMatch(/\{marketplace\}'(e|a|ye|ya|in|ın)\b/);
    }
  });

  it('are merged into messages/*.json', () => {
    for (const key of Object.keys(enFlat)) {
      expect(typeof lookup(en, key), key).toBe('string');
      expect(typeof lookup(tr, key), key).toBe('string');
    }
  });

  it('every change group and queued action has a label', () => {
    for (const g of CHANGE_GROUPS) expect(enFlat[`listingEditor.changes.group.${g}`], g).toBeTruthy();
    for (const a of [...QUEUED_ACTIONS, 'other']) expect(enFlat[`listingEditor.changes.queued.${a}`], a).toBeTruthy();
    expect(enFlat['listingEditor.changes.group.other']).toBeTruthy();
  });

  it('cause keys used by recent sends exist in both locales', () => {
    for (const k of ['generic', 'interrupted', 'reconnect', 'rateLimited', 'notFound', 'rejected', 'conflict']) {
      expect(lookup(en, `listings.sendError.${k}`)).toBeTruthy();
      expect(lookup(tr, `listings.sendError.${k}`)).toBeTruthy();
    }
  });
});

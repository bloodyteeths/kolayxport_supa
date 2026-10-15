// M6 Group A: changeSummary (listing-editor §5.2 count rule) + section config + editor nav helpers.
import { describe, expect, it } from 'vitest';
import {
  changeCount,
  diffKeys,
  fieldEquals,
  listDelta,
  sectionStates,
  summarizeChanges,
} from '@/components/domain/listing-editor/changeSummary';
import { FIELD_GROUP, GROUP_SECTION, SECTION_DEFS, sectionsFor, sectionAnchorId, fieldAnchorId } from '@/lib/listingEditor/sections';
import { editorHref, editorNeighbors, listHref, newListingHref, parseEditorNav } from '@/lib/listingEditor/editorNav';
import type { DraftRow, FieldMap } from '@/lib/listingEditor/types';

function draft(partial: Partial<DraftRow> = {}): DraftRow {
  return {
    id: 'd1',
    status: 'draft',
    listingId: '123',
    fieldPatch: {},
    queuedActions: [],
    media: [],
    syncAttempts: [],
    ...partial,
  };
}

const remote: FieldMap = { title: 'Baby Blanket', description: 'Soft', tags: ['baby gift', 'blanket'], price: '12.50', quantity: 3, shop_section_id: '' };

describe('fieldEquals / diffKeys / listDelta', () => {
  it('treats a reformatted price and blank values as equal', () => {
    expect(fieldEquals('12.50', 12.5)).toBe(true);
    expect(fieldEquals('12.5', '12.50')).toBe(true);
    expect(fieldEquals('', null)).toBe(true);
    expect(fieldEquals([], '')).toBe(true);
    expect(fieldEquals('12.50', '12.51')).toBe(false);
  });
  it('compares arrays in order (Etsy keeps tag order)', () => {
    expect(fieldEquals(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(fieldEquals(['a', 'b'], ['b', 'a'])).toBe(false);
  });
  it('diffKeys against null lists every non-blank key (create)', () => {
    expect(diffKeys(null, { title: 'x', tags: [], price: '' }).sort()).toEqual(['title']);
    expect(diffKeys(remote, { ...remote, price: '12.5' })).toEqual([]);
    expect(diffKeys(remote, { ...remote, title: 'New' })).toEqual(['title']);
  });
  it('listDelta counts added / removed case-insensitively', () => {
    expect(listDelta(['Baby Gift', 'blanket'], ['baby gift', 'name blanket', 'swaddle'])).toEqual({ added: 2, removed: 1 });
  });
});

describe('summarizeChanges', () => {
  it('one line per field group, tags with added/removed, revertable in edit', () => {
    const current = { ...remote, title: 'Baby Blanket, Custom', tags: ['baby gift', 'name blanket', 'swaddle'] };
    const out = summarizeChanges({ mode: 'edit', remote, current, draft: null, unsavedKeys: ['title'] });
    expect(out.map((c) => c.id)).toEqual(['title', 'tags']);
    expect(out[0]).toMatchObject({ kind: 'field', section: 'title', source: 'form', revertable: true, fields: ['title'] });
    expect(out[1]).toMatchObject({ added: 2, removed: 1, source: 'draft' });
    expect(changeCount(out)).toBe(2);
  });

  it('several fields of one group count once (processing min + max)', () => {
    const r = { processing_min: 1, processing_max: 3 };
    const out = summarizeChanges({ mode: 'edit', remote: r, current: { processing_min: 2, processing_max: 5 }, draft: null });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'processing', fields: ['processing_min', 'processing_max'], section: 'shipping' });
  });

  it('reads staged-only content from the draft row (media, taxonomy, inventory, personalization)', () => {
    const d = draft({
      taxonomyPatch: { properties: [{ property_id: 1 }] },
      inventoryPatch: { products: [{ sku: 'A', property_values: [] }] },
      personalizationPatch: { is_personalizable: true },
      media: [
        { id: 'm1', kind: 'image', operation: 'upload' },
        { id: 'm2', kind: 'image', operation: 'reorder', etsyMediaId: '9' },
        { id: 'm3', kind: 'image', operation: 'update_alt', etsyMediaId: '9' },
        { id: 'm4', kind: 'video', operation: 'delete', etsyMediaId: '5' },
      ],
    });
    const out = summarizeChanges({ mode: 'edit', remote, current: remote, draft: d });
    expect(out.map((c) => c.id)).toEqual(['photos', 'photoOrder', 'altText', 'video', 'sku', 'categoryDetails', 'personalization']);
    expect(out.every((c) => c.source === 'draft' && !c.revertable)).toBe(true);
  });

  it('a variations inventory patch is "Variations"', () => {
    const d = draft({ inventoryPatch: { products: [{ property_values: [{ property_id: 1 }] }, { property_values: [] }] } });
    expect(summarizeChanges({ mode: 'edit', remote, current: remote, draft: d }).map((c) => c.id)).toEqual(['variations']);
  });

  it('queued delete is listed first; state actions one line each; create_* and completed actions are not counted', () => {
    const d = draft({
      queuedActions: [
        { type: 'deactivate' },
        { type: 'create_shop_section', tempId: -1, payload: { title: 'x' } },
        { type: 'renew', completedAt: '2026-10-01' },
        { type: 'delete' },
      ],
    });
    const out = summarizeChanges({ mode: 'edit', remote, current: { ...remote, title: 'T' }, draft: d });
    expect(out.map((c) => c.id)).toEqual(['action:delete', 'title', 'action:deactivate']);
    expect(out[0]).toMatchObject({ kind: 'action', action: 'delete', section: null });
  });

  it('registered dirty sections add their groups (or a default one) as unsaved', () => {
    const out = summarizeChanges({
      mode: 'edit',
      remote,
      current: remote,
      draft: null,
      sections: [
        { id: 'photos', dirty: true, changes: [{ group: 'photoOrder' }] },
        { id: 'variations', dirty: true },
        { id: 'personalization', dirty: false },
      ],
    });
    expect(out.map((c) => [c.id, c.source])).toEqual([
      ['photoOrder', 'form'],
      ['variations', 'form'],
    ]);
  });

  it('extra draft keys without an input still count', () => {
    const out = summarizeChanges({ mode: 'edit', remote, current: remote, draft: draft({ fieldPatch: { condition: 'x' } }), extraKeys: ['condition'] });
    expect(out.map((c) => c.id)).toEqual(['condition']);
  });

  it('create mode diffs against the blank workspace and is not revertable', () => {
    const blank = { title: '', tags: [], price: '' };
    const out = summarizeChanges({ mode: 'create', remote: blank, current: { title: 'New', tags: ['a'], price: '' }, draft: null });
    expect(out.map((c) => c.id)).toEqual(['title', 'tags']);
    expect(out.some((c) => c.revertable)).toBe(false);
  });
});

describe('sectionStates', () => {
  it('counts changes per section and flags block_sync errors only', () => {
    const changes = summarizeChanges({ mode: 'edit', remote, current: { ...remote, title: 'x', price: '9' }, draft: null });
    const st = sectionStates(changes, [
      { field: 'tags', section: 'tags', severity: 'block_sync', key: 'k' },
      { field: 'title', section: 'title', severity: 'warn', key: 'w' },
    ]);
    expect(st.title).toEqual({ changes: 1, error: false });
    expect(st.price).toEqual({ changes: 1, error: false });
    expect(st.tags).toEqual({ changes: 0, error: true });
  });
});

describe('sections config', () => {
  it('Etsy page order and no eBay-only sections', () => {
    expect(sectionsFor('etsy', 'edit').map((s) => s.id)).toEqual(['photos', 'title', 'tags', 'price', 'variations', 'details', 'personalization', 'shipping']);
  });
  it('eBay has specifics instead of tags and no personalization', () => {
    expect(sectionsFor('ebay', 'edit').map((s) => s.id)).toEqual(['photos', 'title', 'specifics', 'price', 'variations', 'details', 'shipping']);
  });
  it('every field group maps to a section that exists', () => {
    const ids = new Set(SECTION_DEFS.map((s) => s.id));
    for (const g of Object.values(FIELD_GROUP)) expect(ids.has(GROUP_SECTION[g])).toBe(true);
  });
  it('anchor ids are DOM-safe', () => {
    expect(sectionAnchorId('photos')).toBe('le-section-photos');
    expect(fieldAnchorId('item weight')).toBe('le-field-item_weight');
  });
});

describe('editorNav', () => {
  const nav = parseEditorNav({ marketplace: 'etsy', shopId: '42', ids: ['1', '2', '3', 7], query: 'shop=42&view=active' });
  it('validates storage content', () => {
    expect(nav?.ids).toEqual(['1', '2', '3']);
    expect(parseEditorNav({ marketplace: 'amazon', ids: ['1'] })).toBeNull();
    expect(parseEditorNav('x')).toBeNull();
    expect(parseEditorNav({ marketplace: 'etsy', ids: [] })).toBeNull();
  });
  it('neighbors within the same marketplace and shop', () => {
    expect(editorNeighbors(nav, 'etsy', '42', '2')).toMatchObject({ prev: '1', next: '3', index: 1, total: 3 });
    expect(editorNeighbors(nav, 'etsy', '42', '1')).toMatchObject({ prev: null, next: '2' });
    expect(editorNeighbors(nav, 'etsy', '99', '2')).toBeNull();
    expect(editorNeighbors(nav, 'ebay', '42', '2')).toBeNull();
    expect(editorNeighbors(nav, 'etsy', '42', '9')).toBeNull();
  });
  it('hrefs', () => {
    expect(editorHref('etsy', '123', '42')).toBe('/app/etsy-listings/123?shop=42');
    expect(editorHref('ebay', 'SKU 1', '42')).toBe('/app/ebay-listings/SKU%201');
    expect(newListingHref('etsy', '42', { draft: 'abc' })).toBe('/app/etsy-listings/new?shop=42&draft=abc');
    expect(listHref('etsy', '42')).toBe('/app/etsy-listings?shop=42');
    expect(listHref('etsy', '42', '?shop=42&view=active')).toBe('/app/etsy-listings?shop=42&view=active');
  });
});

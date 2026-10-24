import { describe, expect, it } from 'vitest';
import { addTemplateStep, normaliseTemplateName, normaliseTemplateStep, templateStepsOf, TEMPLATE_FIELD_KEYS, type TemplateStep } from '@/lib/bulk/editorTemplates';
import { SET_FIELD_KEYS } from '@/components/domain/listings/bulk/SetFieldModal';
import { planTemplate, templateNeeds } from '@/components/domain/listings/bulk/templatePlan';
import type { ListingRow } from '@/lib/listings/types';

const row = (id: string, over: Partial<ListingRow> = {}): ListingRow =>
  ({ id, editable: { price: true, qty: true, title: true }, sync: null, ...over }) as unknown as ListingRow;

describe('template steps', () => {
  it('field keys match the Set field dialog', () => {
    expect([...TEMPLATE_FIELD_KEYS]).toEqual([...SET_FIELD_KEYS]);
  });
  it('normalises and rejects', () => {
    expect(normaliseTemplateStep({ kind: 'price', mode: 'decPct', value: 15, round: '99' })).toEqual({ kind: 'price', mode: 'decPct', value: 15, round: '99' });
    expect(normaliseTemplateStep({ kind: 'price', mode: 'decPct', value: 5000, round: '99' })).toBeNull();
    expect(normaliseTemplateStep({ kind: 'price', mode: 'set', value: 0, round: 'none' })).toBeNull();
    expect(normaliseTemplateStep({ kind: 'tags', mode: 'add', tags: ['gift', 'Gift', ' ', 'a'.repeat(30)] })).toEqual({ kind: 'tags', mode: 'add', tags: ['gift', 'a'.repeat(20)] });
    expect(normaliseTemplateStep({ kind: 'field', key: 'shipping', value: { shippingProfileId: 7, evil: { x: 1 } } })).toEqual({ kind: 'field', key: 'shipping', value: { shippingProfileId: 7 } });
    expect(normaliseTemplateStep({ kind: 'field', key: 'nope', value: { a: 1 } })).toBeNull();
    expect(templateStepsOf([{ kind: 'x' }, { kind: 'tags', mode: 'add', tags: ['a'] }])).toHaveLength(1);
    expect(normaliseTemplateName('  Yılbaşı   indirimi ')).toBe('Yılbaşı indirimi');
    expect(normaliseTemplateName('   ')).toBeNull();
  });
  it('one price step and one step per field key; tag steps accumulate', () => {
    let steps: TemplateStep[] = [];
    steps = addTemplateStep(steps, { kind: 'price', mode: 'decPct', value: 10, round: 'none' });
    steps = addTemplateStep(steps, { kind: 'tags', mode: 'add', tags: ['a'] });
    steps = addTemplateStep(steps, { kind: 'tags', mode: 'remove', tags: ['b'] });
    steps = addTemplateStep(steps, { kind: 'field', key: 'shipping', value: { shippingProfileId: 1 } });
    steps = addTemplateStep(steps, { kind: 'field', key: 'shipping', value: { shippingProfileId: 2 } });
    steps = addTemplateStep(steps, { kind: 'price', mode: 'decPct', value: 15, round: '99' });
    expect(steps.map((s) => s.kind)).toEqual(['tags', 'tags', 'field', 'price']);
    expect(steps.find((s) => s.kind === 'field')).toMatchObject({ value: { shippingProfileId: 2 } });
  });
});

describe('planTemplate', () => {
  const steps: TemplateStep[] = [
    { kind: 'price', mode: 'decPct', value: 10, round: 'none' },
    { kind: 'tags', mode: 'add', tags: ['christmas gift'] },
    { kind: 'field', key: 'shipping', value: { shippingProfileId: 55 } },
    { kind: 'field', key: 'description', value: { description: 'Ships in 1 day.', descriptionMode: 'append' } },
  ];
  it('one merged patch per listing; variation listings go to the variation-price path', () => {
    expect(templateNeeds(steps)).toEqual({ tags: true, materials: false, descriptions: true });
    const plan = planTemplate([row('a'), row('v', { editable: { price: false } as any })], steps, {
      currentPrice: () => 20,
      tagMax: 13,
      tags: new Map([['a', ['copper']], ['v', ['brass']]]),
      descriptions: new Map([['a', 'Pure copper.'], ['v', 'Brass.']]),
    });
    expect(plan.patches.find((p) => p.id === 'a')!.patch).toEqual({
      price: 18,
      tags: ['copper', 'christmas gift'],
      etsy: { fields: { shipping_profile_id: 55 } },
      description: 'Pure copper.\n\nShips in 1 day.',
    });
    expect(plan.patches.find((p) => p.id === 'v')!.patch).not.toHaveProperty('price');
    expect(plan.variationPriceRows.map((r) => r.id)).toEqual(['v']);
    expect(plan.priceStep).toMatchObject({ mode: 'decPct', value: 10 });
    expect(plan.skipped).toBe(0);
  });
  it('skips a step whose current value is unknown or has an unsent change; excludes queued deletions', () => {
    const plan = planTemplate(
      [row('a'), row('b', { sync: { status: 'pending', changedFields: ['tags'] } as any }), row('d', { sync: { status: 'pending', changedFields: [], queuedDelete: true } as any })],
      [{ kind: 'tags', mode: 'add', tags: ['x'] }],
      { currentPrice: () => 1, tagMax: 13, tags: new Map([['b', ['y']]]) },
    );
    expect(plan.patches).toEqual([]);
    expect(plan.skipped).toBe(2);
    expect(plan.excludedRemovals).toBe(1);
  });
  it('steps chain: replace tags then add; price below the minimum is skipped', () => {
    const plan = planTemplate([row('a')], [
      { kind: 'tags', mode: 'replace', tags: ['one'] },
      { kind: 'tags', mode: 'add', tags: ['two'] },
      { kind: 'price', mode: 'set', value: 0.1, round: 'none' },
    ], { currentPrice: () => 5, priceMin: 0.2, tagMax: 13 });
    expect(plan.patches[0].patch).toEqual({ tags: ['one', 'two'] });
    expect(plan.skipped).toBe(1);
  });
});

describe('planTemplate tag limit', () => {
  it('a listing already at 13 tags: nothing staged for tags, counted as over the limit', () => {
    const full = Array.from({ length: 13 }, (_, i) => `t${i}`);
    const plan = planTemplate([row('a')], [{ kind: 'tags', mode: 'add', tags: ['christmas gift'] }], { currentPrice: () => 1, tagMax: 13, tags: new Map([['a', full]]) });
    expect(plan.patches).toEqual([]);
    expect(plan.tagsOverLimit).toBe(1);
  });
});

import { planTagChanges, commonTags } from '@/components/domain/listings/bulk/AddTagsModal';

describe('full-13-tag listings are never a dead end', () => {
  const full = Array.from({ length: 13 }, (_, i) => `t${i}`);
  const rows = [row('a'), row('b')];
  const cur = (r: { id: string }) => (r.id === 'a' ? full : ['x']);
  it('reports which listings are full', () => {
    const p = planTagChanges(rows as any, cur as any, ['christmas gift'], 'add', 13);
    expect(p.fullIds).toEqual(['a']);
    expect(p.patches.map((x) => x.id)).toEqual(['b']);
  });
  it('remove-first makes room, then adds', () => {
    const p = planTagChanges(rows as any, cur as any, ['christmas gift'], 'add', 13, ['t0']);
    expect(p.fullIds).toEqual([]);
    expect(p.patches.find((x) => x.id === 'a')!.patch.tags).toEqual([...full.slice(1), 'christmas gift']);
  });
  it('suggests the most common tags', () => {
    expect(commonTags([['a', 'b'], ['B', 'c'], null])[0]).toBe('b');
  });
});

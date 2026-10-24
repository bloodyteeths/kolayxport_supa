import { describe, expect, it } from 'vitest';
import { asReferenceRole, referenceInstruction, referenceLabel, usesReferenceRoles } from '@/lib/ai/referenceImages';

describe('AI reference roles', () => {
  it('unknown roles are product references', () => {
    expect(asReferenceRole('style')).toBe('style');
    expect(asReferenceRole('evil')).toBe('product');
    expect(asReferenceRole(undefined)).toBe('product');
  });
  it('product-only references keep the original prompt sentence (no behaviour change for existing callers)', () => {
    expect(usesReferenceRoles(['product', 'product'])).toBe(false);
    expect(referenceInstruction(['product', 'product'])).toBe('Use the 2 reference images above: keep the exact same product (shape, colours, materials, details, any printed text) and change only what the instructions ask.');
    expect(referenceInstruction(['product'])).toMatch(/^Use the reference image above/);
    expect(referenceInstruction([])).toBe('');
  });
  it('mixed roles: labelled references and role-aware instructions', () => {
    const roles = ['product', 'person', 'scene', 'style'] as const;
    expect(usesReferenceRoles(roles)).toBe(true);
    const ins = referenceInstruction(roles);
    expect(ins).toMatch(/PRODUCT references/);
    expect(ins).toMatch(/MODEL reference/);
    expect(ins).toMatch(/SCENE reference/);
    expect(ins).toMatch(/STYLE reference/);
    expect(referenceLabel('style', 3)).toMatch(/^Reference image 3 — STYLE reference: copy only its visual style/);
    expect(referenceInstruction(['style'])).toMatch(/Show the product described in the instructions/);
  });
});

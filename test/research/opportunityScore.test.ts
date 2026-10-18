import { describe, expect, it } from 'vitest';
import { competitionValue, opportunityOf } from '@/lib/research/opportunityScore';

const g = (value: number | null) => ({ value, kind: 'measured' as const, guard: value == null ? { ok: false, reasonKey: 'x' } : { ok: true } });
const result = (tier: 1 | 2 | 3 | 4 | 5 | null, total: number | null, top5: number | null, newcomers: number | null) => ({
  demand: { tier, inputs: [], kind: 'signal' as const },
  competition: { total: g(total), top5Share: g(top5) },
  newcomers: g(newcomers),
}) as any;

describe('opportunityOf', () => {
  it('the real "personalized wooden jewelry box" Etsy search scores as a fair opportunity', () => {
    // Demand ●●●○○, 14 029 listings, top 5 hold 12.5 %, 36.2 % newcomers (live search 2026-10-18).
    const o = opportunityOf(result(3, 14029, 0.125, 0.362));
    expect(o.score).toBeGreaterThanOrEqual(55);
    expect(o.score).toBeLessThan(70);
    expect(o.band).toBe('ok');
    expect(o).toMatchObject({ demand: 'medium', competition: 'medium', newcomersOk: true, dominated: false, kind: 'signal' });
  });

  it('high demand, few listings, open niche → good; low demand, saturated, dominated → hard', () => {
    expect(opportunityOf(result(5, 800, 0.1, 0.5)).band).toBe('good');
    expect(opportunityOf(result(1, 400000, 0.7, 0.05)).band).toBe('hard');
  });

  it('needs demand plus one more input; missing inputs renormalise the weights', () => {
    expect(opportunityOf(result(null, 1000, 0.2, 0.3)).score).toBeNull();
    expect(opportunityOf(result(4, null, null, null)).score).toBeNull();
    const ebayLike = opportunityOf(result(4, 2000, null, null));
    expect(ebayLike.score).not.toBeNull();
    expect(ebayLike.parts.map((p) => p.key)).toEqual(['demand', 'competition']);
  });

  it('competition is a log scale', () => {
    expect(competitionValue(500)).toBe(1);
    expect(competitionValue(5000)).toBeCloseTo(0.667, 2);
    expect(competitionValue(50000)).toBeCloseTo(0.333, 2);
    expect(competitionValue(5_000_000)).toBe(0.05);
  });
});

// research R3-B test fixtures: one GET /api/research/watches row as R3-A returns it.
export function rawRow(over: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    type: 'etsyShop',
    marketplace: 'etsy',
    refId: '12345',
    label: 'WoodAndWords',
    url: 'https://www.etsy.com/shop/WoodAndWords',
    iconUrl: null,
    createdAt: '2026-10-01T06:00:00Z',
    source: 'researchWatch',
    capabilities: { alerts: true, remove: true },
    shop: null,
    href: '/app/research/shops?open=w1',
    alertRules: { newListing: true, priceDropPct: 10, salesSpikeX: null },
    snapshots: { count: 14, first: '2026-10-01', last: '2026-10-15' },
    metrics: {
      salesPerDay: { value: 14.3, kind: 'measured', guard: { ok: true } },
      salesVsPrev: { value: 0.22, kind: 'measured', guard: { ok: true } },
      active: { value: 412, kind: 'measured', guard: { ok: true } },
      new7d: { value: 9, kind: 'measured', guard: { ok: true } },
      priceChange: { value: null, kind: 'measured', guard: { ok: false, reasonKey: 'research.guard.insufficient' } },
      soldItemsAllTime: null,
      droppedPoints: 0,
    },
    ...over,
  };
}

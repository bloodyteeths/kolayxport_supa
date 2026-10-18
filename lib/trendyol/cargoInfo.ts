/**
 * Pure (client + server): cargo facts of a stored Trendyol shipment package (`Order.rawData`).
 * Used by the order rows (lib/orders/toOrderRows.ts) and the cargo route (pages/api/trendyol/cargo.ts).
 */
export interface TrendyolCargoInfo {
  cargoNumber: string | null;
  carrier: string | null;
  packageId: string | null;
  packageStatus: string | null;
  /** Trendyol's common label exists for this package (Trendyol Express / Aras, Trendyol pays). */
  commonLabel: boolean;
  /** Status the seller can report next. */
  nextStatus: 'Picking' | 'Invoiced' | null;
  lines: Array<{ lineId: string; quantity: number }>;
}

const COMMON_LABEL_CARRIERS = /trendyol\s*express|\btex\b|aras/i;

/** Pure: what the order panel and the label route need from the raw package. */
export function trendyolCargoInfo(raw: Record<string, any> | null | undefined): TrendyolCargoInfo {
  const r = raw || {};
  const cargoNumber = r.cargoTrackingNumber != null && String(r.cargoTrackingNumber).trim() ? String(r.cargoTrackingNumber).trim() : null;
  const carrier = typeof r.cargoProviderName === 'string' && r.cargoProviderName.trim() ? r.cargoProviderName.trim() : null;
  const packageStatus = String(r.shipmentPackageStatus || r.status || '') || null;
  // whoPays 1 = Trendyol-paid cargo (the common-label process); absent → let Trendyol decide (404 falls back to PDF).
  const trendyolPays = r.whoPays === undefined || r.whoPays === null || Number(r.whoPays) === 1;
  const s = (packageStatus || '').toLowerCase();
  const nextStatus = s === 'created' ? 'Picking' : s === 'picking' ? 'Invoiced' : null;
  const lines = (Array.isArray(r.lines) ? r.lines : [])
    .map((l: any) => ({ lineId: String(l?.lineId ?? l?.id ?? ''), quantity: Number(l?.quantity) || 1 }))
    .filter((l: { lineId: string }) => l.lineId);
  return {
    cargoNumber,
    carrier,
    packageId: r.shipmentPackageId != null ? String(r.shipmentPackageId) : r.id != null ? String(r.id) : null,
    packageStatus,
    commonLabel: !!cargoNumber && !!carrier && COMMON_LABEL_CARRIERS.test(carrier) && trendyolPays,
    nextStatus,
    lines,
  };
}

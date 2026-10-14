/**
 * Label link helpers shared by the labels page and the carrier drawers.
 *
 * Where label files live (see pages/api/orders/index.ts + the label routes):
 *  - Shipment.pdfUrl       UPS (data:image/gif;base64,...) and MNG (http URL or
 *                          data:application/pdf;base64,...). Newest first from the API.
 *  - LabelJob.pdfUrl       FedEx, per order item (line_items[].labelJobs[]).
 *  - Order.shippingLabelUrl FedEx, order level.
 *  - /api/labels/ups/[orderId]/pdf  in-memory UPS cache. Not used as a fallback:
 *                          it is filled from the same URL stored in Shipment.pdfUrl.
 */

export interface LabelShipmentLike {
  id?: string;
  status?: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  pdfUrl?: string | null;
  createdAt?: string | null;
}

export interface LabelJobLike {
  status?: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  pdfUrl?: string | null;
  createdAt?: string | null;
}

export interface LabelOrderLike {
  id?: string;
  shipments?: LabelShipmentLike[] | null;
  line_items?: Array<{ labelJobs?: LabelJobLike[] | null } | null> | null;
  shippingLabelUrl?: string | null;
  trackingNumber?: string | null;
  lastShipmentCarrier?: string | null;
}

export interface LatestLabel {
  /** Openable label URL (http, relative /api path or data: URI), or null. */
  url: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  /** Shipment row id when the label is a Shipment (deletable via /api/shipments/:id/delete). */
  shipmentId: string | null;
}

const nonEmpty = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() && v.trim() !== '—' ? v.trim() : null;

/** Accept only values that can actually be opened in a tab. */
export function isOpenableLabelUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return /^https?:\/\//i.test(s) || s.startsWith('/') || /^data:[^;,]+;base64,/i.test(s);
}

/** Build an openable href from what a label API returned (URL and/or raw base64). */
export function toLabelHref(labelUrl?: unknown, labelBase64?: unknown, mime = 'application/pdf'): string | null {
  if (isOpenableLabelUrl(labelUrl)) return labelUrl.trim();
  if (typeof labelBase64 === 'string' && labelBase64.trim()) {
    const b64 = labelBase64.trim();
    return b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`;
  }
  return null;
}

const time = (s?: string | null) => {
  const n = s ? new Date(s).getTime() : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Newest label (shipment or FedEx label job, whichever is newer; then order-level URL) for an order. */
export function getLatestLabel(order: LabelOrderLike | null | undefined): LatestLabel {
  const empty: LatestLabel = { url: null, trackingNumber: null, carrier: null, shipmentId: null };
  if (!order) return empty;

  const shipments = (order.shipments || [])
    .filter((s): s is LabelShipmentLike => !!s && s.status === 'created' && !!(s.trackingNumber || s.pdfUrl))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const shipment = shipments[0];

  const jobs = (order.line_items || [])
    .flatMap((li) => li?.labelJobs || [])
    .filter((j): j is LabelJobLike => !!j && j.status === 'created' && !!(j.trackingNumber || j.pdfUrl))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const job = jobs[0];

  // Prefer whichever label is newer. LabelJob rows from /api/orders carry no
  // createdAt yet, so without dates the shipment (UPS/MNG) wins as before.
  const jobIsNewer = !!job && !!shipment && time(job.createdAt) > time(shipment.createdAt);

  if (shipment && !jobIsNewer) {
    const carrier = nonEmpty(shipment.carrier);
    // No stored file = no print button. The /api/labels/ups/[orderId]/pdf cache
    // is filled from the same labelUrl that would have been stored here (and is
    // lost on restart), so falling back to it only produced a 404 tab.
    const url = isOpenableLabelUrl(shipment.pdfUrl) ? shipment.pdfUrl.trim() : null;
    return {
      url,
      trackingNumber: nonEmpty(shipment.trackingNumber),
      carrier,
      shipmentId: shipment.id || null,
    };
  }

  if (job) {
    return {
      url: isOpenableLabelUrl(job.pdfUrl) ? job.pdfUrl.trim() : isOpenableLabelUrl(order.shippingLabelUrl) ? order.shippingLabelUrl.trim() : null,
      trackingNumber: nonEmpty(job.trackingNumber) || nonEmpty(order.trackingNumber),
      carrier: nonEmpty(job.carrier),
      shipmentId: null,
    };
  }

  if (isOpenableLabelUrl(order.shippingLabelUrl)) {
    return {
      url: order.shippingLabelUrl.trim(),
      trackingNumber: nonEmpty(order.trackingNumber),
      carrier: nonEmpty(order.lastShipmentCarrier),
      shipmentId: null,
    };
  }

  return empty;
}

/**
 * Tracking number and carrier taken from the SAME source, so the tracking
 * dialog never pairs one label's number with another label's carrier.
 * Latest label first (when it has a number), otherwise the row's own pair.
 */
export function getTrackingPair(
  latest: LatestLabel,
  rowTrackingNumber?: string | null,
  rowCarrier?: string | null,
): { trackingNumber: string; carrier: string } {
  if (latest.trackingNumber) {
    return { trackingNumber: latest.trackingNumber, carrier: latest.carrier || '' };
  }
  return { trackingNumber: nonEmpty(rowTrackingNumber) || '', carrier: nonEmpty(rowCarrier) || '' };
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try {
    const bin = atob(match[2].replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: match[1] });
  } catch {
    return null;
  }
}

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/gif': 'gif',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/zpl': 'zpl',
};

/**
 * Open a label in a new tab. Call it directly from a click handler: browsers
 * block window.open after an await. data: URIs are turned into blob URLs
 * (Chrome refuses to navigate a tab to a data: URI); if the tab is still
 * blocked the file is downloaded instead.
 *
 * Returns false when nothing could be opened.
 */
export function openLabelUrl(url: string | null | undefined, filename = 'label'): boolean {
  if (typeof window === 'undefined' || !url) return false;

  if (url.trim().startsWith('data:')) {
    const blob = dataUrlToBlob(url);
    if (!blob) return false;
    const objectUrl = URL.createObjectURL(blob);
    const win = window.open(objectUrl, '_blank');
    if (!win) {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${filename}.${EXT[blob.type] || 'bin'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
    return true;
  }

  // An anchor click inside a user gesture is not popup-blocked and keeps noopener.
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

/** Map a stored carrier name to the Veeqo carrier id used by the tracking dialog (3 = Other). */
export function carrierToVeeqoId(carrier: string | null | undefined): number {
  const c = (carrier || '').toLowerCase();
  if (!c || c === '—') return 3;
  if (c.includes('fedex')) return 2;
  if (c.includes('ups')) return 5;
  if (c.includes('mng') || c.includes('dhl ecommerce') || c.includes('dhl e-commerce')) return 10;
  if (c.includes('dhl')) return 9;
  if (c.includes('usps')) return 7;
  if (c.includes('dpd')) return 4;
  if (c.includes('royal')) return 1;
  if (c.includes('yurti')) return 12;
  if (c.includes('aras')) return 13;
  if (c.includes('sürat') || c.includes('surat')) return 14;
  if (c.includes('trendyol')) return 15;
  return 3;
}

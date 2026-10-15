// lib/shipping/submit/tracking.ts — what happens after a label exists (orders §2.5 success state, §6.4):
// push the tracking number to the marketplace (`POST /api/orders/:id/submit-tracking`, same body as the legacy
// tracking dialog) and send the ETGB document (`POST /api/etgb/process`). Results are reported honestly:
// the route answers 200 with "Tracking saved locally. eBay push failed: …" when the push failed, so that
// message is read as a failure, and Etsy is "queued for the Chrome extension" (`etsyPending: true`).
import { carrierToVeeqoId } from '../labelLinks';
import { JSON_HEADERS } from '../labelDraft';

export type TrackingPushStatus = 'sent' | 'queued' | 'failed';

export interface TrackingPushResult {
  status: TrackingPushStatus;
  /** Server text (≤ 200 chars) for a failure; never shown as JSON. */
  message?: string;
}

/** Tracking numbers the route accepts (submit-tracking.ts L54). */
export const TRACKING_NUMBER_RE = /^[A-Za-z0-9]{8,40}$/;

export function buildTrackingRequest(orderId: string, trackingNumber: string, carrier: string | null | undefined) {
  return {
    url: `/api/orders/${encodeURIComponent(orderId)}/submit-tracking`,
    init: {
      method: 'POST' as const,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        trackingNumber: trackingNumber.trim(),
        carrierId: carrierToVeeqoId(carrier),
        notifyCustomer: true,
        updateRemoteOrder: true,
      }),
    },
  };
}

const PUSH_FAILED_RE = /push (failed|error)|nothing pushed/i;

export function parseTrackingResult(status: number, body: unknown): TrackingPushResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const msg = [b.details, b.error, b.message].find((m): m is string => typeof m === 'string' && !!m.trim());
  if (status < 200 || status >= 300 || b.success === false) return { status: 'failed', message: msg?.slice(0, 200) };
  if (b.etsyPending === true) return { status: 'queued' };
  if (typeof b.message === 'string' && PUSH_FAILED_RE.test(b.message)) return { status: 'failed', message: b.message.slice(0, 200) };
  return { status: 'sent' };
}

export async function pushTracking(
  orderId: string,
  trackingNumber: string,
  carrier: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<TrackingPushResult> {
  if (!TRACKING_NUMBER_RE.test(trackingNumber.trim())) return { status: 'failed', message: 'Invalid tracking number format' };
  const { url, init } = buildTrackingRequest(orderId, trackingNumber, carrier);
  try {
    const res = await fetchImpl(url, init);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return parseTrackingResult(res.status, body);
  } catch (e) {
    return { status: 'failed', message: e instanceof Error ? e.message.slice(0, 200) : undefined };
  }
}

export interface EtgbResult { ok: boolean; message?: string }

/** `POST /api/etgb/process { orderIds, recipientEmail }` (same body as the legacy bulk ETGB action). */
export async function sendEtgb(orderIds: string[], recipientEmail: string, fetchImpl: typeof fetch = fetch): Promise<EtgbResult> {
  try {
    const res = await fetchImpl('/api/etgb/process', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ orderIds, recipientEmail }),
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    if (res.ok && body.success) return { ok: true };
    const msg = [body.error, body.message].find((m): m is string => typeof m === 'string' && !!m.trim());
    return { ok: false, message: msg?.slice(0, 200) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 200) : undefined };
  }
}

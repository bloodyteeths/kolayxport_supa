// lib/ds/status/tracking.ts — overview §4.3 tracking push to Etsy (`tracking` domain, overview §6).
// Orders shows the same fact as a caption under the order pill (1-pill rule, CRITIQUE C24); the pill is
// used by the Overview queue.

import { normalizeRaw, type TrackingStatusKey } from './vocabulary';

/** A pending submission older than this counts as "not sent". */
export const TRACKING_PENDING_GRACE_MS = 30 * 60 * 1000;
/** A labeled Etsy order with no submission counts as "not sent" after 2h, within 14 days. */
export const TRACKING_MISSING_AFTER_MS = 2 * 60 * 60 * 1000;
export const TRACKING_MISSING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface TrackingSubmissionInput {
  status?: string | null;
  /** pending | submitted | failed | needs_manual | submitted_external | cancelled */
  etsySubmitStatus?: string | null;
  submittedAt?: Date | string | number | null;
}

/**
 * - submission failed (`etsySubmitStatus` or `status` = failed) → `send_failed`
 * - submission pending / needs_manual for > 30 min → `not_sent`
 * - no submission, newest label created > 2h and < 14 days ago → `not_sent`
 * - otherwise null (sent, sent elsewhere, cancelled, or too early to tell)
 */
export function trackingStatus(
  submission: TrackingSubmissionInput | null | undefined,
  opts: { labelCreatedAt?: Date | string | number | null; now?: Date } = {},
): TrackingStatusKey | null {
  const now = (opts.now ?? new Date()).getTime();
  if (submission) {
    const etsy = normalizeRaw(submission.etsySubmitStatus);
    if (etsy === 'failed' || normalizeRaw(submission.status) === 'failed') return 'send_failed';
    if (etsy === 'pending' || etsy === 'needs_manual') {
      const at = submission.submittedAt == null ? NaN : new Date(submission.submittedAt).getTime();
      return Number.isFinite(at) && now - at > TRACKING_PENDING_GRACE_MS ? 'not_sent' : null;
    }
    return null;
  }
  if (opts.labelCreatedAt == null) return null;
  const created = new Date(opts.labelCreatedAt).getTime();
  if (!Number.isFinite(created)) return null;
  const age = now - created;
  return age > TRACKING_MISSING_AFTER_MS && age < TRACKING_MISSING_WINDOW_MS ? 'not_sent' : null;
}

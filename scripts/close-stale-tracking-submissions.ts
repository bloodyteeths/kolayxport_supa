/**
 * W4 cleanup: close TrackingSubmission rows (etsySubmitStatus pending /
 * needs_manual) that the extension queue should no longer offer:
 *   - order cancelled                                    -> 'cancelled'          (closedReason order_cancelled)
 *   - Etsy receipt already shows the same tracking code  -> 'submitted'          (closedReason matched_remote)
 *   - Etsy receipt shows it shipped with another code    -> 'submitted_external' (closedReason shipped_external)
 * The same rules run live as OrderEffects (close_tracking_cancelled / close_tracking_shipped).
 *
 * Dry-run by default; prints counts only.
 *   npx tsx scripts/close-stale-tracking-submissions.ts [--user=<id>]
 *   KX_ALLOW_PROD_WRITE=1 npx tsx scripts/close-stale-tracking-submissions.ts --apply --db-host=<host>
 */
import { runSafeDbScript } from './lib/safeDb';
import { isCancelledStatus } from '../lib/orders/orderStatus';

const norm = (v: unknown) => String(v || '').replace(/\s+/g, '').toUpperCase();

void runSafeDbScript('close-stale-tracking-submissions', async ({ prisma, write, args, count }) => {
  const rows = await prisma.trackingSubmission.findMany({
    where: { etsySubmitStatus: { in: ['pending', 'needs_manual'] }, ...(args.userId ? { submittedBy: args.userId } : {}) },
    select: { id: true, trackingNumber: true, order: { select: { status: true, externalStatus: true, cancelledAt: true, rawData: true } } },
  });
  count('submissions.open', rows.length);
  const now = new Date();
  for (const ts of rows) {
    const o = ts.order;
    let data: Record<string, any> | null = null;
    if (o.cancelledAt || isCancelledStatus(o.status, o.externalStatus)) {
      data = { etsySubmitStatus: 'cancelled', closedReason: 'order_cancelled', closedAt: now };
    } else {
      const ships = Array.isArray((o.rawData as any)?.shipments) ? (o.rawData as any).shipments : [];
      const codes = new Set(ships.map((s: any) => norm(s?.tracking_code)).filter(Boolean));
      if (codes.has(norm(ts.trackingNumber))) {
        data = { etsySubmitStatus: 'submitted', etsySubmittedAt: now, closedReason: 'matched_remote', closedAt: now };
      } else if (codes.size > 0) {
        data = { etsySubmitStatus: 'submitted_external', closedReason: 'shipped_external', closedAt: now };
      }
    }
    if (!data) {
      count('submissions.keep');
      continue;
    }
    count(`submissions.close.${data.etsySubmitStatus}`);
    if (write) await prisma.trackingSubmission.update({ where: { id: ts.id }, data });
  }
});

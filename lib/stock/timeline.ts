/**
 * Plain-language stock timeline (W2, T14). Server-only.
 *
 * Merges the ledger, pushes and notable observations of one item into
 * entries the client renders from i18n keys (stockSync.timeline.<kind>) with
 * ICU params, e.g. "Trendyol #123 satıldı → Etsy 5→4 gönderildi 14:02 ✓".
 * A remote drop that an order later explained is shown as that sale.
 */
import prisma from '@/lib/prisma';

export type TimelineEntry = {
  id: string;
  at: string;
  source: 'ledger' | 'push' | 'observation';
  kind: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
  params: Record<string, string | number>;
  /** observation id for one-tap adopt (increase alerts) */
  adoptObservationId?: string;
  linkId?: string | null;
};

export function orderRef(orderKey: string | null | undefined): string {
  if (!orderKey) return '';
  const parts = orderKey.split(':');
  return parts.length > 1 ? parts[parts.length - 1] : orderKey;
}

type LedgerRow = { id: string; kind: string; delta: number; qtyAfter: number; channel: string | null; linkId: string | null; orderKey: string | null; actor: string; note: string | null; createdAt: Date };
type PushRow = { id: string; linkId: string; status: string; reason: string; targetQty: number; freshRemoteQty: number | null; sentQty: number | null; externalRef: string | null; lastError: string | null; createdAt: Date; appliedAt: Date | null; updatedAt: Date };
type ObsRow = { id: string; linkId: string; kind: string; remoteQty: number; prevSeenQty: number | null; createdAt: Date };

/** Pure: builds entries (newest first). Exported for tests. */
export function buildTimelineEntries(
  ledger: LedgerRow[],
  pushes: PushRow[],
  observations: ObsRow[],
  channelOfLink: Map<string, string>,
): TimelineEntry[] {
  const out: TimelineEntry[] = [];

  // Remote drops later explained by a sale on the same link.
  const matched = new Map<string, string>();
  const sales = ledger.filter((l) => l.kind === 'sale' && l.note?.startsWith('counted_via_remote_drop'));
  for (const s of sales) {
    let units = Number(String(s.note).split(':')[1] || 0);
    const drops = ledger
      .filter((d) => d.kind === 'remote_adjust' && d.note === 'unattributed_drop' && d.linkId === s.linkId && d.createdAt <= s.createdAt && !matched.has(d.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    for (const d of drops) {
      if (units <= 0) break;
      matched.set(d.id, orderRef(s.orderKey));
      units -= Math.abs(d.delta);
    }
  }

  for (const l of ledger) {
    const base = { id: `l:${l.id}`, at: l.createdAt.toISOString(), source: 'ledger' as const, linkId: l.linkId };
    const ch = l.channel || (l.linkId ? channelOfLink.get(l.linkId) : '') || '';
    switch (l.kind) {
      case 'sale':
        out.push({ ...base, kind: 'sale', tone: 'neutral', params: { channel: ch, order: orderRef(l.orderKey), units: -l.delta, after: l.qtyAfter } });
        break;
      case 'sale_adjust':
        out.push({ ...base, kind: 'saleAdjust', tone: 'neutral', params: { channel: ch, order: orderRef(l.orderKey), delta: l.delta, after: l.qtyAfter } });
        break;
      case 'cancel':
        out.push({ ...base, kind: 'cancel', tone: 'neutral', params: { channel: ch, order: orderRef(l.orderKey), units: l.delta, after: l.qtyAfter } });
        break;
      case 'manual_adjust':
        out.push({
          ...base,
          kind: l.note === 'etsy_editor' ? 'manualEditor' : l.note === 'adopt_remote' ? 'adopt' : 'manual',
          tone: 'neutral',
          params: { delta: l.delta, after: l.qtyAfter, channel: ch },
        });
        break;
      case 'seed':
        out.push({ ...base, kind: 'seed', tone: 'neutral', params: { after: l.qtyAfter } });
        break;
      case 'remote_adjust':
        if (l.note === 'reattributed_to_sale') break; // folded into the sale
        if (matched.has(l.id)) out.push({ ...base, kind: 'remoteDropMatched', tone: 'neutral', params: { channel: ch, units: -l.delta, order: matched.get(l.id)!, after: l.qtyAfter } });
        else out.push({ ...base, kind: 'remoteDrop', tone: 'warning', params: { channel: ch, units: -l.delta, after: l.qtyAfter } });
        break;
      case 'drift_fix':
        out.push({ ...base, kind: 'driftFix', tone: 'neutral', params: { delta: l.delta, after: l.qtyAfter } });
        break;
      default:
        out.push({ ...base, kind: 'other', tone: 'neutral', params: { delta: l.delta, after: l.qtyAfter } });
    }
  }

  for (const p of pushes) {
    const ch = channelOfLink.get(p.linkId) || '';
    const at = (p.appliedAt ?? p.updatedAt ?? p.createdAt).toISOString();
    const base = { id: `p:${p.id}`, at, source: 'push' as const, linkId: p.linkId };
    const from = p.freshRemoteQty ?? '';
    switch (p.status) {
      case 'applied':
        if (p.externalRef === 'deactivated') out.push({ ...base, kind: 'pushDeactivated', tone: 'warning', params: { channel: ch } });
        else if (p.externalRef === 'reactivated') out.push({ ...base, kind: 'pushReactivated', tone: 'success', params: { channel: ch, to: p.sentQty ?? p.targetQty } });
        else if (p.externalRef === 'draft_sync') out.push({ ...base, kind: 'pushDraft', tone: 'success', params: { channel: ch, to: p.sentQty ?? p.targetQty } });
        else out.push({ ...base, kind: 'pushApplied', tone: 'success', params: { channel: ch, from, to: p.sentQty ?? p.targetQty } });
        break;
      case 'skipped':
        if (p.lastError === 'disabled') break;
        out.push({ ...base, kind: 'pushSkipped', tone: 'neutral', params: { channel: ch, qty: p.freshRemoteQty ?? p.targetQty } });
        break;
      case 'dry_run':
        out.push({ ...base, kind: 'pushDryRun', tone: 'neutral', params: { channel: ch, from, to: p.targetQty } });
        break;
      case 'failed':
        out.push({ ...base, kind: 'pushFailed', tone: 'error', params: { channel: ch, to: p.targetQty, error: String(p.lastError || '').slice(0, 120) } });
        break;
      case 'pending':
      case 'in_flight':
      case 'unknown':
      case 'awaiting_batch':
        out.push({ ...base, kind: 'pushPending', tone: 'neutral', params: { channel: ch, to: p.targetQty, status: p.status } });
        break;
      default:
        break; // superseded: noise
    }
  }

  for (const o of observations) {
    if (o.kind !== 'increase_alert') continue;
    out.push({
      id: `o:${o.id}`,
      at: o.createdAt.toISOString(),
      source: 'observation',
      kind: 'remoteIncrease',
      tone: 'warning',
      params: { channel: channelOfLink.get(o.linkId) || '', from: o.prevSeenQty ?? '', to: o.remoteQty },
      adoptObservationId: o.id,
      linkId: o.linkId,
    });
  }

  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export async function buildTimeline(userId: string, stockItemId: string, opts: { limit?: number } = {}): Promise<TimelineEntry[]> {
  const take = Math.min(200, Math.max(10, opts.limit ?? 80));
  const item = await prisma.stockItem.findFirst({ where: { id: stockItemId, userId }, select: { id: true } });
  if (!item) return [];
  const links = await prisma.stockLink.findMany({ where: { stockItemId, userId }, select: { id: true, channel: true } });
  const linkIds = links.map((l) => l.id);
  const [ledger, pushes, observations] = await Promise.all([
    prisma.stockLedger.findMany({ where: { stockItemId, userId }, orderBy: { createdAt: 'desc' }, take }),
    prisma.stockPush.findMany({ where: { stockItemId, userId, status: { not: 'superseded' } }, orderBy: { createdAt: 'desc' }, take }),
    linkIds.length
      ? prisma.stockObservation.findMany({ where: { linkId: { in: linkIds }, kind: 'increase_alert' }, orderBy: { createdAt: 'desc' }, take: 30 })
      : Promise.resolve([]),
  ]);
  return buildTimelineEntries(ledger, pushes, observations as ObsRow[], new Map(links.map((l) => [l.id, l.channel]))).slice(0, take);
}

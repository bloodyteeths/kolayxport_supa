/**
 * Wizard data: candidates from every connected channel, match groups and
 * sales coverage (W2, T11). Server-only. Reads the local caches only
 * (EtsyListing/Offering, TrendyolProduct, ShopifyProduct, EbayListing,
 * WixProduct) — no marketplace calls.
 */
import prisma from '@/lib/prisma';
import { STOCK_ADAPTERS, OVERSELL_WINDOW_MINUTES } from './adapters';
import { buildMatchSuggestions, candidateKey, type RemoteCandidate } from './matching';
import { normalizeSku } from './normalize';
import { deriveOrderKey, resolveOrderChannel } from './orderKey';
import { connectedDirectChannels } from './orders';
import { STOCK_CHANNELS, type StockChannel } from './types';

export async function listChannelAccounts(userId: string) {
  const out: Array<{ channel: StockChannel; supportsWrite: boolean; unsupportedReason: string | null; oversellWindowMinutes: number; accounts: Array<{ accountRef: string; label: string }> }> = [];
  for (const ch of STOCK_CHANNELS) {
    const a = STOCK_ADAPTERS[ch];
    const accounts = await a.listAccounts(userId).catch(() => []);
    out.push({ channel: ch, supportsWrite: a.supportsWrite, unsupportedReason: a.unsupportedReason ?? null, oversellWindowMinutes: OVERSELL_WINDOW_MINUTES[ch], accounts });
  }
  return out;
}

export async function listAllCandidates(userId: string, channels?: string[]): Promise<RemoteCandidate[]> {
  const out: RemoteCandidate[] = [];
  for (const ch of STOCK_CHANNELS) {
    if (channels?.length && !channels.includes(ch)) continue;
    const list = await STOCK_ADAPTERS[ch].listCandidates(userId).catch(() => [] as RemoteCandidate[]);
    out.push(...list);
  }
  return out;
}

export async function wizardSuggestions(userId: string, channels?: string[]) {
  const candidates = await listAllCandidates(userId, channels);
  const links = await prisma.stockLink.findMany({
    where: { userId, status: { not: 'suggested' } },
    select: { channel: true, accountRef: true, externalId: true, variantRef: true },
  });
  const linkedKeys = new Set(links.map((l) => candidateKey(l)));
  const res = buildMatchSuggestions(candidates, { linkedKeys });
  return { ...res, candidateCount: candidates.length, linkedCount: links.length };
}

/** % of the last 30 days' order lines that resolve to a linked stock item. */
export async function salesCoverage(userId: string): Promise<{ lines: number; covered: number; percent: number }> {
  const orders = await prisma.order.findMany({
    where: { userId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
    select: { id: true, marketplace: true, marketplaceKey: true, orderNumber: true, source: true, status: true, rawData: true, items: { select: { sku: true, listingRef: true, variantRef: true } } },
    take: 3000,
  });
  if (!orders.length) return { lines: 0, covered: 0, percent: 0 };
  const direct = await connectedDirectChannels(userId);
  const links = await prisma.stockLink.findMany({ where: { userId, status: { in: ['active', 'paused', 'unsupported'] } }, select: { channel: true, externalId: true, variantRef: true } });
  const items = await prisma.stockItem.findMany({ where: { userId }, select: { sku: true } });
  const skus = new Set(items.map((i) => i.sku));
  const seen = new Set<string>();
  let lines = 0;
  let covered = 0;
  for (const o of orders) {
    const key = deriveOrderKey(o, { directChannels: direct });
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const ch = resolveOrderChannel(o).channel;
    for (const line of o.items) {
      lines++;
      const byListing = ch && line.listingRef && links.some((l) => l.channel === ch && l.externalId === line.listingRef);
      const byExt = ch && line.sku && links.some((l) => l.channel === ch && l.externalId === String(line.sku).trim());
      const bySku = skus.has(normalizeSku(line.sku) || '#');
      if (byListing || byExt || bySku) covered++;
    }
  }
  return { lines, covered, percent: lines ? Math.round((covered / lines) * 100) : 0 };
}

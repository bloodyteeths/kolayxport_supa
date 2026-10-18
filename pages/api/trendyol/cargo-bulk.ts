/**
 * Bulk Trendyol cargo labels (Orders page › "Trendyol labels (N)").
 *
 *   GET                       → { eligible, skippedNoCargoNumber }  (the button's count)
 *   POST { format, locale?, deliver? }
 *        format pdf → ONE PDF, one 100×150 mm page per parcel (same drawing as the single label, every carrier)
 *        format zpl → Trendyol's common labels (Trendyol Express / Aras only) concatenated into one .zpl
 *        Prints ≤ 100 orders that are Trendyol ∧ unshipped (Created/Picking/Invoiced) ∧ not printed yet
 *        (lib/trendyol/bulkLabels.ts), oldest ship-by first. After the file is built the printed orders get
 *        `cargoLabelPrintedAt = now` (the next run skips them; a reprint is the per-order button) and the
 *        auto-Picking rule runs per order exactly like the single label (pages/api/trendyol/cargo.ts).
 *        deliver 'file' (default) → the file, counts in X-Labels-* headers.
 *        deliver 'link' → JSON { counts, downloadUrl }: iPhone / home-screen app, where a blob download after an
 *        await is ignored; the page then navigates to `downloadUrl` (a GET that rebuilds the same file).
 *   GET ?ids=a,b&format=pdf|zpl&locale=  → the file for those (own, Trendyol) orders again; marks nothing.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { isTrendyolEnabled } from '@/lib/config';
import { cargoLabelsPdf } from '@/lib/shipping/cargoLabelPdf';
import type { TrendyolApiClient } from '@/lib/integrations/trendyolApiClient';
import {
  autoPicking,
  autoPickingEnabled,
  cargoLabelInputOf,
  fetchCommonLabel,
  isCommonLabelNotAllowed,
  mapLimit,
  markCargoLabelsPrinted,
  senderOf,
  trendyolCargoInfo,
  trendyolClientFor,
  trendyolErrorText,
} from '@/lib/trendyol/cargo';
import {
  BULK_LABELS_MAX,
  UNSHIPPED_PACKAGE_STATUSES,
  concatZpl,
  countsToHeaders,
  planBulkLabels,
  type BulkLabelCounts,
  type BulkLabelFormat,
} from '@/lib/trendyol/bulkLabels';

export const config = { api: { responseLimit: '25mb' } };

/** Unshipped Trendyol orders are few; this only bounds a pathological account. */
const CANDIDATE_CAP = 2000;
const TRENDYOL_CONCURRENCY = 4;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const localeOf = (v: unknown): 'tr' | 'en' => (str(v) === 'en' ? 'en' : 'tr');
const formatOf = (v: unknown): BulkLabelFormat => (str(v).toLowerCase() === 'zpl' ? 'zpl' : 'pdf');

const CANDIDATE_SELECT = {
  id: true,
  marketplace: true,
  orderNumber: true,
  externalStatus: true,
  cargoLabelPrintedAt: true,
  rawData: true,
} as const;

/** The user's own unprinted Trendyol orders that may be unshipped, oldest ship-by / order date first. */
async function loadCandidates(userId: string) {
  return prisma.order.findMany({
    where: {
      userId,
      marketplace: { equals: 'Trendyol', mode: 'insensitive' },
      cargoLabelPrintedAt: null,
      // The pure eligibility check (bulkLabels.ts) decides; rows without externalStatus fall back to rawData.status.
      OR: [{ externalStatus: { in: [...UNSHIPPED_PACKAGE_STATUSES] } }, { externalStatus: null }, { externalStatus: '' }],
    },
    orderBy: [{ shipByAt: { sort: 'asc', nulls: 'last' } }, { uiOrderDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: CANDIDATE_CAP,
    select: CANDIDATE_SELECT,
  });
}

type Candidate = Awaited<ReturnType<typeof loadCandidates>>[number];
const rawOf = (o: { rawData: unknown }) => (o.rawData && typeof o.rawData === 'object' ? (o.rawData as Record<string, any>) : {});

interface BuiltFile {
  body: Buffer;
  contentType: string;
  filename: string;
  /** Orders whose label is in the file. */
  printedIds: string[];
  skippedFailed: number;
  commonLabelNotAllowed: boolean;
}

/** Build the file for `orders` (each has a cargo number; for zpl, a common label). Throws when nothing could be built. */
async function buildFile(userId: string, orders: Candidate[], format: BulkLabelFormat, locale: 'tr' | 'en', client: TrendyolApiClient | null): Promise<BuiltFile> {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'pdf') {
    const sender = await senderOf(client, userId);
    const inputs = orders.map((o) => cargoLabelInputOf(o, rawOf(o), trendyolCargoInfo(rawOf(o)), sender, locale));
    const body = await cargoLabelsPdf(inputs);
    return { body, contentType: 'application/pdf', filename: `trendyol-etiketler-${stamp}.pdf`, printedIds: orders.map((o) => o.id), skippedFailed: 0, commonLabelNotAllowed: false };
  }

  if (!client) throw Object.assign(new Error('Trendyol credentials not configured'), { status: 400 });
  let notAllowed = false;
  const docs = await mapLimit(orders, TRENDYOL_CONCURRENCY, async (o) => {
    if (notAllowed) return null; // the store is not enabled: every further call fails the same way
    const info = trendyolCargoInfo(rawOf(o));
    try {
      return await fetchCommonLabel(client, info.cargoNumber!, 1);
    } catch (err) {
      if (isCommonLabelNotAllowed(err)) notAllowed = true;
      else logger.warn('[TRENDYOL CARGO BULK] common label failed', { userId, orderId: o.id, ...trendyolErrorText(err), error: (err as Error)?.message });
      return null;
    }
  });
  const printedIds: string[] = [];
  const zpl: string[] = [];
  docs.forEach((d, i) => {
    if (d && d.length) {
      printedIds.push(orders[i].id);
      zpl.push(...d);
    }
  });
  if (!printedIds.length && notAllowed) {
    throw Object.assign(new Error('Trendyol has not enabled the common label for this store'), { status: 409, code: 'common_label_not_allowed' });
  }
  if (!printedIds.length) throw Object.assign(new Error('Trendyol did not return any common label; try again in a minute or use PDF'), { status: 502, code: 'no_labels' });
  return {
    body: Buffer.from(concatZpl(zpl), 'utf8'),
    contentType: 'text/plain; charset=utf-8',
    filename: `trendyol-etiketler-${stamp}.zpl`,
    printedIds,
    skippedFailed: orders.length - printedIds.length,
    commonLabelNotAllowed: notAllowed,
  };
}

function sendFile(res: NextApiResponse, file: BuiltFile, headers: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(file.body);
}

function downloadUrlFor(ids: string[], format: BulkLabelFormat, locale: 'tr' | 'en') {
  const sp = new URLSearchParams({ format, locale, ids: ids.join(',') });
  return `/api/trendyol/cargo-bulk?${sp.toString()}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!isTrendyolEnabled(user.id)) return res.status(403).json({ error: 'Trendyol is not enabled for this account' });
  const userId = user.id;

  try {
    if (req.method === 'GET' && str(req.query.ids)) {
      // Rebuild the file of an earlier bulk run (link delivery). Own Trendyol orders only; nothing is marked.
      const ids = [...new Set(str(req.query.ids).split(',').map((s) => s.trim()).filter(Boolean))].slice(0, BULK_LABELS_MAX);
      const format = formatOf(req.query.format);
      const rows = await prisma.order.findMany({
        where: { id: { in: ids }, userId, marketplace: { equals: 'Trendyol', mode: 'insensitive' } },
        select: CANDIDATE_SELECT,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const orders = ids
        .map((id) => byId.get(id))
        .filter((o): o is Candidate => !!o)
        .filter((o) => {
          const info = trendyolCargoInfo(rawOf(o));
          return !!info.cargoNumber && (format === 'pdf' || info.commonLabel);
        });
      if (!orders.length) return res.status(404).json({ error: 'No labels to download' });
      const file = await buildFile(userId, orders, format, localeOf(req.query.locale), await trendyolClientFor(userId));
      return sendFile(res, file);
    }

    if (req.method === 'GET') {
      const plan = planBulkLabels(await loadCandidates(userId), 'pdf', 0);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ eligible: plan.eligible, skippedNoCargoNumber: plan.skippedNoCargoNumber });
    }

    if (req.method === 'POST') {
      const format = formatOf(req.body?.format);
      const locale = localeOf(req.body?.locale);
      const deliver = str(req.body?.deliver) === 'link' ? 'link' : 'file';
      const plan = planBulkLabels(await loadCandidates(userId), format, BULK_LABELS_MAX);
      const baseCounts: BulkLabelCounts = {
        printed: 0,
        skippedNoCargoNumber: plan.skippedNoCargoNumber,
        skippedNotCommonLabel: plan.skippedNotCommonLabel,
        skippedFailed: 0,
        commonLabelNotAllowed: false,
        remaining: plan.remaining,
      };
      if (!plan.include.length) {
        return res.status(409).json({ error: 'No Trendyol labels to print', code: 'nothing_to_print', counts: baseCounts });
      }

      const client = await trendyolClientFor(userId);
      let file: BuiltFile;
      try {
        file = await buildFile(userId, plan.include.map((p) => p.order), format, locale, client);
      } catch (err: any) {
        const status = typeof err?.status === 'number' ? err.status : 500;
        logger.warn('[TRENDYOL CARGO BULK] build failed', { userId, format, status, error: err?.message });
        return res.status(status).json({ error: err?.message || 'Could not build the labels', code: err?.code, counts: baseCounts });
      }

      // The file exists: remember exactly these orders as printed, then the per-order auto-Picking rule.
      await markCargoLabelsPrinted(userId, file.printedIds);
      const printedSet = new Set(file.printedIds);
      const printed = plan.include.filter((p) => printedSet.has(p.order.id));
      if (client && printed.some((p) => p.info.nextStatus === 'Picking') && (await autoPickingEnabled(userId))) {
        await mapLimit(printed, TRENDYOL_CONCURRENCY, (p) => autoPicking(userId, p.order.id, rawOf(p.order), client, true));
      }

      const counts: BulkLabelCounts = {
        ...baseCounts,
        printed: file.printedIds.length,
        skippedFailed: file.skippedFailed,
        commonLabelNotAllowed: file.commonLabelNotAllowed,
      };
      logger.info('[TRENDYOL CARGO BULK] printed', { userId, format, ...counts });
      if (deliver === 'link') {
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).json({ counts, downloadUrl: downloadUrlFor(file.printedIds, format, locale), filename: file.filename });
      }
      return sendFile(res, file, countsToHeaders(counts));
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    const ty = trendyolErrorText(err);
    logger.warn('[TRENDYOL CARGO BULK] failed', { userId, method: req.method, status: err?.status, code: ty.code, error: ty.text || err?.message });
    const message = ty.text ? `Trendyol: ${ty.text}` : err?.message || 'Trendyol cargo labels failed';
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: message, code: ty.code || err?.code || undefined });
  }
}

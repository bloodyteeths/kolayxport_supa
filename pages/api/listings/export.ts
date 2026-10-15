// GET /api/listings/export?…same filters as /api/listings… [&ids=a,b][&includeDescription=1]
// CSV of ALL rows matching the filters (not only the page), in the list's sort order (listings-grid §9.4, §10).
// Live (marketplace) values only: staged drafts are not part of the export. DB only.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { collectExportRows, planListingsQuery, type ExportItem } from '@/lib/listings/query';
import { contentDisposition, exportColumns, exportFilename, toCsv, TAG_SEPARATOR, type CsvCell } from '@/lib/listings/csv';
import { handleListingsError, parseIds, prepareListingsRequest } from './index';

/** "Selected" scope: at most this many ids in one export. */
export const MAX_EXPORT_IDS = 5000;

export const config = { api: { responseLimit: false } };

export function exportRecord(item: ExportItem, includeDescription: boolean): Record<string, CsvCell> {
  const { row, fields } = item;
  const rec: Record<string, CsvCell> = {
    id: row.id,
    title: row.title,
    price: row.price?.amount ?? null,
    currency: row.price?.currency ?? null,
    quantity: row.qty,
    status: row.status,
    sku: fields.sku,
    tags: fields.tags.join(TAG_SEPARATOR),
    health: row.health.score,
    url: row.externalUrl,
  };
  for (const [k, v] of Object.entries(row.extra)) if (!(k in rec)) rec[k] = v;
  if (includeDescription) rec.description = fields.description;
  return rec;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ready = await prepareListingsRequest(req, res);
  if (!ready) return;
  const { userId, query, adapter } = ready;
  try {
    const ids = parseIds(req.query.ids, MAX_EXPORT_IDS);
    const incl = req.query.includeDescription;
    const includeDescription = incl === '1' || incl === 'true';
    const plan = await planListingsQuery(prisma, adapter, userId, query, ids ? { ids } : {});
    const { items, truncated } = await collectExportRows(prisma, plan, query, { includeDescription });
    const columns = exportColumns(adapter.exportExtras, includeDescription);
    const csv = toCsv(columns, items.map((i) => exportRecord(i, includeDescription)));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(exportFilename(query.marketplace, plan.ctx.store.name)));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Export-Rows', String(items.length));
    if (truncated) res.setHeader('X-Export-Truncated', '1');
    res.status(200).send(csv);
  } catch (err) {
    handleListingsError(res, err, 'GET /api/listings/export', userId);
  }
}

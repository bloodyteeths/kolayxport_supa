import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import {
  CatalogDraftError,
  catalogDraftErrorResponse,
  isCatalogDraftError,
  isCatalogMarketplace,
  listCatalogDrafts,
  stageCatalogDraft,
  toDTO,
  validateFieldPatch,
} from '@/lib/catalogDrafts/service';
import {
  BATCH_STAGE_CONCURRENCY,
  BatchStageRequestError,
  assertItemsArray,
  isPlainObject,
  mapWithConcurrency,
  resultStatus,
  type BatchStageIssue,
  type BatchStageResult,
} from '@/lib/bulk/batchStage';

/**
 * GET  /api/catalog-drafts?marketplace=trendyol|wix|shopify&store=&ids=a,b&includeSynced=1&scheduled=1
 *      → { drafts: CatalogDraftDTO[] } (open drafts; + synced in the last 24 h with includeSynced)
 * POST /api/catalog-drafts { marketplace, storeId?, externalId, fields?, queuedActions?, removeQueuedActions?, scheduledSendAt? }
 *      → { draft: CatalogDraftDTO } (merges into the open draft; never touches the marketplace)
 *      `fields`: v1 + v2 keys of `ALLOWED_FIELDS[marketplace]` (lib/catalogDrafts/schemas.ts; aliases such as
 *      Trendyol `salePrice` or Shopify `body_html` are normalised), `null` drops a key.
 *      Create (marketplace-editors §5): externalId `new` (or omitted) + queuedActions [{ type: 'create', payload? }]
 *      starts a new-product draft whose externalId is `new:<id>` (read it from the response); later stages
 *      send that `new:<id>`, and a repeated create action merges its payload. Nothing is created on the
 *      marketplace until POST /api/catalog-drafts/send.
 * POST /api/catalog-drafts { marketplace, storeId?, items: { externalId, fields? }[] }   (bulk grid, 1..50 items)
 *      → { results: BatchStageResult[] } (`listingId` = externalId; per-item errors never fail the batch;
 *        items never carry queued actions or a schedule, so nothing is deleted or sent from here;
 *        a field whose value is invalid on its own is dropped into `rejected[]` and the rest of the
 *        item is staged — checks against the live snapshot still refuse the whole item)
 */
function errorParams(body: Record<string, unknown>): Record<string, string | number> | undefined {
  return isPlainObject(body.params) ? (body.params as Record<string, string | number>) : undefined;
}

/** A per-field validation error as a batch issue; null when it is not a CatalogDraftError (unexpected). */
function toBatchIssue(field: string, err: unknown): BatchStageIssue | null {
  if (!isCatalogDraftError(err)) return null;
  const { body } = catalogDraftErrorResponse(err);
  // `params.field` repeats the issue's own `field` (v2 validation adds it to every field error): dropped here,
  // except for FIELD_NOT_SUPPORTED whose message interpolates {field}.
  const all = errorParams(body) || {};
  const { field: _field, ...rest } = all;
  const kept = body.code === 'FIELD_NOT_SUPPORTED' ? all : rest;
  const params = Object.keys(kept).length ? kept : undefined;
  return { field, key: String(body.key || 'listings.draftError.internal'), ...(params ? { params } : {}) };
}

function toBatchFailure(listingId: string, err: unknown): BatchStageResult {
  const { body } = catalogDraftErrorResponse(err);
  const params = errorParams(body);
  return {
    listingId,
    ok: false,
    code: String(body.code || 'INTERNAL'),
    key: String(body.key || 'listings.draftError.internal'),
    ...(params ? { params } : {}),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const marketplace = req.query.marketplace;
      if (!isCatalogMarketplace(marketplace)) throw new CatalogDraftError('INVALID_MARKETPLACE', 'marketplace must be trendyol, wix or shopify');
      const ids = typeof req.query.ids === 'string' && req.query.ids
        ? req.query.ids.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      const drafts = await listCatalogDrafts({
        userId: user.id,
        marketplace,
        storeId: typeof req.query.store === 'string' ? req.query.store : null,
        externalIds: ids,
        includeRecentSynced: req.query.includeSynced === '1',
        scheduledOnly: req.query.scheduled === '1',
      });
      return res.status(200).json({ drafts: drafts.map(toDTO) });
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (!isCatalogMarketplace(body.marketplace)) throw new CatalogDraftError('INVALID_MARKETPLACE', 'marketplace must be trendyol, wix or shopify');
      if (body.items !== undefined) {
        let items: Record<string, unknown>[];
        try {
          items = assertItemsArray(body.items);
        } catch (err) {
          const e = err as BatchStageRequestError;
          return res.status(400).json({ error: e.message, code: e.code, key: e.key, ...(e.params ? { params: e.params } : {}) });
        }
        const marketplace = body.marketplace;
        const storeId = typeof body.storeId === 'string' ? body.storeId : null;
        const seen = new Set<string>();
        const results = await mapWithConcurrency(items, BATCH_STAGE_CONCURRENCY, async (it): Promise<BatchStageResult> => {
          const externalId = typeof it.externalId === 'string' ? it.externalId.trim() : typeof it.externalId === 'number' ? String(it.externalId) : '';
          if (!externalId) return { listingId: externalId, ok: false, code: 'INVALID_INPUT', key: 'listings.draftError.invalidInput' };
          if (seen.has(externalId)) return { listingId: externalId, ok: false, code: 'DUPLICATE_ITEM', key: 'bulk.stage.duplicate' };
          seen.add(externalId);
          if (!isPlainObject(it.fields) || Object.keys(it.fields).length === 0) {
            return { listingId: externalId, ok: false, code: 'EMPTY_ITEM', key: 'bulk.stage.empty' };
          }
          // Validate one field at a time so one bad paste cell doesn't block the row.
          const valid: Record<string, unknown> = {};
          const rejected: BatchStageIssue[] = [];
          for (const [field, value] of Object.entries(it.fields)) {
            try {
              validateFieldPatch(marketplace, { [field]: value });
              valid[field] = value;
            } catch (err) {
              const issue = toBatchIssue(field, err);
              if (!issue) return toBatchFailure(externalId, err);
              rejected.push(issue);
            }
          }
          if (Object.keys(valid).length === 0) {
            return { listingId: externalId, ok: false, code: 'VALIDATION_FAILED', key: rejected[0].key, ...(rejected[0].params ? { params: rejected[0].params } : {}), issues: rejected };
          }
          try {
            const draft = await stageCatalogDraft({ userId: user.id, marketplace, storeId, externalId, fields: valid });
            return { listingId: externalId, ok: true, draftId: draft.id, status: resultStatus(draft.status), ...(rejected.length ? { rejected } : {}) };
          } catch (err) {
            return toBatchFailure(externalId, err);
          }
        });
        return res.status(200).json({ results });
      }
      const draft = await stageCatalogDraft({
        userId: user.id,
        marketplace: body.marketplace,
        storeId: typeof body.storeId === 'string' ? body.storeId : null,
        externalId: typeof body.externalId === 'string' || typeof body.externalId === 'number' ? String(body.externalId) : '',
        fields: body.fields,
        queuedActions: body.queuedActions,
        removeQueuedActions: body.removeQueuedActions,
        scheduledSendAt: body.scheduledSendAt,
      });
      return res.status(200).json({ draft: toDTO(draft) });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const { status, body } = catalogDraftErrorResponse(err);
    return res.status(status).json(body);
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import {
  CatalogDraftError,
  catalogDraftErrorResponse,
  isCatalogMarketplace,
  listCatalogDrafts,
  stageCatalogDraft,
  toDTO,
} from '@/lib/catalogDrafts/service';

/**
 * GET  /api/catalog-drafts?marketplace=trendyol|wix|shopify&store=&ids=a,b&includeSynced=1&scheduled=1
 *      → { drafts: CatalogDraftDTO[] } (open drafts; + synced in the last 24 h with includeSynced)
 * POST /api/catalog-drafts { marketplace, storeId?, externalId, fields?, queuedActions?, removeQueuedActions?, scheduledSendAt? }
 *      → { draft: CatalogDraftDTO } (merges into the open draft; never touches the marketplace)
 */
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
      const draft = await stageCatalogDraft({
        userId: user.id,
        marketplace: body.marketplace,
        storeId: typeof body.storeId === 'string' ? body.storeId : null,
        externalId: String(body.externalId ?? ''),
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

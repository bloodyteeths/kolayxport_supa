// GET /api/billing/v2-catalog — pricing v2 plans and module prices (+KDV, TRY) for the pricing page and checkout
// (docs/gtm/pricing-v2.md P3/P4). 404 until PRICING_V2 is on, so nothing can show the proposed prices early.
import type { NextApiRequest, NextApiResponse } from 'next';
import { KDV_RATE, V2_MODULE_PRICES, V2_PLANS, pricingV2Enabled } from '@/lib/billing/pricingV2';
import { DECIDED_PLAN_LIMITS } from '@/lib/billing/planLimits';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!pricingV2Enabled()) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({
    currency: 'TRY',
    pricesExcludeKdv: true,
    kdvRate: KDV_RATE,
    plans: V2_PLANS.map((p) => ({ ...p, limits: DECIDED_PLAN_LIMITS[p.key].limits })),
    modules: V2_MODULE_PRICES,
  });
}

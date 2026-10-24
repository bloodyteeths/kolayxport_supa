// components/domain/pricing/PlanV2Cards.tsx — pricing v2 on the in-app checkout page (/plan): Aylık + yearly
// packages, each "Satın al" starts the real Stripe checkout with the v2 plan key (the server resolves the price by
// lookup key and fixes the interval). Shown only when GET /api/billing/v2-catalog answers (PRICING_V2 on).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs';
import { neutral, radius, accent } from '@/lib/ds/tokens';
import type { V2PlanOffer } from '@/lib/billing/pricingV2';

export type V2Catalog = { plans: Array<V2PlanOffer & { limits: { connectedStores: number | null; orders: number | null; labels: number | null } }> };
export type SelfServeV2Key = 'aylik' | 'baslangic_yil' | 'buyume_yil' | 'pro_yil';
const ORDER: SelfServeV2Key[] = ['aylik', 'baslangic_yil', 'buyume_yil', 'pro_yil'];
const RECOMMENDED: SelfServeV2Key = 'buyume_yil';

export function PlanV2Cards({ catalog, foundingPercent, pending, onBuy }: {
  catalog: V2Catalog;
  foundingPercent: number | null;
  pending: string | null;
  onBuy: (plan: SelfServeV2Key, interval: 'month' | 'year') => void;
}) {
  // `tv`, not `t`: test/billing/e-i18n.test.ts scans tv('…') in this folder as marketing.pricingV2 keys.
  const tv = useTranslations('marketing.pricingV2.v2');
  const locale = useLocale();
  const tl = (n: number) => `₺${Math.round(n).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US')}`;
  const num = (n: number | null) => (n === null ? '∞' : n.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US'));
  return (
    <Box sx={{ mt: '24px', display: 'grid', gap: '16px', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }} data-testid="pricing-v2-app">
      {ORDER.map((key) => {
        const offer = catalog.plans.find((p) => p.key === key);
        if (!offer || offer.priceTry === null) return null;
        const yearly = offer.interval === 'year';
        const price = foundingPercent !== null ? offer.priceTry * (1 - foundingPercent / 100) : offer.priceTry;
        return (
          <Box key={key} id={`plan-card-${key}`} sx={{ p: '20px', bgcolor: neutral[0], border: `1px solid ${key === RECOMMENDED ? accent[600] : neutral[200]}`, borderRadius: `${radius.md}px`, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {key === RECOMMENDED ? <Typography variant="caption" sx={{ color: accent[700], fontWeight: 600 }}>{tv('recommended')}</Typography> : null}
            <Typography variant="titleSm" component="h3" sx={{ m: 0, color: neutral[900] }}>{tv(`plans.${key}.name`)}</Typography>
            <Typography variant="body2" sx={{ color: neutral[600], minHeight: 40 }}>{tv(`plans.${key}.tagline`)}</Typography>
            <Box>
              <Typography component="span" sx={{ fontSize: 28, fontWeight: 700, color: neutral[900] }}>{tl(price)}</Typography>
              <Typography component="span" sx={{ color: neutral[600] }}> {yearly ? tv('perYear') : tv('perMonth')}</Typography>
              {foundingPercent !== null ? <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[500], textDecoration: 'line-through' }}>{tl(offer.priceTry)}</Typography> : null}
              <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[600] }}>
                {yearly ? tv('monthlyEquivalent', { price: tl(price / 12) }) : tv('cancelAnytime')}
              </Typography>
            </Box>
            <Box component="ul" sx={{ m: 0, p: 0, pl: '18px', color: neutral[800], fontSize: 14, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <li>{tv('stores', { count: offer.limits.connectedStores ?? 0 })}</li>
              <li>{tv(yearly ? 'ordersYear' : 'ordersMonth', { count: num(offer.limits.orders) })}</li>
              <li>{tv(yearly ? 'labelsYear' : 'labelsMonth', { count: num(offer.limits.labels) })}</li>
              <li>{tv(`plans.${key}.editor`)}</li>
            </Box>
            <Box sx={{ mt: 'auto', pt: '8px' }}>
              <Button variant={key === RECOMMENDED ? 'primary' : 'secondary'} fullWidth loading={pending === key} disabled={pending !== null && pending !== key}
                onClick={() => onBuy(key, offer.interval)} data-testid={`pricing-v2-buy-${key}`}>
                {tv('buy')}
              </Button>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default PlanV2Cards;

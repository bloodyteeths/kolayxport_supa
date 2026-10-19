// Home "Strong niches today": the niche library's best-scored niches (lib/research/nicheLibrary, refreshed daily)
// so a first visit is never empty. Each card opens Product finder for that niche (answer served from the shared
// cache). Hidden until the library has data; no empty state of its own.
import * as React from 'react';
import NextLink from 'next/link';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { useDsFormat } from '@/components/ds/data/fmt';
import { neutral } from '@/lib/ds/tokens';
import type { NicheSummary } from '@/lib/research/nicheLibrary';
import { researchToolHref } from '../ResearchLayout';

const BAND_COLOR: Record<string, string> = { good: '#15803D', ok: '#B45309', hard: '#B91C1C' };

export function NichesCard() {
  const t = useTranslations('research.niches');
  const fmt = useDsFormat();
  const { data } = useSWR<{ niches: NicheSummary[] }>('/api/research/niches?limit=9', (u: string) => fetch(u, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { niches: [] })), { revalidateOnFocus: false });
  const niches = data?.niches ?? [];
  if (!niches.length) return null;
  return (
    <Section variant="card" title={t('title')} description={t('description')} data-testid="research-niches">
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2, minmax(0,1fr))', md: 'repeat(3, minmax(0,1fr))' }, gap: '8px' }}>
        {niches.map((n) => (
          <Box
            key={n.q}
            component={NextLink}
            href={researchToolHref('products', 'etsy', { q: n.q })}
            data-testid="research-niche"
            sx={{ display: 'block', p: '12px', border: `1px solid ${neutral[200]}`, borderRadius: '10px', textDecoration: 'none', color: 'inherit', '&:hover': { borderColor: neutral[400] } }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '4px' }}>
              <Box component="span" sx={{ minWidth: 30, height: 22, px: '6px', borderRadius: '11px', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', bgcolor: BAND_COLOR[n.band ?? 'ok'] }}>
                {n.score}
              </Box>
              <Typography sx={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.q}</Typography>
            </Box>
            <Typography sx={{ fontSize: 12, color: neutral[600] }}>
              {t('sales', { count: fmt.num(n.salesMonthly ?? 0) })}
              {n.revenueMonthly != null ? ` · ${t('revenue', { amount: fmt.money(n.revenueMonthly, n.currency, { approx: true }) })}` : ''}
            </Typography>
            <Typography sx={{ fontSize: 12, color: neutral[500] }}>
              {n.typicalPrice != null ? t('price', { amount: fmt.money(n.typicalPrice, n.currency) }) : ''}
              {n.total != null ? ` · ${t('competitors', { count: fmt.num(n.total) })}` : ''}
            </Typography>
            <Typography sx={{ fontSize: 11, color: neutral[500] }}>{t('basis', { counted: n.counted, measured: n.measured })}</Typography>
          </Box>
        ))}
      </Box>
    </Section>
  );
}

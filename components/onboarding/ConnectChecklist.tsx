// components/onboarding/ConnectChecklist.tsx — first screen for a seller with no store connected (Home › Sales
// while useConnections().anyMarketplace === false). 0 of 8 October 2026 signups connected a store, so instead of one
// "Connect a store" button the screen shows the 3 steps and the store tiles inline:
//   1. connect a store  — Etsy / eBay go straight to OAuth; Amazon, Shopify, Wix, Trendyol open their panel on
//                         Settings › Connections (&provider=); Trendyol also has an inline "where is my API key" guide
//   2. sender profile   — the address on labels and customs forms
//   3. first label      — Orders
// Plus the WhatsApp line (components/support/WhatsAppHelp.tsx) and a link to support tickets.
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { Button } from '@/components/ds/inputs';
import { neutral as n, accent } from '@/lib/ds/tokens';
import { EBAY_CONNECT_HREF, ETSY_CONNECT_HREF } from '@/lib/settings/integrations';
import WhatsAppHelp from '@/components/support/WhatsAppHelp';
import { trackActivation } from '@/lib/activation/track';

type Store = { id: 'etsy' | 'trendyol' | 'amazon' | 'ebay' | 'shopify' | 'wix'; name: string; href: string };

/** Turkish sellers mostly start with Etsy or Trendyol, so those come first. */
export const STORES: readonly Store[] = [
  { id: 'etsy', name: 'Etsy', href: ETSY_CONNECT_HREF },
  { id: 'trendyol', name: 'Trendyol', href: '/ayarlar?tab=connections&provider=trendyol' },
  { id: 'amazon', name: 'Amazon', href: '/ayarlar?tab=connections&provider=amazon' },
  { id: 'ebay', name: 'eBay', href: EBAY_CONNECT_HREF },
  { id: 'shopify', name: 'Shopify', href: '/ayarlar?tab=connections&provider=shopify' },
  { id: 'wix', name: 'Wix', href: '/ayarlar?tab=connections&provider=wix' },
];

const card = { p: '16px', borderRadius: '12px', border: `1px solid ${n[200]}`, bgcolor: '#fff' } as const;

function StepNumber({ n: num, active }: { n: number; active: boolean }) {
  return (
    <Box sx={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700,
      bgcolor: active ? accent[600] : n[100], color: active ? '#fff' : n[600] }}>{num}</Box>
  );
}

export default function ConnectChecklist({ 'data-testid': testId = 'connect-checklist' }: { 'data-testid'?: string }) {
  const t = useTranslations('onboarding.checklist');
  const [guide, setGuide] = useState(false);
  useEffect(() => trackActivation('checklist_view', { once: true }), []);

  return (
    <Box data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: 760, mx: 'auto', width: '100%' }}>
      <Box>
        <Box component="h2" sx={{ m: 0, fontSize: 18, fontWeight: 700, color: n[900] }}>{t('title')}</Box>
        <Box sx={{ fontSize: 14, color: n[600], mt: '4px' }}>{t('subtitle')}</Box>
      </Box>

      {/* 1. Connect a store */}
      <Box sx={{ ...card, borderColor: accent[200] }}>
        <Box sx={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <StepNumber n={1} active />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontSize: 15, fontWeight: 600, color: n[900] }}>{t('step1.title')}</Box>
            <Box sx={{ fontSize: 14, color: n[600], mt: '2px' }}>{t('step1.body')}</Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }, gap: '8px', mt: '12px' }}>
              {STORES.map((s) => (
                <Box key={s.id} component="a" href={s.href} data-testid={`checklist-store-${s.id}`} onClick={() => trackActivation('connect_click', { provider: s.id })}
                  sx={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: 48, px: '12px', borderRadius: '10px', border: `1px solid ${n[200]}`,
                    color: n[900], textDecoration: 'none', fontSize: 14, fontWeight: 600, bgcolor: '#fff',
                    '&:hover': { borderColor: accent[500] }, '&:focus-visible': { outline: `2px solid ${accent[500]}`, outlineOffset: 2 } }}>
                  <LogoTile brand={s.id} size={24} />
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</Box>
                </Box>
              ))}
            </Box>
            <Box sx={{ fontSize: 13, color: n[500], mt: '8px' }}>{t('step1.oauthNote')}</Box>

            {/* Trendyol API key guide */}
            <Box sx={{ mt: '12px' }}>
              <Box component="button" type="button" onClick={() => setGuide((g) => !g)} aria-expanded={guide} data-testid="checklist-trendyol-guide-toggle"
                sx={{ p: 0, border: 0, bgcolor: 'transparent', color: accent[700], fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
                {guide ? t('trendyol.hide') : t('trendyol.show')}
              </Box>
              {guide && (
                <Box data-testid="checklist-trendyol-guide" sx={{ mt: '8px', p: '12px', borderRadius: '10px', bgcolor: n[50], border: `1px solid ${n[200]}` }}>
                  <Box component="ol" sx={{ m: 0, pl: '20px', listStyle: 'decimal', fontSize: 14, color: n[800], display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(['1', '2', '3', '4', '5'] as const).map((k) => <li key={k}>{t(`trendyol.steps.${k}`)}</li>)}
                  </Box>
                  <Box sx={{ fontSize: 13, color: n[600], mt: '8px' }}>{t('trendyol.note')}</Box>
                  <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mt: '10px' }}>
                    <Button size="sm" variant="secondary" href="https://partner.trendyol.com/" external>{t('trendyol.openPanel')}</Button>
                    <Button size="sm" href="/ayarlar?tab=connections&provider=trendyol">{t('trendyol.enterKeys')}</Button>
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* 2. Sender profile */}
      <Box sx={{ ...card, display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <StepNumber n={2} active={false} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ fontSize: 15, fontWeight: 600, color: n[900] }}>{t('step2.title')}</Box>
          <Box sx={{ fontSize: 14, color: n[600], mt: '2px' }}>{t('step2.body')}</Box>
          <Box sx={{ mt: '8px' }}><Button size="sm" variant="secondary" href="/ayarlar?tab=senderProfile">{t('step2.cta')}</Button></Box>
        </Box>
      </Box>

      {/* 3. First label */}
      <Box sx={{ ...card, display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <StepNumber n={3} active={false} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ fontSize: 15, fontWeight: 600, color: n[900] }}>{t('step3.title')}</Box>
          <Box sx={{ fontSize: 14, color: n[600], mt: '2px' }}>{t('step3.body')}</Box>
        </Box>
      </Box>

      <WhatsAppHelp variant="help" showTicketLink />
    </Box>
  );
}

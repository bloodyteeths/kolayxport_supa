// pages/app/nasil-kullanirim.tsx — Help: a short, current getting-started guide (founder audit 2026-10-16: the old
// page explained a Veeqo settings section that no longer exists). Each step says what to do and links to the screen.
import React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Page, PageHeader, Section } from '@/components/ds/page';
import { Button } from '@/components/ds/inputs/Button';
import { neutral as n, accent } from '@/lib/ds/tokens';
import WhatsAppHelp from '@/components/support/WhatsAppHelp';

type Step = { key: string; href: string; external?: boolean };

const STEPS: Step[] = [
  { key: 'connect', href: '/ayarlar?tab=connections' },
  { key: 'sender', href: '/ayarlar?tab=senderProfile' },
  { key: 'orders', href: '/app/labels' },
  { key: 'extension', href: '/ayarlar?tab=connections' },
  { key: 'listings', href: '/app/etsy-listings' },
  { key: 'messages', href: '/app/mesajlar' },
  { key: 'reports', href: '/app/analytics' },
  { key: 'research', href: '/app/research' },
];

export default function HowToUsePage() {
  const t = useTranslations('help.guide');
  return (
    <Page title={t('title')} width="detail">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Box sx={{ mb: '16px' }}><WhatsAppHelp variant="help" /></Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {STEPS.map((s, i) => (
          <Box component="li" key={s.key}>
            <Section variant="card" sx={{ mb: 0 }}>
              <Box sx={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <Box
                  aria-hidden
                  sx={{
                    flexShrink: 0, width: 28, height: 28, borderRadius: '50%', bgcolor: accent[50], color: accent[700],
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600,
                  }}
                >
                  {i + 1}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box component="h2" sx={{ m: 0, fontSize: 15, lineHeight: '22px', fontWeight: 600, color: n[900] }}>{t(`${s.key}.title`)}</Box>
                  <Box sx={{ mt: '4px', fontSize: 14, lineHeight: '20px', color: n[700] }}>{t(`${s.key}.body`)}</Box>
                  <Box sx={{ mt: '10px' }}>
                    <Button variant="secondary" size="sm" href={s.href}>{t(`${s.key}.action`)}</Button>
                  </Box>
                </Box>
              </Box>
            </Section>
          </Box>
        ))}
      </Box>
      <Section variant="card" sx={{ mt: '16px', mb: 0 }}>
        <Box component="h2" sx={{ m: 0, fontSize: 15, lineHeight: '22px', fontWeight: 600, color: n[900] }}>{t('library.title')}</Box>
        <Box sx={{ mt: '4px', fontSize: 14, lineHeight: '20px', color: n[700] }}>{t('library.body')}</Box>
        <Box sx={{ mt: '10px' }}>
          {/* Public library (content/tr/guides, generated with the videos by scripts/tutorials). */}
          <Button variant="primary" size="sm" href="/nasil-kullanirim">{t('library.action')}</Button>
        </Box>
      </Section>
      <Box sx={{ mt: '16px', fontSize: 13, color: n[600] }}>{t('contact')}</Box>
    </Page>
  );
}

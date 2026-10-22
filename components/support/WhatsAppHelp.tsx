// components/support/WhatsAppHelp.tsx — WhatsApp click-to-chat to KolayXport support (lib/site/company.ts number).
//   variant="connect"  one line under store-connection screens: "Stuck connecting? Message us…"
//   variant="help"     a card for the Help page
// Renders nothing when no number is configured.
import React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { MessageCircle } from 'lucide-react';
import { whatsappDisplay, whatsappUrl } from '@/lib/site/company';
import { neutral as n } from '@/lib/ds/tokens';

const WA_GREEN = '#25D366';

export interface WhatsAppHelpProps {
  variant?: 'connect' | 'help';
  'data-testid'?: string;
}

export default function WhatsAppHelp({ variant = 'connect', 'data-testid': testId = 'whatsapp-help' }: WhatsAppHelpProps) {
  const t = useTranslations('support.whatsapp');
  const href = whatsappUrl(t(variant === 'help' ? 'prefillHelp' : 'prefillConnect'));
  if (!href) return null;
  const link = (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0, px: '12px', minHeight: 36,
        borderRadius: '8px', border: `1px solid ${n[300]}`, color: n[900], fontSize: 14, fontWeight: 600,
        textDecoration: 'none', bgcolor: '#fff', '&:hover': { borderColor: WA_GREEN },
        '&:focus-visible': { outline: `2px solid ${WA_GREEN}`, outlineOffset: 2 },
      }}
    >
      <MessageCircle size={16} color={WA_GREEN} aria-hidden />
      {t('cta')}
    </Box>
  );

  if (variant === 'help') {
    return (
      <Box data-testid={testId} sx={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', p: '16px', borderRadius: '12px', border: `1px solid ${n[200]}`, bgcolor: '#fff' }}>
        <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
          <Box sx={{ fontSize: 14, fontWeight: 600, color: n[900] }}>{t('helpTitle')}</Box>
          <Box sx={{ fontSize: 14, color: n[600], mt: '2px' }}>{t('helpBody', { number: whatsappDisplay() ?? '' })}</Box>
        </Box>
        {link}
      </Box>
    );
  }

  return (
    <Box data-testid={testId} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', fontSize: 14, color: n[600], textAlign: 'center' }}>
      <span>{t('connectHelp')}</span>
      {link}
    </Box>
  );
}

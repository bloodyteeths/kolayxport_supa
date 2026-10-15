// components/domain/pricing/PricingHeader.tsx — the public page H1 (settings §10.1: `display` 28/36, the one
// place outside KPI tiles that uses it, because a public page has no PageHeader), subtitle and trial line.
// No prices here, so it renders at once for every viewer (§10.5).
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { neutral } from '@/lib/ds/tokens';

export function PricingHeader() {
  const t = useTranslations('marketing.pricingV2');
  return (
    <Box component="header" sx={{ mb: '24px' }}>
      <Typography variant="display" component="h1" sx={{ m: 0, color: neutral[900] }}>
        {t('title')}
      </Typography>
      <Typography variant="body1" component="p" sx={{ m: 0, mt: '8px', color: neutral[600], maxWidth: 720 }}>
        {t('subtitle')}
      </Typography>
      <Typography variant="body1" component="p" sx={{ m: 0, mt: '4px', color: neutral[700] }}>
        {t('trialLine')}
      </Typography>
    </Box>
  );
}

export default PricingHeader;

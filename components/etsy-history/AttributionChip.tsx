import React from 'react';
import { Chip } from '@mui/material';
import { useTranslations } from 'next-intl';
import { ATTRIBUTION_COLORS } from './types';

/** Who changed a listing: Etsy / KolayXport draft / stock sync / found in a check. */
export default function AttributionChip({ attribution }: { attribution: string }) {
  const t = useTranslations('listingHistory');
  const c = ATTRIBUTION_COLORS[attribution] || ATTRIBUTION_COLORS.unknown;
  const label = t.has(`attribution.${attribution}`) ? t(`attribution.${attribution}`) : attribution;
  return <Chip size="small" label={label} sx={{ bgcolor: c.bg, color: c.fg, fontWeight: 600, height: 22, fontSize: '0.7rem' }} />;
}

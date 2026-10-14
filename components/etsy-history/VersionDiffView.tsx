import React from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';

export interface VersionDiffViewProps {
  changedKeys: string[];
  diff: Record<string, any>;
  isTombstone?: boolean;
  /** Hide keys (e.g. when the parent already shows them). */
  compact?: boolean;
}

const MONEY_KEYS = new Set(['price']);
const BOOL_KEYS = new Set(['isSupply', 'isPersonalizable', 'personalizationIsRequired', 'hasVariations']);

/**
 * Before/after view of one listing version's diff (output of
 * lib/etsy/listingNormalize diffSnapshots). Stacks vertically on mobile.
 */
export default function VersionDiffView({ changedKeys, diff, isTombstone = false, compact = false }: VersionDiffViewProps) {
  const t = useTranslations('listingHistory');

  const keyLabel = (k: string) => (t.has(`keys.${k}`) ? t(`keys.${k}`) : k);
  const fmt = (key: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return t('diff.empty');
    if (BOOL_KEYS.has(key)) return v ? t('diff.yes') : t('diff.no');
    if (MONEY_KEYS.has(key) && typeof v === 'number') return (v / 100).toFixed(2);
    if (key === 'state' && typeof v === 'string') return t.has(`states.${v}`) ? t(`states.${v}`) : v;
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  };

  if (isTombstone) {
    return (
      <Typography variant="body2" color="error.main">
        {t('history.tombstone')}
      </Typography>
    );
  }

  const keys = changedKeys.filter((k) => k !== 'created');
  if (keys.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {changedKeys.includes('created') ? t('keys.created') : t('diff.noDetails')}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {keys.map((key) => {
        const d = diff?.[key];
        if (key === 'tags' || key === 'materials') {
          const added: string[] = d?.added || [];
          const removed: string[] = d?.removed || [];
          return (
            <Box key={key}>
              {!compact && <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>{keyLabel(key)}</Typography>}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {added.map((x) => (
                  <Chip key={`a-${x}`} size="small" label={`+ ${x}`} sx={{ bgcolor: '#DCFCE7', color: '#166534', height: 22 }} />
                ))}
                {removed.map((x) => (
                  <Chip key={`r-${x}`} size="small" label={`− ${x}`} sx={{ bgcolor: '#FEE2E2', color: '#991B1B', height: 22, textDecoration: 'line-through' }} />
                ))}
                {added.length === 0 && removed.length === 0 && (
                  <Typography variant="body2" color="text.secondary">{t('diff.noDetails')}</Typography>
                )}
              </Box>
            </Box>
          );
        }
        if (key === 'images') {
          const parts: string[] = [];
          if (d?.added?.length) parts.push(t('diff.imagesAdded', { count: d.added.length }));
          if (d?.removed?.length) parts.push(t('diff.imagesRemoved', { count: d.removed.length }));
          if (d?.reordered) parts.push(t('diff.imagesReordered'));
          if (d?.altChanged?.length) parts.push(t('diff.imagesAlt', { count: d.altChanged.length }));
          return (
            <Box key={key}>
              {!compact && <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>{keyLabel(key)}</Typography>}
              <Typography variant="body2">{parts.join(' · ') || t('diff.noDetails')}</Typography>
            </Box>
          );
        }
        if (key === 'offerings') {
          const parts: string[] = [];
          if (d?.added?.length) parts.push(t('diff.offeringsAdded', { count: d.added.length }));
          if (d?.removed?.length) parts.push(t('diff.offeringsRemoved', { count: d.removed.length }));
          const fieldName = (f: string) =>
            f === 'sku' ? t('diff.offeringFieldSku') : f === 'price' ? t('diff.offeringFieldPrice') : t('diff.offeringFieldIsEnabled');
          return (
            <Box key={key}>
              {!compact && <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>{keyLabel(key)}</Typography>}
              {parts.length > 0 && <Typography variant="body2">{parts.join(' · ')}</Typography>}
              {(d?.changed || []).slice(0, 8).map((c: any) => (
                <Typography key={c.variantKey} variant="body2" color="text.secondary">
                  {t('diff.offeringChanged', { label: c.label || '—', fields: (c.fields || []).map(fieldName).join(', ') })}
                </Typography>
              ))}
            </Box>
          );
        }
        if (key === 'videos') {
          return (
            <Box key={key}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>{keyLabel(key)}</Typography>
              <Typography variant="body2">{`${(d?.from || []).length} → ${(d?.to || []).length}`}</Typography>
            </Box>
          );
        }
        const long = key === 'description' || key === 'personalizationInstructions';
        return (
          <Box key={key}>
            {!compact && <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>{keyLabel(key)}</Typography>}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: long ? '1fr' : '1fr 1fr' },
                gap: 0.75,
                mt: 0.5,
              }}
            >
              <Box sx={{ p: 1, borderRadius: '8px', bgcolor: '#FEF2F2', minWidth: 0 }}>
                <Typography variant="caption" sx={{ color: '#991B1B', fontWeight: 600 }}>{t('diff.from')}</Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-word', whiteSpace: long ? 'pre-wrap' : 'normal', maxHeight: long ? 160 : 'none', overflow: 'auto' }}>
                  {fmt(key, d?.from)}
                </Typography>
              </Box>
              <Box sx={{ p: 1, borderRadius: '8px', bgcolor: '#F0FDF4', minWidth: 0 }}>
                <Typography variant="caption" sx={{ color: '#166534', fontWeight: 600 }}>{t('diff.to')}</Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-word', whiteSpace: long ? 'pre-wrap' : 'normal', maxHeight: long ? 160 : 'none', overflow: 'auto' }}>
                  {fmt(key, d?.to)}
                </Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

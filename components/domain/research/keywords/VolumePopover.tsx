// components/domain/research/keywords/VolumePopover.tsx (research R2-B) — "Etsy volume" cell (research.md §6.1).
//
// Etsy doesn't share search volume through its API; the seller can read it in Etsy Marketplace Insights and type it
// here ("You entered", `ResearchKeywordNote`, backend request BR-1b). "add ↗" opens Insights in a new tab AND a
// Popover with a NumberField "Searches in the last 30 days (from Etsy)". When our Signal and Etsy's number differ by
// ≥ 3 tiers the cell tooltip says "Our signal differs from Etsy's number: trust Etsy's" (RR §6.4).
//
// Guard: the column only renders while `volumeAvailable` (GET says the table exists); a 503 `unavailable` from the
// note endpoint (migration not deployed yet) shows an info line, never an error toast.
import * as React from 'react';
import Box from '@mui/material/Box';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { FormField } from '@/components/ds/inputs/FormField';
import { Metric } from '@/components/ds/research/Metric';
import { useDsFormat } from '@/components/ds/data/fmt';
import { icons } from '@/lib/ds/icons';
import { neutral, tone, zIndex } from '@/lib/ds/tokens';
import { saveKeywordNote } from '@/lib/research/hooks/useKeywords';
import type { KeywordRowExt } from '@/lib/research/keywordTypes';
import { ETSY_INSIGHTS_URL } from './keywordModel';

export type VolumePopoverProps = {
  row: KeywordRowExt;
  /** Called after a successful save (revalidate the view). */
  onSaved?: (keyword: string, value: number | null) => void;
  /** Test seam (default `window.open`). */
  openInsights?: (url: string) => void;
};

const MAX_SEARCHES = 10_000_000;

export function VolumePopover({ row, onSaved, openInsights }: VolumePopoverProps) {
  const t = useTranslations('research');
  const fmt = useDsFormat();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [value, setValue] = React.useState<number | null>(row.etsyVolume?.value ?? null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<'unavailable' | 'failed' | null>(null);

  const open = (e: React.MouseEvent<HTMLElement>, withInsights: boolean) => {
    e.stopPropagation();
    setValue(row.etsyVolume?.value ?? null);
    setNote(null);
    setAnchor(e.currentTarget);
    if (withInsights) {
      const go = openInsights ?? ((u: string) => window.open(u, '_blank', 'noopener,noreferrer'));
      go(ETSY_INSIGHTS_URL);
    }
  };

  const save = async (v: number | null) => {
    setBusy(true);
    setNote(null);
    const res = await saveKeywordNote(row.keyword, v);
    setBusy(false);
    if (res.ok) {
      setAnchor(null);
      onSaved?.(row.keyword, res.data?.value ?? v);
      return;
    }
    setNote(res.unavailable ? 'unavailable' : 'failed');
  };

  const valid = value === null || (Number.isInteger(value) && value >= 0 && value <= MAX_SEARCHES);
  const entered = row.etsyVolume;

  return (
    <>
      {entered ? (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px' }}>
          {row.volumeDisagrees ? (
            <Tooltip title={t('kw.trustEtsy')}>
              <Box component="span" tabIndex={0} data-testid="kw-volume-disagree" sx={{ color: tone.warning.fg, cursor: 'help' }}>
                <icons.warning size={14} aria-label={t('kw.trustEtsy')} />
              </Box>
            </Tooltip>
          ) : null}
          <Box
            component="button"
            type="button"
            onClick={(e: React.MouseEvent<HTMLElement>) => open(e, false)}
            aria-label={t('kw.volumeEdit', { keyword: row.keyword })}
            sx={{ all: 'unset', cursor: 'pointer', '&:focus-visible': { outline: `2px solid ${neutral[900]}`, outlineOffset: '2px' } }}
            data-testid="kw-volume-edit"
          >
            <Metric value={fmt.num(entered.value)} kind="user" />
          </Box>
        </Box>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          icon={icons.externalLink}
          onClick={(e) => open(e, true)}
          aria-label={t('kw.volumeAddAria', { keyword: row.keyword })}
          data-testid="kw-volume-add"
        >
          {t('kw.volumeAdd')}
        </Button>
      )}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ zIndex: zIndex.popover }}
        slotProps={{ paper: { sx: { p: '16px', width: 300 } } }}
      >
        <Box
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            if (valid) void save(value);
          }}
          data-testid="kw-volume-popover"
        >
          <Typography variant="titleSm" component="p" sx={{ m: 0, mb: '8px' }} lang="en">{row.keyword}</Typography>
          <FormField label={t('kw.volumePrompt')} helper={t('kw.volumeHelper')} error={valid ? undefined : t('kw.volumeInvalid')}>
            <NumberField value={value} onChange={setValue} min={0} max={MAX_SEARCHES} decimals={0} autoFocus data-testid="kw-volume-input" />
          </FormField>
          {note ? (
            <Typography variant="caption" component="p" role="status" sx={{ m: 0, mt: '8px', color: note === 'failed' ? 'error.main' : neutral[600] }}>
              {note === 'unavailable' ? t('kw.volumeUnavailable') : t('kw.volumeFailed')}
            </Typography>
          ) : null}
          <Box sx={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', mt: '12px', flexWrap: 'wrap' }}>
            {entered ? (
              <Button variant="ghost" size="sm" onClick={() => void save(null)} disabled={busy} data-testid="kw-volume-clear">
                {t('kw.volumeClear')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              icon={icons.externalLink}
              onClick={() => (openInsights ?? ((u: string) => window.open(u, '_blank', 'noopener,noreferrer')))(ETSY_INSIGHTS_URL)}
            >
              {t('kw.openInsights')}
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!valid || value === null} data-testid="kw-volume-save">
              {t('kw.volumeSave')}
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}

export default VolumePopover;

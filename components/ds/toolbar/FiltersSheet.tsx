// DS §4.3 FiltersSheet: every filter in one place. Desktop: a right-aligned popover under the
// "Filters" button. Mobile: a bottom sheet with a drag handle and a 50/50 footer
// [Clear] [Show 142 results]. Filters apply immediately in both (the count stays truthful).
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Popover from '@mui/material/Popover';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { accent, control, neutral, radius, zIndex } from '@/lib/ds/tokens';
import { dsIcons, ICON_SIZE, ICON_STROKE } from '../page/icons';
import { coarseSize } from '../page/touch';
import type { DsBaseProps } from '../page/types';
import { useIsMobile } from '../page/useViewport';
import { FilterButton, SEARCHABLE_THRESHOLD } from './FilterButton';
import { emptyValue } from './filterUtils';
import type { FilterDef, FilterValue, FilterValues, NumberRangeValue } from './types';

export type FiltersSheetProps = DsBaseProps & {
  open: boolean;
  onClose: () => void;
  /** Desktop anchor (the "Filters" button). Without one, desktop also uses the sheet. */
  anchorEl?: HTMLElement | null;
  filters: FilterDef[];
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  resultCount?: number;
  /** Default: sets every filter in `filters` to empty. */
  onClear?: () => void;
  /** Force a layout; default follows the viewport. */
  variant?: 'auto' | 'popover' | 'sheet';
};

const rangeKey = (r: NumberRangeValue | undefined) => `${r?.min ?? ''}|${r?.max ?? ''}`;
const rangeText = (n: number | undefined) => (n == null ? '' : String(n));
function parseBound(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Controlled min/max inputs. The typed text is a local draft (keeps "1," while typing); it resyncs
 * when the value changes from outside (Clear, chip ×, a saved view) but not on the echo of its own
 * edit. The next value is built from both drafts, so editing one bound never drops the other.
 */
function RangeControl({ def, value, onChange }: { def: FilterDef; value: NumberRangeValue | undefined; onChange: (v: FilterValue) => void }) {
  const t = useTranslations('ds.toolbar');
  const [draft, setDraft] = React.useState(() => ({ min: rangeText(value?.min), max: rangeText(value?.max) }));
  const emitted = React.useRef(rangeKey(value));
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const incoming = rangeKey(value);
  React.useEffect(() => {
    if (incoming === emitted.current) return;
    emitted.current = incoming;
    setDraft({ min: rangeText(valueRef.current?.min), max: rangeText(valueRef.current?.max) });
  }, [incoming]);

  const set = (k: 'min' | 'max', raw: string) => {
    const nextDraft = { ...draft, [k]: raw };
    setDraft(nextDraft);
    const next: NumberRangeValue = { min: parseBound(nextDraft.min), max: parseBound(nextDraft.max) };
    const out = next.min == null && next.max == null ? undefined : next;
    emitted.current = rangeKey(out);
    onChange(out);
  };
  const box = {
    flex: 1,
    height: control.md,
    px: '10px',
    fontSize: 13,
    border: `1px solid ${neutral[300]}`,
    borderRadius: `${radius.sm}px`,
    '@media (pointer: coarse)': { fontSize: 16, height: control.lg },
  };
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <InputBase
        sx={box}
        value={draft.min}
        placeholder={t('min')}
        onChange={(e) => set('min', e.target.value)}
        inputProps={{ inputMode: 'decimal', 'aria-label': `${def.label} ${t('min')}`, 'data-testid': `range-min-${def.key}` }}
        endAdornment={def.unit}
      />
      <Typography variant="caption" component="span" aria-hidden>
        {'—'}
      </Typography>
      <InputBase
        sx={box}
        value={draft.max}
        placeholder={t('max')}
        onChange={(e) => set('max', e.target.value)}
        inputProps={{ inputMode: 'decimal', 'aria-label': `${def.label} ${t('max')}`, 'data-testid': `range-max-${def.key}` }}
        endAdornment={def.unit}
      />
    </Box>
  );
}

function FilterControl({ def, value, onChange }: { def: FilterDef; value: FilterValue; onChange: (v: FilterValue) => void }) {
  if (def.render) return <>{def.render({ value, onChange, placement: 'sheet' })}</>;

  switch (def.type) {
    case 'select':
    case 'multiselect': {
      const options = def.options ?? [];
      const multiple = def.type === 'multiselect';
      if (options.length > SEARCHABLE_THRESHOLD || def.searchable) {
        return (
          <FilterButton
            label={def.label}
            value={value as string | string[] | undefined}
            options={options}
            multiple={multiple}
            searchable
            allLabel={def.allLabel}
            onChange={(v) => onChange(v)}
            size="md"
          />
        );
      }
      const selected = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
      return (
        <Box role="group" aria-label={def.label} sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <ButtonBase
                key={o.value}
                aria-pressed={on}
                disabled={Boolean(o.disabledReason)}
                title={o.disabledReason}
                data-testid={`sheet-option-${def.key}-${o.value}`}
                onClick={() => {
                  if (multiple) onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value]);
                  else onChange(on ? undefined : o.value);
                }}
                sx={{
                  height: control.sm,
                  px: '10px',
                  gap: '6px',
                  fontSize: 13,
                  borderRadius: `${radius.full}px`,
                  border: `1px solid ${on ? accent[600] : neutral[300]}`,
                  bgcolor: on ? accent[50] : neutral[0],
                  color: on ? accent[700] : neutral[700],
                  '@media (pointer: coarse)': { height: control.lg },
                  '&.Mui-disabled': { opacity: 0.5 },
                }}
              >
                {o.leading}
                {o.label}
              </ButtonBase>
            );
          })}
        </Box>
      );
    }
    case 'boolean':
      return (
        <Switch
          checked={value === true}
          onChange={(e) => onChange(e.target.checked ? true : undefined)}
          inputProps={{ 'aria-label': def.label }}
        />
      );
    case 'range':
      return <RangeControl def={def} value={value as NumberRangeValue | undefined} onChange={onChange} />;
    case 'daterange':
      // DateRangeField is M1-b's; a daterange filter must pass `render`.
      return null;
  }
}

export function FiltersSheet({
  open,
  onClose,
  anchorEl,
  filters,
  values,
  onChange,
  resultCount,
  onClear,
  variant = 'auto',
  className,
  ...rest
}: FiltersSheetProps) {
  const t = useTranslations('ds.toolbar');
  const isMobile = useIsMobile();
  const asSheet = variant === 'sheet' || (variant === 'auto' && (isMobile || !anchorEl));
  const testId = rest['data-testid'] ?? 'filters-sheet';

  const clear = () => {
    if (onClear) onClear();
    else {
      const next = { ...values };
      filters.forEach((f) => {
        next[f.key] = emptyValue(f);
      });
      onChange(next);
    }
  };

  const body = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {filters.map((def) => (
        <Box key={def.key} data-testid={`sheet-filter-${def.key}`}>
          <Typography variant="label" component="div" sx={{ mb: '6px', color: neutral[700] }}>
            {def.label}
          </Typography>
          <FilterControl def={def} value={values[def.key]} onChange={(v) => onChange({ ...values, [def.key]: v })} />
        </Box>
      ))}
    </Box>
  );

  const showLabel =
    typeof resultCount === 'number' ? t('showResults', { count: resultCount }) : t('done');
  const CloseIcon = dsIcons.close;

  if (asSheet) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        sx={{ zIndex: zIndex.drawer }}
        PaperProps={{
          className,
          'data-testid': testId,
          sx: {
            borderTopLeftRadius: `${radius.lg}px`,
            borderTopRightRadius: `${radius.lg}px`,
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            pb: 'env(safe-area-inset-bottom)',
          },
        } as React.ComponentProps<typeof Drawer>['PaperProps']}
      >
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: '8px' }} aria-hidden>
          <Box sx={{ width: 36, height: 4, borderRadius: `${radius.full}px`, bgcolor: neutral[300] }} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', px: '16px', py: '8px' }}>
          <Typography variant="titleMd" component="h2" sx={{ flex: 1 }}>
            {t('filters')}
          </Typography>
          <IconButton aria-label={t('close')} onClick={onClose} sx={coarseSize} data-testid="filters-sheet-close">
            <CloseIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
          </IconButton>
        </Box>
        <Box sx={{ px: '16px', pb: '16px', overflowY: 'auto', flex: 1 }}>{body}</Box>
        <Box sx={{ display: 'flex', gap: '8px', px: '16px', py: '8px', borderTop: `1px solid ${neutral[200]}` }}>
          <Button variant="outlined" size="large" fullWidth onClick={clear} sx={{ minHeight: 48 }} data-testid="filters-sheet-clear">
            {t('clear')}
          </Button>
          <Button variant="contained" size="large" fullWidth onClick={onClose} sx={{ minHeight: 48 }} data-testid="filters-sheet-show">
            {showLabel}
          </Button>
        </Box>
      </Drawer>
    );
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      sx={{ zIndex: zIndex.popover }}
      slotProps={{ paper: { className, 'data-testid': testId, sx: { mt: '4px', width: 360, maxHeight: 520, display: 'flex', flexDirection: 'column' } } as never }}
    >
      <Box sx={{ p: '16px', overflowY: 'auto', flex: 1 }}>{body}</Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: '16px', py: '8px', borderTop: `1px solid ${neutral[200]}` }}>
        <Button variant="text" color="inherit" size="small" onClick={clear} data-testid="filters-sheet-clear">
          {t('clear')}
        </Button>
        {typeof resultCount === 'number' ? (
          <Typography variant="caption" component="span" className="tnum">
            {t('results', { count: resultCount })}
          </Typography>
        ) : null}
      </Box>
    </Popover>
  );
}

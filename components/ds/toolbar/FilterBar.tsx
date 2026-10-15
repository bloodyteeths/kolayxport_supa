// The filter half of DS §3.3 Toolbar, usable on its own (research tools, report tabs):
// search · ≤ 3 visible FilterButtons · "Filters • n" (FiltersSheet) · active chips + "Clear all".
// CRITIQUE X4 overflow rule: below 1200px the visible FilterButtons fold right-to-left into
// "Filters • n" (one fewer), the search shrinks to ≥ 200px and the result count moves to the right end
// of the chips row. Below 900px every filter lives in the bottom sheet, and with no active chips the count
// sits at the end of the saved-views chip row (no lone "25 results" row).
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useFormatter, useTranslations } from 'next-intl';
import { useFormatters } from '@/lib/format';
import { accent, control, focusRing, neutral, radius } from '@/lib/ds/tokens';
import { dsIcons, ICON_SIZE, ICON_STROKE } from '../page/icons';
import type { DsBaseProps } from '../page/types';
import { useIsMobile, useIsNarrow } from '../page/useViewport';
import { ActiveFilterChips, type FilterChip } from './ActiveFilterChips';
import { FilterButton } from './FilterButton';
import { FiltersSheet } from './FiltersSheet';
import { emptyValue, formatFilterValue, isActiveValue, pickVisibleFilters, type ValueLabels } from './filterUtils';
import { SearchField, type SearchFieldProps } from './SearchField';
import type { FilterDef, FilterValues } from './types';

export type FilterBarProps = DsBaseProps & {
  search?: SearchFieldProps;
  filters?: FilterDef[];
  values?: FilterValues;
  onChange?: (values: FilterValues) => void;
  /** Max visible FilterButtons on wide screens (DS: 3). */
  maxVisible?: number;
  resultCount?: number;
  /** Translated count text ("142 orders"); default "142 results". */
  resultLabel?: string;
  /** Before the search (e.g. finance's DateRangeField first). */
  leading?: React.ReactNode;
  /** End of the controls row, before the result count (Toolbar puts SavedViews + density here). */
  trailing?: React.ReactNode;
  /** Chips beyond the filter values (e.g. a search scope); appended. */
  extraChips?: FilterChip[];
  /** Default: empties every filter value. */
  onClearAll?: () => void;
  hideChips?: boolean;
  /** Mobile only: a row under the search (Toolbar puts SavedViews chips here). */
  mobileSecondRow?: React.ReactNode;
};

function useValueLabels(): ValueLabels {
  const t = useTranslations('ds.toolbar');
  const tDate = useTranslations('ds.inputs.dateRange');
  const format = useFormatter();
  const fmt = useFormatters();
  return React.useMemo(
    () => ({
      yes: t('yes'),
      between: (a, b) => t('between', { a, b }),
      atLeast: (a) => t('atLeast', { a }),
      atMost: (a) => t('atMost', { a }),
      andMore: (first, more) => t('andMore', { first, count: more }),
      formatNumber: (n) => format.number(n),
      datePreset: (key) => tDate(`preset.${key}`),
      dateRange: (from, to) => fmt.dateRange(from, to),
    }),
    [t, tDate, format, fmt],
  );
}

function isToolbarEligible(f: FilterDef) {
  return Boolean(f.render) || f.type === 'select' || f.type === 'multiselect' || f.type === 'boolean';
}

export function FilterBar({
  search,
  filters = [],
  values = {},
  onChange,
  maxVisible = 3,
  resultCount,
  resultLabel,
  leading,
  trailing,
  extraChips = [],
  onClearAll,
  hideChips = false,
  mobileSecondRow,
  className,
  ...rest
}: FilterBarProps) {
  const t = useTranslations('ds.toolbar');
  const labels = useValueLabels();
  const isMobile = useIsMobile();
  const isNarrow = useIsNarrow();
  const [sheetAnchor, setSheetAnchor] = React.useState<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const cap = isMobile ? 0 : isNarrow ? Math.max(maxVisible - 1, 1) : maxVisible;
  const visible = pickVisibleFilters(filters.filter(isToolbarEligible), cap);
  const visibleKeys = new Set(visible.map((f) => f.key));
  const hidden = filters.filter((f) => !visibleKeys.has(f.key));
  const hiddenActive = hidden.filter((f) => isActiveValue(f, values[f.key])).length;
  const showFiltersButton = hidden.length > 0;

  const set = (key: string, v: FilterValues[string]) => onChange?.({ ...values, [key]: v });
  const clearAll =
    onClearAll ??
    (() => {
      const next = { ...values };
      filters.forEach((f) => {
        next[f.key] = emptyValue(f);
      });
      onChange?.(next);
    });

  const chips: FilterChip[] = hideChips
    ? []
    : [
        ...filters
          .filter((f) => isActiveValue(f, values[f.key]))
          .map((f) => ({
            key: f.key,
            label: f.formatChip?.(values[f.key]) ?? t('chip', { label: f.label, value: formatFilterValue(f, values[f.key], labels) }),
            onRemove: () => set(f.key, emptyValue(f)),
          })),
        ...extraChips,
      ];

  const countText =
    typeof resultCount === 'number' ? (
      <Typography variant="caption" component="span" className="tnum" sx={{ whiteSpace: 'nowrap', color: neutral[600] }} data-testid="toolbar-result-count" aria-live="polite">
        {resultLabel ?? t('results', { count: resultCount })}
      </Typography>
    ) : null;
  const countInChipsRow = isNarrow || isMobile;

  const FiltersIcon = dsIcons.filters;
  const filtersButton = showFiltersButton ? (
    <ButtonBase
      aria-haspopup="dialog"
      aria-expanded={sheetOpen || undefined}
      onClick={(e) => {
        setSheetAnchor(e.currentTarget);
        setSheetOpen(true);
      }}
      data-testid="filters-button"
      sx={{
        height: control.sm,
        px: '10px',
        gap: '6px',
        border: `1px solid ${hiddenActive ? accent[200] : neutral[300]}`,
        bgcolor: hiddenActive ? accent[50] : neutral[0],
        borderRadius: `${radius.sm}px`,
        fontSize: 13,
        fontWeight: 500,
        color: neutral[800],
        flexShrink: 0,
        whiteSpace: 'nowrap',
        '&.Mui-focusVisible': { boxShadow: focusRing },
        '@media (pointer: coarse)': { height: control.lg, minWidth: control.lg },
      }}
    >
      <FiltersIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
      {hiddenActive ? t('filtersWithCount', { count: hiddenActive }) : t('filters')}
    </ButtonBase>
  ) : null;

  const sheet = showFiltersButton ? (
    <FiltersSheet
      open={sheetOpen}
      onClose={() => setSheetOpen(false)}
      anchorEl={sheetAnchor}
      filters={isMobile ? filters : hidden}
      values={values}
      onChange={(v) => onChange?.(v)}
      resultCount={resultCount}
      onClear={() => {
        const next = { ...values };
        (isMobile ? filters : hidden).forEach((f) => {
          next[f.key] = emptyValue(f);
        });
        onChange?.(next);
      }}
    />
  ) : null;

  // Mobile density: with no active chips the count joins the saved-views row instead of taking a lone row.
  const countInSecondRow = isMobile && Boolean(mobileSecondRow) && chips.length === 0 && Boolean(countText);
  const chipsRow = countInSecondRow ? null : !hideChips ? (
    <ActiveFilterChips chips={chips} onClearAll={clearAll} trailing={countInChipsRow ? countText : undefined} />
  ) : countInChipsRow && countText ? (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: '8px' }}>{countText}</Box>
  ) : null;

  if (isMobile) {
    return (
      <Box className={className} data-testid={rest['data-testid'] ?? 'filter-bar'} data-layout="mobile">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {leading}
          {search ? <SearchField size="md" {...search} shortcut={null} fullWidth /> : null}
          {filtersButton}
        </Box>
        {mobileSecondRow ? (
          countInSecondRow ? (
            <Box sx={{ mt: '8px', display: 'flex', alignItems: 'center', gap: '8px' }} data-testid="filter-bar-second-row">
              <Box sx={{ flex: 1, minWidth: 0 }}>{mobileSecondRow}</Box>
              <Box sx={{ flexShrink: 0 }}>{countText}</Box>
            </Box>
          ) : (
            <Box sx={{ mt: '8px' }} data-testid="filter-bar-second-row">{mobileSecondRow}</Box>
          )
        ) : null}
        {chipsRow}
        {sheet}
      </Box>
    );
  }

  return (
    <Box className={className} data-testid={rest['data-testid'] ?? 'filter-bar'} data-layout="desktop">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: 40, minWidth: 0 }}>
        {leading}
        {search ? <SearchField {...search} /> : null}
        {visible.map((f) =>
          f.render ? (
            <React.Fragment key={f.key}>{f.render({ value: values[f.key], onChange: (v) => set(f.key, v), placement: 'toolbar' })}</React.Fragment>
          ) : f.type === 'boolean' ? (
            <FilterButton
              key={f.key}
              data-testid={`filter-${f.key}`}
              label={f.label}
              value={values[f.key] === true ? 'true' : undefined}
              options={[{ value: 'true', label: labels.yes }]}
              allLabel={f.allLabel}
              onChange={(v) => set(f.key, v === 'true' ? true : undefined)}
            />
          ) : (
            <FilterButton
              key={f.key}
              data-testid={`filter-${f.key}`}
              label={f.label}
              value={values[f.key] as string | string[] | undefined}
              options={f.options ?? []}
              multiple={f.type === 'multiselect'}
              searchable={f.searchable}
              allLabel={f.allLabel}
              onChange={(v) => set(f.key, f.type === 'multiselect' ? (v as string[]) ?? [] : v)}
            />
          ),
        )}
        {filtersButton}
        <Box sx={{ flex: 1, minWidth: 0 }} />
        {trailing}
        {!countInChipsRow ? countText : null}
      </Box>
      {chipsRow}
      {sheet}
    </Box>
  );
}

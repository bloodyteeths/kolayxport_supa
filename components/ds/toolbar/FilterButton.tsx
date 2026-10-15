// DS §4.3 FilterButton: outlined "Label: Value ▾" (empty value reads "Status: All"); single or multi
// select in a popover, searchable for long lists, options may carry a leading logo, a count, or a
// disabled reason.
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import InputBase from '@mui/material/InputBase';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import { useFormatter, useTranslations } from 'next-intl';
import { accent, control, focusRing, neutral, radius, zIndex } from '@/lib/ds/tokens';
import { dsIcons, ICON_SIZE, ICON_STROKE } from '../page/icons';
import type { DsBaseProps } from '../page/types';
import type { FilterOption } from './types';

export type FilterButtonProps = DsBaseProps & {
  label: string;
  /** `undefined` / '' / [] = All. */
  value?: string | string[];
  options: FilterOption[];
  multiple?: boolean;
  /** Default: auto when options > 8. */
  searchable?: boolean;
  onChange: (value: string | string[] | undefined) => void;
  /** Label of the empty value; default "All". */
  allLabel?: string;
  /** Hide the "All" row (a value is always required, e.g. research marketplace). */
  required?: boolean;
  size?: 'sm' | 'md';
  disabled?: boolean;
};

export const SEARCHABLE_THRESHOLD = 8;

export function FilterButton({
  label,
  value,
  options,
  multiple = false,
  searchable,
  onChange,
  allLabel,
  required = false,
  size = 'sm',
  disabled,
  className,
  ...rest
}: FilterButtonProps) {
  const t = useTranslations('ds.toolbar');
  const format = useFormatter();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [query, setQuery] = React.useState('');
  const listId = React.useId();

  const selected: string[] = Array.isArray(value) ? value : value ? [value] : [];
  const showSearch = searchable ?? options.length > SEARCHABLE_THRESHOLD;
  const all = allLabel ?? t('all');
  const firstLabel = selected.length ? options.find((o) => o.value === selected[0])?.label ?? selected[0] : '';
  const valueText = !selected.length ? all : selected.length === 1 ? firstLabel : t('andMore', { first: firstLabel, count: selected.length - 1 });
  const active = selected.length > 0;

  const q = query.trim().toLocaleLowerCase();
  const visibleOptions = q ? options.filter((o) => o.label.toLocaleLowerCase().includes(q)) : options;

  const close = () => {
    setAnchor(null);
    setQuery('');
  };

  const pick = (opt: FilterOption) => {
    if (opt.disabledReason) return;
    if (multiple) {
      const next = selected.includes(opt.value) ? selected.filter((v) => v !== opt.value) : [...selected, opt.value];
      onChange(next);
    } else {
      onChange(opt.value);
      close();
    }
  };

  const ChevronIcon = dsIcons.dropdown;
  const CheckIcon = dsIcons.selected;

  return (
    <>
      <ButtonBase
        className={className}
        data-testid={rest['data-testid'] ?? 'filter-button'}
        data-active={active || undefined}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={anchor ? true : undefined}
        aria-controls={anchor ? listId : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          height: size === 'md' ? control.md : control.sm,
          px: '10px',
          gap: '4px',
          maxWidth: 240,
          border: `1px solid ${active ? accent[200] : neutral[300]}`,
          bgcolor: active ? accent[50] : neutral[0],
          borderRadius: `${radius.sm}px`,
          fontSize: 13,
          color: neutral[800],
          whiteSpace: 'nowrap',
          flexShrink: 0,
          '&:hover': { bgcolor: active ? accent[50] : neutral[50] },
          '&.Mui-focusVisible': { boxShadow: focusRing },
          '@media (pointer: coarse)': { height: control.lg },
        }}
      >
        <Box component="span" sx={{ color: neutral[500] }}>
          {t('filterLabel', { label })}
        </Box>
        <Box component="span" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }} data-testid="filter-button-value">
          {valueText}
        </Box>
        <ChevronIcon size={14} strokeWidth={ICON_STROKE} aria-hidden />
      </ButtonBase>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        sx={{ zIndex: zIndex.popover }}
        slotProps={{ paper: { sx: { mt: '4px', minWidth: 220, maxWidth: 320, maxHeight: 420, display: 'flex', flexDirection: 'column' } } }}
      >
        {showSearch ? (
          <Box sx={{ p: '8px', borderBottom: `1px solid ${neutral[200]}` }}>
            <InputBase
              autoFocus
              fullWidth
              value={query}
              placeholder={t('searchOptions')}
              onChange={(e) => setQuery(e.target.value)}
              inputProps={{ 'aria-label': t('searchOptions') }}
              sx={{ fontSize: 13, height: control.sm, px: '8px', border: `1px solid ${neutral[300]}`, borderRadius: `${radius.sm}px` }}
            />
          </Box>
        ) : null}
        <MenuList
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          autoFocusItem={!showSearch}
          dense
          sx={{ overflowY: 'auto', py: '4px' }}
        >
          {!required ? (
            <MenuItem
              role="option"
              aria-selected={!active}
              selected={!active}
              onClick={() => {
                onChange(multiple ? [] : undefined);
                if (!multiple) close();
              }}
              data-testid="filter-option-all"
            >
              <Box sx={{ width: 20, display: 'inline-flex', color: accent[600] }}>
                {!active ? <CheckIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden /> : null}
              </Box>
              {all}
            </MenuItem>
          ) : null}
          {!required && visibleOptions.length ? <Divider /> : null}
          {visibleOptions.map((opt) => {
            const isSel = selected.includes(opt.value);
            const isDisabled = Boolean(opt.disabledReason);
            return (
              <MenuItem
                key={opt.value}
                role="option"
                aria-selected={isSel}
                aria-disabled={isDisabled || undefined}
                selected={isSel && !multiple}
                onClick={() => pick(opt)}
                data-testid={`filter-option-${opt.value}`}
                sx={{ gap: '8px', alignItems: 'flex-start', ...(isDisabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
              >
                {multiple ? (
                  <Checkbox checked={isSel} disabled={isDisabled} tabIndex={-1} sx={{ p: 0, mt: '1px' }} inputProps={{ 'aria-hidden': true }} />
                ) : (
                  <Box sx={{ width: 20, display: 'inline-flex', color: accent[600], mt: '1px' }}>
                    {isSel ? <CheckIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden /> : null}
                  </Box>
                )}
                {opt.leading ? <Box sx={{ display: 'inline-flex', mt: '1px' }}>{opt.leading}</Box> : null}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="dense" component="div" noWrap>
                    {opt.label}
                  </Typography>
                  {opt.disabledReason ? (
                    <Typography variant="caption" component="div" sx={{ whiteSpace: 'normal' }}>
                      {opt.disabledReason}
                    </Typography>
                  ) : null}
                </Box>
                {typeof opt.count === 'number' ? (
                  <Typography variant="caption" component="span" className="tnum">
                    {format.number(opt.count)}
                  </Typography>
                ) : null}
              </MenuItem>
            );
          })}
          {!visibleOptions.length ? (
            <Typography variant="caption" component="div" sx={{ px: '12px', py: '8px' }} data-testid="filter-no-options">
              {t('noOptions')}
            </Typography>
          ) : null}
        </MenuList>
      </Popover>
    </>
  );
}

// DS §4.3 SearchField: debounced search with a `/` focus shortcut and a clear button.
import * as React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import { useTranslations } from 'next-intl';
import { useShortcuts } from '@/lib/ds/useShortcuts';
import { accent, control, focusRing, neutral, radius } from '@/lib/ds/tokens';
import { dsIcons, ICON_SIZE, ICON_STROKE } from '../page/icons';
import { coarseHitArea } from '../page/touch';
import type { DsBaseProps } from '../page/types';

export type SearchFieldProps = DsBaseProps & {
  value: string;
  /** Called after `debounceMs` of no typing, immediately on clear / Enter. */
  onChange: (value: string) => void;
  placeholder: string;
  /** Focus shortcut; `'/'` per P3. Pass `null` to disable. Default '/'. */
  shortcut?: '/' | null;
  debounceMs?: number;
  size?: 'sm' | 'md';
  /** Accessible name; defaults to the placeholder. */
  ariaLabel?: string;
  /** CSS width; default 280 (toolbar), 100% when `fullWidth`. */
  width?: number | string;
  minWidth?: number;
  fullWidth?: boolean;
  autoFocus?: boolean;
  onSubmit?: (value: string) => void;
};

export function SearchField({
  value,
  onChange,
  placeholder,
  shortcut = '/',
  debounceMs = 250,
  size = 'sm',
  ariaLabel,
  width = 280,
  minWidth = 200,
  fullWidth = false,
  autoFocus,
  onSubmit,
  className,
  ...rest
}: SearchFieldProps) {
  const t = useTranslations('ds.toolbar');
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  // External value changes (URL navigation, "Clear all") win over the local draft. The echo of our
  // own commit is ignored so a slow URL round-trip never eats characters typed meanwhile.
  const committedRef = React.useRef(value);
  React.useEffect(() => {
    if (value === committedRef.current) return;
    committedRef.current = value;
    setDraft(value);
  }, [value]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = React.useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    committedRef.current = next;
    onChangeRef.current(next);
  }, []);

  const schedule = (next: string) => {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    if (debounceMs <= 0) {
      commit(next);
      return;
    }
    timer.current = setTimeout(() => commit(next), debounceMs);
  };

  useShortcuts(
    shortcut
      ? {
          [shortcut]: () => {
            inputRef.current?.focus();
            inputRef.current?.select();
          },
        }
      : {},
    { scope: 'page', enabled: Boolean(shortcut) },
  );

  const SearchIcon = dsIcons.search;
  const ClearIcon = dsIcons.clear;
  const height = size === 'md' ? control.md : control.sm;

  return (
    <Box
      className={className}
      data-testid={rest['data-testid'] ?? 'search-field'}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        height,
        width: fullWidth ? '100%' : width,
        minWidth: fullWidth ? 0 : minWidth,
        flexShrink: 1,
        px: '8px',
        bgcolor: neutral[0],
        border: `1px solid ${neutral[300]}`,
        borderRadius: `${radius.sm}px`,
        color: neutral[500],
        '&:focus-within': { borderColor: accent[600], boxShadow: focusRing },
        '@media (pointer: coarse)': { height: control.lg },
      }}
    >
      <SearchIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
      <InputBase
        inputRef={inputRef}
        value={draft}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => schedule(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(draft);
            onSubmit?.(draft);
          } else if (e.key === 'Escape') {
            if (draft) {
              e.stopPropagation();
              e.preventDefault();
              setDraft('');
              commit('');
            } else {
              inputRef.current?.blur();
            }
          }
        }}
        inputProps={{
          'aria-label': ariaLabel ?? placeholder,
          type: 'search',
          enterKeyHint: 'search',
          'aria-keyshortcuts': shortcut ?? undefined,
          'data-testid': 'search-field-input',
        }}
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          color: neutral[900],
          // iOS: 16px text avoids zoom on focus (P3).
          '@media (pointer: coarse)': { fontSize: 16 },
          '& input::-webkit-search-cancel-button': { display: 'none' },
        }}
      />
      {draft ? (
        <IconButton
          size="small"
          aria-label={t('clearSearch')}
          onClick={() => {
            setDraft('');
            commit('');
            inputRef.current?.focus();
          }}
          sx={{ width: 20, height: 20, p: 0, ...coarseHitArea }}
          data-testid="search-field-clear"
        >
          <ClearIcon size={14} strokeWidth={ICON_STROKE} aria-hidden />
        </IconButton>
      ) : shortcut ? (
        <Box
          component="kbd"
          aria-hidden
          sx={{
            fontFamily: 'inherit',
            fontSize: 11,
            lineHeight: '16px',
            px: '5px',
            borderRadius: `${radius.xs}px`,
            border: `1px solid ${neutral[200]}`,
            color: neutral[500],
            '@media (pointer: coarse)': { display: 'none' },
          }}
        >
          {shortcut}
        </Box>
      ) : null}
    </Box>
  );
}

// components/ds/inputs/Combobox.tsx — DS §4.6: searchable single/multi select on MUI Autocomplete.
// Static `options` or async `loadOptions(q)` (taxonomy, sold products, own listings, timezones),
// `creatable` adds "Create 'x'" (eBay FREE_TEXT aspects, Shopify vendor). Popper z 1600 via theme.
// Values are option objects so async results keep their labels.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useTranslations } from 'next-intl';
import { neutral, type as typeScale } from '@/lib/ds/tokens';
import OutlinedInput from '@mui/material/OutlinedInput';
import { chipBaseSx, hitSlopSx, outlinedInputSx, useFieldContext } from './_shared';
import { IconClose, IconDisclose, ICON_STROKE } from './_icons';
import type { DsBaseProps, FieldSize } from './types';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  /** Leading slot (flag, LogoTile, Thumb). */
  leading?: ReactNode;
  group?: string;
  disabled?: boolean;
  /** Set on the synthetic "Create 'x'" option and on the value it produces. */
  created?: boolean;
}

interface ComboboxBase extends DsBaseProps {
  options?: ComboboxOption[];
  /** Async search. Called with the typed query (debounced); stale responses are dropped. */
  loadOptions?: (query: string) => Promise<ComboboxOption[]>;
  creatable?: boolean;
  renderOption?: (option: ComboboxOption) => ReactNode;
  placeholder?: string;
  size?: FieldSize;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Text for an empty result. Defaults to "No results". */
  noOptionsText?: string;
  debounceMs?: number;
  /** Don't call loadOptions below this many characters (default 0 = also on open). */
  minQueryLength?: number;
  /** Prefix match on the label instead of substring (long fixed lists). */
  matchFrom?: 'any' | 'start';
  /** Hide the ✕ clear button (pickers that always hold a value: phone country, currency). Default false. */
  disableClearable?: boolean;
  'aria-label'?: string;
}

export interface ComboboxSingleProps extends ComboboxBase {
  multiple?: false;
  value: ComboboxOption | null;
  onChange: (value: ComboboxOption | null) => void;
}
export interface ComboboxMultipleProps extends ComboboxBase {
  multiple: true;
  value: ComboboxOption[];
  onChange: (value: ComboboxOption[]) => void;
}
export type ComboboxProps = ComboboxSingleProps | ComboboxMultipleProps;

export function Combobox(props: ComboboxProps) {
  const {
    options: staticOptions, loadOptions, creatable, renderOption, placeholder, size = 'md', id, invalid, disabled,
    noOptionsText, debounceMs = 250, minQueryLength = 0, matchFrom = 'any', disableClearable = false, className,
    'data-testid': testId, 'aria-label': ariaLabel,
  } = props;
  const t = useTranslations('ds.inputs.combobox');
  const field = useFieldContext();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState<ComboboxOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const reqId = useRef(0);
  const filter = useMemo(() => createFilterOptions<ComboboxOption>({ matchFrom, stringify: (o) => `${o.label} ${o.description ?? ''}` }), [matchFrom]);

  useEffect(() => {
    if (!loadOptions || !open) return undefined;
    if (input.length < minQueryLength) { setLoaded([]); return undefined; }
    const my = ++reqId.current;
    setLoading(true);
    const h = setTimeout(() => {
      loadOptions(input)
        .then((res) => { if (my === reqId.current) { setLoaded(res); setLoadFailed(false); } })
        .catch(() => { if (my === reqId.current) { setLoaded([]); setLoadFailed(true); } })
        .finally(() => { if (my === reqId.current) setLoading(false); });
    }, debounceMs);
    return () => {
      clearTimeout(h);
      // Closing (or a new query) abandons this request: drop its result and its spinner.
      if (my === reqId.current) { reqId.current += 1; setLoading(false); }
    };
  }, [input, open, loadOptions, debounceMs, minQueryLength]);

  const options = loadOptions ? loaded : staticOptions ?? [];
  const multiple = props.multiple === true;
  const isInvalid = Boolean(invalid ?? field?.invalid);

  const defaultRender = (o: ComboboxOption) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
      {o.leading}
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box component="span" sx={{ fontSize: 14, color: neutral[800], overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {o.created ? t('create', { value: o.label }) : o.label}
        </Box>
        {o.description ? <Box component="span" sx={{ fontSize: 12, color: neutral[500] }}>{o.description}</Box> : null}
      </Box>
    </Box>
  );

  return (
    <Autocomplete<ComboboxOption, boolean, boolean, false>
      multiple={multiple}
      value={props.value as never}
      onChange={(_, v) => {
        if (multiple) {
          const list = (v as ComboboxOption[]).map((o) => (o.created ? { value: o.value, label: o.value, created: true } : o));
          (props as ComboboxMultipleProps).onChange(list);
        } else {
          const o = v as ComboboxOption | null;
          (props as ComboboxSingleProps).onChange(o && o.created ? { value: o.value, label: o.value, created: true } : o);
        }
      }}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      options={options}
      groupBy={options.some((o) => o.group) ? (o) => o.group ?? '' : undefined}
      getOptionLabel={(o) => o.label}
      getOptionDisabled={(o) => Boolean(o.disabled)}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      filterOptions={(opts, state) => {
        const base = loadOptions ? opts : filter(opts, state);
        const q = state.inputValue.trim();
        if (creatable && q && !opts.some((o) => o.label.toLocaleLowerCase() === q.toLocaleLowerCase())) {
          return [...base, { value: q, label: q, created: true }];
        }
        return base;
      }}
      loading={loading}
      loadingText={t('loading')}
      noOptionsText={loadFailed ? t('loadFailed') : noOptionsText ?? t('noResults')}
      disabled={disabled}
      disableClearable={disableClearable}
      popupIcon={<IconDisclose size={16} strokeWidth={ICON_STROKE} aria-hidden />}
      clearIcon={<IconClose size={14} strokeWidth={ICON_STROKE} aria-hidden />}
      clearText={t('clear')}
      openText={t('open')}
      closeText={t('close')}
      id={id ?? field?.id}
      className={className}
      data-testid={testId}
      fullWidth
      renderOption={(liProps, o) => {
        const { key, ...rest } = liProps as typeof liProps & { key: string };
        return <li key={key} {...rest}>{renderOption && !o.created ? renderOption(o) : defaultRender(o)}</li>;
      }}
      renderTags={(vals, getTagProps) => vals.map((o, index) => {
        const { key, onDelete, ...tagRest } = getTagProps({ index }) as ReturnType<typeof getTagProps> & { key: string };
        return (
          <Box component="span" key={key} {...tagRest} sx={{ ...chipBaseSx, m: '2px', pr: '2px' }}>
            <span>{o.label}</span>
            <Box component="button" type="button" onClick={onDelete} aria-label={t('remove', { value: o.label })} sx={{ position: 'relative', display: 'inline-flex', border: 0, background: 'none', p: '2px', cursor: 'pointer', color: neutral[500], borderRadius: '50%', ...hitSlopSx }}>
              <IconClose size={12} strokeWidth={ICON_STROKE} aria-hidden />
            </Box>
          </Box>
        );
      })}
      renderInput={(params) => (
        <OutlinedInput
          ref={params.InputProps.ref}
          className={params.InputProps.className}
          startAdornment={params.InputProps.startAdornment}
          endAdornment={
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              {loading && open ? <CircularProgress size={14} sx={{ color: neutral[400] }} aria-hidden /> : null}
              {params.InputProps.endAdornment}
            </Box>
          }
          disabled={params.disabled}
          fullWidth
          notched={false}
          error={isInvalid}
          size="small"
          placeholder={multiple && (props.value as ComboboxOption[]).length ? undefined : placeholder}
          inputProps={{
            ...params.inputProps,
            'aria-label': ariaLabel,
            'aria-invalid': isInvalid || undefined,
            'aria-describedby': field?.describedBy,
          }}
          sx={{
            ...outlinedInputSx(size),
            // Single: one line, always (the chevron must never wrap under the value: "+90", "₺ TRY").
            // Multi: tags wrap; the indicators stay on the first line.
            flexWrap: multiple ? 'wrap' : 'nowrap',
            gap: '2px',
            pr: '8px !important',
            '& .MuiOutlinedInput-input': {
              ...outlinedInputSx(size)['& .MuiOutlinedInput-input'],
              flex: 1,
              minWidth: multiple ? 80 : 0,
              textOverflow: 'ellipsis',
            },
          }}
        />
      )}
      sx={{
        '& .MuiAutocomplete-endAdornment': { position: 'static', transform: 'none', flexShrink: 0, alignSelf: 'center' },
        '& .MuiAutocomplete-groupLabel': { fontSize: typeScale.caption[0], fontWeight: 500, color: neutral[500] },
      }}
    />
  );
}

/** Task alias: the DS calls it Combobox; some specs say Autocomplete. One component. */
export const AutocompleteField = Combobox;

export default Combobox;

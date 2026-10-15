// components/ds/inputs/Select.tsx — DS §4.6: a short fixed list (≤ ~12 options). Searchable lists use Combobox.
import type { ReactNode } from 'react';
import MuiSelect from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import OutlinedInput from '@mui/material/OutlinedInput';
import Box from '@mui/material/Box';
import { neutral } from '@/lib/ds/tokens';
import { outlinedInputSx, useFieldContext } from './_shared';
import { IconDisclose, ICON_STROKE, type LucideIcon } from './_icons';
import type { DsBaseProps, FieldSize } from './types';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Brand mark or flag slot (DS §4.6 `brand?`): pass `<LogoTile brand="etsy" size={16} />`. */
  leading?: ReactNode;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string | number> extends DsBaseProps {
  value: T | null;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  size?: FieldSize;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  'aria-label'?: string;
}

function Chevron(props: { className?: string }) {
  return (
    <Box component="span" className={props.className} sx={{ display: 'inline-flex', right: '10px !important', top: 'calc(50% - 8px) !important', color: neutral[500], pointerEvents: 'none', position: 'absolute' }}>
      <IconDisclose size={16} strokeWidth={ICON_STROKE} aria-hidden />
    </Box>
  );
}

export function Select<T extends string | number>({
  value, onChange, options, placeholder, size = 'md', id, invalid, disabled, fullWidth = true, className,
  'data-testid': testId, 'aria-label': ariaLabel,
}: SelectProps<T>) {
  const field = useFieldContext();
  const isInvalid = Boolean(invalid ?? field?.invalid);
  const byKey = new Map(options.map((o) => [String(o.value), o]));

  const renderOption = (o: SelectOption<T>) => {
    const Icon = o.icon;
    return (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        {o.leading ?? (Icon ? <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden /> : null)}
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</Box>
      </Box>
    );
  };

  return (
    <MuiSelect<string>
      value={value == null ? '' : String(value)}
      onChange={(e) => {
        const opt = byKey.get(String(e.target.value));
        if (opt) onChange(opt.value);
      }}
      displayEmpty
      disabled={disabled}
      fullWidth={fullWidth}
      className={className}
      data-testid={testId}
      IconComponent={Chevron}
      input={<OutlinedInput notched={false} error={isInvalid} size="small" sx={{ ...outlinedInputSx(size), '& .MuiSelect-select': { pr: '36px !important', display: 'flex', alignItems: 'center' } }} />}
      SelectDisplayProps={{
        id: id ?? field?.id,
        'aria-label': ariaLabel,
        'aria-labelledby': ariaLabel ? undefined : field?.labelId,
        'aria-invalid': isInvalid || undefined,
        'aria-describedby': field?.describedBy,
      } as Record<string, unknown>}
      renderValue={(v) => {
        const opt = byKey.get(v);
        if (!opt) return <Box component="span" sx={{ color: neutral[400] }}>{placeholder}</Box>;
        return renderOption(opt);
      }}
    >
      {options.map((o) => (
        <MenuItem key={String(o.value)} value={String(o.value)} disabled={o.disabled} sx={{ fontSize: 14, flexDirection: 'column', alignItems: 'flex-start' }}>
          {renderOption(o)}
          {o.description ? <Box component="span" sx={{ fontSize: 12, color: neutral[500] }}>{o.description}</Box> : null}
        </MenuItem>
      ))}
    </MuiSelect>
  );
}

export default Select;

// components/ds/inputs/Switch.tsx — DS §4.6: an on/off setting that applies immediately (not a form submit).
import { useId, type ChangeEvent } from 'react';
import MuiSwitch from '@mui/material/Switch';
import Box from '@mui/material/Box';
import { neutral, type as typeScale } from '@/lib/ds/tokens';
import { COARSE, useFieldContext } from './_shared';
import type { DsBaseProps } from './types';

export interface SwitchProps extends DsBaseProps {
  checked: boolean;
  onChange: (checked: boolean, event: ChangeEvent<HTMLInputElement>) => void;
  label?: string;
  description?: string;
  /** Label left, switch right (settings rows). Default: switch first. */
  labelPlacement?: 'end' | 'start';
  disabled?: boolean;
  id?: string;
  name?: string;
  'aria-label'?: string;
}

export function Switch({
  checked, onChange, label, description, labelPlacement = 'end', disabled, id, name, className, 'data-testid': testId,
  'aria-label': ariaLabel,
}: SwitchProps) {
  const field = useFieldContext();
  const uid = useId().replace(/:/g, '');
  const inputId = id ?? field?.id ?? `${uid}-in`;
  const labelId = `${uid}-l`;
  const descId = `${uid}-d`;
  const sw = (
    <MuiSwitch
      checked={checked}
      onChange={(e) => onChange(e.target.checked, e)}
      disabled={disabled}
      name={name}
      size="small"
      inputProps={{ id: inputId, role: 'switch', 'aria-label': label ? undefined : ariaLabel, 'aria-labelledby': label ? labelId : undefined, 'aria-describedby': [description ? descId : null, field?.describedBy].filter(Boolean).join(' ') || undefined } as Record<string, unknown>}
    />
  );
  // DS §2.4: MUI's small switch is ~40×24; on coarse pointers the wrapper is a <label> for the input, so the whole
  // 44×44 box toggles it.
  const coarseTarget = { [COARSE]: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' } } as const;
  if (!label) {
    return (
      <Box component="label" htmlFor={inputId} className={className} data-testid={testId} sx={{ display: 'inline-flex', cursor: disabled ? 'default' : 'pointer', ...coarseTarget }}>
        {sw}
      </Box>
    );
  }
  return (
    <Box
      component="label"
      htmlFor={inputId}
      className={className}
      data-testid={testId}
      sx={{
        display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: disabled ? 'default' : 'pointer',
        flexDirection: labelPlacement === 'start' ? 'row-reverse' : 'row', justifyContent: labelPlacement === 'start' ? 'space-between' : 'flex-start',
      }}
    >
      <Box component="span" sx={{ display: 'inline-flex', mt: '-2px', ...coarseTarget, [COARSE]: { ...coarseTarget[COARSE], mt: '-12px' } }}>{sw}</Box>
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: '2px', pt: '2px' }}>
        <Box component="span" id={labelId} sx={{ fontSize: typeScale.body[0], lineHeight: `${typeScale.body[1]}px`, color: disabled ? neutral[400] : neutral[800] }}>{label}</Box>
        {description ? <Box component="span" id={descId} sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }}>{description}</Box> : null}
      </Box>
    </Box>
  );
}

export default Switch;

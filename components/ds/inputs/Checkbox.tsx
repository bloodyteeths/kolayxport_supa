// components/ds/inputs/Checkbox.tsx — DS §4.6 standard checkbox with an optional label and description.
import { useId, type ChangeEvent } from 'react';
import MuiCheckbox from '@mui/material/Checkbox';
import Box from '@mui/material/Box';
import { neutral, type as typeScale } from '@/lib/ds/tokens';
import { COARSE, useFieldContext } from './_shared';
import type { DsBaseProps } from './types';

export interface CheckboxProps extends DsBaseProps {
  checked: boolean;
  onChange: (checked: boolean, event: ChangeEvent<HTMLInputElement>) => void;
  label?: string;
  description?: string;
  indeterminate?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  /** Required when there is no visible label (e.g. row selection). */
  'aria-label'?: string;
}

export function Checkbox({
  checked, onChange, label, description, indeterminate, disabled, id, name, className, 'data-testid': testId,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const field = useFieldContext();
  const inputId = id ?? field?.id;
  const uid = useId().replace(/:/g, '');
  const labelId = `${uid}-l`;
  const descId = `${uid}-d`;
  const box = (
    <MuiCheckbox
      checked={checked}
      indeterminate={indeterminate}
      onChange={(e) => onChange(e.target.checked, e)}
      disabled={disabled}
      name={name}
      size="small"
      inputProps={{ id: inputId, 'aria-label': label ? undefined : ariaLabel, 'aria-labelledby': label ? labelId : undefined, 'aria-describedby': [description ? descId : null, field?.describedBy].filter(Boolean).join(' ') || undefined } as Record<string, unknown>}
      sx={{ p: '6px', m: '-6px', [COARSE]: { p: '12px', m: '-12px' } }}
    />
  );
  if (!label) return <Box component="span" className={className} data-testid={testId} sx={{ display: 'inline-flex' }}>{box}</Box>;
  return (
    <Box
      component="label"
      htmlFor={inputId}
      className={className}
      data-testid={testId}
      sx={{ display: 'inline-flex', alignItems: 'flex-start', gap: '8px', cursor: disabled ? 'default' : 'pointer', py: '4px' }}
    >
      <Box component="span" sx={{ display: 'inline-flex', mt: '-1px', ml: '6px' }}>{box}</Box>
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: '2px', ml: '6px' }}>
        <Box component="span" id={labelId} sx={{ fontSize: typeScale.body[0], lineHeight: `${typeScale.body[1]}px`, color: disabled ? neutral[400] : neutral[800] }}>{label}</Box>
        {description ? <Box component="span" id={descId} sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }}>{description}</Box> : null}
      </Box>
    </Box>
  );
}

export default Checkbox;

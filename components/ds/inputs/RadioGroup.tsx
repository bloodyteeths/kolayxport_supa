// components/ds/inputs/RadioGroup.tsx — DS §4.6: plain radio list (RadioCards for the card form).
import { useId } from 'react';
import MuiRadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { neutral, type as typeScale } from '@/lib/ds/tokens';
import { COARSE, useFieldContext } from './_shared';
import type { DsBaseProps } from './types';

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface RadioGroupProps<T extends string> extends DsBaseProps {
  value: T | null;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  name?: string;
  direction?: 'column' | 'row';
  'aria-label'?: string;
}

export function RadioGroup<T extends string>({
  value, onChange, options, name, direction = 'column', className, 'data-testid': testId, 'aria-label': ariaLabel,
}: RadioGroupProps<T>) {
  const field = useFieldContext();
  const auto = useId().replace(/:/g, '');
  const groupName = name ?? `radio-${auto}`;
  return (
    <MuiRadioGroup
      name={groupName}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value as T)}
      className={className}
      data-testid={testId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : field?.labelId}
      aria-describedby={field?.describedBy}
      sx={{ display: 'flex', flexDirection: direction, gap: direction === 'row' ? '16px' : '8px', flexWrap: 'wrap' }}
    >
      {options.map((o) => {
        const id = `${groupName}-${o.value}`;
        const row = (
          <Box
            key={o.value}
            component="label"
            htmlFor={id}
            sx={{ display: 'inline-flex', alignItems: 'flex-start', gap: '8px', cursor: o.disabled ? 'default' : 'pointer' }}
          >
            <Radio value={o.value} disabled={o.disabled} size="small" inputProps={{ id }} sx={{ p: '6px', m: '-6px', ml: 0, mt: '-5px', [COARSE]: { p: '12px', m: '-12px' } }} />
            <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <Box component="span" sx={{ fontSize: typeScale.body[0], lineHeight: `${typeScale.body[1]}px`, color: o.disabled ? neutral[400] : neutral[800] }}>{o.label}</Box>
              {o.description ? <Box component="span" sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }}>{o.description}</Box> : null}
            </Box>
          </Box>
        );
        return o.disabled && o.disabledReason ? <Tooltip key={o.value} title={o.disabledReason}>{row}</Tooltip> : row;
      })}
    </MuiRadioGroup>
  );
}

export default RadioGroup;

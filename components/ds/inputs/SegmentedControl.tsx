// components/ds/inputs/SegmentedControl.tsx — DS §4.6: 2–4 options, one choice. Never for filters or status views.
import { useRef, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { neutral, accent, control, radius, type as typeScale, motion, elevation } from '@/lib/ds/tokens';
import { COARSE, focusVisibleSx, useFieldContext } from './_shared';
import { ICON_STROKE, type LucideIcon } from './_icons';
import type { DsBaseProps, FieldSize } from './types';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Show only the icon; the label stays for screen readers. */
  iconOnly?: boolean;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> extends DsBaseProps {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: FieldSize;
  /** Accessible name of the group. */
  'aria-label'?: string;
  fullWidth?: boolean;
}

export function SegmentedControl<T extends string>({
  value, onChange, options, size = 'sm', fullWidth, className, 'data-testid': testId, 'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const field = useFieldContext();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const idx = enabled.findIndex((o) => o.value === value);
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % enabled.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + enabled.length) % enabled.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = enabled.length - 1;
    const opt = enabled[next];
    if (!opt) return;
    onChange(opt.value);
    refs.current[options.indexOf(opt)]?.focus();
  };

  const h = control[size];
  return (
    <Box
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : field?.labelId}
      aria-describedby={field?.describedBy}
      onKeyDown={onKey}
      className={className}
      data-testid={testId}
      sx={{
        display: fullWidth ? 'flex' : 'inline-flex',
        p: '2px',
        gap: '2px',
        borderRadius: `${radius.sm}px`,
        backgroundColor: neutral[100],
        height: h,
        [COARSE]: { height: 36 }, // touch: 36px (44px switches dominated small headers); segments are wide enough to hit
      }}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        const Icon = o.icon;
        return (
          <ButtonBase
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            role="radio"
            aria-checked={selected}
            aria-label={o.iconOnly ? o.label : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            sx={{
              flex: fullWidth ? 1 : undefined,
              gap: '6px',
              px: '10px',
              borderRadius: `${radius.sm - 2}px`,
              fontSize: typeScale.label[0],
              fontWeight: typeScale.label[2],
              color: selected ? neutral[900] : neutral[600],
              backgroundColor: selected ? neutral[0] : 'transparent',
              boxShadow: selected ? elevation.e1 : 'none',
              transition: `background-color ${motion.fast}ms ${motion.ease}, color ${motion.fast}ms ${motion.ease}`,
              '&:hover': { color: selected ? neutral[900] : neutral[800] },
              '&.Mui-disabled': { color: neutral[400] },
              ...focusVisibleSx,
              '&:focus-visible': { outline: 'none', boxShadow: `0 0 0 2px ${accent[500]}` },
            }}
          >
            {Icon ? <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden /> : null}
            {o.iconOnly ? null : <span>{o.label}</span>}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

export default SegmentedControl;

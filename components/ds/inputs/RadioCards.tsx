// components/ds/inputs/RadioCards.tsx — DS §4.6: one choice among a few rich options (plan, carrier fallback).
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { neutral, accent, radius, type as typeScale, motion } from '@/lib/ds/tokens';
import { focusVisibleSx, useFieldContext } from './_shared';
import type { DsBaseProps } from './types';

export interface RadioCardOption<T extends string> {
  value: T;
  title: string;
  description?: string;
  /** Right side: a price, a pill, a count. */
  trailing?: ReactNode;
  /** Brand slot (DS `brand?`): pass `<LogoTile brand="ups" size={24} />`. */
  leading?: ReactNode;
  /** Rendered when set; the card is disabled and the reason is shown under the title. */
  disabledReason?: string;
}

export interface RadioCardsProps<T extends string> extends DsBaseProps {
  value: T | null;
  onChange: (value: T) => void;
  options: RadioCardOption<T>[];
  columns?: 1 | 2 | 3;
  'aria-label'?: string;
}

export function RadioCards<T extends string>({
  value, onChange, options, columns = 1, className, 'data-testid': testId, 'aria-label': ariaLabel,
}: RadioCardsProps<T>) {
  const field = useFieldContext();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId().replace(/:/g, '');
  const enabled = options.filter((o) => !o.disabledReason);
  const selectedIdx = options.findIndex((o) => o.value === value && !o.disabledReason);
  // Roving tab stop: the selected card, else the first ENABLED card (never a disabled one).
  const focusIdx = selectedIdx >= 0 ? selectedIdx : Math.max(0, options.findIndex((o) => !o.disabledReason));

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key) || enabled.length === 0) return;
    e.preventDefault();
    const cur = enabled.findIndex((o) => o.value === value);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    // Nothing selected: forward keys land on the first card, backward keys on the last.
    const next = cur === -1
      ? enabled[step === 1 ? 0 : enabled.length - 1]
      : enabled[(cur + step + enabled.length) % enabled.length];
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  };

  return (
    <Box
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : field?.labelId}
      aria-describedby={field?.describedBy}
      onKeyDown={onKey}
      className={className}
      data-testid={testId}
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${columns}, minmax(0, 1fr))` }, gap: '8px' }}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        const disabled = Boolean(o.disabledReason);
        const descId = `${base}-${i}-d`;
        return (
          <ButtonBase
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            aria-describedby={o.description || o.disabledReason ? descId : undefined}
            tabIndex={i === focusIdx ? 0 : -1}
            onClick={() => { if (!disabled) onChange(o.value); }}
            sx={{
              display: 'flex', alignItems: 'flex-start', gap: '12px', textAlign: 'left', justifyContent: 'flex-start',
              p: '12px 16px', borderRadius: `${radius.md}px`,
              border: `1px solid ${selected ? accent[600] : neutral[200]}`,
              boxShadow: selected ? `inset 0 0 0 1px ${accent[600]}` : 'none',
              backgroundColor: selected ? accent[50] : neutral[0],
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: `border-color ${motion.fast}ms ${motion.ease}, background-color ${motion.fast}ms ${motion.ease}`,
              '&:hover': disabled ? undefined : { borderColor: selected ? accent[600] : neutral[300] },
              ...focusVisibleSx,
            }}
          >
            <Box
              aria-hidden
              sx={{
                mt: '2px', width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: `1px solid ${selected ? accent[600] : neutral[300]}`,
                boxShadow: selected ? `inset 0 0 0 4px ${accent[600]}` : 'none',
                backgroundColor: neutral[0],
              }}
            />
            {o.leading ? <Box sx={{ display: 'inline-flex', flexShrink: 0 }}>{o.leading}</Box> : null}
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <Box component="span" sx={{ fontSize: typeScale.titleSm[0], lineHeight: `${typeScale.titleSm[1]}px`, fontWeight: 500, color: neutral[800] }}>{o.title}</Box>
              {o.description || o.disabledReason ? (
                <Box component="span" id={descId} sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }}>
                  {o.disabledReason ?? o.description}
                </Box>
              ) : null}
            </Box>
            {o.trailing ? <Box sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: neutral[800], fontSize: 14 }}>{o.trailing}</Box> : null}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

export default RadioCards;

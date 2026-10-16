// components/ds/format/CopyText.tsx — DS §3.12/§4.4 (absorbs ui/CopyButton). IDs, tracking numbers, emails:
// the text plus a copy button shown on hover/focus (always shown on touch). Copy feedback is the check icon
// and a polite live-region message, no toast (DS §3.14: no toast when the result is visible).
// Safe inside clickable rows: click, mousedown and Enter/Space do not bubble (Escape and Tab do).

import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { Box, ButtonBase, Tooltip } from '@mui/material';
import { useTranslations } from 'next-intl';
import { copyText } from '@/lib/hooks/useCopy';
import { ICON_STROKE, iconSize, icons } from '@/lib/ds/icons';
import { focusRing, font, motion, neutral, radius, tone, zIndex } from '@/lib/ds/tokens';

export interface CopyTextProps {
  /** Exact text written to the clipboard. */
  value: string;
  /** What is shown (defaults to `value`). */
  display?: string;
  /** Monospace (IDs, tracking numbers). */
  mono?: boolean;
  /** Max visible characters; longer text ends with "…" and the full value is in the tooltip. */
  truncate?: number;
  /** Show the whole value on as many lines as it needs (personalization, notes) instead of one ellipsised line. */
  wrap?: boolean;
  className?: string;
  'data-testid'?: string;
}

const COPIED_MS = 1500;

export function truncateText(text: string, max?: number): string {
  if (!max || max < 2 || text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function CopyText({ value, display, mono, truncate, wrap, className, 'data-testid': testId }: CopyTextProps) {
  const t = useTranslations('ds.copy');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const shown = display ?? value;
  const visible = truncateText(shown, truncate);
  const Icon = state === 'copied' ? icons.check : icons.copy;

  const stop = (e: SyntheticEvent) => e.stopPropagation();
  // Only the activation keys stay local; Escape and Tab must still reach a parent Modal/Drawer or row.
  const stopActivationKeys = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  };
  const onCopy = async (e: SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await copyText(value);
    setState(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), COPIED_MS);
  };

  const tip = state === 'copied' ? t('copied') : state === 'failed' ? t('failed') : t('action');

  return (
    <Box
      component="span"
      className={className}
      data-testid={testId}
      sx={{
        display: 'inline-flex',
        alignItems: wrap ? 'flex-start' : 'center', // multi-line values: the copy icon sits by the first line
        gap: '4px',
        maxWidth: '100%',
        verticalAlign: 'middle',
        '& .kx-copy-btn': { opacity: 0 },
        '&:hover .kx-copy-btn, &:focus-within .kx-copy-btn, & .kx-copy-btn[data-state="copied"]': { opacity: 1 },
        '@media (pointer: coarse)': { '& .kx-copy-btn': { opacity: 1 } },
      }}
    >
      <Box
        component="span"
        title={visible !== shown ? shown : undefined}
        sx={{
          ...(wrap
            ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
            : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
          ...(mono ? { fontFamily: font.mono, fontVariantNumeric: 'tabular-nums' } : {}),
        }}
      >
        {visible}
      </Box>
      <Tooltip describeChild title={tip} enterDelay={400} slotProps={{ popper: { sx: { zIndex: zIndex.tooltip } } }}>
        <ButtonBase
          className="kx-copy-btn"
          data-state={state}
          aria-label={t('label', { value: shown })}
          onClick={onCopy}
          onMouseDown={stop}
          onKeyDown={stopActivationKeys}
          sx={{
            flex: '0 0 auto',
            width: 24,
            height: 24,
            borderRadius: `${radius.sm}px`,
            color: state === 'copied' ? tone.success.fg : neutral[500],
            transition: `opacity ${motion.fast}ms ${motion.ease}, background-color ${motion.fast}ms ${motion.ease}`,
            '&:hover': { bgcolor: neutral[100], color: neutral[700] },
            '&.Mui-focusVisible': { boxShadow: focusRing },
            // Touch: keep the 24px icon in the layout and give it an invisible 44px hit area, so every copyable
            // line (order number, SKU, name) doesn't grow to 44px tall on phones.
            '@media (pointer: coarse)': { position: 'relative', '&::after': { content: '""', position: 'absolute', inset: '-10px' } },
          }}
        >
          <Icon size={iconSize.control} strokeWidth={ICON_STROKE} aria-hidden />
        </ButtonBase>
      </Tooltip>
      <Box
        component="span"
        role="status"
        aria-live="polite"
        sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {state === 'copied' ? t('copied') : state === 'failed' ? t('failed') : ''}
      </Box>
    </Box>
  );
}

export default CopyText;

// components/ds/format/Money.tsx — DS §3.12, §4.4 (+ settings §14 `wholeIfIntegral`).
// Locale follows the UI, currency follows the data. Symbol, never the ISO code. Mixed currencies are never
// summed: use `fmtMoneyTotals` / `useFormatters().moneyTotals`.

import { Box, Tooltip } from '@mui/material';
import { useTranslations } from 'next-intl';
import { COMPACT_MIN, useFormatters } from '@/lib/format';
import { tone, zIndex } from '@/lib/ds/tokens';

export interface MoneyProps {
  amount: number | null | undefined;
  currency: string | null | undefined;
  /** KPI tiles and chart axes only; applied at ≥ 100,000, full value in the tooltip. */
  compact?: boolean;
  /** Converted value: "≈ " prefix, tooltip = `fxNote` (or a generic "Converted amount"). */
  approx?: boolean;
  /** Tooltip for converted values: "Converted from USD at exchangerate-api.com rates (15 Oct 10:00)". */
  fxNote?: string;
  /** Signed amount: "+" / "-" with success-fg / danger-fg text (Transactions). */
  sign?: boolean;
  /** "₺2.499" instead of "₺2.499,00" when the amount has no cents (price lists). */
  wholeIfIntegral?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Money({
  amount,
  currency,
  compact,
  approx,
  fxNote,
  sign,
  wholeIfIntegral,
  className,
  'data-testid': testId,
}: MoneyProps) {
  const f = useFormatters();
  const t = useTranslations('ds.format');
  const text = f.money(amount, currency, { compact, approx, sign, wholeIfIntegral });
  const valid = typeof amount === 'number' && Number.isFinite(amount);
  const color = sign && valid && amount !== 0 ? (amount > 0 ? tone.success.fg : tone.danger.fg) : undefined;

  const tips: string[] = [];
  if (valid && compact && Math.abs(amount) >= COMPACT_MIN) tips.push(f.money(amount, currency, { sign }));
  if (approx) tips.push(fxNote || t('approx'));

  const node = (
    <Box
      component="span"
      className={className}
      data-testid={testId}
      sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', ...(color ? { color } : {}) }}
    >
      {text}
    </Box>
  );
  if (tips.length === 0) return node;
  return (
    <Tooltip describeChild title={tips.join(' · ')} enterDelay={400} slotProps={{ popper: { sx: { zIndex: zIndex.tooltip } } }}>
      {node}
    </Tooltip>
  );
}

export default Money;

// components/ds/inputs/RateList.tsx — DS §3.16 / §4.6: carrier & service rates in one radio list
// (logo · service · transit · price, "Recommended" = cheapest on-time). Unavailable rates stay listed with
// their reason. Live-rate failure: inline error + Retry, rates still selectable without a price.
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Skeleton from '@mui/material/Skeleton';
import { useTranslations } from 'next-intl';
import { neutral, accent, tone, radius, type as typeScale } from '@/lib/ds/tokens';
import { COARSE, focusVisibleSx, useIntlLocale } from './_shared';
import { IconError, ICON_STROKE } from './_icons';
import { Button } from './Button';
import type { DsBaseProps } from './types';

export type CarrierKey = 'fedex' | 'ups' | 'dhl' | 'shippo';

export interface Rate {
  id: string;
  carrier: CarrierKey;
  service: string;
  /** Days, or a [min, max] range. */
  transitDays?: number | [number, number];
  amount?: number;
  currency?: string;
  recommended?: boolean;
  /** Set → the row is disabled and shows this reason instead of transit ("Connect UPS in Settings"). */
  unavailableReason?: string;
  /** Warning line on an ENABLED row, shown instead of transit ("Couldn't check UPS"; orders §6.3). */
  note?: string;
  /** Link after the reason/note, clickable even when the row is disabled
   *  ({ label: 'Connect UPS in Settings', href: '/ayarlar?tab=connections&provider=ups' }). */
  action?: { label: string; href: string };
}

export interface RateListProps extends DsBaseProps {
  value: string | null;
  onChange: (rateId: string) => void;
  rates: Rate[];
  state: 'loading' | 'ready' | 'error';
  onRetry?: () => void;
  /** Carrier mark slot: pass `(c) => <LogoTile brand={c} size={24} />` (LogoTile is M1-d). */
  renderCarrier?: (carrier: CarrierKey) => ReactNode;
  'aria-label'?: string;
}

export function RateList({
  value, onChange, rates, state, onRetry, renderCarrier, className, 'data-testid': testId, 'aria-label': ariaLabel,
}: RateListProps) {
  const t = useTranslations('ds.inputs.rates');
  const locale = useIntlLocale();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const available = rates.filter((r) => !r.unavailableReason);

  const transit = (r: Rate) => {
    if (r.transitDays == null) return null;
    if (Array.isArray(r.transitDays)) return t('transitRange', { min: r.transitDays[0], max: r.transitDays[1] });
    return t('transit', { count: r.transitDays });
  };
  const price = (r: Rate) =>
    r.amount != null && r.currency
      ? new Intl.NumberFormat(locale, { style: 'currency', currency: r.currency }).format(r.amount)
      : null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key) || available.length === 0) return;
    e.preventDefault();
    const cur = available.findIndex((r) => r.id === value);
    const next = available[(cur + (e.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length];
    onChange(next.id);
    refs.current[rates.indexOf(next)]?.focus();
  };

  if (state === 'loading') {
    return (
      <Box className={className} data-testid={testId} aria-busy="true" aria-label={t('loading')} sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={56} />)}
      </Box>
    );
  }

  const focusIdx = Math.max(0, rates.findIndex((r) => r.id === value && !r.unavailableReason));

  return (
    <Box className={className} data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {state === 'error' ? (
        <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 13, color: tone.danger.fg }}>
          <IconError size={14} strokeWidth={ICON_STROKE} aria-hidden />
          <span>{t('error')}</span>
          {onRetry ? <Button variant="ghost" size="sm" onClick={onRetry}>{t('retry')}</Button> : null}
        </Box>
      ) : null}
      {rates.length === 0 && state === 'ready' ? (
        <Box sx={{ fontSize: 13, color: neutral[500] }}>{t('empty')}</Box>
      ) : null}
      <Box role="radiogroup" aria-label={ariaLabel ?? t('label')} onKeyDown={onKey} sx={{ display: 'flex', flexDirection: 'column', border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px`, overflow: 'hidden', '&:empty': { display: 'none' } }}>
        {rates.map((r, i) => {
          const selected = r.id === value;
          const disabled = Boolean(r.unavailableReason);
          const p = price(r);
          return (
            <Box key={r.id} sx={{ display: 'flex', flexDirection: 'column', borderTop: i === 0 ? 'none' : `1px solid ${neutral[100]}`, backgroundColor: selected ? accent[50] : neutral[0] }}>
            <ButtonBase
              ref={(el) => { refs.current[i] = el; }}
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled || undefined}
              tabIndex={i === focusIdx ? 0 : -1}
              onClick={() => { if (!disabled) onChange(r.id); }}
              sx={{
                display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'flex-start', textAlign: 'left',
                minHeight: 56, px: '16px', py: '8px',
                backgroundColor: selected ? accent[50] : neutral[0],
                boxShadow: selected ? `inset 2px 0 0 ${accent[600]}` : 'none',
                opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
                '&:hover': disabled ? undefined : { backgroundColor: selected ? accent[50] : neutral[50] },
                ...focusVisibleSx,
              }}
            >
              <Box aria-hidden sx={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `1px solid ${selected ? accent[600] : neutral[300]}`, boxShadow: selected ? `inset 0 0 0 4px ${accent[600]}` : 'none' }} />
              {renderCarrier ? <Box sx={{ display: 'inline-flex', flexShrink: 0 }}>{renderCarrier(r.carrier)}</Box> : null}
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <Box component="span" sx={{ fontSize: 14, fontWeight: 500, color: neutral[800] }}>{r.service}</Box>
                  {r.recommended && !disabled ? (
                    <Box component="span" sx={{ fontSize: typeScale.micro[0], lineHeight: `${typeScale.micro[1]}px`, fontWeight: 500, px: '6px', py: '2px', borderRadius: `${radius.full}px`, backgroundColor: tone.info.bg, color: tone.info.fg }}>
                      {t('recommended')}
                    </Box>
                  ) : null}
                </Box>
                {!disabled && r.note ? (
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 12, lineHeight: '16px', color: tone.warning.fg }}>
                    <IconError size={12} strokeWidth={ICON_STROKE} aria-hidden />
                    {r.note}
                  </Box>
                ) : (
                  <Box component="span" sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }}>
                    {r.unavailableReason ?? transit(r)}
                  </Box>
                )}
              </Box>
              {p ? <Box component="span" sx={{ fontSize: 14, fontWeight: 500, color: neutral[800], fontVariantNumeric: 'tabular-nums' }}>{p}</Box> : null}
            </ButtonBase>
            {r.action ? (
              // Outside the radio (no link inside a button), so it stays clickable on a disabled row.
              <Box
                component={NextLink}
                href={r.action.href}
                onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}
                sx={{
                  alignSelf: 'flex-start', ml: '44px', mt: '-6px', mb: '8px', fontSize: 12, lineHeight: '16px', fontWeight: 500,
                  color: accent[600], textDecoration: 'none', borderRadius: '4px', '&:hover': { textDecoration: 'underline' },
                  ...focusVisibleSx,
                  // The radiogroup clips overflow, so the 44px coarse target is real size, not a hit-slop.
                  [COARSE]: { display: 'inline-flex', alignItems: 'center', minHeight: 44, minWidth: 44, mt: '-8px', mb: 0 },
                }}
              >
                {r.action.label}
              </Box>
            ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export default RateList;

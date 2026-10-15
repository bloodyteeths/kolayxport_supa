// components/domain/pricing/IntervalCurrencyControls.tsx — "( Monthly | Yearly · 2 months free )" and
// "( ₺ TRY | $ USD )" (settings §10.2: SegmentedControl md 40; §10.3: full width on mobile). A signed-in
// account with a billing currency sees the currency toggle locked to it, with the tooltip "Your account is
// billed in TRY." (Stripe customers are single-currency).
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { SegmentedControl } from '@/components/ds/inputs';
import { Tooltip } from '@/components/ds/overlay';
import type { Currency, Interval } from '@/lib/billing/types';

export interface IntervalCurrencyControlsProps {
  interval: Interval;
  currency: Currency;
  onInterval: (interval: Interval) => void;
  onCurrency: (currency: Currency) => void;
  /** The account's locked billing currency (null = free choice). */
  lockedCurrency: Currency | null;
}

export function IntervalCurrencyControls({ interval, currency, onInterval, onCurrency, lockedCurrency }: IntervalCurrencyControlsProps) {
  const t = useTranslations('marketing.pricingV2');
  const currencyControl = (
    <Box sx={{ width: { xs: '100%', sm: 'auto' } }} data-testid="pricing-currency" data-locked={lockedCurrency ? 'true' : 'false'}>
      <SegmentedControl<Currency>
        size="md"
        fullWidth
        aria-label={t('currency.label')}
        value={lockedCurrency ?? currency}
        onChange={onCurrency}
        options={[
          { value: 'TRY', label: t('currency.try'), disabled: !!lockedCurrency && lockedCurrency !== 'TRY' },
          { value: 'USD', label: t('currency.usd'), disabled: !!lockedCurrency && lockedCurrency !== 'USD' },
        ]}
      />
    </Box>
  );
  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: '8px', sm: '16px' }, alignItems: { sm: 'center' } }}>
      <Box sx={{ width: { xs: '100%', sm: 'auto' } }} data-testid="pricing-interval">
        <SegmentedControl<Interval>
          size="md"
          fullWidth
          aria-label={t('interval.label')}
          value={interval}
          onChange={onInterval}
          options={[
            { value: 'month', label: t('interval.monthly') },
            { value: 'year', label: t('interval.yearly') },
          ]}
        />
      </Box>
      {lockedCurrency ? (
        <Tooltip title={t('currency.locked', { currency: lockedCurrency })}>{currencyControl}</Tooltip>
      ) : (
        currencyControl
      )}
    </Box>
  );
}

export default IntervalCurrencyControls;

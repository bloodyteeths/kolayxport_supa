/**
 * OrderPanel › Costs (orders §2.4, §5): the carrier cost from the carrier invoice (`MoneyField` +
 * `CurrencySelect`, default = the account base currency, never a hard "USD"). Saved on blur and on a
 * currency change through `PATCH /api/orders/:id/shipping-cost { cost, currency }`; an empty field clears it.
 * No profit in v1 (marketplace fees per order are unknown; P6), it ships with Finance (M9).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { FormField } from '@/components/ds/inputs/FormField';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { CurrencySelect } from '@/components/ds/inputs/CurrencySelect';
import type { CarrierCost, OrderRow } from '@/lib/orders/types';
import { CARRIER_COST_CURRENCIES } from './useOrderActions';

export interface CostsSectionProps {
  row: OrderRow;
  onSave: (amount: number | null, currency: string | null) => Promise<CarrierCost | null | undefined>;
  saving?: boolean;
  /** The seller's base currency (TRY for a TR seller). */
  baseCurrency?: string;
}

const API_CURRENCIES = CARRIER_COST_CURRENCIES as readonly string[];

/** Currency shown for a cost: the stored one when the API accepts it, else the base currency. */
export function costCurrency(cost: CarrierCost | null, baseCurrency: string): string {
  const c = (cost?.currency || '').toUpperCase();
  if (API_CURRENCIES.includes(c)) return c;
  return API_CURRENCIES.includes(baseCurrency) ? baseCurrency : 'TRY';
}

export function CostsSection({ row, onSave, saving, baseCurrency = 'TRY' }: CostsSectionProps) {
  const t = useTranslations('orders.panel');
  const stored = row.carrierCost;
  const [amount, setAmount] = useState<number | null>(stored?.amount ?? null);
  const [currency, setCurrency] = useState<string>(costCurrency(stored, baseCurrency));
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef<{ amount: number | null; currency: string }>({ amount: stored?.amount ?? null, currency: costCurrency(stored, baseCurrency) });

  // Adopt server data on order switch / revalidation.
  useEffect(() => {
    const next = { amount: stored?.amount ?? null, currency: costCurrency(stored, baseCurrency) };
    savedRef.current = next;
    setAmount(next.amount);
    setCurrency(next.currency);
    setError(null);
    // baseCurrency is handled below, so settings arriving late never wipe a typed amount.
  }, [row.id, stored?.amount, stored?.currency]);

  // The base currency resolves after the account settings load: follow it while no stored currency applies.
  useEffect(() => {
    const c = costCurrency(stored, baseCurrency);
    savedRef.current = { ...savedRef.current, currency: c };
    setCurrency(c);
  }, [baseCurrency]);

  const persist = async (a: number | null, c: string) => {
    if (a != null && (!Number.isFinite(a) || a < 0 || a > 100000)) {
      setError(t('carrierCostInvalid'));
      return;
    }
    setError(null);
    const prev = savedRef.current;
    if (prev.amount === a && (a == null || prev.currency === c)) return;
    const result = await onSave(a, a == null ? null : c);
    if (result === undefined) return; // failed: the toast said so; the field keeps the typed value
    savedRef.current = { amount: result?.amount ?? null, currency: costCurrency(result, c) };
  };

  return (
    <SidePanelSection id="order-costs" title={t('costs')}>
      <FormField label={t('carrierCost')} htmlFor="order-carrier-cost" helper={t('carrierCostHint')} error={error} width="medium">
        <Box sx={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <MoneyField
              id="order-carrier-cost"
              value={amount}
              onChange={setAmount}
              onBlur={() => void persist(amount, currency)}
              currency={currency}
              min={0}
              max={100000}
              disabled={saving}
              data-testid="carrier-cost"
            />
          </Box>
          <Box sx={{ width: 128, flexShrink: 0 }}>
            <CurrencySelect
              value={currency}
              onChange={(c) => {
                const next = c || currency;
                setCurrency(next);
                if (amount != null) void persist(amount, next);
              }}
              currencies={[...API_CURRENCIES]}
              defaultCurrency={baseCurrency}
              disabled={saving}
              aria-label={t('carrierCostCurrency')}
              data-testid="carrier-cost-currency"
            />
          </Box>
        </Box>
      </FormField>
    </SidePanelSection>
  );
}

export default CostsSection;

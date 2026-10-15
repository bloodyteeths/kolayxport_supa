// components/ds/inputs/MoneyField.tsx — DS §4.6: NumberField + currency. The currency symbol is the prefix
// adornment (never in the label, §3.7); fraction digits follow the currency (JPY 0, USD/TRY 2).
import { NumberField, type NumberFieldProps } from './NumberField';
import { useIntlLocale } from './_shared';
import { currencyDecimals, currencySymbol } from './_number';

export interface MoneyFieldProps extends Omit<NumberFieldProps, 'decimals' | 'fixedDecimals' | 'prefix' | 'unit'> {
  /** ISO 4217, e.g. "USD", "TRY". */
  currency: string;
  /** Show the ISO code after the amount as well (when the currency is not obvious). */
  showCode?: boolean;
}

export function MoneyField({ currency, showCode, min = 0, step, ...rest }: MoneyFieldProps) {
  const locale = useIntlLocale();
  const decimals = currencyDecimals(currency);
  return (
    <NumberField
      {...rest}
      min={min}
      step={step ?? 1}
      decimals={decimals}
      fixedDecimals
      prefix={currencySymbol(currency, locale)}
      unit={showCode ? currency : undefined}
    />
  );
}

export default MoneyField;

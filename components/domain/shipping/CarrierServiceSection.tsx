/**
 * CreateLabelPanel › Carrier & service (orders §2.5, §6.3): FedEx, UPS and DHL eCommerce services in one
 * `RateList` with real logos. Unavailable carriers stay listed with their reason and a Settings link.
 * v1 has no rates API (§0.1): no price, no "Recommended", and the caption "The price shows on the carrier
 * invoice." (DS §3.16 fallback). When A7 lands, the caller passes `amounts` and the list shows prices.
 */
import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { RateList, type Rate } from '@/components/ds/inputs/RateList';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { neutral as n } from '@/lib/ds/tokens';
import { CARRIER_NAME, carrierSettingsHref, type RateRow } from '@/lib/shipping/carriers';

export interface CarrierServiceSectionProps {
  rows: readonly RateRow[];
  /** `rateId(carrier, service)`. */
  value: string | null;
  onChange: (rateId: string) => void;
  /** Forces a reason on rows of a carrier (bulk: DHL eCommerce when not every order is TR). */
  overrideReason?: Partial<Record<RateRow['carrier'], string>>;
  /** Loading connections: the rows render as skeletons. */
  loading?: boolean;
  /** Future A7 amounts per rate id. */
  amounts?: Record<string, { amount: number; currency: string; recommended?: boolean }>;
}

export function CarrierServiceSection({ rows, value, onChange, overrideReason, loading, amounts }: CarrierServiceSectionProps) {
  const t = useTranslations('createLabel');
  const rates: Rate[] = useMemo(() => rows.map((r) => {
    const carrier = CARRIER_NAME[r.carrier];
    const e = r.eligibility;
    const forced = overrideReason?.[r.carrier];
    const reason = forced
      ?? (e.reason === 'domesticOnly' ? t('unavailable.domesticOnly')
        : e.reason === 'notConnected' ? t('unavailable.notConnected', { carrier })
          : e.reason === 'incomplete' ? t('unavailable.incomplete', { carrier })
            : undefined);
    const link = !forced && (e.reason === 'notConnected' || e.reason === 'incomplete')
      ? { label: t('openSettings'), href: carrierSettingsHref(r.carrier) }
      : undefined;
    const name = r.service.i18nKey ? `${CARRIER_NAME.dhl} · ${t(`dhl.service.${r.service.i18nKey}`)}` : r.service.name;
    const a = amounts?.[r.id];
    return {
      id: r.id,
      carrier: r.carrier,
      service: name,
      transitDays: r.service.transitDays,
      ...(a ? { amount: a.amount, currency: a.currency, recommended: a.recommended } : {}),
      ...(reason ? { unavailableReason: reason } : {}),
      ...(!reason && e.checkFailed ? { note: t('unavailable.checkFailed', { carrier }) } : {}),
      ...(link ? { action: link } : {}),
    };
  }), [rows, overrideReason, amounts, t]);

  return (
    <SidePanelSection id="label-carrier" title={t('carrier')} data-testid="label-carrier">
      <RateList
        value={value}
        onChange={onChange}
        rates={rates}
        state={loading ? 'loading' : 'ready'}
        renderCarrier={(c) => <LogoTile brand={c} size={24} />}
        aria-label={t('carrier')}
        data-testid="rate-list"
      />
      {!amounts ? <Box sx={{ mt: '8px', fontSize: 12, lineHeight: '16px', color: n[500] }}>{t('noPrice')}</Box> : null}
    </SidePanelSection>
  );
}

export default CarrierServiceSection;

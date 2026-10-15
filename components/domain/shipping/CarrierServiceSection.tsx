/**
 * CreateLabelPanel › Carrier & service (orders §2.5, §6.3): FedEx, UPS and DHL eCommerce services in one
 * `RateList` with real logos. Unavailable carriers stay listed with their reason and a Settings link.
 * v1 has no rates API (§0.1): no price, no "Recommended", and the caption "The price shows on the carrier
 * invoice." (DS §3.16 fallback). When A7 lands, the caller passes `amounts` and the list shows prices.
 * `primary` (usability wave 2026-10-15): only the route's carriers show up front (TR → TR: DHL eCommerce;
 * international: FedEx, UPS); the rest sit behind "Other carriers (n)", which starts open when the selected
 * rate is one of them.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { RateList, type Rate } from '@/components/ds/inputs/RateList';
import { Button } from '@/components/ds/inputs/Button';
import { icons } from '@/lib/ds/icons';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { neutral as n } from '@/lib/ds/tokens';
import { CARRIER_NAME, carrierSettingsHref, type RateRow } from '@/lib/shipping/carriers';
import type { CarrierKey } from '@/lib/shipping/labelDraft';

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
  /** Carriers listed up front; every other row goes behind "Other carriers". Omitted: one flat list. */
  primary?: readonly CarrierKey[];
}

export function CarrierServiceSection({ rows, value, onChange, overrideReason, loading, amounts, primary }: CarrierServiceSectionProps) {
  const t = useTranslations('createLabel');
  const selectedCarrier = rows.find((r) => r.id === value)?.carrier;
  const selectedIsOther = !!primary && !!selectedCarrier && !primary.includes(selectedCarrier);
  const [showOther, setShowOther] = useState(selectedIsOther);
  // A selection that lands in the hidden group (default carrier, remembered rate) opens it.
  useEffect(() => { if (selectedIsOther) setShowOther(true); }, [selectedIsOther]);
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

  const isPrimary = (c: string) => !primary || (primary as readonly string[]).includes(c);
  const main = rates.filter((r) => isPrimary(r.carrier));
  const other = rates.filter((r) => !isPrimary(r.carrier));
  const otherCarriers = Array.from(new Set(other.map((r) => r.carrier)));

  return (
    <SidePanelSection id="label-carrier" title={t('carrier')} data-testid="label-carrier">
      {main.length > 0 ? (
        <RateList
          value={value}
          onChange={onChange}
          rates={main}
          state={loading ? 'loading' : 'ready'}
          renderCarrier={(c) => <LogoTile brand={c} size={24} />}
          aria-label={t('carrier')}
          data-testid="rate-list"
        />
      ) : null}
      {other.length > 0 ? (
        <Box sx={{ mt: main.length > 0 ? '8px' : 0 }}>
          {main.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              trailingIcon={icons.disclosure}
              onClick={() => setShowOther((v) => !v)}
              aria-expanded={showOther}
              aria-controls="label-carrier-other"
              data-testid="carrier-other-toggle"
            >
              {t('otherCarriers', { count: otherCarriers.length })}
            </Button>
          ) : null}
          {showOther || main.length === 0 ? (
            <Box id="label-carrier-other" sx={{ mt: main.length > 0 ? '8px' : 0 }}>
              <RateList
                value={value}
                onChange={onChange}
                rates={other}
                state={loading ? 'loading' : 'ready'}
                renderCarrier={(c) => <LogoTile brand={c} size={24} />}
                aria-label={t('otherCarriers', { count: otherCarriers.length })}
                data-testid={main.length > 0 ? 'rate-list-other' : 'rate-list'}
              />
            </Box>
          ) : null}
        </Box>
      ) : null}
      {!amounts ? <Box sx={{ mt: '8px', fontSize: 12, lineHeight: '16px', color: n[500] }}>{t('noPrice')}</Box> : null}
    </SidePanelSection>
  );
}

export default CarrierServiceSection;

// components/domain/research/shops/AlertSwitches.tsx (research R3-B) — the three alert switches of a watched shop
// (research.md §8.1): new listings · price drop over 10% · sales spike over 2×. Each Switch applies immediately
// (PATCH /api/research/watches/[id] { alertRules }), optimistic with revert + inline error on failure. Alerts arrive
// through the backend's `notify()` (types researchShopNewListings / researchShopPriceDrop / researchShopSalesSpike).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ds/inputs/Switch';
import { neutral as n, tone } from '@/lib/ds/tokens';
import { updateWatchAlerts, type AlertRules, type WatchSummary } from '@/lib/research/hooks/useWatches';
import { ALERT_KEYS, alertOn, withAlert, type AlertKey, type ShopT } from './shopModel';

export type AlertSwitchesProps = {
  watch: WatchSummary;
  /** False until BR-7 ships: the rules save, notifications start later (R3-A `alertsAvailable`). */
  alertsAvailable?: boolean;
  /** After the server accepted the change (revalidate the list). */
  onSaved?: (watch: WatchSummary | null) => void;
  /** Test seam. */
  save?: (id: string, rules: AlertRules) => Promise<WatchSummary | null>;
};

export function AlertSwitches({ watch, alertsAvailable = true, onSaved, save = updateWatchAlerts }: AlertSwitchesProps) {
  const t = useTranslations() as unknown as ShopT;
  const [rules, setRules] = React.useState<AlertRules>(watch.alertRules);
  const [pending, setPending] = React.useState<AlertKey | null>(null);
  const [failed, setFailed] = React.useState(false);

  // A different watch (‹ ›) or a fresh server copy resets the local state.
  const { newListing, priceDropPct, salesSpikeX } = watch.alertRules;
  React.useEffect(() => {
    setRules({ newListing, priceDropPct, salesSpikeX });
    setFailed(false);
  }, [watch.id, newListing, priceDropPct, salesSpikeX]);

  const toggle = async (key: AlertKey, on: boolean) => {
    if (pending) return;
    const prev = rules;
    const next = withAlert(rules, key, on);
    setRules(next);
    setPending(key);
    setFailed(false);
    try {
      const saved = await save(watch.id, next);
      onSaved?.(saved);
    } catch {
      setRules(prev);
      setFailed(true);
    } finally {
      setPending(null);
    }
  };

  const disabled = !watch.capabilities.alerts;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }} data-testid="shop-alerts">
      {ALERT_KEYS.map((key) => (
        <Switch
          key={key}
          checked={alertOn(rules, key)}
          onChange={(on) => void toggle(key, on)}
          label={t(`research.shops.alert.${key}`)}
          disabled={disabled || pending !== null}
          data-testid={`shop-alert-${key}`}
        />
      ))}
      {disabled ? (
        <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>
          {t('research.shops.alertsLegacy')}
        </Typography>
      ) : (
        <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>
          {t(alertsAvailable ? 'research.shops.alertsNote' : 'research.shops.alertsPending')}
        </Typography>
      )}
      {failed ? (
        <Typography variant="caption" component="p" role="alert" sx={{ m: 0, color: tone.danger.fg }} data-testid="shop-alerts-error">
          {t('research.shops.alertsFailed')}
        </Typography>
      ) : null}
    </Box>
  );
}

export default AlertSwitches;

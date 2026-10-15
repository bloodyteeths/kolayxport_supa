// components/domain/overview/SetupChecklist.tsx (overview G6, §2.2, §3.6) — "Get started" card (state A):
// 1 Connect a store → 2 Set your sender address → 3 Create your first label (the CTA switches by carrier and
// order state). Accent progress bar (never green), done rows neutral with a success check and no strike-through.
// Dismiss (✕) hides it for this user for good (`kx.overview.setupDismissed:<uid>`, try/catch storage).
// "Refresh orders" here is a click-only pull (it costs an order sync; the note says so when a limit exists).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { Button } from '@/components/ds/inputs/Button';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { LogoTile } from '@/components/ds/data';
import { icons } from '@/lib/ds/icons';
import { accent, neutral, px, radius, space, tone } from '@/lib/ds/tokens';
import { settingsHref } from '@/lib/nav/links';

export const SETUP_DISMISS_PREFIX = 'kx.overview.setupDismissed:';

export interface SetupFacts {
  /** `useConnections().anyMarketplace` */
  storeConnected: boolean;
  /** First connected store account (step 1 done text). */
  storeName: string | null;
  storeProvider: string | null;
  senderComplete: boolean;
  hasLabel: boolean;
  hasOrders: boolean;
  /** FedEx, UPS or DHL eCommerce (mng) connected. */
  hasCarrier: boolean;
}

export type SetupStepKey = 'connect' | 'sender' | 'label';
export type LabelStepCta = 'carrier' | 'refresh' | 'create';

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
}

/** Pure: the three steps in order. */
export function setupSteps(f: SetupFacts): SetupStep[] {
  return [
    { key: 'connect', done: f.storeConnected },
    { key: 'sender', done: f.senderComplete },
    { key: 'label', done: f.hasLabel },
  ];
}

/** Pure: step 3's CTA — no carrier → connect one; carrier but no orders → refresh; else create a label. */
export function labelStepCta(f: Pick<SetupFacts, 'hasCarrier' | 'hasOrders'>): LabelStepCta {
  if (!f.hasCarrier) return 'carrier';
  if (!f.hasOrders) return 'refresh';
  return 'create';
}

/**
 * Pure: whether the card renders (all inputs loaded, the dismiss flag read, ≥ 1 open step, not dismissed).
 * `dismissed: null` = storage not read yet → hidden, so a dismissed card never flashes on a warm cache.
 */
export function shouldShowSetup(args: { connectionsLoaded: boolean; facts: SetupFacts | null; dismissed: boolean | null }): boolean {
  if (!args.connectionsLoaded || !args.facts || args.dismissed !== false) return false;
  return setupSteps(args.facts).some((s) => !s.done);
}

export function readSetupDismissed(uid: string | null | undefined): boolean {
  if (!uid) return false;
  try {
    return window.localStorage.getItem(SETUP_DISMISS_PREFIX + uid) === '1';
  } catch {
    return false;
  }
}

export function writeSetupDismissed(uid: string | null | undefined): void {
  if (!uid) return;
  try {
    window.localStorage.setItem(SETUP_DISMISS_PREFIX + uid, '1');
  } catch {
    /* storage blocked: the card hides for this session only */
  }
}

// Layout effect on the client: the flag is read before the first paint (no flash either way); SSR-safe.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * `useState` + localStorage for the dismiss flag, read after mount (SSR-safe). Returns null until the flag
 * for this `uid` has been read (`shouldShowSetup` keeps the card hidden meanwhile).
 */
export function useSetupDismissed(uid: string | null | undefined): [boolean | null, () => void] {
  const [state, setState] = React.useState<{ uid: string | null | undefined; dismissed: boolean } | null>(null);
  useIsomorphicLayoutEffect(() => {
    setState({ uid, dismissed: readSetupDismissed(uid) });
  }, [uid]);
  const dismiss = React.useCallback(() => {
    writeSetupDismissed(uid);
    setState({ uid, dismissed: true });
  }, [uid]);
  return [state && state.uid === uid ? state.dismissed : null, dismiss];
}

export interface SetupChecklistProps {
  facts: SetupFacts;
  onDismiss: () => void;
  onRefreshOrders: () => void;
  refreshing: boolean;
  /** `usage.orderSync.limit` (null = unlimited: no quota note). */
  orderSyncLimit: number | null;
  /** Disabled reason for refresh (order syncs paused). */
  refreshDisabledReason?: string;
  /** `ordersHref('to_ship')` */
  toShipHref: string;
}

export function SetupChecklist({ facts, onDismiss, onRefreshOrders, refreshing, orderSyncLimit, refreshDisabledReason, toShipHref }: SetupChecklistProps) {
  const t = useTranslations('overview');
  const steps = setupSteps(facts);
  const done = steps.filter((s) => s.done).length;
  const total = steps.length;
  const Check = icons.check;

  const stepText = (s: SetupStep): { title: string; desc: React.ReactNode; cta: React.ReactNode } => {
    if (s.key === 'connect') {
      return {
        title: t('setup.connect.title'),
        desc: s.done ? (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[1]) }}>
            {facts.storeProvider ? <LogoTile brand={facts.storeProvider} size={16} /> : null}
            {t('setup.connect.doneDesc', { name: facts.storeName ?? '' })}
          </Box>
        ) : (
          t('setup.connect.desc')
        ),
        cta: s.done ? null : (
          <Button variant="secondary" size="sm" href={settingsHref('connections')} data-testid="setup-cta-connect">
            {t('setup.connect.title')}
          </Button>
        ),
      };
    }
    if (s.key === 'sender') {
      return {
        title: t('setup.sender.title'),
        desc: t('setup.sender.desc'),
        cta: s.done ? null : (
          <Button variant="secondary" size="sm" href={settingsHref('senderProfile')} data-testid="setup-cta-sender">
            {t('setup.sender.cta')}
          </Button>
        ),
      };
    }
    const kind = labelStepCta(facts);
    const desc = kind === 'carrier' ? t('setup.label.descNoCarrier') : kind === 'refresh' ? t('setup.label.descNoOrders') : t('setup.label.descReady');
    let cta: React.ReactNode = null;
    if (!s.done) {
      if (kind === 'carrier') {
        cta = (
          <Button variant="secondary" size="sm" href={settingsHref('apiKeys')} data-testid="setup-cta-carrier">
            {t('setup.label.ctaCarrier')}
          </Button>
        );
      } else if (kind === 'refresh') {
        cta = (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: { xs: 'flex-start', sm: 'flex-end' }, gap: px(space[1]) }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefreshOrders}
              loading={refreshing}
              loadingLabel={t('meta.refreshing')}
              disabled={Boolean(refreshDisabledReason)}
              disabledReason={refreshDisabledReason}
              data-testid="setup-cta-refresh"
            >
              {t('attention.refreshOrders')}
            </Button>
            {orderSyncLimit != null ? (
              <Typography variant="caption" sx={{ color: neutral[500] }}>
                {t('setup.quota', { limit: orderSyncLimit })}
              </Typography>
            ) : null}
          </Box>
        );
      } else {
        cta = (
          <Button variant="secondary" size="sm" href={toShipHref} data-testid="setup-cta-create">
            {t('setup.label.ctaCreate')}
          </Button>
        );
      }
    }
    return { title: t('setup.label.title'), desc, cta };
  };

  const header = (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[2]) }}>
      <Typography variant="caption" sx={{ color: neutral[500] }} className="tnum" data-testid="setup-progress">
        {t('setup.progress', { done, total })}
      </Typography>
      <IconButton icon={icons.close} label={t('setup.hide')} size="sm" onClick={onDismiss} data-testid="setup-dismiss" />
    </Box>
  );

  return (
    <Section variant="card" title={t('setup.title')} headerSlot={header} data-testid="overview-setup">
      <Box
        role="progressbar"
        aria-label={t('setup.progress', { done, total })}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        sx={{ height: 4, borderRadius: px(radius.full), bgcolor: neutral[100], overflow: 'hidden', mb: px(space[3]) }}
      >
        <Box sx={{ width: `${(done / total) * 100}%`, height: '100%', bgcolor: accent[600] }} />
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {steps.map((s, i) => {
          const { title, desc, cta } = stepText(s);
          return (
            <Box
              component="li"
              key={s.key}
              data-testid={`setup-step-${s.key}`}
              data-done={s.done ? 'true' : 'false'}
              sx={{
                display: 'flex',
                alignItems: { xs: 'flex-start', sm: 'center' },
                flexDirection: { xs: 'column', sm: 'row' },
                gap: px(space[3]),
                py: px(space[3]),
                borderTop: i === 0 ? 'none' : `1px solid ${neutral[100]}`,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: px(space[3]), flex: 1, minWidth: 0 }}>
                <Box
                  aria-hidden
                  sx={{
                    width: 20,
                    height: 20,
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: px(radius.full),
                    fontSize: 12,
                    fontWeight: 600,
                    color: s.done ? neutral[0] : neutral[600],
                    bgcolor: s.done ? tone.success.solid : neutral[100],
                  }}
                >
                  {s.done ? <Check size={14} strokeWidth={2.5} /> : i + 1}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="titleSm" component="p" sx={{ m: 0, color: s.done ? neutral[500] : neutral[900] }}>
                    {title}
                  </Typography>
                  <Typography variant="dense" component="div" sx={{ color: neutral[500] }}>
                    {desc}
                  </Typography>
                </Box>
              </Box>
              {cta ? <Box sx={{ flexShrink: 0, pl: { xs: '32px', sm: 0 } }}>{cta}</Box> : null}
            </Box>
          );
        })}
      </Box>
    </Section>
  );
}

export default SetupChecklist;

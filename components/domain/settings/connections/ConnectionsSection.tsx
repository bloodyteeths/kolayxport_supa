/**
 * Settings › Connections (`?tab=connections`, settings-billing-pricing §4). The tab body Group A's
 * SettingsPage renders under its section nav. Renders at once from its own hooks (no settings skeleton):
 * `useConnections()` (tiles), `/api/integrations/amazon/status` (Amazon panel), `/api/user/settings`
 * (credential panels, shared SWR key), `useEntitlement()` (store meter + upsell gate).
 *
 * URL contract (read here; Group A keeps `?tab=` and the OAuth toast block):
 * - `&provider=<id>`: opens that provider's panel; panel-less providers (eBay, Wix, Hepsiburada, Chrome)
 *   scroll into view with the 1.5s focus ring, and a flagged tile's "Reconnect" gets focus. Nothing
 *   starts an OAuth flow by itself. The param is removed when that panel closes.
 * - `&limit=connectedStore`: opens the store-limit Modal once; the param is stripped after showing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { Section, useIsMobile } from '@/components/ds/page';
import { Banner } from '@/components/ds/feedback';
import { ErrorState } from '@/components/ds/state';
import { Button } from '@/components/ds/inputs';
import type { ActionSpec, OverflowItem } from '@/components/ds/overlay';
import { useFormatters } from '@/lib/format';
import { icons } from '@/lib/ds/icons';
import { usePageActions } from '@/lib/ds/usePageActions';
import { useConnections } from '@/lib/hooks/useConnections';
import type { ConnectionAccount } from '@/lib/integrations/connectionStatus';
import type { ConnectionStatusKey } from '@/lib/ds/status/vocabulary';
import {
  INTEGRATION_GROUPS,
  amazonConnectHref,
  getIntegration,
  integrationsInGroup,
  type IntegrationId,
  type IntegrationSpec,
} from '@/lib/settings/integrations';
import { IntegrationGrid } from './IntegrationGrid';
import { IntegrationTile } from './IntegrationTile';
import { EtsyShopsPanel } from './EtsyShopsPanel';
import { AmazonPanel } from './AmazonPanel';
import { ShopifyPanel } from './ShopifyPanel';
import { ProviderCredentialsPanel } from './ProviderCredentialsPanel';
import { StoreLimitModal } from './StoreLimitModal';
import { reauthBannerModel, storesFull, storesLine, tileModel, type TileModel } from './connectionView';
import { useAmazonDetails } from './useAmazonDetails';
import { useConnectionActions } from './useConnectionActions';
import { useCredentialsStore, type CredentialsStore } from './useIntegrationCredentials';
import { useStoreAllowance } from './useStoreAllowance';
import { formatElapsed, useWixInstallPoll } from './useWixInstallPoll';
import { useSettingsShell } from '../settingsNav';

export const HIGHLIGHT_MS = 1500;

export type OpenPanel =
  | { kind: 'etsy' }
  | { kind: 'amazon' }
  | { kind: 'shopify' }
  | { kind: 'credentials'; id: string }
  | null;

export interface ConnectionsSectionProps {
  /** Bump after an OAuth return to refetch provider details (Amazon marketplaces). */
  refreshKey?: number;
  /**
   * Provider whose tile gets the 1.5s focus ring and scrolls into view (OAuth `?success=`/`?error=`
   * return, §3.3). Pass a new value (or bump `highlightNonce`) to replay it.
   */
  highlightProvider?: string | null;
  highlightNonce?: number;
  /** Optional: an already-loaded settings store (avoids a second `/api/user/settings` subscriber). */
  credentials?: CredentialsStore;
  /** Injectable for tests; default `window.location.href = href`. */
  navigate?: (href: string) => void;
}

const PANEL_FOR: Partial<Record<IntegrationId, Exclude<OpenPanel, null>['kind']>> = {
  etsy: 'etsy', amazon: 'amazon', shopify: 'shopify',
};

function panelFor(spec: IntegrationSpec): OpenPanel {
  if (spec.panel === 'credentials') return { kind: 'credentials', id: spec.id };
  const k = PANEL_FOR[spec.id];
  return k ? ({ kind: k } as OpenPanel) : null;
}

export function ConnectionsSection(props: ConnectionsSectionProps) {
  const { credentials: injected, navigate } = props;
  // Inside Group A's SettingsPage the shell context carries `&provider=`, the OAuth focus ring and the
  // refresh key; explicit props win (isolated use, tests).
  const shell = useSettingsShell();
  const refreshKey = props.refreshKey ?? shell?.connectionsRefreshKey ?? 0;
  const highlightProvider = props.highlightProvider !== undefined ? props.highlightProvider : shell?.focusProvider ?? null;
  const highlightNonce = props.highlightNonce ?? shell?.focusNonce ?? 0;
  const t = useTranslations('settings');
  const tc = useTranslations('settings.connections');
  const f = useFormatters();
  const router = useRouter();
  const isPhone = useIsMobile();
  const { connections, extension, isLoading, isValidating, error: connError, get, needsReauth, mutate } = useConnections();

  const credentials = useCredentialsStore(injected);
  const allowance = useStoreAllowance();
  const amazon = useAmazonDetails(refreshKey);
  const wix = useWixInstallPoll({ connected: !!get('wix')?.connected, onConnected: () => void mutate() });
  const actions = useConnectionActions({
    mutateConnections: mutate,
    credentials,
    onAfterDisconnect: (spec) => { if (spec.id === 'amazon') amazon.reset(); },
  });

  const go = useCallback((href: string) => {
    if (navigate) navigate(href);
    else window.location.href = href;
  }, [navigate]);

  const [panel, setPanel] = useState<OpenPanel>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Stale banner: when the shown data was last good.
  const lastGoodRef = useRef<Date | null>(null);
  useEffect(() => { if (connections && !connError) lastGoodRef.current = new Date(); }, [connections, connError]);

  const loadingAll = isLoading && !connections;
  const checkFailed = !!connError && !!connections;
  const now = useMemo(() => new Date(), [connections]); // one "now" per snapshot

  const models = useMemo(() => {
    const out = new Map<IntegrationId, TileModel>();
    for (const g of INTEGRATION_GROUPS) {
      for (const spec of integrationsInGroup(g)) {
        out.set(spec.id, tileModel(spec, {
          entry: spec.id === 'chrome' ? undefined : get(spec.id),
          loading: loadingAll,
          checkFailed,
          extension,
          credentialValues: credentials.values,
          wixPoll: spec.id === 'wix' ? wix.state : undefined,
          now,
        }));
      }
    }
    return out;
  }, [get, loadingAll, checkFailed, extension, credentials.values, wix.state, now]);

  /* ── highlight + scroll ─────────────────────────────────────────────────────────────────────── */
  const flash = useCallback((id: string, focusAction: boolean) => {
    setHighlighted(id);
    if (typeof document !== 'undefined') {
      const el = document.getElementById(`integration-${id}`);
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      if (focusAction) document.querySelector<HTMLElement>(`[data-testid="tile-${id}-action"]`)?.focus();
    }
  }, []);
  useEffect(() => {
    if (!highlighted) return undefined;
    const id = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => clearTimeout(id);
  }, [highlighted]);
  useEffect(() => {
    if (!highlightProvider || !getIntegration(highlightProvider)) return;
    flash(highlightProvider, false);
  }, [highlightProvider, highlightNonce, flash]);

  /* ── &provider= deep link ───────────────────────────────────────────────────────────────────── */
  const routerProvider = typeof router?.query?.provider === 'string' ? router.query.provider : null;
  const qProvider = shell ? shell.provider : routerProvider;
  const handledProvider = useRef<string | null>(null);
  useEffect(() => { if (!qProvider) handledProvider.current = null; }, [qProvider]);
  useEffect(() => {
    if ((!shell && !router?.isReady) || !qProvider || handledProvider.current === qProvider) return;
    const spec = getIntegration(qProvider);
    if (!spec) { handledProvider.current = qProvider; return; }
    const p = panelFor(spec);
    if (p) {
      handledProvider.current = qProvider;
      setPanel(p);
      return;
    }
    if (loadingAll) return; // wait for the snapshot: a flagged tile's Reconnect gets focus
    handledProvider.current = qProvider;
    const m = models.get(spec.id);
    flash(spec.id, m?.knownStatus === 'needs_reconnect');
  }, [shell, router?.isReady, qProvider, loadingAll, models, flash]);

  const stripQuery = useCallback((keys: string[]) => {
    if (!router?.isReady) return;
    const rest = { ...router.query };
    let changed = false;
    for (const k of keys) if (k in rest) { delete rest[k]; changed = true; }
    if (changed) void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
  }, [router]);

  const closePanel = useCallback(() => {
    setPanel(null);
    if (!qProvider) return;
    if (shell) shell.clearProvider();
    else stripQuery(['provider']);
  }, [qProvider, shell, stripQuery]);

  /* ── &limit=connectedStore ──────────────────────────────────────────────────────────────────── */
  const qLimit = router?.query?.limit;
  useEffect(() => {
    if (!router?.isReady || qLimit !== 'connectedStore') return;
    setLimitOpen(true);
    stripQuery(['limit']);
  }, [router?.isReady, qLimit, stripQuery]);

  /* ── per-tile actions ───────────────────────────────────────────────────────────────────────── */
  const connectAmazon = useCallback(() => setPanel({ kind: 'amazon' }), []);
  const reconnectAmazonNow = useCallback(() => {
    if (amazon.selectedIds.length === 0 || amazon.reconnectBlocked) { setPanel({ kind: 'amazon' }); return; }
    go(amazonConnectHref(amazon.selectedIds));
  }, [amazon.selectedIds, amazon.reconnectBlocked, go]);

  const reconnectAction = useCallback((spec: IntegrationSpec, label: string): ActionSpec => {
    const id = `${spec.id}-reconnect`;
    if (spec.connectHref) return { id, label, href: spec.connectHref };
    if (spec.id === 'amazon') {
      return {
        id, label, onClick: reconnectAmazonNow,
        disabled: amazon.reconnectBlocked, disabledReason: amazon.reconnectBlocked ? t('amazonDetailsLoadFailed') : undefined,
      };
    }
    if (spec.id === 'wix') return { id, label, onClick: () => void wix.connect(), disabled: wix.state === 'polling', disabledReason: wix.state === 'polling' ? tc('meta.wixWaiting', { elapsed: formatElapsed(wix.elapsedSec) }) : undefined };
    const p = panelFor(spec);
    return { id, label, onClick: () => setPanel(p) };
  }, [amazon.reconnectBlocked, reconnectAmazonNow, t, tc, wix]);

  const buttonFor = useCallback((spec: IntegrationSpec, m: TileModel): ActionSpec | null => {
    const id = `${spec.id}-action`;
    switch (m.button) {
      case 'connect': {
        const label = tc('action.connect', { provider: spec.name });
        if (spec.connectHref) return { id, label, href: spec.connectHref };
        if (spec.id === 'amazon') return { id, label, onClick: connectAmazon };
        if (spec.id === 'shopify') return { id, label, onClick: () => setPanel({ kind: 'shopify' }) };
        if (spec.id === 'wix') {
          const polling = wix.state === 'polling';
          return { id, label, onClick: () => void wix.connect(), disabled: polling, disabledReason: polling ? tc('meta.wixWaiting', { elapsed: formatElapsed(wix.elapsedSec) }) : undefined };
        }
        return null;
      }
      case 'setUp':
        return { id, label: tc('action.setUp'), onClick: () => setPanel(panelFor(spec)) };
      case 'finishSetup':
        return { id, label: tc('action.finishSetup'), onClick: () => setPanel(panelFor(spec)) };
      case 'reconnect':
        return reconnectAction(spec, tc('action.reconnect'));
      case 'manage':
        return { id, label: tc('action.manage'), onClick: () => setPanel(panelFor(spec)) };
      case 'contactSupport':
        return { id, label: tc('action.contactSupport'), href: '/support' };
      case 'checkAgain':
        return { id, label: tc('action.checkAgain'), onClick: wix.checkAgain };
      case 'installExtension':
        return { id, label: tc('meta.installExtension'), href: spec.guideHref };
      default:
        return null;
    }
  }, [connectAmazon, reconnectAction, tc, wix]);

  const overflowFor = useCallback((spec: IntegrationSpec, m: TileModel): OverflowItem[] => {
    const entry = spec.id === 'chrome' ? undefined : get(spec.id);
    const accounts: ConnectionAccount[] = entry?.accounts ?? [];
    const items: OverflowItem[] = [];
    if (m.canRefresh) items.push({ id: 'refresh', label: tc('menu.refreshAll'), icon: icons.pull, onClick: () => void actions.refreshAll(), loading: actions.refreshing });
    if (m.canReconnect) items.push(reconnectAction(spec, tc('action.reconnect')));
    if (spec.id === 'wix' && wix.state === 'timedOut') items.push({ id: 'wix-open-again', label: t('wixOpenInstallAgain'), onClick: () => void wix.connect() });
    items.push({ id: 'guide', label: tc('menu.guide'), href: spec.guideHref, icon: icons.externalLink });
    if (m.canDisconnect) {
      items.push('divider');
      items.push({
        id: 'disconnect', label: tc('menu.disconnect', { provider: spec.name }), tone: 'danger',
        loading: actions.busyKey === spec.id || !!actions.busyKey?.startsWith(`${spec.id}:`),
        onClick: () => {
          if (spec.id === 'etsy' && accounts.length > 1) { setPanel({ kind: 'etsy' }); return; }
          void actions.disconnect(spec, accounts, spec.id === 'etsy' ? accounts[0] : undefined);
        },
      });
    } else if (m.canRemoveCredentials) {
      items.push('divider');
      items.push({
        id: 'remove', label: tc('menu.removeCredentials'), tone: 'danger', loading: actions.busyKey === spec.id,
        onClick: () => void actions.removeCredentials(spec),
      });
    }
    return items;
  }, [actions, get, reconnectAction, t, tc, wix]);

  /* ── ⌘K: "Connect a store" scrolls to the first not-connected marketplace ───────────────────── */
  const firstOpenStore = integrationsInGroup('marketplaces').find((s) => models.get(s.id)?.knownStatus === 'not_connected');
  usePageActions([
    firstOpenStore && {
      id: 'settings-connect-store', label: tc('pageAction.connectStore'), icon: icons.add,
      onClick: () => flash(firstOpenStore.id, false),
    },
  ]);

  /* ── render ─────────────────────────────────────────────────────────────────────────────────── */
  // Phones: the top bar already says "Connections"; repeating it as the first heading cost a row.
  const header = { id: 'settings-connections', title: isPhone ? undefined : tc('title'), description: tc('description') };

  if (connError && !connections) {
    return (
      <Section {...header} data-testid="connections-section">
        <ErrorState variant="page" title={tc('loadFailed')} onRetry={() => void mutate()} retrying={isValidating} />
      </Section>
    );
  }

  const banner = reauthBannerModel(needsReauth, connections);
  const bannerNode = banner?.kind === 'one' ? (
    <Banner
      tone="warning"
      title={banner.since
        ? tc('reauthBanner.one', { provider: banner.spec.name, account: banner.account ?? banner.spec.name, date: f.date(banner.since) })
        : tc('reauthBanner.oneNoDate', { provider: banner.spec.name, account: banner.account ?? banner.spec.name })}
      action={reconnectAction(banner.spec, tc('reauthBanner.reconnect', { provider: banner.spec.name }))}
      data-testid="connections-reauth-banner"
    />
  ) : banner?.kind === 'many' ? (
    <Banner
      tone="warning"
      title={tc('reauthBanner.many', { count: banner.count })}
      action={{ id: 'reauth-review', label: tc('reauthBanner.review', { count: banner.count }), onClick: () => flash(banner.firstId, true) }}
      data-testid="connections-reauth-banner"
    />
  ) : null;

  const stores = storesLine(allowance);
  const groups = INTEGRATION_GROUPS.map((g) => ({
    id: g,
    heading: g === 'marketplaces' && stores ? tc('storesUsed', { used: stores.used, limit: stores.limit }) : tc(`group.${g}` as 'group.marketplaces'),
    trailing: g === 'marketplaces' && stores?.showCompare ? (
      <Button variant="ghost" size="sm" href="/fiyatlandirma" data-testid="connections-compare-plans">{tc('comparePlans')}</Button>
    ) : undefined,
    tiles: integrationsInGroup(g).map((spec) => {
      const m = models.get(spec.id)!;
      return (
        <IntegrationTile
          key={spec.id}
          spec={spec}
          model={m}
          action={buttonFor(spec, m)}
          actionVariant={m.button === 'contactSupport' ? 'ghost' : 'secondary'}
          overflow={overflowFor(spec, m)}
          onRefreshAll={() => void actions.refreshAll()}
          refreshing={actions.refreshing}
          highlighted={highlighted === spec.id}
          wixElapsedSec={spec.id === 'wix' ? wix.elapsedSec : undefined}
        />
      );
    }),
  }));

  const pillOf = (id: IntegrationId): ConnectionStatusKey | null => {
    const st = models.get(id)?.status;
    return st && st !== 'loading' ? st : null;
  };
  const etsy = get('etsy');
  const amazonEntry = get('amazon');
  const shopify = get('shopify');
  const credSpec = panel?.kind === 'credentials' ? getIntegration(panel.id) : undefined;

  return (
    <Section {...header} data-testid="connections-section">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {bannerNode}
        {checkFailed && (
          <ErrorState
            variant="stale"
            title={lastGoodRef.current ? tc('stale', { time: f.date(lastGoodRef.current, 'time') }) : tc('loadFailed')}
            staleSince={lastGoodRef.current ?? undefined}
            onRetry={() => void mutate()}
            retrying={isValidating}
          />
        )}
      </div>
      <IntegrationGrid groups={groups} />

      <EtsyShopsPanel
        open={panel?.kind === 'etsy'}
        onClose={closePanel}
        accounts={etsy?.accounts ?? []}
        loading={loadingAll}
        storesFull={storesFull(allowance)}
        showCompare={allowance.stripeUpsell === true}
        busyKey={actions.busyKey}
        isPhone={isPhone}
        onDisconnect={(shop) => void actions.disconnect(getIntegration('etsy')!, etsy?.accounts ?? [], shop)}
      />
      <AmazonPanel
        open={panel?.kind === 'amazon'}
        onClose={closePanel}
        details={amazon}
        connected={!!amazonEntry?.connected}
        status={pillOf('amazon')}
        fallbackSellerId={amazonEntry?.accounts[0]?.externalId ?? null}
        navigate={go}
      />
      <ShopifyPanel
        open={panel?.kind === 'shopify'}
        onClose={closePanel}
        accounts={shopify?.accounts ?? []}
        status={pillOf('shopify')}
      />
      <ProviderCredentialsPanel
        open={panel?.kind === 'credentials'}
        providerId={credSpec?.id ?? null}
        onClose={closePanel}
        store={credentials}
        status={credSpec ? pillOf(credSpec.id) : null}
        onSaved={() => mutate()}
        allowance={allowance}
        isPhone={isPhone}
      />
      <StoreLimitModal open={limitOpen} onClose={() => setLimitOpen(false)} allowance={allowance} />
    </Section>
  );
}

export default ConnectionsSection;

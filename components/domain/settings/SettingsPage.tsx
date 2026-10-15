// components/domain/settings/SettingsPage.tsx — the new Settings shell (settings §1, §3; Group A).
//
// Desktop: PageHeader + a 220px section nav (sticky) + the 880px section column. Mobile: `/ayarlar` is the
// index (grouped 56px rows with summaries), `?tab=` is a drill-in whose TopBar title is the section and
// whose back chevron returns to the index. One `useSettings()` instance is shared through
// `SettingsProvider`; tab/provider/focus state through `SettingsShellContext` (settingsNav.ts).
//
// Sections (Groups B/C/D) render their own heading, skeleton and errors; this file only gates nothing,
// routes, guards unsaved edits and handles the OAuth return (`ayarlar.tsx` block kept verbatim, toasts on
// the DS `useToast`).
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Page, PageHeader, Section, useIsMobile } from '@/components/ds/page';
import { useToast } from '@/components/ds/feedback';
import { ICON_STROKE, icons } from '@/lib/ds/icons';
import { elevation, focusRing, layout, motion, neutral as n, px, radius, tone } from '@/lib/ds/tokens';
import { useLocale } from '@/lib/i18n/useLocale';
import { sanitizeMessage } from '@/lib/notify';
import { useConnections } from '@/lib/hooks/useConnections';
import { SettingsProvider, useSettings } from '@/lib/hooks/useSettings';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { useEntitlement } from '@/lib/billing/useEntitlement';
import BillingPanel from '@/components/settings/BillingPanel';
import ConnectionsPanel from '@/components/settings/ConnectionsPanel';
import ApiKeysPanel from '@/components/settings/ApiKeysPanel';
import SenderProfilePanel from '@/components/settings/SenderProfilePanel';
import SyncPanel from '@/components/settings/SyncPanel';
import PreferencesPanel from './PreferencesPanel';
import {
  FOCUS_RING_MS, OAUTH_PARAMS, SETTINGS_NAV_GAP, SETTINGS_NAV_STICKY_TOP, SETTINGS_NAV_WIDTH, SETTINGS_PATH,
  SettingsShellContext, buildSettingsNav, leavesSettingsTab, navLabel, oauthMessage, oauthProviderOf,
  resolveSettingsTab, settingsHref, tabSlices,
  type SettingsNavDot, type SettingsNavGroupModel, type SettingsNavItemModel, type SettingsShellValue, type SettingsTabKey,
} from './settingsNav';

const DOT_COLOR: Record<SettingsNavDot, string> = {
  warning: tone.warning.solid,
  danger: tone.danger.solid,
  attention: tone.attention.solid,
};

function NavDot({ dot, testId }: { dot: SettingsNavDot; testId: string }) {
  return (
    <Box
      component="span"
      aria-hidden
      data-testid={testId}
      data-dot={dot}
      sx={{ width: 6, height: 6, borderRadius: px(radius.full), bgcolor: DOT_COLOR[dot], flexShrink: 0 }}
    />
  );
}

function ariaFor(item: SettingsNavItemModel): string {
  return item.dotLabel ? `${item.label}, ${item.dotLabel}` : item.label;
}

// ── Desktop section nav (§3.1): SideNav selection style, 32px rows, sentence-case group captions ────────
function SettingsNavList({
  groups, active, onSelect, label,
}: {
  groups: SettingsNavGroupModel[];
  active: SettingsTabKey | null;
  onSelect: (tab: SettingsTabKey) => void;
  label: string;
}) {
  return (
    <Box
      component="nav"
      aria-label={label}
      data-testid="settings-nav"
      sx={{ width: SETTINGS_NAV_WIDTH, flexShrink: 0, position: 'sticky', top: SETTINGS_NAV_STICKY_TOP, alignSelf: 'flex-start' }}
    >
      {groups.map((g, gi) => (
        <Box key={g.key} sx={{ mt: gi === 0 ? 0 : '16px' }}>
          <Typography
            variant="caption"
            component="div"
            id={`settings-nav-group-${g.key}`}
            sx={{ fontWeight: 500, color: n[500], px: '8px', mb: '4px' }}
          >
            {g.label}
          </Typography>
          <Box component="ul" aria-labelledby={`settings-nav-group-${g.key}`} sx={{ m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {g.items.map((item) => {
              const selected = item.key === active;
              const Icon = item.icon;
              return (
                <Box component="li" key={item.key} sx={{ listStyle: 'none' }}>
                  <Box
                    component={NextLink}
                    href={item.href}
                    shallow
                    replace
                    onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      onSelect(item.key);
                    }}
                    aria-label={ariaFor(item)}
                    aria-current={selected ? 'page' : undefined}
                    data-testid={`settings-nav-${item.key}`}
                    data-active={selected ? 'true' : undefined}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      height: 32,
                      px: '8px',
                      boxSizing: 'border-box',
                      textDecoration: 'none',
                      borderRadius: px(radius.sm),
                      border: '1px solid transparent',
                      color: selected ? n[900] : n[600],
                      transition: `background-color ${motion.fast}ms ${motion.ease}`,
                      ...(selected
                        ? { bgcolor: n[0], borderColor: n[200], boxShadow: elevation.e1 }
                        : { '&:hover': { bgcolor: n[100] } }),
                      '&:focus-visible': { outline: 'none', boxShadow: focusRing },
                    }}
                  >
                    <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden color={selected ? n[900] : n[500]} />
                    <Typography
                      component="span"
                      variant="label"
                      sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'inherit' }}
                    >
                      {item.label}
                    </Typography>
                    {item.dot ? <NavDot dot={item.dot} testId={`settings-nav-dot-${item.key}`} /> : null}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// ── Mobile index (§3.2): one card per group, 56px link rows (icon tile 32, label + summary, chevron) ─────
function SettingsMobileIndexList({ groups, onOpen }: { groups: SettingsNavGroupModel[]; onOpen: (tab: SettingsTabKey) => void }) {
  const Next = icons.next;
  return (
    <Box data-testid="settings-mobile-index">
      {groups.map((g) => (
        <Box key={g.key} sx={{ mb: '16px' }}>
          <Typography variant="caption" component="h2" sx={{ fontWeight: 500, color: n[500], m: 0, mb: '8px' }}>
            {g.label}
          </Typography>
          <Section variant="card" flush sx={{ mb: 0 }}>
            <Box component="ul" sx={{ m: 0, p: 0 }}>
              {g.items.map((item, i) => {
                const Icon = item.icon;
                return (
                  <Box component="li" key={item.key} sx={{ listStyle: 'none', borderTop: i === 0 ? 'none' : `1px solid ${n[100]}` }}>
                    <Box
                      component={NextLink}
                      href={item.href}
                      shallow
                      onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        onOpen(item.key);
                      }}
                      aria-label={ariaFor(item)}
                      data-testid={`settings-index-${item.key}`}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        minHeight: 56,
                        px: '16px',
                        py: '8px',
                        boxSizing: 'border-box',
                        textDecoration: 'none',
                        color: n[900],
                        '&:active': { bgcolor: n[50] },
                        '&:focus-visible': { outline: 'none', boxShadow: `inset ${focusRing}` },
                      }}
                    >
                      <Box
                        aria-hidden
                        sx={{
                          width: 32, height: 32, flexShrink: 0, borderRadius: px(radius.md), bgcolor: n[100],
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Icon size={18} strokeWidth={ICON_STROKE} color={n[600]} />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography component="div" variant="label" sx={{ color: n[900] }}>{item.label}</Typography>
                        {item.summary ? (
                          <Typography
                            component="div"
                            variant="caption"
                            data-testid={`settings-index-summary-${item.key}`}
                            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {item.summary}
                          </Typography>
                        ) : null}
                      </Box>
                      {item.dot ? <NavDot dot={item.dot} testId={`settings-index-dot-${item.key}`} /> : null}
                      <Next size={16} strokeWidth={ICON_STROKE} aria-hidden color={n[400]} />
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Section>
        </Box>
      ))}
    </Box>
  );
}

type LastRunPage = { syncs?: { status?: string | null }[] };
const lastRunFetcher = async (url: string): Promise<LastRunPage> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`sync_history_${res.status}`);
  return res.json();
};

export default function SettingsPage() {
  const router = useRouter();
  const t = useTranslations('settings');
  const tPlan = useTranslations('billing.planName');
  const tNav = useTranslations('nav.items');
  const toast = useToast();
  const mobile = useIsMobile();
  const { config } = useLocale();

  const settings = useSettings();
  const connections = useConnections();
  const { mutate: refreshConnections } = connections;
  const entitlement = useEntitlement();
  const { data: lastRunPage } = useSWR<LastRunPage>('/api/sync/history?limit=1', lastRunFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const [lastRunFailed, setLastRunFailed] = React.useState<boolean | null>(null);
  const [preferencesDirty, setPreferencesDirty] = React.useState(false);

  const tab: SettingsTabKey | null = router.isReady
    ? resolveSettingsTab(router.query.tab, mobile)
    : mobile ? null : 'connections';
  const provider = typeof router.query.provider === 'string' && router.query.provider ? router.query.provider : null;

  const [focus, setFocus] = React.useState<{ provider: string | null; nonce: number }>({ provider: null, nonce: 0 });
  const [connectionsRefreshKey, setConnectionsRefreshKey] = React.useState(0);
  const handledOAuth = React.useRef<string | null>(null);

  const ringProvider = React.useCallback((p: string) => setFocus((f) => ({ provider: p, nonce: f.nonce + 1 })), []);
  React.useEffect(() => {
    if (!focus.provider) return undefined;
    const id = setTimeout(() => setFocus((f) => ({ ...f, provider: null })), FOCUS_RING_MS);
    return () => clearTimeout(id);
  }, [focus]);

  // ── Unsaved-changes guard (§3.3) ───────────────────────────────────────────────────────────────────
  const slices = tabSlices(tab);
  const { isSliceDirty, discard } = settings;
  const tabDirty = (slices.length > 0 && isSliceDirty(slices)) || (tab === 'preferences' && preferencesDirty);
  const guard = useUnsavedChangesGuard(tabDirty, {
    onDiscard: () => {
      if (slices.length) discard(slices);
      setPreferencesDirty(false);
    },
    shouldBlock: (url) => leavesSettingsTab(router.asPath, url, mobile),
  });
  const { runGuarded, confirmDiscard } = guard;

  const goToTab = React.useCallback(
    (next: SettingsTabKey, extra: Record<string, string | undefined> = {}) => {
      const query: Record<string, string> = { tab: next };
      for (const [k, v] of Object.entries(extra)) if (v) query[k] = v;
      // Mobile index → drill-in pushes (OS back returns to the index); every other tab change replaces.
      const fromIndex = mobile && tab === null;
      return runGuarded(() =>
        fromIndex
          ? router.push({ pathname: SETTINGS_PATH, query }, undefined, { shallow: true })
          : router.replace({ pathname: SETTINGS_PATH, query }, undefined, { shallow: true }),
      );
    },
    [mobile, router, runGuarded, tab],
  );

  const clearProvider = React.useCallback(() => {
    if (!router.query.provider) return;
    const rest = { ...router.query };
    delete rest.provider;
    void router.replace({ pathname: SETTINGS_PATH, query: rest }, undefined, { shallow: true });
  }, [router]);

  // `&provider=<id>` (§1.1): the section opens its panel; tiles without a panel get the focus ring.
  React.useEffect(() => {
    if (provider) ringProvider(provider);
  }, [provider, ringProvider]);

  // ── OAuth callback results (ayarlar.tsx:73-120 verbatim; toasts on useToast, tile focus ring) ─────────
  React.useEffect(() => {
    if (!router.isReady) return;
    const success = typeof router.query.success === 'string' ? router.query.success : '';
    const error = typeof router.query.error === 'string' ? router.query.error : '';
    if (!success && !error) return;

    const signature = `${success}|${error}`;
    if (handledOAuth.current === signature) return; // re-render / StrictMode guard
    handledOAuth.current = signature;

    const code = success || error;
    const m = oauthMessage(success ? 'success' : 'error', code);
    let msg = t(m.key as never, m.values as never);
    if (success) {
      toast.success(msg);
    } else {
      const rawDetails = typeof router.query.details === 'string' ? router.query.details : '';
      let decoded = rawDetails;
      try { decoded = decodeURIComponent(rawDetails); } catch { /* already decoded by Next */ }
      const details = sanitizeMessage(decoded); // null for technical / JSON / HTML text
      if (details) msg = `${msg} ${details}`;
      toast.error(msg);
    }

    const p = oauthProviderOf(code);
    if (p?.known) ringProvider(p.id);
    setConnectionsRefreshKey((k) => k + 1);
    void refreshConnections();

    const rest = { ...router.query };
    OAUTH_PARAMS.forEach((k) => { delete rest[k]; });
    guard.allowNextNavigation();
    void router.replace({ pathname: SETTINGS_PATH, query: { ...rest, tab: 'connections' } }, undefined, { shallow: true });
  }, [router.isReady, router.query.success, router.query.error]);

  // ── Nav model ──────────────────────────────────────────────────────────────────────────────────────
  const ent = entitlement.data;
  const rawLastStatus = lastRunPage?.syncs?.[0]?.status ?? null;
  const lastRunStatus = lastRunFailed === null ? rawLastStatus : lastRunFailed ? 'failed' : 'completed';
  const dirtySections = React.useMemo(
    () => (preferencesDirty ? Array.from(new Set([...settings.dirtySections, 'preferences' as const])) : settings.dirtySections),
    [preferencesDirty, settings.dirtySections],
  );
  const groups = React.useMemo(
    () =>
      buildSettingsNav(
        {
          connections: connections.connections,
          needsReauthCount: connections.needsReauth.length,
          billing: ent ? { plan: ent.plan, state: ent.state, stripeUpsell: ent.stripeUpsell, meters: ent.meters } : null,
          dirtySections,
          lastRunStatus,
        },
        {
          t: (key, values) => t(key as never, values as never),
          planLabel: (plan) => (tPlan.has(plan as never) ? tPlan(plan as never) : plan),
        },
      ),
    [connections.connections, connections.needsReauth.length, ent, dirtySections, lastRunStatus, t, tPlan],
  );

  const settingsTitle = tNav('settings');
  const sectionLabel = tab ? navLabel(groups, tab) : null;
  const drillIn = mobile && tab !== null;
  // `<title>`: "Plan & billing · Settings · KolayXport" (§1.3). Mobile TopBar title: the section on a drill-in.
  const pageTitle = drillIn ? (sectionLabel as string) : sectionLabel && !mobile ? `${sectionLabel} · ${settingsTitle}` : settingsTitle;

  const shell = React.useMemo<SettingsShellValue>(
    () => ({
      tab,
      mobile,
      provider,
      clearProvider,
      focusProvider: focus.provider,
      focusNonce: focus.nonce,
      connectionsRefreshKey,
      goToTab,
      confirmDiscard,
    }),
    [tab, mobile, provider, clearProvider, focus, connectionsRefreshKey, goToTab, confirmDiscard],
  );

  // ── Sections ───────────────────────────────────────────────────────────────────────────────────────
  const senderSlices = tabSlices('senderProfile');
  const saveSender = React.useCallback(async () => {
    // The toast's retry goes through saveSender itself, so a retry gets the same success / failure toast.
    const run = async (): Promise<Awaited<ReturnType<typeof settings.saveSlice>>> => {
      const res = await settings.saveSlice(senderSlices);
      if (res.ok) toast.success(t('sender.saved'));
      else toast.error(t('saveFailed'), { action: { label: t('saveBar.save'), onClick: () => { void run(); } } });
      return res;
    };
    return run();
  }, [settings, senderSlices, t, toast]);

  const senderState: 'loading' | 'ready' | 'error' = settings.initialDataLoaded ? 'ready' : settings.loadFailed ? 'error' : 'loading';

  const content = (() => {
    switch (tab) {
      case 'connections':
        return <ConnectionsPanel refreshKey={connectionsRefreshKey} />;
      case 'apiKeys':
        return (
          <ApiKeysPanel
            integrationSettings={settings.formData.integrationSettings || {}}
            onChange={(name, value) => settings.handleInputChange('integrationSettings', name, value)}
          />
        );
      case 'senderProfile':
        return (
          <SenderProfilePanel
            shipperProfile={settings.formData.shipperProfile || {}}
            shippingSettings={settings.formData.shippingSettings || {}}
            onChangeProfile={(name, value) => settings.handleInputChange('shipperProfile', name, value)}
            onChangeShipping={(name, value) => settings.handleInputChange('shippingSettings', name, value)}
            importerJsonError={settings.importerJsonError}
            etgbCollapsed={config.etgbProminence === 'collapsed'}
            state={senderState}
            onRetry={() => { void settings.refetch(); }}
            dirty={settings.isSliceDirty(senderSlices)}
            saving={settings.isSubmitting}
            onSave={saveSender}
            onDiscard={() => settings.discard(senderSlices)}
          />
        );
      case 'billing':
        return <BillingPanel subscriptionData={settings.subscriptionData} ready={settings.initialDataLoaded} />;
      case 'preferences':
        return <PreferencesPanel onDirtyChange={setPreferencesDirty} />;
      case 'syncAdvanced':
        return <SyncPanel onLastRunFailedChange={setLastRunFailed} />;
      default:
        return null;
    }
  })();

  const crumbs = sectionLabel && !drillIn ? [{ label: sectionLabel }] : undefined;

  return (
    <SettingsProvider value={settings}>
      <SettingsShellContext.Provider value={shell}>
        <Page
          title={pageTitle}
          width="form"
          breadcrumbs={crumbs}
          backHref={drillIn ? SETTINGS_PATH : undefined}
          data-testid="settings-page"
          // Settings is the one form page with a side nav: 220 + 40 + 880, left-aligned (DS §3.2).
          sx={{ maxWidth: { md: SETTINGS_NAV_WIDTH + SETTINGS_NAV_GAP + layout.maxForm + 2 * layout.gutter }, mx: { md: 0 } }}
        >
          {mobile ? (
            tab === null ? (
              <SettingsMobileIndexList groups={groups} onOpen={(k) => { void goToTab(k); }} />
            ) : (
              <Box data-testid={`settings-section-${tab}`} sx={{ minWidth: 0 }}>{content}</Box>
            )
          ) : (
            <>
              <PageHeader title={settingsTitle} subtitle={t('pageSubtitle')} />
              <Box sx={{ display: 'flex', gap: `${SETTINGS_NAV_GAP}px`, alignItems: 'flex-start', mt: '16px' }}>
                <SettingsNavList groups={groups} active={tab} onSelect={(k) => { if (k !== tab) void goToTab(k); }} label={settingsTitle} />
                <Box
                  component="div"
                  data-testid={tab ? `settings-section-${tab}` : undefined}
                  sx={{ flex: 1, minWidth: 0, maxWidth: layout.maxForm }}
                >
                  {content}
                </Box>
              </Box>
            </>
          )}
        </Page>
      </SettingsShellContext.Provider>
    </SettingsProvider>
  );
}

export { SettingsPage };

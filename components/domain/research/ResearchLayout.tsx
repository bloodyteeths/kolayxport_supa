// components/domain/research/ResearchLayout.tsx (research R1-C) — the frame shared by the five Research routes
// (research.md §2.1, §2.4, §3.2): Page width="list" · PageHeader "Research" (subtitle on Home only) with the
// marketplace FilterButton in the actions slot · route Tabs (Home · Product finder · Keyword explorer · Listing
// doctor · Shop tracker) · the tool's toolbar and content.
//
// Marketplace = a filter, not a page: `?mkt=` in the URL, remembered per viewer (localStorage `kx.research.mkt`,
// try/catch), default the first connected of Etsy → eBay → Trendyol → Amazon. Options per tool follow §3.2
// (hidden options never render; a disabled option carries its reason). Mobile: the shell TopBar owns the title,
// so the switch moves into ⋯ ("Marketplace: eBay") and the tabs scroll horizontally (the allowed h-scroll).
//
// A tool that has not shipped yet links to its legacy route until its PR flips `RESEARCH_TOOL_SHIPPED` (all five
// tools are on the hub since R3).
import * as React from 'react';
import { useRouter } from 'next/router';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Page, PageHeader, type ActionSpec } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { FilterButton } from '@/components/ds/toolbar/FilterButton';
import type { FilterOption } from '@/components/ds/toolbar/types';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { Tabs } from '@/components/ds/inputs/Tabs';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { icons } from '@/lib/ds/icons';
import { defaultUiFlags, readClientUiOverride, resolveUiFlag } from '@/lib/ds/uiFlags';
import { useConnections } from '@/lib/hooks/useConnections';
import { urlField, useUrlState } from '@/lib/ds/useUrlState';
import { RESEARCH_MKTS, isResearchMkt as isMkt, type ResearchMkt } from '@/lib/research/types';

export { RESEARCH_MKTS };

export type ResearchTab = 'home' | 'products' | 'keywords' | 'listings' | 'shops';
export const RESEARCH_TABS: readonly ResearchTab[] = ['home', 'products', 'keywords', 'listings', 'shops'];

/** New-route paths (research.md §2.1). */
export const RESEARCH_TOOL_PATH: Record<ResearchTab, string> = {
  home: '/app/research',
  products: '/app/research/products',
  keywords: '/app/research/keywords',
  listings: '/app/research/listings',
  shops: '/app/research/shops',
};

/** Which tools have their hub route live. R2 integrator flipped `keywords`; R3 integrator flipped `shops` (pages/app/research/shops.tsx). */
export const RESEARCH_TOOL_SHIPPED: Record<ResearchTab, boolean> = {
  home: true,
  products: true,
  keywords: true,
  listings: true,
  shops: true,
};

/** Legacy routes for tools that are not on the hub yet (verified against the legacy route files). */
function legacyToolHref(tab: ResearchTab, mkt: ResearchMkt): string {
  if (mkt === 'amazon') return '/app/amazon-research';
  if (mkt === 'trendyol') return '/app/trendyol-arastirma';
  if (tab === 'keywords') return mkt === 'ebay' ? '/app/ebay-research?sub=keyword_intelligence' : '/app/etsy-research?tab=research';
  if (tab === 'shops') return mkt === 'ebay' ? '/app/ebay-research?sub=seller_tracker' : '/app/etsy-research?tab=shopIntel';
  return mkt === 'ebay' ? '/app/ebay-research' : '/app/etsy-research';
}

/** Legacy page for a marketplace (flag `research` off). */
export function legacyResearchHref(mkt: ResearchMkt | undefined): string {
  if (mkt === 'ebay') return '/app/ebay-research';
  if (mkt === 'trendyol') return '/app/trendyol-arastirma';
  if (mkt === 'amazon') return '/app/amazon-research';
  return '/app/etsy-research';
}

/** Href of a tool with the current marketplace (and optional extra query). */
export function researchToolHref(tab: ResearchTab, mkt?: ResearchMkt, extra?: Record<string, string | undefined>): string {
  if (!RESEARCH_TOOL_SHIPPED[tab]) return legacyToolHref(tab, mkt ?? 'etsy');
  const sp = new URLSearchParams();
  if (mkt) sp.set('mkt', mkt);
  for (const [k, v] of Object.entries(extra ?? {})) if (v !== undefined && v !== '') sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${RESEARCH_TOOL_PATH[tab]}?${qs}` : RESEARCH_TOOL_PATH[tab];
}

// ─── Marketplace eligibility (§3.2) ─────────────────────────────────────────────────────────────────────

export type MktAvailability = 'enabled' | 'disabled' | 'hidden';

export type MktEligibilityContext = {
  /** Amazon Creators API eligibility is confirmed (no source yet in v1 → false). */
  amazonEligible?: boolean;
};

/** Pure (§3.2 table). */
export function mktAvailability(tab: ResearchTab, mkt: ResearchMkt, ctx: MktEligibilityContext = {}): MktAvailability {
  switch (mkt) {
    case 'etsy':
    case 'ebay':
      return 'enabled';
    case 'amazon':
      if (tab === 'listings') return 'hidden';
      if (tab === 'products') return ctx.amazonEligible ? 'enabled' : 'disabled';
      return 'enabled';
    case 'trendyol':
      return tab === 'home' || tab === 'products' ? 'enabled' : 'hidden';
    default:
      return 'hidden';
  }
}

export const MKT_STORAGE_KEY = 'kx.research.mkt';

export function readStoredMkt(): ResearchMkt | null {
  try {
    const v = window.localStorage.getItem(MKT_STORAGE_KEY);
    return isMkt(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStoredMkt(mkt: ResearchMkt) {
  try {
    window.localStorage.setItem(MKT_STORAGE_KEY, mkt);
  } catch {
    /* storage blocked */
  }
}

/**
 * Pure: the marketplace a tool shows. URL wins, then the viewer's last choice, then the first connected of
 * Etsy → eBay → Trendyol → Amazon, then Etsy. A value the tool hides falls through to the next source.
 */
export function resolveMkt(
  tab: ResearchTab,
  sources: { url?: string | null; stored?: string | null; connected?: Partial<Record<ResearchMkt, boolean | undefined>> },
  ctx: MktEligibilityContext = {},
): ResearchMkt {
  const usable = (m: unknown): m is ResearchMkt => isMkt(m) && mktAvailability(tab, m, ctx) !== 'hidden';
  if (usable(sources.url)) return sources.url;
  if (usable(sources.stored)) return sources.stored;
  for (const m of ['etsy', 'ebay', 'trendyol', 'amazon'] as const) {
    // Product finder can't serve Trendyol yet (R1-A answers `research.products.trendyolLater`): never default to it.
    if (tab === 'products' && m === 'trendyol') continue;
    if (sources.connected?.[m] && mktAvailability(tab, m, ctx) === 'enabled') return m;
  }
  return 'etsy';
}

const MKT_SCHEMA = { mkt: urlField.optionalEnum(RESEARCH_MKTS) };

export type ResearchMktState = {
  mkt: ResearchMkt;
  setMkt: (mkt: ResearchMkt) => void;
  /** The URL carries an explicit `?mkt=` (deep link). */
  explicit: boolean;
  /** FilterButton options for this tool (hidden ones removed, disabled ones with their reason). */
  options: FilterOption[];
  /** Connection state per marketplace (undefined while loading). */
  connected: Partial<Record<ResearchMkt, boolean | undefined>>;
};

/** Marketplace state for one tool (`?mkt=` + localStorage + connections). */
export function useResearchMkt(tab: ResearchTab, ctx: MktEligibilityContext = {}): ResearchMktState {
  const t = useTranslations('research');
  const [url, setUrl] = useUrlState(MKT_SCHEMA);
  const conn = useConnections();
  const [stored, setStored] = React.useState<ResearchMkt | null>(null);
  React.useEffect(() => setStored(readStoredMkt()), []);
  const connected = React.useMemo(
    () => ({ etsy: conn.has('etsy'), ebay: conn.has('ebay'), trendyol: conn.has('trendyol'), amazon: conn.has('amazon') }),
    [conn],
  );
  const amazonEligible = Boolean(ctx.amazonEligible);
  const mkt = resolveMkt(tab, { url: url.mkt, stored, connected }, { amazonEligible });
  const setMkt = React.useCallback(
    (m: ResearchMkt) => {
      writeStoredMkt(m);
      setStored(m);
      setUrl({ mkt: m });
    },
    [setUrl],
  );
  const options = React.useMemo<FilterOption[]>(
    () =>
      RESEARCH_MKTS.filter((m) => mktAvailability(tab, m, { amazonEligible }) !== 'hidden').map((m) => ({
        value: m,
        label: MKT_NAME[m],
        leading: <LogoTile brand={m} size={16} />,
        disabledReason: mktAvailability(tab, m, { amazonEligible }) === 'disabled' ? t('mkt.amazonIneligible') : undefined,
      })),
    [tab, amazonEligible, t],
  );
  return { mkt, setMkt, explicit: Boolean(url.mkt), options, connected };
}

/** Brand names are proper nouns (not translated). */
export const MKT_NAME: Record<ResearchMkt, string> = { etsy: 'Etsy', ebay: 'eBay', amazon: 'Amazon', trendyol: 'Trendyol' };

// ─── Layout ─────────────────────────────────────────────────────────────────────────────────────────────

export type ResearchLayoutProps = {
  tab: ResearchTab;
  /** From `useResearchMkt(tab)` (the page owns it so tool content can read the same value). */
  market: ResearchMktState;
  /** The tool's one primary (none on Home). On mobile it goes to the StickyActionBar (state-driven). */
  primaryAction?: ActionSpec;
  secondaryActions?: ActionSpec[];
  /** Tool overflow (⋯). On mobile the marketplace switch is prepended here. */
  overflowActions?: ActionSpec[];
  /** Mobile placement of the primary (default 'sticky'). */
  mobilePrimary?: 'sticky' | 'menu' | 'none';
  /** Banner / toolbar rows rendered between the tabs and the content. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  'data-testid'?: string;
};

export function ResearchLayout({
  tab,
  market,
  primaryAction,
  secondaryActions,
  overflowActions,
  mobilePrimary = 'sticky',
  toolbar,
  children,
  'data-testid': testId,
}: ResearchLayoutProps) {
  const t = useTranslations('research');
  const mobile = useIsMobile();
  const { mkt, setMkt, options } = market;
  const toolLabel = t(`tabs.${tab}`);
  const title = t('title');

  const tabs = RESEARCH_TABS.map((value) => ({ value, label: t(`tabs.${value}`), href: researchToolHref(value, mkt) }));

  const mktSwitch = (
    <FilterButton
      label={t('mkt.label')}
      value={mkt}
      options={options}
      required
      onChange={(v) => {
        const next = Array.isArray(v) ? v[0] : v;
        if (next && isMkt(next)) setMkt(next);
      }}
      data-testid="research-mkt"
    />
  );

  // Mobile (C2 slot rule): no mobileAction; ⋯ holds the marketplace switch and the tool overflow.
  const mobileMktItems: ActionSpec[] = mobile
    ? options
        .filter((o) => o.value !== mkt)
        .map((o) => ({
          id: `research-mkt-${o.value}`,
          label: t('mkt.switchTo', { name: o.label }),
          onClick: () => isMkt(o.value) && setMkt(o.value),
          disabled: Boolean(o.disabledReason),
          disabledReason: o.disabledReason,
        }))
    : [];

  return (
    <Page
      title={tab === 'home' ? title : toolLabel}
      width="list"
      breadcrumbs={tab === 'home' ? undefined : [{ label: title, href: researchToolHref('home', mkt) }, { label: toolLabel }]}
      data-testid={testId ?? `research-${tab}`}
    >
      <PageHeader
        title={title}
        subtitle={tab === 'home' ? t('subtitle') : undefined}
        actionsSlot={mobile ? undefined : mktSwitch}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        overflowActions={[...mobileMktItems, ...(overflowActions ?? [])]}
        mobilePrimary={mobilePrimary}
      />
      <Box
        sx={{
          position: 'sticky',
          top: 'var(--kx-topbar-current, 0px)',
          zIndex: 3,
          bgcolor: 'background.default',
          mb: '16px',
          // Tabs scroll horizontally on narrow screens (the only allowed h-scroll with the question chips).
          minWidth: 0,
        }}
      >
        <Tabs value={tab} tabs={tabs} aria-label={title} data-testid="research-tabs" />
      </Box>
      {toolbar}
      {children}
    </Page>
  );
}

export default ResearchLayout;

// ─── Route gate (flag `research`) ───────────────────────────────────────────────────────────────────────

/**
 * Hub routes live behind the `research` flag (DS §7.1.5). Flag off → the legacy page for the requested
 * marketplace. When the build default has the flag ON (so the legacy routes redirect to the hub, R1-E) but this
 * viewer turned it off with `?ui=`, an automatic redirect would bounce forever; the gate shows a link instead.
 */
export function useResearchRouteGate(): { state: 'pending' | 'on' | 'off-redirect' | 'off-link' } {
  const [state, setState] = React.useState<'pending' | 'on' | 'off-redirect' | 'off-link'>('pending');
  React.useEffect(() => {
    const defaults = defaultUiFlags();
    const on = resolveUiFlag('research', defaults, readClientUiOverride());
    setState(on ? 'on' : defaults.has('research') ? 'off-link' : 'off-redirect');
  }, []);
  return { state };
}

export type ResearchRouteGateProps = {
  /** `?mkt=` of the request (picks the legacy page). */
  mkt?: string | string[];
  children: React.ReactNode;
};

export function ResearchRouteGate({ mkt, children }: ResearchRouteGateProps) {
  const t = useTranslations('research');
  const router = useRouter();
  const { state } = useResearchRouteGate();
  const m = Array.isArray(mkt) ? mkt[0] : mkt;
  const legacy = legacyResearchHref(isMkt(m) ? m : undefined);
  React.useEffect(() => {
    // Static pages: router.query is empty until hydration — wait for isReady so `?mkt=` picks the right page.
    if (state === 'off-redirect' && router?.isReady) void router.replace(legacy);
  }, [state, router, router?.isReady, legacy]);
  if (state === 'on') return <>{children}</>;
  if (state === 'off-link') {
    return (
      <Box sx={{ p: '24px' }}>
        <EmptyState kind="first-use" icon={icons.research} title={t('legacy.title')} action={{ id: 'legacy', label: t('legacy.open'), href: legacy }} data-testid="research-legacy-link" />
      </Box>
    );
  }
  return null;
}

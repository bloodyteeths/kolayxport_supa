// components/domain/settings/settingsNav.ts — settings §1.1–§1.2, §3.3: tab keys, nav groups, the pure
// nav model (labels, dots, mobile summaries) and the shell context the sections read.
//
// Pure apart from `SettingsShellContext`; every decision here is unit-tested
// (test/settings/a-settingsNav.test.ts).
import { createContext, useContext } from 'react';
import type { LucideIcon } from '@/lib/ds/icons';
import { icons } from '@/lib/ds/icons';
import { runStatus } from '@/lib/ds/status/runs';
import type { ConnectionProvider, ConnectionsMap } from '@/lib/integrations/connectionStatus';
import type { SettingsFormSection, SettingsSlice } from '@/lib/hooks/useSettings';
import { SECTION_SLICES } from '@/lib/hooks/useSettings';

// ── Tabs ──────────────────────────────────────────────────────────────────────────────────────────
/** `?tab=` keys. The five existing keys are unchanged (links in notifications, AppLayout, portal return). */
export const SETTINGS_TAB_KEYS = ['connections', 'apiKeys', 'senderProfile', 'billing', 'preferences', 'syncAdvanced'] as const;
export type SettingsTabKey = (typeof SETTINGS_TAB_KEYS)[number];
export const DEFAULT_SETTINGS_TAB: SettingsTabKey = 'connections';
export const SETTINGS_PATH = '/ayarlar';

export function isSettingsTabKey(v: unknown): v is SettingsTabKey {
  return typeof v === 'string' && (SETTINGS_TAB_KEYS as readonly string[]).includes(v);
}

/** `?tab=` → key; missing/unknown → null (desktop falls back to Connections, mobile shows the index). */
export function parseSettingsTab(raw: string | string[] | undefined): SettingsTabKey | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isSettingsTabKey(v) ? v : null;
}

/** Tab rendered for a query: desktop never shows the index. */
export function resolveSettingsTab(raw: string | string[] | undefined, mobile: boolean): SettingsTabKey | null {
  const tab = parseSettingsTab(raw);
  if (tab) return tab;
  return mobile ? null : DEFAULT_SETTINGS_TAB;
}

/** `/ayarlar?tab=<key>` (+ extra params, e.g. `{ provider: 'trendyol' }`, `{ invoices: 'all' }`). */
export function settingsHref(tab?: SettingsTabKey | null, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  if (tab) params.set('tab', tab);
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `${SETTINGS_PATH}?${qs}` : SETTINGS_PATH;
}

/** Form slices behind each tab (empty = the tab has no page-level unsaved state). */
export function tabSlices(tab: SettingsTabKey | null): readonly SettingsSlice[] {
  if (tab === 'apiKeys' || tab === 'senderProfile' || tab === 'preferences') return SECTION_SLICES[tab as SettingsFormSection];
  return [];
}

/**
 * Pure (§3.3 guard): does a route change to `url` leave the form the user is editing? Rewrites that keep
 * the same pathname and `tab` (stripping `?success=`, adding `&provider=`) do not.
 */
export function leavesSettingsTab(currentAsPath: string, url: string, mobile: boolean): boolean {
  const parse = (u: string) => {
    const [path, query = ''] = u.split('#')[0].split('?');
    return { path, tab: resolveSettingsTab(new URLSearchParams(query).get('tab') ?? undefined, mobile) };
  };
  const a = parse(currentAsPath);
  const b = parse(url);
  return a.path !== b.path || a.tab !== b.tab;
}

// ── Nav groups (§1.2) ─────────────────────────────────────────────────────────────────────────────
export type SettingsNavGroupKey = 'workspace' | 'shipping' | 'account' | 'system';
export const SETTINGS_NAV_GROUPS: readonly { key: SettingsNavGroupKey; items: readonly SettingsTabKey[] }[] = [
  { key: 'workspace', items: ['connections', 'apiKeys'] },
  { key: 'shipping', items: ['senderProfile'] },
  { key: 'account', items: ['billing', 'preferences'] },
  { key: 'system', items: ['syncAdvanced'] },
];

export const SETTINGS_TAB_ICONS: Record<SettingsTabKey, LucideIcon> = {
  connections: icons.connections,
  apiKeys: icons.credentials,
  senderProfile: icons.senderProfile,
  billing: icons.billing,
  preferences: icons.languageRegion,
  syncAdvanced: icons.history,
};

/** Providers configured with keys on Carriers & API keys (§5.1): the "3 of 7 set up" summary. */
export const CREDENTIAL_PROVIDERS: readonly ConnectionProvider[] = ['trendyol', 'veeqo', 'shippo', 'fedex', 'ups', 'mng', 'parasut'];

// ── Nav model ─────────────────────────────────────────────────────────────────────────────────────
export type SettingsNavDot = 'warning' | 'danger' | 'attention';

export interface SettingsNavItemModel {
  key: SettingsTabKey;
  label: string;
  icon: LucideIcon;
  href: string;
  dot: SettingsNavDot | null;
  /** Screen-reader sentence for the dot (a dot is never the only signal). */
  dotLabel?: string;
  /** Mobile index caption ("4 connected · 1 needs attention"). */
  summary?: string;
}

export interface SettingsNavGroupModel {
  key: SettingsNavGroupKey;
  label: string;
  items: SettingsNavItemModel[];
}

/** Billing inputs, read from `useEntitlement()` (Group D) — structural so this file needs no billing import. */
export interface SettingsNavBilling {
  plan: string;
  state: string;
  /** false → shopify_free wording; Stripe never mentioned. */
  stripeUpsell: boolean;
  meters?: { orders?: { used: number; limit: number | null } } | null;
}

export interface SettingsNavInputs {
  connections: ConnectionsMap | null;
  needsReauthCount: number;
  /** Entitlement, or null while unknown (loading / error): neutral "Plan & billing", no summary, no dot. */
  billing: SettingsNavBilling | null;
  dirtySections: readonly SettingsFormSection[];
  /** Raw status of the newest refresh run (`/api/sync/history?limit=1`), or null. */
  lastRunStatus: string | null;
}

/** Translator over the `settings` namespace + the billing plan label. */
export interface SettingsNavCopy {
  t: (key: string, values?: Record<string, string | number>) => string;
  planLabel: (plan: string) => string;
}

const BILLING_DANGER_STATES = new Set(['past_due_grace', 'grace', 'expired']);

/** Pure: the whole Settings nav (desktop list and mobile index read the same model). */
export function buildSettingsNav(input: SettingsNavInputs, copy: SettingsNavCopy): SettingsNavGroupModel[] {
  const { t } = copy;
  const item = (key: SettingsTabKey): SettingsNavItemModel => {
    const base: SettingsNavItemModel = {
      key,
      label: t(`nav.${key}`),
      icon: SETTINGS_TAB_ICONS[key],
      href: settingsHref(key),
      dot: null,
    };
    switch (key) {
      case 'connections': {
        if (input.needsReauthCount > 0) {
          base.dot = 'warning';
          base.dotLabel = t('nav.dot.needsAttention');
        }
        if (input.connections) {
          const connected = (Object.keys(input.connections) as ConnectionProvider[]).filter((p) => input.connections?.[p]?.connected).length;
          base.summary = t('nav.summary.connections', { connected, attention: input.needsReauthCount });
        }
        return base;
      }
      case 'apiKeys': {
        if (input.dirtySections.includes('apiKeys')) {
          base.dot = 'attention';
          base.dotLabel = t('nav.dot.unsaved');
        }
        if (input.connections) {
          const done = CREDENTIAL_PROVIDERS.filter((p) => input.connections?.[p]?.connected).length;
          base.summary = t('nav.summary.apiKeys', { done, total: CREDENTIAL_PROVIDERS.length });
        }
        return base;
      }
      case 'senderProfile':
      case 'preferences': {
        if (input.dirtySections.includes(key)) {
          base.dot = 'attention';
          base.dotLabel = t('nav.dot.unsaved');
        }
        return base;
      }
      case 'billing': {
        const b = input.billing;
        if (!b) return base; // unknown provider: neutral label, no summary (§11)
        const enterprise = b.plan === 'enterprise' || b.state === 'enterprise';
        // Shopify wording only for Shopify billing. Enterprise also has `stripeUpsell: false` (manual
        // invoicing) — it keeps the normal "Plan & billing" label with the plan name, no Shopify claim.
        if (b.plan === 'shopify_free' || b.state === 'shopify_free' || (!b.stripeUpsell && !enterprise)) {
          return { ...base, label: t('nav.billingShopify'), summary: t('nav.summary.billingShopify') };
        }
        if (BILLING_DANGER_STATES.has(b.state)) {
          base.dot = 'danger';
          base.dotLabel = t('nav.dot.billing');
        }
        const orders = b.meters?.orders;
        if (orders && orders.limit && orders.limit > 0) {
          const percent = Math.round((orders.used / orders.limit) * 100);
          base.summary = t('nav.summary.billing', { plan: copy.planLabel(b.plan), percent });
        } else {
          base.summary = copy.planLabel(b.plan);
        }
        return base;
      }
      case 'syncAdvanced': {
        if (runStatus(input.lastRunStatus) === 'failed') {
          base.dot = 'danger';
          base.dotLabel = t('nav.dot.runFailed');
        }
        return base;
      }
      default:
        return base;
    }
  };
  return SETTINGS_NAV_GROUPS.map((g) => ({ key: g.key, label: t(`nav.group.${g.key}`), items: g.items.map(item) }));
}

/** Label of one tab in the current model (title of the mobile drill-in, breadcrumb, `<title>`). */
export function navLabel(groups: readonly SettingsNavGroupModel[], tab: SettingsTabKey): string {
  for (const g of groups) for (const i of g.items) if (i.key === tab) return i.label;
  return tab;
}

// ── OAuth return (§3.3: the ayarlar.tsx block kept verbatim) ─────────────────────────────────────
export const OAUTH_PROVIDER_NAMES: Record<string, string> = {
  etsy: 'Etsy', ebay: 'eBay', amazon: 'Amazon', shopify: 'Shopify', wix: 'Wix',
  trendyol: 'Trendyol', hepsiburada: 'Hepsiburada',
};
/** Existing per-provider messages in the `settings` namespace. */
export const OAUTH_SUCCESS_KEY: Record<string, string> = {
  etsy: 'etsyShopConnected', ebay: 'ebayConnectedSuccess', amazon: 'amazonConnectedSuccess',
  shopify: 'shopifyConnectedSuccess', wix: 'wixConnectedSuccess',
};
export const OAUTH_FAILED_KEY: Record<string, string> = {
  etsy: 'etsyConnectionFailed', ebay: 'ebayConnectionFailed', amazon: 'amazonConnectionFailed',
  shopify: 'shopifyConnectionFailed', wix: 'wixConnectionFailed',
};
export const OAUTH_PARAMS = ['success', 'error', 'details'] as const;

/** 'shopify_invalid_state' → { id: 'shopify', name: 'Shopify', known: true } */
export function oauthProviderOf(code: string): { id: string; name: string; known: boolean } | null {
  const id = code.split('_')[0]?.toLowerCase();
  if (!id) return null;
  return { id, name: OAUTH_PROVIDER_NAMES[id] || id, known: !!OAUTH_PROVIDER_NAMES[id] };
}

/** Pure: i18n key + values (under `settings`) for an OAuth return code. `details` is appended by the caller. */
export function oauthMessage(kind: 'success' | 'error', code: string): { key: string; values?: Record<string, string> } {
  const p = oauthProviderOf(code);
  if (kind === 'success') {
    if (code === 'shopify_install_complete') return { key: 'oauth.shopifyInstallComplete' };
    if (p && OAUTH_SUCCESS_KEY[p.id]) return { key: OAUTH_SUCCESS_KEY[p.id] };
    if (p?.known) return { key: 'oauth.connectedGeneric', values: { provider: p.name } };
    return { key: 'oauth.unknownSuccess' };
  }
  if (code === 'amazon_no_marketplace_selected') return { key: 'amazonSelectMarketplaceFirst' };
  if (code === 'shopify_expiring_token_required') return { key: 'oauth.shopifyTokenType' };
  if (p?.known && /_(csrf_failed|invalid_state|hmac_failed)$/.test(code)) return { key: 'oauth.securityCheckFailed', values: { provider: p.name } };
  if (p?.known && /_missing_params$/.test(code)) return { key: 'oauth.missingParams', values: { provider: p.name } };
  if (p && OAUTH_FAILED_KEY[p.id]) return { key: OAUTH_FAILED_KEY[p.id] };
  if (p?.known) return { key: 'oauth.failedGeneric', values: { provider: p.name } };
  return { key: 'oauth.unknownFailed' };
}

// ── Shell context (read by the sections, Groups B/C/D) ───────────────────────────────────────────
export interface SettingsShellValue {
  /** Active tab (null = mobile index). */
  tab: SettingsTabKey | null;
  mobile: boolean;
  /** `&provider=<id>` deep link (§1.1): open that provider's panel, or focus its tile. Cleared by `clearProvider`. */
  provider: string | null;
  clearProvider: () => void;
  /**
   * Provider whose tile gets the 1.5s focus ring + scroll-into-view (OAuth return or `&provider=` for a
   * tile without a panel). `focusNonce` changes on each request so the same provider can ring twice.
   */
  focusProvider: string | null;
  focusNonce: number;
  /** Bumped after an OAuth return; legacy ConnectionsPanel `refreshKey`. */
  connectionsRefreshKey: number;
  /** Switch tab through the unsaved-changes guard (replace, shallow). Resolves false if the user kept editing. */
  goToTab: (tab: SettingsTabKey, extra?: Record<string, string | undefined>) => Promise<boolean>;
  /** Run `fn` only after the unsaved-changes confirm (e.g. closing a panel that leaves the tab). */
  confirmDiscard: () => Promise<boolean>;
}

export const SettingsShellContext = createContext<SettingsShellValue | null>(null);

/** Shell state for a section; null outside `SettingsPage` (legacy page). */
export function useSettingsShell(): SettingsShellValue | null {
  return useContext(SettingsShellContext);
}

/** Desktop frame (§1.3): 220 nav + 40 gap + 880 content. */
export const SETTINGS_NAV_WIDTH = 220;
export const SETTINGS_NAV_GAP = 40;
/**
 * Sticky offset of the desktop nav (space-4). The M2 shell renders the TopBar outside `<main>`, and
 * `<main>` is the scroll container, so the offset is measured from main's top, not the viewport.
 */
export const SETTINGS_NAV_STICKY_TOP = 16;
/** §3.3 focus ring duration on a tile after OAuth / `&provider=`. */
export const FOCUS_RING_MS = 1500;

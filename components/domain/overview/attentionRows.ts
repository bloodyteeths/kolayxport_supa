// components/domain/overview/attentionRows.ts (overview G6) — pure: summary + connections + notifications →
// the ordered "Needs your attention" rows (overview §3.2). No React, no formatting: text is described as i18n
// keys (full paths from the root, e.g. `overview.attention.paused.title`), raw strings (item names, order
// numbers, errors), a ship-by date (rendered by `<ShipBy>`) or a notification (rendered by the bell's text
// helper). Hrefs come from `lib/nav/links.ts` with explicit flags, so the result is the same in tests.
//
// Rules (§3.2): one row per kind (reconnect: one per provider; drafts: one per marketplace), the table order
// 1–11, a kind with 0 items is not rendered, the first affected item is named and the rest are "+N more".
// Every queue-feeding section in `summary.errors` is reported in `failedSections` (the queue is then never
// "All caught up"). With no store connected only rows 1–3 render.
import {
  createLabelHref,
  listingDoctorHref,
  listingHref,
  listingsHref,
  ordersHref,
  settingsHref,
  type LinkFlags,
} from '@/lib/nav/links';
import { TRIAL_ENDING_DAYS } from '@/lib/ds/status/billing';
import { QUEUE_SECTION_KEYS, type DraftBucket, type OrderRef, type OverviewSummary, type SectionKey } from '@/lib/overview/types';
import type { ConnectionReason } from '@/lib/integrations/connectionStatus';

/** Rows shown before "Show N more" (§3.2). */
export const ATTENTION_VISIBLE_ROWS = 7;
/** Quoted error text in a row detail is cut to this length (§3.2 rows 4 and 7). */
export const ATTENTION_ERROR_MAX = 80;
export const SUPPORT_HREF = '/support';
export const EXTENSION_SETUP_HREF = '/app/entegrasyonlar-ve-rehberler';
/** Where an `orderSyncFailed` row goes when the notification has no link. */
export const NOTIFICATIONS_HREF = '/app/bildirimler';

export type AttentionKind =
  | 'paused'
  | 'reconnect'
  | 'syncFailing'
  | 'labelsFailed'
  | 'overdue'
  | 'conflict'
  | 'sendFailed'
  | 'tracking'
  | 'notSent'
  | 'listingHealth'
  | 'usage';

/** Queue order (§3.2 table, 1–11). */
export const ATTENTION_ORDER: readonly AttentionKind[] = [
  'paused',
  'reconnect',
  'syncFailing',
  'labelsFailed',
  'overdue',
  'conflict',
  'sendFailed',
  'tracking',
  'notSent',
  'listingHealth',
  'usage',
];

/** Kinds that come from client caches (connections, notifications) and render before the summary arrives. */
export const CLIENT_CACHE_KINDS: readonly AttentionKind[] = ['reconnect', 'syncFailing'];

export type AttentionMsgValue = string | number;

/** Row text, rendered by AttentionQueue. */
export type AttentionText =
  | { kind: 'key'; key: string; values?: Record<string, AttentionMsgValue> }
  | { kind: 'raw'; text: string }
  /** `ShipBy` phrase of this ISO date ("Overdue 1 day"). */
  | { kind: 'shipBy'; date: string }
  /** The bell's title for a notification (`notifications.<titleKey>` with its params). */
  | { kind: 'notification'; type: string; titleKey: string; params: Record<string, string | number> | null };

/** The leading pill. `score` = ScoreMeter cell of the worst listing (row 10). */
export type AttentionPill =
  | { kind: 'status'; domain: 'subscription'; status: 'expired' | 'near_limit' | 'trial_ending' }
  | { kind: 'status'; domain: 'connection'; status: 'needs_reconnect' }
  | { kind: 'status'; domain: 'sync'; status: 'refresh_failed' | 'conflict' | 'sync_failed' | 'pending' }
  | { kind: 'status'; domain: 'label'; status: 'label_failed' }
  | { kind: 'status'; domain: 'order'; status: 'overdue' }
  | { kind: 'status'; domain: 'tracking'; status: 'not_sent' | 'send_failed' }
  | { kind: 'score'; score: number };

export type AttentionLead =
  | { kind: 'logo'; brand: string }
  | { kind: 'thumb'; src: string | null; alt: string }
  | null;

export interface AttentionRow {
  /** Stable React key / test id: `<kind>` or `<kind>:<provider|marketplace>`. */
  id: string;
  kind: AttentionKind;
  pill: AttentionPill;
  lead: AttentionLead;
  title: AttentionText;
  detail: AttentionText | null;
  /** Items beyond the named one ("+N more"); 0 = none. */
  more: number;
  cta: { label: AttentionText; href: string };
}

/** A provider that must be re-authorised (useConnections `needsReauth` + its entry). */
export interface ReconnectInput {
  provider: string;
  /** Display name (lib/ds/logos), e.g. "eBay". */
  name: string;
  reason?: ConnectionReason | string | null;
}

/** An unresolved `orderSyncFailed` notification (useNotifications item subset). */
export interface SyncFailureInput {
  id: string;
  type: string;
  titleKey: string;
  params: Record<string, string | number> | null;
  link: string | null;
  createdAt?: string;
  resolvedAt?: string | null;
}

export interface AttentionInput {
  /** undefined while loading; null when the whole request failed (only client-cache rows then). */
  summary: OverviewSummary | null | undefined;
  reconnect: readonly ReconnectInput[];
  syncFailures: readonly SyncFailureInput[];
  /** `useConnections().extension?.detected`; null/undefined = unknown (treated as not set up). */
  extensionDetected: boolean | null | undefined;
  /** `useConnections().anyMarketplace`: false = no store connected → rows 1–3 only. */
  anyMarketplace: boolean | undefined;
  flags: LinkFlags;
  now: Date;
}

export interface AttentionModel {
  rows: AttentionRow[];
  /** Queue-feeding sections the server could not check (§3.2 "Partial"), in QUEUE_SECTION_KEYS order. */
  failedSections: SectionKey[];
}

const key = (k: string, values?: Record<string, AttentionMsgValue>): AttentionText => (values ? { kind: 'key', key: k, values } : { kind: 'key', key: k });
const raw = (text: string): AttentionText => ({ kind: 'raw', text });

const MARKETPLACE_NAME = { etsy: 'Etsy', ebay: 'eBay' } as const;
type DraftMarketplace = keyof typeof MARKETPLACE_NAME;
const DRAFT_MARKETPLACES: readonly DraftMarketplace[] = ['etsy', 'ebay'];

/** Pure: an error for a row detail — never JSON, ≤ 80 chars with an ellipsis, quoted. Null when unusable. */
export function quoteError(error: string | null | undefined, max = ATTENTION_ERROR_MAX): string | null {
  if (typeof error !== 'string') return null;
  const s = error.replace(/\s+/g, ' ').trim();
  if (!s || s.startsWith('{') || s.startsWith('[')) return null;
  const cut = s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
  return `“${cut}”`;
}

/** Pure: "#3891 Baby Blanket" for an order reference. */
export function orderRefText(ref: Pick<OrderRef, 'orderNumber' | 'itemName'>): string {
  const num = ref.orderNumber ? `#${ref.orderNumber.replace(/^#/, '')}` : '';
  const item = ref.itemName?.trim() ?? '';
  return [num, item].filter(Boolean).join(' ');
}

/** Whole days until `iso` (ceil), or null when it is not in the future. */
export function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end) || end <= now.getTime()) return null;
  return Math.max(1, Math.ceil((end - now.getTime()) / 86_400_000));
}

export type UsageSnapshotLike = Pick<NonNullable<OverviewSummary['usage']>, 'blocked' | 'orderSync' | 'label'>;

/** What a usage block actually pauses. `reason` = the server's blocked reason (null when nothing is paused). */
export interface UsagePause {
  orderSync: boolean;
  label: boolean;
  reason: NonNullable<OverviewSummary['usage']>['blocked'];
}

const atLimit = (m: { used: number; limit: number | null } | null | undefined) => Boolean(m && m.limit != null && m.used >= m.limit);

/**
 * Pure: which meters are paused. `blocked` is set by the server when ANY meter is exhausted, so it is split
 * per meter here: a trial user with 10 of 10 labels and 5 of 50 order syncs can still refresh orders.
 * noSubscription / invalidPlan (an expired trial is noSubscription) pause both. A trial/planLimit block whose
 * meters show no exhausted meter (a snapshot from another source) is treated as pausing both (the server
 * will refuse anyway).
 */
export function usagePause(u: UsageSnapshotLike | null | undefined): UsagePause {
  if (!u?.blocked) return { orderSync: false, label: false, reason: null };
  if (u.blocked === 'noSubscription' || u.blocked === 'invalidPlan') return { orderSync: true, label: true, reason: u.blocked };
  const orderSync = atLimit(u.orderSync);
  const label = atLimit(u.label);
  if (!orderSync && !label) return { orderSync: true, label: true, reason: u.blocked };
  return { orderSync, label, reason: u.blocked };
}

function pausedRow(summary: OverviewSummary): AttentionRow | null {
  const u = summary.usage;
  const p = usagePause(u);
  if (!u || !p.reason || (!p.orderSync && !p.label)) return null;
  const whole = p.reason === 'noSubscription' || p.reason === 'invalidPlan';
  let title: AttentionText;
  let detail: AttentionText;
  if (whole) {
    title = key('overview.attention.paused.title');
    detail = key('overview.attention.paused.reason', { reason: p.reason });
  } else if (p.orderSync && p.label) {
    // Both meters used up: a limit, not an ended trial (an ended trial is noSubscription).
    title = key('overview.attention.paused.title');
    detail = key('overview.attention.paused.limitReason', { reason: p.reason });
  } else {
    const k = p.orderSync ? 'orderSync' : 'label';
    title = key(p.orderSync ? 'overview.attention.paused.titleOrderSync' : 'overview.attention.paused.titleLabels');
    detail = key('overview.attention.usage.detail', { kind: k, used: u[k].used, limit: u[k].limit as number });
  }
  return {
    id: 'paused',
    kind: 'paused',
    pill: { kind: 'status', domain: 'subscription', status: 'expired' },
    lead: null,
    title,
    detail,
    more: 0,
    // shopify_free never sees Stripe/pricing (tiers.md): support instead of plans.
    cta: u.hideBilling
      ? { label: key('overview.attention.paused.supportCta'), href: SUPPORT_HREF }
      : { label: key('overview.attention.paused.cta'), href: settingsHref('billing') },
  };
}

function reconnectRows(list: readonly ReconnectInput[]): AttentionRow[] {
  const seen = new Set<string>();
  const out: AttentionRow[] = [];
  for (const r of list) {
    if (!r.provider || seen.has(r.provider)) continue;
    seen.add(r.provider);
    out.push({
      id: `reconnect:${r.provider}`,
      kind: 'reconnect',
      pill: { kind: 'status', domain: 'connection', status: 'needs_reconnect' },
      lead: { kind: 'logo', brand: r.provider },
      title: raw(r.name),
      detail: r.reason ? key(`overview.reason.${r.reason}`) : null,
      more: 0,
      cta: { label: key('overview.attention.reconnect.cta', { provider: r.name }), href: settingsHref('connections', r.provider) },
    });
  }
  return out;
}

function syncFailingRow(list: readonly SyncFailureInput[]): AttentionRow | null {
  const open = list.filter((n) => n.type === 'orderSyncFailed' && !n.resolvedAt);
  if (!open.length) return null;
  const sorted = [...open].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const first = sorted[0];
  const provider = first.params && typeof first.params.provider === 'string' ? first.params.provider : null;
  return {
    id: 'syncFailing',
    kind: 'syncFailing',
    pill: { kind: 'status', domain: 'sync', status: 'refresh_failed' },
    lead: provider ? { kind: 'logo', brand: provider } : null,
    title: { kind: 'notification', type: first.type, titleKey: first.titleKey, params: first.params },
    detail: null,
    more: sorted.length - 1,
    cta: { label: key('overview.attention.syncFailing.cta'), href: first.link ?? NOTIFICATIONS_HREF },
  };
}

function labelsFailedRow(summary: OverviewSummary, flags: LinkFlags): AttentionRow | null {
  const l = summary.labels;
  if (!l || l.failed <= 0) return null;
  const first = l.first;
  const refText = first ? orderRefText(first) : '';
  const err = quoteError(first?.error);
  return {
    id: 'labelsFailed',
    kind: 'labelsFailed',
    pill: { kind: 'status', domain: 'label', status: 'label_failed' },
    lead: first ? { kind: 'logo', brand: first.channel } : null,
    title: refText ? raw(refText) : key('overview.attention.labelsFailed.title', { count: l.failed }),
    detail: err ? raw(err) : null,
    more: refText ? l.failed - 1 : 0,
    cta: { label: key('overview.attention.labelsFailed.cta'), href: ordersHref('problems', null, null, null, {}, flags) },
  };
}

function overdueRow(summary: OverviewSummary, flags: LinkFlags): AttentionRow | null {
  const s = summary.toShip;
  if (!s || s.overdue <= 0) return null;
  const first = s.firstOverdue;
  const refText = first ? orderRefText(first) : '';
  return {
    id: 'overdue',
    kind: 'overdue',
    pill: { kind: 'status', domain: 'order', status: 'overdue' },
    lead: first ? { kind: 'logo', brand: first.channel } : null,
    title: refText ? raw(refText) : key('overview.attention.overdue.title', { count: s.overdue }),
    detail: first?.shipBy ? { kind: 'shipBy', date: first.shipBy } : null,
    more: refText ? s.overdue - 1 : 0,
    cta: {
      label: key('overview.attention.overdue.cta'),
      href: first ? createLabelHref(first.id, first.orderNumber, flags) : ordersHref('overdue', null, null, null, {}, flags),
    },
  };
}

function draftTitle(ref: { title: string | null; listingId: string } | null): string | null {
  const t = ref?.title?.trim();
  return t || null;
}

function conflictRow(mp: DraftMarketplace, b: DraftBucket, flags: LinkFlags): AttentionRow | null {
  if (b.conflict <= 0) return null;
  const first = b.firstConflict;
  const title = draftTitle(first);
  const marketplace = MARKETPLACE_NAME[mp];
  return {
    id: `conflict:${mp}`,
    kind: 'conflict',
    pill: { kind: 'status', domain: 'sync', status: 'conflict' },
    lead: first ? { kind: 'thumb', src: first.thumb, alt: title ?? '' } : { kind: 'logo', brand: mp },
    title: title ? raw(title) : key('overview.attention.conflict.title', { count: b.conflict, marketplace }),
    detail: key('overview.attention.conflict.detail', { marketplace }),
    more: title ? b.conflict - 1 : 0,
    cta: {
      label: key('overview.attention.conflict.cta'),
      // Review only: a conflicted draft is never re-sent from here (it may hold a queued delete).
      href: first ? listingHref(mp, first.listingId, flags) : listingsHref(mp, 'send_failed', flags),
    },
  };
}

function sendFailedRow(mp: DraftMarketplace, b: DraftBucket, flags: LinkFlags): AttentionRow | null {
  if (b.failed <= 0) return null;
  const first = b.firstFailed;
  const title = draftTitle(first);
  const err = quoteError(first?.error);
  const marketplace = MARKETPLACE_NAME[mp];
  return {
    id: `sendFailed:${mp}`,
    kind: 'sendFailed',
    pill: { kind: 'status', domain: 'sync', status: 'sync_failed' },
    lead: first ? { kind: 'thumb', src: first.thumb, alt: title ?? '' } : { kind: 'logo', brand: mp },
    title: title ? raw(title) : key('overview.attention.sendFailed.title', { count: b.failed, marketplace }),
    detail: err ? raw(err) : null,
    more: title ? b.failed - 1 : 0,
    cta: {
      label: key('overview.attention.sendFailed.cta'),
      href: first ? listingHref(mp, first.listingId, flags) : listingsHref(mp, 'send_failed', flags),
    },
  };
}

function trackingRow(summary: OverviewSummary, extensionDetected: boolean | null | undefined, flags: LinkFlags): AttentionRow | null {
  const tr = summary.tracking;
  if (!tr) return null;
  const total = tr.notSent + tr.failed;
  if (total <= 0) return null;
  const first = tr.first;
  const num = first?.orderNumber ? `#${first.orderNumber.replace(/^#/, '')}` : '';
  return {
    id: 'tracking',
    kind: 'tracking',
    pill: { kind: 'status', domain: 'tracking', status: tr.failed > 0 ? 'send_failed' : 'not_sent' },
    lead: { kind: 'logo', brand: 'etsy' },
    title: num ? raw(num) : key('overview.attention.tracking.title', { count: total }),
    detail: key('overview.attention.tracking.detail'),
    more: num ? total - 1 : 0,
    cta: extensionDetected
      ? { label: key('overview.attention.tracking.cta'), href: ordersHref('label_created', null, 'etsy', null, {}, flags) }
      : { label: key('overview.attention.tracking.setupCta'), href: EXTENSION_SETUP_HREF },
  };
}

function notSentRow(mp: DraftMarketplace, b: DraftBucket, flags: LinkFlags): AttentionRow | null {
  if (b.draft <= 0) return null;
  const marketplace = MARKETPLACE_NAME[mp];
  return {
    id: `notSent:${mp}`,
    kind: 'notSent',
    pill: { kind: 'status', domain: 'sync', status: 'pending' },
    lead: { kind: 'logo', brand: mp },
    title: key('overview.attention.notSent.title', { count: b.draft, marketplace }),
    detail: null,
    more: 0,
    // "Review & send" opens the list's Not sent view; nothing is sent from the Overview (explicit send only).
    cta: { label: key('overview.attention.notSent.cta'), href: listingsHref(mp, 'changes_not_sent', flags) },
  };
}

function listingHealthRow(summary: OverviewSummary, flags: LinkFlags): AttentionRow | null {
  const h = summary.listingHealth?.etsy;
  if (!h || h.needsWork <= 0) return null;
  const href = listingDoctorHref(flags);
  if (!href) return null; // before M5 there is no needs-work list: the row is hidden (§3.2 row 10)
  const worst = h.worst;
  return {
    id: 'listingHealth',
    kind: 'listingHealth',
    pill: worst ? { kind: 'score', score: worst.score } : { kind: 'score', score: 0 },
    lead: null,
    title: key('overview.attention.health.title', { count: h.needsWork }),
    detail: worst?.title ? raw(worst.title) : null,
    more: 0,
    cta: { label: key(flags.research ? 'overview.attention.health.cta' : 'overview.attention.health.ctaLegacy'), href },
  };
}

function usageRow(summary: OverviewSummary, now: Date): AttentionRow | null {
  const u = summary.usage;
  if (!u || u.blocked || u.hideBilling) return null;
  const trialDays = /trial/i.test(u.status ?? '') || u.plan === 'trial' ? daysUntil(u.trialEndsAt, now) : null;
  if (trialDays != null && trialDays <= TRIAL_ENDING_DAYS) {
    return {
      id: 'usage',
      kind: 'usage',
      pill: { kind: 'status', domain: 'subscription', status: 'trial_ending' },
      lead: null,
      title: key('overview.attention.trialEnds', { days: trialDays }),
      detail: null,
      more: 0,
      cta: { label: key('overview.attention.usage.cta'), href: settingsHref('billing') },
    };
  }
  if (!u.nearLimit) return null;
  // The meter closest to its limit names the row ("Labels: 9 of 10 used").
  const meters = (['orderSync', 'label'] as const)
    .map((k) => ({ k, m: u[k] }))
    .filter(({ m }) => m.limit != null && m.limit > 0)
    .sort((a, b) => b.m.used / (b.m.limit as number) - a.m.used / (a.m.limit as number));
  const top = meters[0];
  return {
    id: 'usage',
    kind: 'usage',
    pill: { kind: 'status', domain: 'subscription', status: 'near_limit' },
    lead: null,
    title: top
      ? key('overview.attention.usage.detail', { kind: top.k, used: top.m.used, limit: top.m.limit as number })
      : key('overview.attention.usage.cta'),
    detail: null,
    more: 0,
    cta: { label: key('overview.attention.usage.cta'), href: settingsHref('billing') },
  };
}

/** Pure: the ordered queue. */
export function buildAttentionRows(input: AttentionInput): AttentionModel {
  const { summary, flags, now } = input;
  const rows: AttentionRow[] = [];
  const push = (r: AttentionRow | null) => {
    if (r) rows.push(r);
  };

  if (summary) push(pausedRow(summary));
  rows.push(...reconnectRows(input.reconnect));
  push(syncFailingRow(input.syncFailures));

  const failedSections: SectionKey[] = summary ? QUEUE_SECTION_KEYS.filter((k) => summary.errors.includes(k)) : [];

  // No store: only rows 1–3 (§3.2 "Not connected").
  if (summary && input.anyMarketplace !== false) {
    push(labelsFailedRow(summary, flags));
    push(overdueRow(summary, flags));
    const drafts = summary.drafts;
    if (drafts) for (const mp of DRAFT_MARKETPLACES) push(conflictRow(mp, drafts[mp], flags));
    if (drafts) for (const mp of DRAFT_MARKETPLACES) push(sendFailedRow(mp, drafts[mp], flags));
    push(trackingRow(summary, input.extensionDetected, flags));
    if (drafts) for (const mp of DRAFT_MARKETPLACES) push(notSentRow(mp, drafts[mp], flags));
    push(listingHealthRow(summary, flags));
    push(usageRow(summary, now));
  }

  // Stable sort by the §3.2 order (reconnect rows keep their provider order).
  const rank = (k: AttentionKind) => ATTENTION_ORDER.indexOf(k);
  const ordered = rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r.kind) - rank(b.r.kind) || a.i - b.i).map(({ r }) => r);
  return { rows: ordered, failedSections };
}

export type QueueState = 'loading' | 'rows' | 'done' | 'doneWithErrors' | 'notConnected' | 'noOrders' | 'error';

/**
 * Pure: what the queue body shows besides its rows.
 * - `loading`: no summary yet (client-cache rows + skeleton rows)
 * - `error`: the whole request failed with nothing cached (client-cache rows + "Couldn't load your overview")
 * - `notConnected`: no store and the setup card is dismissed (first-use EmptyState under rows 1–3)
 * - `noOrders`: a store is connected but no order exists yet ("No orders yet" + [Refresh orders], under any rows)
 * - `doneWithErrors`: no rows but a check failed ("Nothing else needs attention · N checks failed")
 * - `done`: nothing at all ("All caught up")
 */
export function queueState(args: {
  summary: OverviewSummary | null | undefined;
  wholeError: boolean;
  model: AttentionModel;
  anyMarketplace: boolean | undefined;
  setupCardVisible: boolean;
}): QueueState {
  const { summary, wholeError, model, anyMarketplace, setupCardVisible } = args;
  if (!summary) return wholeError ? 'error' : 'loading';
  if (anyMarketplace === false && !setupCardVisible) return 'notConnected';
  if (anyMarketplace === true && summary.setup && !summary.setup.hasOrders) return 'noOrders';
  if (model.rows.length) return 'rows';
  return model.failedSections.length ? 'doneWithErrors' : 'done';
}

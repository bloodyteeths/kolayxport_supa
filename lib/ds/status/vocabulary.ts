// lib/ds/status/vocabulary.ts — DESIGN_SYSTEM §3.9 + every surface addition (BUILD_PLAN §2, CRITIQUE C7/C26):
// listing in_review/rejected (listings-grid §1.2), message in_review/answer_rejected (messages §11),
// subscription ×8 + invoice ×4 + run ×3 (settings §14), tracking ×2 + sync.refresh_failed (overview §6).
// Closed vocabulary: StatusPill takes `domain` + `status` only; labels come from i18n `status.<domain>.<key>`.
// Registry frozen in M1-a; later changes go through the integrator.

import type { ToneKey } from '@/lib/ds/tokens';

/** `solid` = tone dot · `hollow` = ring dot · `accent` = accent-600 dot on a neutral pill · `pulse` = animated tone dot. */
export type StatusDot = 'solid' | 'hollow' | 'accent' | 'pulse';

export interface StatusStyle {
  tone: ToneKey;
  dot?: StatusDot;
  /** Transparent background with a tone border instead of the soft fill (connection `incomplete`). */
  outline?: boolean;
}

export const STATUS_VOCABULARY = {
  order: {
    to_ship: { tone: 'info' },
    overdue: { tone: 'danger' },
    label_created: { tone: 'neutral', dot: 'accent' },
    shipped: { tone: 'success' },
    delivered: { tone: 'success', dot: 'hollow' },
    on_hold: { tone: 'warning' },
    problem: { tone: 'danger' },
    cancelled: { tone: 'neutral' },
    refunded: { tone: 'neutral' },
  },
  label: {
    label_failed: { tone: 'danger' },
  },
  listing: {
    active: { tone: 'success' },
    draft: { tone: 'neutral' },
    inactive: { tone: 'neutral', dot: 'hollow' },
    sold_out: { tone: 'warning' },
    expired: { tone: 'warning' },
    in_review: { tone: 'info' },
    rejected: { tone: 'danger' },
  },
  sync: {
    pending: { tone: 'attention' },
    syncing: { tone: 'info', dot: 'pulse' },
    sync_failed: { tone: 'danger' },
    conflict: { tone: 'warning' },
    synced: { tone: 'success' },
    refresh_failed: { tone: 'danger' },
  },
  connection: {
    connected: { tone: 'success' },
    needs_reconnect: { tone: 'warning' },
    incomplete: { tone: 'warning', outline: true },
    not_connected: { tone: 'neutral' },
    check_failed: { tone: 'neutral' },
  },
  message: {
    unread: { tone: 'info' },
    needs_reply: { tone: 'warning' },
    in_review: { tone: 'info' },
    answer_rejected: { tone: 'danger' },
  },
  subscription: {
    trial: { tone: 'info' },
    grace: { tone: 'warning' },
    active: { tone: 'success' },
    canceling: { tone: 'warning' },
    past_due: { tone: 'danger' },
    expired: { tone: 'danger' },
    near_limit: { tone: 'warning' },
    trial_ending: { tone: 'warning' },
  },
  invoice: {
    paid: { tone: 'success' },
    open: { tone: 'warning' },
    void: { tone: 'neutral' },
    uncollectible: { tone: 'danger' },
  },
  run: {
    completed: { tone: 'success' },
    running: { tone: 'info', dot: 'pulse' },
    failed: { tone: 'danger' },
  },
  tracking: {
    not_sent: { tone: 'warning' },
    send_failed: { tone: 'danger' },
  },
} as const satisfies Record<string, Record<string, StatusStyle>>;

export type StatusDomain = keyof typeof STATUS_VOCABULARY;
export type StatusKeyOf<D extends StatusDomain> = keyof (typeof STATUS_VOCABULARY)[D] & string;
/** Any key of any domain. Prefer `StatusKeyOf<D>` where the domain is known. */
export type StatusKey = { [D in StatusDomain]: StatusKeyOf<D> }[StatusDomain];

export type OrderStatusKey = StatusKeyOf<'order'>;
export type LabelStatusKey = StatusKeyOf<'label'>;
export type ListingStatusKey = StatusKeyOf<'listing'>;
export type SyncStatusKey = StatusKeyOf<'sync'>;
export type ConnectionStatusKey = StatusKeyOf<'connection'>;
export type MessageStatusKey = StatusKeyOf<'message'>;
export type SubscriptionStatusKey = StatusKeyOf<'subscription'>;
export type InvoiceStatusKey = StatusKeyOf<'invoice'>;
export type RunStatusKey = StatusKeyOf<'run'>;
export type TrackingStatusKey = StatusKeyOf<'tracking'>;

export const STATUS_DOMAINS = Object.keys(STATUS_VOCABULARY) as StatusDomain[];

export function isStatusDomain(d: unknown): d is StatusDomain {
  return typeof d === 'string' && Object.prototype.hasOwnProperty.call(STATUS_VOCABULARY, d);
}

export function isStatusKey<D extends StatusDomain>(domain: D, key: unknown): key is StatusKeyOf<D> {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(STATUS_VOCABULARY[domain], key);
}

/** Style for a pill, or null when the pair is not in the vocabulary. */
export function getStatusStyle(domain: StatusDomain, key: string): StatusStyle | null {
  if (!isStatusDomain(domain) || !isStatusKey(domain, key)) return null;
  return (STATUS_VOCABULARY[domain] as Record<string, StatusStyle>)[key];
}

/** i18n key inside the `status` namespace: `useTranslations('status')(statusMessageKey('order','to_ship'))`. */
export function statusMessageKey(domain: StatusDomain, key: string): string {
  return `${domain}.${key}`;
}

/** Every `status.<domain>.<key>` message id the vocabulary needs (used by the parity test). */
export function allStatusMessageIds(): string[] {
  return STATUS_DOMAINS.flatMap((d) => Object.keys(STATUS_VOCABULARY[d]).map((k) => `status.${d}.${k}`));
}

const TR_FOLD: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ç: 'c', ö: 'o', ü: 'u' };

/**
 * Lower-case, trimmed, Turkish letters folded, camelCase/spaces/dashes to underscores:
 * "Partially Shipped" / "PartiallyShipped" / "partially-shipped" → "partially_shipped"; "Kargolandı" → "kargolandi".
 */
export function normalizeRaw(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLocaleLowerCase('tr')
    .replace(/[ışğçöü]/g, (c) => TR_FOLD[c] ?? c)
    .replace(/[\s-]+/g, '_');
}

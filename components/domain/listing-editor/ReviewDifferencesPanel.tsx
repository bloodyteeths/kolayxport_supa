// components/domain/listing-editor/ReviewDifferencesPanel.tsx — listing-editor §6.4, §10 Group H.
// "Review differences": a SidePanel lg opened from the conflict banner or the footer primary when the
// marketplace changed the listing after the draft started. One row per field, the seller picks Mine / Etsy's.
//
// Safety (CLAUDE.md "Known caution", founder rules):
//  - The review NEVER sends. [Keep my choices] → POST /api/{etsy,ebay}-drafts/:id/resolve { keep } re-bases the
//    draft on the live listing and sets it back to `draft`; sending stays the footer's explicit Send.
//  - `force: true` is not reachable from here (or anywhere in the new editor).
//  - A queued `delete` is always listed first, in danger tone, with [Remove] (un-queues it without discarding
//    the draft). Other queued actions are listed so nothing hides behind the review. Keeping choices while the
//    delete is still queued asks again: "This will delete the listing on Etsy", type the shop name (§6.4).
//  - Every label is translated: unknown field keys / action types get a neutral translated label, never English
//    built from the API key (founder: no mixed TR/EN).
//  - Fields Etsy changed that the draft did not touch are shown read-only ("Etsy's, no choice").
// Data: GET /api/{etsy,ebay}-drafts/:id/diff (Group G route over backend BR-3; eBay F3). 501 NOT_AVAILABLE until
// the backend ships → an inline "not available yet" state with the frame's fallback actions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { RadioGroup } from '@/components/ds/inputs/RadioGroup';
import { Button } from '@/components/ds/inputs/Button';
import { Banner } from '@/components/ds/feedback/Banner';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { useFormatters } from '@/lib/format';
import { icons } from '@/lib/ds/icons';
import { neutral, tone, radius } from '@/lib/ds/tokens';
import { removeEtsyDraftQueuedActions } from '@/lib/etsy/draftClient';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { decodeEntities } from '@/lib/text/decodeEntities';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Types + pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Etsy/eBay drafts, or the Trendyol/Wix/Shopify CatalogDraft (same diff/resolve contract, marketplace-editors §7.1). */
export type ReviewMarketplace = 'etsy' | 'ebay' | 'trendyol' | 'wix' | 'shopify';
export type ReviewChoice = 'mine' | 'remote';

/** One field of GET …/diff (pages/api/etsy-drafts/[id]/diff.ts `DraftDiffField`). */
export interface ReviewDiffField {
  key: string;
  base: unknown;
  remote: unknown;
  draft: unknown;
  changedRemotely: boolean;
  inDraft: boolean;
}

export interface ReviewDiff {
  remoteUpdatedAt: string | null;
  fields: ReviewDiffField[];
  queuedActions: Array<{ type: string; [k: string]: unknown }>;
  hasQueuedDelete?: boolean;
}

export type ReviewRowKind = 'conflict' | 'remoteOnly' | 'draftOnly';

export interface ReviewRow extends ReviewDiffField {
  kind: ReviewRowKind;
}

/** Conflicts first (the seller must choose), then Etsy-only changes (read-only), then draft-only (kept). */
export function buildReviewRows(diff: Pick<ReviewDiff, 'fields'> | null | undefined): ReviewRow[] {
  const rows = (diff?.fields ?? [])
    .filter((f) => f && typeof f.key === 'string' && (f.inDraft || f.changedRemotely))
    .map<ReviewRow>((f) => ({
      ...f,
      kind: f.inDraft && f.changedRemotely ? 'conflict' : f.changedRemotely ? 'remoteOnly' : 'draftOnly',
    }));
  const order: Record<ReviewRowKind, number> = { conflict: 0, remoteOnly: 1, draftOnly: 2 };
  return rows.map((r, i) => ({ r, i })).sort((a, b) => order[a.r.kind] - order[b.r.kind] || a.i - b.i).map(({ r }) => r);
}

/** Default: keep the seller's own edits (Mine) for every conflict. */
export function defaultChoices(rows: readonly ReviewRow[]): Record<string, ReviewChoice> {
  const out: Record<string, ReviewChoice> = {};
  for (const r of rows) if (r.kind === 'conflict') out[r.key] = 'mine';
  return out;
}

/**
 * Body of POST …/resolve: every draft field the seller keeps. Draft-only fields (Etsy did not touch them) are always
 * kept; a conflict is kept unless the seller picked Etsy's value.
 */
export function keepList(rows: readonly ReviewRow[], choices: Readonly<Record<string, ReviewChoice>>): string[] {
  return rows
    .filter((r) => r.inDraft && (r.kind === 'draftOnly' || choices[r.key] !== 'remote'))
    .map((r) => r.key);
}

/** Queued actions with a pending `delete` first (never hidden behind the review). */
export function orderQueued(actions: ReviewDiff['queuedActions'] | null | undefined): ReviewDiff['queuedActions'] {
  const list = (actions ?? []).filter((a) => a && typeof a.type === 'string' && !(a as { completedAt?: unknown }).completedAt);
  return [...list.filter((a) => a.type === 'delete'), ...list.filter((a) => a.type !== 'delete')];
}

const PRICE_KEYS = new Set(['price', 'pricingSummary.price', 'offer.price']);
const MAX_TEXT = 140;

/** Full i18n key for a field label; keys not listed get `review.fields.other` ("Other field"). */
export const FIELD_LABEL_KEYS: Record<string, string> = {
  title: 'listingEditor.field.title',
  subtitle: 'listingEditor.field.subtitle',
  description: 'listingEditor.field.description',
  tags: 'listingEditor.section.tags',
  materials: 'listingEditor.field.materials',
  price: 'listingEditor.field.price',
  quantity: 'listingEditor.field.quantity',
  sku: 'listingEditor.field.sku',
  taxonomy_id: 'listingEditor.field.category',
  categoryId: 'listingEditor.field.category',
  who_made: 'listingEditor.field.whoMade',
  is_supply: 'listingEditor.field.whatIsIt',
  when_made: 'listingEditor.field.whenMade',
  shop_section_id: 'listingEditor.field.section',
  shipping_profile_id: 'listingEditor.field.shippingProfile',
  return_policy_id: 'listingEditor.field.returnPolicy',
  readiness_state_id: 'listingEditor.field.processing',
  processing_min: 'listingEditor.review.fields.processingMin',
  processing_max: 'listingEditor.review.fields.processingMax',
  item_weight: 'listingEditor.field.weight',
  item_weight_unit: 'listingEditor.review.fields.weightUnit',
  item_length: 'listingEditor.review.fields.length',
  item_width: 'listingEditor.review.fields.width',
  item_height: 'listingEditor.review.fields.height',
  item_dimensions_unit: 'listingEditor.review.fields.sizeUnit',
  is_personalizable: 'listingEditor.section.personalization',
  personalization_is_required: 'listingEditor.review.fields.personalizationRequired',
  personalization_char_count_max: 'listingEditor.review.fields.personalizationLimit',
  personalization_instructions: 'listingEditor.review.fields.personalizationInstructions',
  condition: 'listingEditor.field.condition',
  conditionDescription: 'listingEditor.field.conditionDescription',
  aspects: 'listingEditor.section.specifics',
  fulfillmentPolicyId: 'listingEditor.field.shippingProfile',
  returnPolicyId: 'listingEditor.field.returnPolicy',
  paymentPolicyId: 'listingEditor.field.paymentPolicy',
  packageWeightAndSize: 'listingEditor.field.dimensions',
  // Etsy fields outside the editor form that a draft or Etsy may still change
  style: 'listingEditor.review.fields.style',
  should_auto_renew: 'listingEditor.review.fields.autoRenew',
  is_taxable: 'listingEditor.review.fields.taxable',
  production_partner_ids: 'listingEditor.review.fields.productionPartners',
  type: 'listingEditor.review.fields.listingType',
  state: 'listingEditor.review.fields.state',
  featured_rank: 'listingEditor.review.fields.featured',
  image_ids: 'listingEditor.review.fields.photos',
  images: 'listingEditor.review.fields.photos',
  imageUrls: 'listingEditor.review.fields.photos',
  videos: 'listingEditor.review.fields.video',
  inventory: 'listingEditor.section.variations',
  variations: 'listingEditor.section.variations',
  variationImages: 'listingEditor.review.fields.variationPhotos',
  personalization: 'listingEditor.section.personalization',
  // eBay (EBAY_FIELD_KEYS + lib/ebay/draftPlan EBAY_DIFF_FIELDS)
  currency: 'listingEditor.review.fields.currency',
  storeCategoryNames: 'listingEditor.review.fields.storeCategories',
  listingPolicies: 'listingEditor.review.fields.policies',
  listingDescription: 'listingEditor.field.description',
  createVariations: 'listingEditor.section.variations',
  weight: 'listingEditor.field.weight',
  weightUnit: 'listingEditor.review.fields.weightUnit',
  length: 'listingEditor.review.fields.length',
  width: 'listingEditor.review.fields.width',
  height: 'listingEditor.review.fields.height',
  dimensionUnit: 'listingEditor.review.fields.sizeUnit',
  dimensions: 'listingEditor.field.dimensions',
  value: 'listingEditor.review.fields.value',
  unit: 'listingEditor.review.fields.unit',
};

/** Queued action types (lib/etsy/draftService QUEUED_ACTION_TYPES + eBay `create`); each has `review.queued.<type>`. */
export const REVIEW_QUEUED_TYPES = [
  'create_listing', 'create_shop_section', 'create_shipping_profile', 'create_return_policy',
  'publish', 'deactivate', 'renew', 'delete', 'copy', 'withdraw', 'create',
] as const;

/** Full i18n key for a field label (dotted paths use the last part); unknown → the neutral "Other field". */
export function fieldLabelKey(key: string): string {
  return FIELD_LABEL_KEYS[key] ?? FIELD_LABEL_KEYS[key.split('.').pop() ?? ''] ?? 'listingEditor.review.fields.other';
}

/** "item_weight_unit" → "Item weight unit". Diagnostics only: the UI never shows it (no English built from API keys). */
export function humanizeKey(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function isMoneyObject(v: unknown): v is { amount: number; divisor?: number; currency_code?: string; currency?: string; value?: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && (typeof (v as { amount?: unknown }).amount === 'number' || typeof (v as { value?: unknown }).value === 'string');
}

/** Keys whose object values are seller / marketplace content (item specific names), shown as they are. */
const CONTENT_KEYS = new Set(['aspects', 'product.aspects']);

/**
 * Plain one-line text of a diff value (entities decoded, long text cut with an ellipsis). Empty → null.
 * Object values show translated sub-labels (`fmt.label`), never raw API keys; item specifics keep their names.
 */
export function plainValue(
  value: unknown,
  fmt: { money: (a: number, c: string) => string; num: (v: number) => string; yes: string; no: string; label?: (key: string) => string | null },
  key: string,
  currency?: string | null,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? fmt.yes : fmt.no;
  if (typeof value === 'number') {
    if (PRICE_KEYS.has(key) && currency) return fmt.money(value, currency);
    return fmt.num(value);
  }
  if (typeof value === 'string') {
    const s = decodeEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    if (PRICE_KEYS.has(key) && currency && /^\d+(\.\d+)?$/.test(s)) return fmt.money(Number(s), currency);
    return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1).trimEnd()}…` : s;
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => plainValue(v, fmt, '', currency)).filter((v): v is string => !!v);
    if (!parts.length) return null;
    const shown = parts.slice(0, 6).join(', ');
    return parts.length > 6 ? `${shown} +${parts.length - 6}` : shown;
  }
  if (isMoneyObject(value)) {
    const amount = typeof value.amount === 'number' ? value.amount / (value.divisor || 1) : Number(value.value);
    const code = value.currency_code || value.currency || currency || '';
    return Number.isFinite(amount) ? (code ? fmt.money(amount, code) : fmt.num(amount)) : null;
  }
  if (typeof value === 'object') {
    const content = CONTENT_KEYS.has(key);
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const p = plainValue(v, fmt, k, currency);
        if (!p) return null;
        const name = content ? k : fmt.label?.(k) ?? null;
        return name ? `${name}: ${p}` : p;
      })
      .filter((v): v is string => !!v);
    if (!entries.length) return null;
    const shown = entries.slice(0, 3).join('; ');
    return entries.length > 3 ? `${shown} +${entries.length - 3}` : shown;
  }
  return null;
}

function toDate(v: Date | string | number | null | undefined): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReviewDifferencesPanelProps {
  open: boolean;
  onClose: () => void;
  marketplace: ReviewMarketplace;
  /** EtsyListingDraft / EbayListingDraft id. */
  draftId: string | null;
  /** When the draft started (DraftRow.createdAt): "…after your draft started at 10:31". */
  draftStartedAt?: Date | string | null;
  /** Listing currency, for price rows. */
  currency?: string | null;
  /** Shop name the seller types to confirm keeping choices while a listing delete is queued (§6.4). */
  shopName?: string | null;
  /** Readable value for id fields (shipping profile name, section title…). Return null to fall back. */
  describeValue?: (key: string, value: unknown) => string | null;
  /** Called with the re-based draft row after [Keep my choices]. The frame refreshes its draft; nothing is sent. */
  onResolved: (draft: unknown) => void;
  /** Un-queues an action without discarding the draft. Default (Etsy): PATCH removeQueuedActions. */
  onRemoveQueuedAction?: (type: string) => Promise<void>;
  /** Recovery offered while the review endpoint is not deployed (501). */
  fallback?: { discard?: () => void; refresh?: () => void };
  /** Test seam. */
  fetcher?: typeof fetch;
  'data-testid'?: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; diff: ReviewDiff }
  | { status: 'unavailable' }
  | { status: 'error'; message?: string };

const BASE: Record<ReviewMarketplace, string> = {
  etsy: '/api/etsy-drafts',
  ebay: '/api/ebay-drafts',
  trendyol: '/api/catalog-drafts',
  wix: '/api/catalog-drafts',
  shopify: '/api/catalog-drafts',
};
const NAMES: Record<ReviewMarketplace, string> = { etsy: 'Etsy', ebay: 'eBay', trendyol: 'Trendyol', wix: 'Wix', shopify: 'Shopify' };

export function ReviewDifferencesPanel({
  open, onClose, marketplace, draftId, draftStartedAt, currency, shopName, describeValue, onResolved, onRemoveQueuedAction,
  fallback, fetcher, 'data-testid': testId = 'le-review-differences',
}: ReviewDifferencesPanelProps) {
  const t = useTranslations();
  const fmt = useFormatters();
  const confirm = useConfirm();
  const mp = NAMES[marketplace];
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [choices, setChoices] = useState<Record<string, ReviewChoice>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  /** A server key (relative to `etsy` / `ebay`, or a full path) if it exists, else the generic line. */
  const serverMessage = useCallback((data: unknown, fallbackKey: string): string => {
    const d = (data && typeof data === 'object' ? data : {}) as { key?: unknown; params?: Record<string, string | number> };
    if (typeof d.key === 'string' && d.key) {
      for (const k of [d.key, `${marketplace}.${d.key}`]) if (t.has(k)) return t(k, d.params ?? {});
    }
    return t(fallbackKey, { marketplace: mp });
  }, [t, marketplace, mp]);

  const fetchDiff = useCallback(async () => {
    if (!draftId) return;
    const seq = ++reqSeq.current;
    setLoad({ status: 'loading' });
    setActionError(null);
    try {
      const res = await (fetcher ?? fetch)(`${BASE[marketplace]}/${encodeURIComponent(draftId)}/diff`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      if (seq !== reqSeq.current) return;
      if (res.status === 501 || (data as { code?: string } | null)?.code === 'NOT_AVAILABLE') {
        setLoad({ status: 'unavailable' });
        return;
      }
      if (!res.ok || !data || !Array.isArray((data as ReviewDiff).fields)) {
        setLoad({ status: 'error', message: serverMessage(data, 'listingEditor.review.loadFailed') });
        return;
      }
      const diff = data as ReviewDiff;
      setChoices(defaultChoices(buildReviewRows(diff)));
      setLoad({ status: 'ready', diff });
    } catch {
      if (seq === reqSeq.current) setLoad({ status: 'error' });
    }
  }, [draftId, fetcher, marketplace, serverMessage]);

  useEffect(() => {
    if (open && draftId) void fetchDiff();
    if (!open) reqSeq.current += 1;
  }, [open, draftId, fetchDiff]);

  const diff = load.status === 'ready' ? load.diff : null;
  const rows = useMemo(() => buildReviewRows(diff), [diff]);
  const queued = useMemo(() => orderQueued(diff?.queuedActions), [diff]);
  const conflicts = rows.filter((r) => r.kind === 'conflict');
  const remoteOnly = rows.filter((r) => r.kind === 'remoteOnly');
  const draftOnly = rows.filter((r) => r.kind === 'draftOnly');

  const label = (key: string) => t(fieldLabelKey(key));
  const subLabel = (key: string): string | null => {
    const k = FIELD_LABEL_KEYS[key];
    return k ? t(k) : null;
  };
  const show = (key: string, value: unknown): string => {
    const described = describeValue?.(key, value);
    if (described) return described;
    return plainValue(value, {
      money: (a, c) => fmt.money(a, c),
      num: (v) => fmt.num(v),
      yes: t('listingEditor.review.yes'),
      no: t('listingEditor.review.no'),
      label: subLabel,
    }, key, currency) ?? t('listingEditor.review.empty');
  };

  const removeQueued = async (type: string) => {
    if (!draftId || removing) return;
    setRemoving(type);
    setActionError(null);
    try {
      if (onRemoveQueuedAction) await onRemoveQueuedAction(type);
      else if (marketplace === 'etsy') await removeEtsyDraftQueuedActions(draftId, [type]);
      else throw new Error('not supported');
      setLoad((prev) => (prev.status === 'ready'
        ? { status: 'ready', diff: { ...prev.diff, queuedActions: prev.diff.queuedActions.filter((a) => a.type !== type), hasQueuedDelete: type === 'delete' ? false : prev.diff.hasQueuedDelete } }
        : prev));
    } catch (err) {
      setActionError(serverMessage(err, 'listingEditor.review.removeFailed'));
    } finally {
      setRemoving(null);
    }
  };

  const keepChoices = async () => {
    if (!draftId || saving) return;
    // Re-basing clears the conflict guard: with a listing delete still queued, ask again first (§6.4).
    if (queued.some((a) => a.type === 'delete') || diff?.hasQueuedDelete) {
      const ok = await confirm({
        title: t('listingEditor.review.deleteTitle', { marketplace: mp }),
        body: shopName ? t('listingEditor.review.deleteBody', { marketplace: mp, shop: shopName }) : t('listingEditor.review.deleteBodyNoShop', { marketplace: mp }),
        confirmLabel: t('listingEditor.review.keep'),
        tone: 'danger',
        typeToConfirm: shopName || undefined,
      });
      if (!ok) return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await (fetcher ?? fetch)(`${BASE[marketplace]}/${encodeURIComponent(draftId)}/resolve`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep: keepList(rows, choices) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(serverMessage(data, 'listingEditor.review.resolveFailed'));
        return;
      }
      onResolved((data as { draft?: unknown } | null)?.draft ?? null);
      onClose();
    } catch {
      setActionError(t('listingEditor.review.resolveFailed', { marketplace: mp }));
    } finally {
      setSaving(false);
    }
  };

  const setAll = (choice: ReviewChoice) => setChoices(Object.fromEntries(conflicts.map((r) => [r.key, choice])));

  const remoteAt = toDate(diff?.remoteUpdatedAt);
  const startedAt = toDate(draftStartedAt);
  const intro = remoteAt && startedAt
    ? t('listingEditor.review.intro', { marketplace: mp, remoteTime: fmt.date(remoteAt, 'datetime'), draftTime: fmt.date(startedAt, 'datetime') })
    : t('listingEditor.review.introShort', { marketplace: mp });

  const ready = load.status === 'ready';
  const nothingToReview = ready && rows.length === 0 && queued.length === 0;

  const valueCell = (text: string, muted: boolean, testid?: string) => (
    <Box
      title={text}
      data-testid={testid}
      sx={{ fontSize: 14, lineHeight: '20px', color: muted ? neutral[500] : neutral[800], overflowWrap: 'anywhere', minWidth: 0 }}
    >
      {text}
    </Box>
  );

  const colLabel = (text: string) => (
    <Box component="span" sx={{ display: { xs: 'block', sm: 'none' }, fontSize: 12, lineHeight: '16px', color: neutral[500] }}>{text}</Box>
  );

  const rowSx = {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', sm: '132px minmax(0,1fr) minmax(0,1fr) 168px' },
    columnGap: '16px',
    rowGap: '6px',
    alignItems: 'start',
    py: '12px',
    borderTop: `1px solid ${neutral[100]}`,
  } as const;

  return (
    <SidePanel padded
      open={open}
      onClose={onClose}
      size="lg"
      title={t('listingEditor.review.title')}
      primary={ready ? {
        id: 'review-keep',
        label: t('listingEditor.review.keep'),
        onClick: () => void keepChoices(),
        loading: saving,
        loadingLabel: t('listingEditor.review.keeping'),
        disabled: !!removing,
        disabledReason: removing ? t('listingEditor.review.keeping') : undefined,
      } : undefined}
      secondary={{ id: 'review-cancel', label: t('listingEditor.sheet.cancel'), onClick: onClose }}
      data-testid={testId}
    >
      {load.status === 'loading' ? <PanelSkeleton sections={3} /> : null}

      {load.status === 'unavailable' ? (
        <ErrorState
          variant="inline"
          title={t('listingEditor.review.unavailable')}
          cause={t('listingEditor.review.unavailableCause', { marketplace: mp })}
          action={fallback?.refresh ? { id: 'review-refresh', label: t('listingEditor.review.refreshKeep'), onClick: fallback.refresh } : undefined}
          secondaryAction={fallback?.discard ? { id: 'review-discard', label: t('listingEditor.review.discardMine'), onClick: fallback.discard, tone: 'danger' } : undefined}
          data-testid="le-review-unavailable"
        />
      ) : null}

      {load.status === 'error' ? (
        <ErrorState
          variant="inline"
          title={t('listingEditor.review.loadFailed', { marketplace: mp })}
          cause={load.message && load.message !== t('listingEditor.review.loadFailed', { marketplace: mp }) ? load.message : undefined}
          onRetry={() => void fetchDiff()}
          data-testid="le-review-error"
        />
      ) : null}

      {ready ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Box component="p" sx={{ m: 0, fontSize: 14, lineHeight: '20px', color: neutral[700] }} data-testid="le-review-intro">{intro}</Box>

          {actionError ? <Banner tone="danger" title={actionError} data-testid="le-review-action-error" /> : null}

          {queued.length ? (
            <Box component="ul" aria-label={t('listingEditor.review.queuedTitle')} sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {queued.map((a) => {
                const isDelete = a.type === 'delete';
                const actionLabel = t.has(`listingEditor.review.queued.${a.type}`) ? t(`listingEditor.review.queued.${a.type}`, { marketplace: mp }) : t('listingEditor.review.queued.other', { marketplace: mp });
                const Icon = isDelete ? icons.warning : icons.info;
                return (
                  <Box
                    component="li"
                    key={a.type}
                    data-testid={`le-review-queued-${a.type}`}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: '8px', p: '8px 12px', borderRadius: `${radius.md}px`,
                      border: `1px solid ${isDelete ? tone.danger.border : neutral[200]}`, bgcolor: isDelete ? tone.danger.bg : neutral[25],
                    }}
                  >
                    <Box component="span" sx={{ display: 'inline-flex', color: isDelete ? tone.danger.fg : neutral[500] }}><Icon size={16} aria-hidden /></Box>
                    <Box component="span" sx={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: '20px', color: isDelete ? tone.danger.fg : neutral[800] }}>{actionLabel}</Box>
                    {isDelete || onRemoveQueuedAction || marketplace === 'etsy' ? (
                      <Button
                        variant={isDelete ? 'danger-ghost' : 'ghost'}
                        size="sm"
                        loading={removing === a.type}
                        onClick={() => void removeQueued(a.type)}
                        disabled={!!removing && removing !== a.type}
                        disabledReason={t('listingEditor.review.keeping')}
                        aria-label={t('listingEditor.review.removeQueued', { action: actionLabel })}
                        data-testid={`le-review-remove-${a.type}`}
                      >
                        {t('listingEditor.review.remove')}
                      </Button>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          ) : null}

          {nothingToReview ? (
            <Box sx={{ fontSize: 14, color: neutral[600] }} data-testid="le-review-nothing">{t('listingEditor.review.nothing', { marketplace: mp })}</Box>
          ) : null}

          {conflicts.length || remoteOnly.length ? (
            <Box role="table" aria-label={t('listingEditor.review.title')} sx={{ display: 'flex', flexDirection: 'column' }}>
              <Box role="row" sx={{ ...rowSx, display: { xs: 'none', sm: 'grid' }, borderTop: 'none', py: '4px', fontSize: 12, lineHeight: '16px', color: neutral[500], fontWeight: 500 }}>
                <span role="columnheader">{t('listingEditor.review.field')}</span>
                <span role="columnheader">{t('listingEditor.review.mine')}</span>
                <span role="columnheader">{t('listingEditor.review.remote', { marketplace: mp })}</span>
                <Box role="columnheader" component="span" sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{t('listingEditor.review.keepCol')}</Box>
              </Box>

              {conflicts.length > 1 ? (
                <Box sx={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap', pb: '4px' }}>
                  <Button variant="ghost" size="sm" onClick={() => setAll('mine')} data-testid="le-review-all-mine">{t('listingEditor.review.allMine')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setAll('remote')} data-testid="le-review-all-remote">{t('listingEditor.review.allRemote', { marketplace: mp })}</Button>
                </Box>
              ) : null}

              {conflicts.map((r) => (
                <Box role="row" key={r.key} sx={rowSx} data-testid={`le-review-row-${r.key}`}>
                  <Box role="rowheader" sx={{ fontSize: 14, lineHeight: '20px', fontWeight: 500, color: neutral[800] }}>{label(r.key)}</Box>
                  <Box role="cell" sx={{ minWidth: 0 }}>{colLabel(t('listingEditor.review.mine'))}{valueCell(show(r.key, r.draft), choices[r.key] === 'remote')}</Box>
                  <Box role="cell" sx={{ minWidth: 0 }}>{colLabel(t('listingEditor.review.remote', { marketplace: mp }))}{valueCell(show(r.key, r.remote), choices[r.key] !== 'remote')}</Box>
                  <Box role="cell">
                    <RadioGroup<ReviewChoice>
                      value={choices[r.key] ?? 'mine'}
                      onChange={(v) => setChoices((c) => ({ ...c, [r.key]: v }))}
                      options={[
                        { value: 'mine', label: t('listingEditor.review.keepMine') },
                        { value: 'remote', label: t('listingEditor.review.keepRemote', { marketplace: mp }) },
                      ]}
                      direction="row"
                      name={`review-${r.key}`}
                      aria-label={t('listingEditor.review.keepFor', { field: label(r.key) })}
                      data-testid={`le-review-choice-${r.key}`}
                    />
                  </Box>
                </Box>
              ))}

              {remoteOnly.map((r) => (
                <Box role="row" key={r.key} sx={rowSx} data-testid={`le-review-row-${r.key}`}>
                  <Box role="rowheader" sx={{ fontSize: 14, lineHeight: '20px', fontWeight: 500, color: neutral[800] }}>{label(r.key)}</Box>
                  <Box role="cell" sx={{ minWidth: 0 }}>{colLabel(t('listingEditor.review.mine'))}{valueCell(t('listingEditor.review.notInDraft'), true)}</Box>
                  <Box role="cell" sx={{ minWidth: 0 }}>{colLabel(t('listingEditor.review.remote', { marketplace: mp }))}{valueCell(show(r.key, r.remote), false)}</Box>
                  <Box role="cell" sx={{ fontSize: 13, lineHeight: '20px', color: neutral[600] }}>{t('listingEditor.review.remoteNoChoice', { marketplace: mp })}</Box>
                </Box>
              ))}
            </Box>
          ) : null}

          {draftOnly.length ? (
            <Box sx={{ fontSize: 13, lineHeight: '20px', color: neutral[600] }} data-testid="le-review-draft-only">
              {t('listingEditor.review.draftOnly', { count: draftOnly.length, fields: draftOnly.slice(0, 4).map((r) => label(r.key)).join(', ') })}
            </Box>
          ) : null}

          <Box sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }}>{t('listingEditor.review.noSend', { marketplace: mp })}</Box>
        </Box>
      ) : null}
    </SidePanel>
  );
}

export default ReviewDifferencesPanel;

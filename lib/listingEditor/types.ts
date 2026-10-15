// lib/listingEditor/types.ts — the listing editor contract (listing-editor §5.1, §10 Group A).
// Pure types, no React. Every editor group (B sections, C media, D sub-editors, E rail, F eBay adapter,
// H AI/review panels, M6b marketplaces) codes against this file and `components/domain/listing-editor/
// useListingDraft.ts` (`useListingEditor()`); nothing here talks to a marketplace.

/** Marketplaces the editor workspace serves (M6: etsy, ebay; M6b: trendyol, wix, shopify). */
export type EditorMarketplace = 'etsy' | 'ebay' | 'trendyol' | 'wix' | 'shopify';

/** Section ids (listing-editor §2.1 + marketplace-editors §3). Order lives in `sections.ts`. */
export type SectionId =
  | 'photos'
  | 'title'
  | 'tags'
  | 'specifics'
  | 'attributes'
  | 'price'
  | 'variations'
  | 'details'
  | 'personalization'
  | 'shipping'
  | 'seo';

export type EditorMode = 'edit' | 'create';

/** A field value the engine can diff (`changeSummary.fieldEquals`). */
export type FieldValue = string | number | boolean | null | readonly string[] | readonly number[];
export type FieldMap = Record<string, FieldValue>;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Etsy field set (the drawer's `EditableFields`, moved; listing-editor §7 "Title, description, …")
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Etsy core fields staged through `fieldPatch`. `''` = "not set" for optional ids/numbers (as in the drawer). */
export interface EtsyEditorFields extends FieldMap {
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  /** Decimal string in the shop currency, e.g. "12.50" (Etsy prices in shop currency only). */
  price: string;
  quantity: number;
  who_made: string;
  when_made: string;
  is_supply: boolean;
  taxonomy_id: number | '';
  shop_section_id: number | '';
  shipping_profile_id: number | '';
  return_policy_id: number | '';
  processing_min: number | '';
  processing_max: number | '';
  readiness_state_id: number | '';
  item_weight: number | '';
  item_weight_unit: string;
  item_length: number | '';
  item_width: number | '';
  item_height: number | '';
  item_dimensions_unit: string;
}

export type EtsyFieldKey = keyof EtsyEditorFields & string;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Remote listing + view
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A photo as the marketplace has it (Etsy `listing.images[]`). Text is entity-decoded. */
export interface RemoteImage {
  id: string;
  /** Display URL (Etsy url_570xN). */
  src: string;
  fullSrc?: string;
  thumbSrc?: string;
  rank: number;
  alt: string;
}

/** Read-only facts about the listing (header, preview, links). Never staged. */
export interface ListingMeta {
  /** Marketplace id (Etsy listing id, eBay SKU). Negative local id (string) for a not-yet-created Etsy listing. */
  id: string | null;
  /** Lifecycle on the marketplace (`active`, `draft`, `inactive`, `expired`, `sold_out`, …); null in create. */
  state: string | null;
  url: string | null;
  /** When the marketplace last changed the listing. */
  updatedAt: Date | null;
  /** Only shown when > 0 (founder complaint: "0 views · 0 favorites"). */
  views: number;
  favorites: number;
  /** ISO 4217 of the shop / listing price. */
  currency: string | null;
  images: RemoteImage[];
  /** Personalization as the marketplace has it (read by PersonalizationSection / preview). */
  personalization?: unknown;
  /** The raw marketplace payload for sub-editors that need more than the field set (import-only use). */
  raw?: unknown;
}

/**
 * Facts the sections report to the frame (score + preview inputs that are not plain fields):
 * photos and alt text from the media section, video, required category attributes from Details, market band.
 * `undefined` = not known yet (the matching score check stays `na`).
 */
export interface ListingFacts {
  images?: Array<{ id: string; src: string; alt: string; staged?: 'add' | 'delete' | 'reorder' }>;
  hasVideo?: boolean;
  attributes?: { required: number; filled: number } | null;
  market?: { p25: number; p75: number; median?: number; n?: number } | null;
  variations?: { count: number; combinations: number; priceRange?: { min: number; max: number } | null } | null;
  personalization?: { enabled: boolean; required: boolean; questions: number } | null;
  shopName?: string | null;
}

/** Remote values merged with the staged patch (listing-editor §5.1 `view`). */
export interface ListingView<F extends FieldMap = FieldMap> {
  marketplace: EditorMarketplace;
  mode: EditorMode;
  fields: F;
  meta: ListingMeta;
  facts: ListingFacts;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Draft row (EtsyListingDraft / EbayListingDraft as `/api/*-drafts` serialises it)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DraftStatus = 'draft' | 'syncing' | 'conflict' | 'failed' | 'synced' | 'cancelled';

export interface QueuedAction {
  type: string;
  tempId?: number;
  payload?: Record<string, unknown>;
  completedAt?: string | null;
}

export interface DraftMediaRow {
  id: string;
  kind: 'image' | 'video' | string;
  operation: 'upload' | 'delete' | 'reorder' | 'update_alt' | string;
  etsyMediaId?: string | null;
  rank?: number | null;
  altText?: string | null;
  sourceUrl?: string | null;
  filename?: string | null;
  status?: string | null;
}

export interface DraftSyncAttempt {
  id: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  error?: string | null;
}

export interface DraftRow {
  id: string;
  status: DraftStatus | string;
  /** Marketplace listing id the draft belongs to (negative for a new local Etsy listing). */
  listingId: string;
  fieldPatch: Record<string, unknown>;
  taxonomyPatch?: Record<string, unknown> | null;
  inventoryPatch?: Record<string, unknown> | null;
  variationImagesPatch?: unknown;
  personalizationPatch?: unknown;
  queuedActions: QueuedAction[];
  media: DraftMediaRow[];
  lastSyncError?: string | null;
  syncAttempts: DraftSyncAttempt[];
  updatedAt?: string | null;
  syncedAt?: string | null;
  createdAt?: string | null;
  /** Server row as returned, for sub-editors (import-only use). */
  raw?: unknown;
}

/** Pending (not completed) queued actions of a draft. */
export function pendingActions(draft: Pick<DraftRow, 'queuedActions'> | null | undefined): QueuedAction[] {
  return (draft?.queuedActions ?? []).filter((a) => a && !a.completedAt);
}

/** True when the draft would delete the listing when sent (CLAUDE.md caution: a queued delete). */
export function hasQueuedDelete(draft: Pick<DraftRow, 'queuedActions'> | null | undefined): boolean {
  return pendingActions(draft).some((a) => a.type === 'delete');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Change summary (drives the count, "Not sent yet", nav dots)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `listingEditor.changes.group.<key>` (listing-editor §8). */
export type ChangeGroupKey =
  | 'title'
  | 'description'
  | 'tags'
  | 'materials'
  | 'price'
  | 'quantity'
  | 'sku'
  | 'photos'
  | 'photoOrder'
  | 'altText'
  | 'video'
  | 'variations'
  | 'category'
  | 'categoryDetails'
  | 'itemDetails'
  | 'shopSection'
  | 'personalization'
  | 'shippingProfile'
  | 'processing'
  | 'returnPolicy'
  | 'weightSize'
  | 'itemSpecifics'
  | 'condition'
  | 'policies';

/** One line of "Not sent yet". `kind: 'action'` lines are queued state actions (`listingEditor.changes.action.<type>`). */
export interface ChangeSummary {
  /** Stable id: the group key, or `action:<type>`. */
  id: string;
  kind: 'field' | 'action';
  group: ChangeGroupKey | null;
  /** Queued action type when `kind === 'action'`. */
  action?: string;
  section: SectionId | null;
  /** Field keys in this group that differ (field kind). Revert uses these. */
  fields: string[];
  /** Tags/materials: counts for "Tags (2 added, 1 removed)". */
  added?: number;
  removed?: number;
  /** Where the change lives: unsaved in the form, or already in the DB draft. */
  source: 'form' | 'draft';
  /** True when Revert can undo it in place (form field groups). */
  revertable: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Section registration contract (Groups B, C, D implement it)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A field-level issue a section reports (block_sync stops Send; warn only shows). */
export interface FieldIssue {
  field: string;
  section: SectionId;
  severity: 'block_save' | 'block_sync' | 'warn';
  /** i18n key (full path from the root) + params. */
  key: string;
  params?: Record<string, string | number>;
  message?: string;
}

/**
 * Registered by every section that stages on its own (photos, video, variations, personalization, category
 * details, SKU). Plain fields do not register: they call `setField` and the engine stages them.
 * `register()` returns the unregister function; call it from an effect cleanup.
 */
export interface DraftSection {
  /** Section the registration belongs to (nav dot, change list). */
  id: SectionId;
  /** Unique key when one section registers more than one handle (e.g. `photos:images`, `photos:video`). Default: `id`. */
  key?: string;
  /** Unsaved edits that are not in the DB draft yet. */
  isDirty(): boolean;
  /** Writes the unsaved edits into the DB draft (the section's own staging calls, unchanged). Must throw on failure. */
  stage(): Promise<void>;
  /** Unsaved groups for "Not sent yet" while dirty (optional; default one line for the section). */
  changes?(): Array<Pick<ChangeSummary, 'group'> & { added?: number; removed?: number }>;
  /** Client validation run before Send (optional). */
  validate?(): FieldIssue[];
  /** Drop unsaved edits (Discard changes) (optional). */
  reset?(): void;
}

/** Props every section component receives (B, C, D). Everything else comes from `useListingEditor()`. */
export interface ListingSectionProps {
  id: SectionId;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Engine state + results
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline';

export type SendOutcome = 'sent' | 'blocked' | 'conflict' | 'failed' | 'cancelled';

export interface SendResult {
  outcome: SendOutcome;
  /** Etsy id of a listing created by this send (create mode) → the page replaces the URL. */
  listingId?: string | null;
  /** The send executed a queued delete: the listing no longer exists on the marketplace (leave the editor). */
  deleted?: boolean;
  /** i18n warnings from a partial success (`etsy.*` keys). */
  warnings?: Array<{ key?: string; params?: Record<string, string | number>; message?: string }>;
  /** Blocking issues (outcome `blocked`). */
  issues?: FieldIssue[];
  /** Server error (outcome `failed`/`conflict`). */
  error?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Create-mode bootstraps (listing-editor §1, §9 "moved types")
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `?copy=<id>` / cross-list prefill (moved from `components/etsy/ListingCreatorDialog.tsx`). */
export interface CopySourceData {
  title: string;
  description: string;
  tags: string[];
  materials?: string[];
  price?: number;
  quantity?: number;
  who_made?: string;
  when_made?: string;
  is_supply?: boolean;
  shipping_profile_id?: number;
  return_policy_id?: number;
  /** null = the source had no section (kept as "no section", not filled from defaults). */
  shop_section_id?: number | null;
  taxonomy_id?: number;
  processing_min?: number;
  processing_max?: number;
  item_weight?: number;
  item_weight_unit?: string;
  item_length?: number;
  item_width?: number;
  item_height?: number;
  item_dimensions_unit?: string;
  /** Public https image URLs, staged as draft media by URL (the server downloads them only on Send). */
  imageUrls?: string[];
  source?: 'etsy' | 'ebay' | 'research';
}

/** How a create workspace starts (`new.tsx` query → `ListingEditor`). */
export type CreateBootstrap =
  | { kind: 'blank' }
  | { kind: 'draft'; draftId: string }
  | { kind: 'local'; listingId: string }
  | { kind: 'copy'; sourceId: string }
  | { kind: 'prefill' };

/** `sessionStorage['kx:editorNav']` written by the list when it opens the editor (listing-editor §1). */
export interface EditorNavState {
  marketplace: EditorMarketplace;
  shopId: string | null;
  ids: string[];
  query?: string;
}

// components/domain/listing-editor/adapters/types.ts — one adapter per marketplace (listing-editor §5.1).
// The engine (`useListingDraft`) is marketplace-agnostic; everything that knows an endpoint, a payload
// shape or a server error lives behind this interface. Etsy: `adapters/etsy.ts` (Group A). eBay:
// `adapters/ebay.ts` (Group F). Trendyol / Wix / Shopify: M6b-C.
import type {
  CopySourceData,
  DraftRow,
  EditorMarketplace,
  EditorMode,
  FieldIssue,
  FieldMap,
  ListingMeta,
  QueuedAction,
} from '@/lib/listingEditor/types';

export interface AdapterContext {
  shopId: string;
  /** Marketplace id; a negative local id (string) for a staged new Etsy listing; null for a blank create. */
  listingId: string | null;
}

export interface LoadedListing<F extends FieldMap> {
  fields: F;
  meta: ListingMeta;
}

/** Normalised server failure (never raw text in the UI: `key` is a full i18n key). */
export interface AdapterErrorInfo {
  status: number | null;
  /** Network failure / no response → the engine keeps a device copy (`offline`). */
  network: boolean;
  /** 409 conflict on send. */
  conflict: boolean;
  /** Full i18n key (e.g. `etsy.draftSync.deleteNotExclusive`) or null. */
  key: string | null;
  params?: Record<string, string | number>;
  /** Field issues returned by validation (400). */
  issues?: FieldIssue[];
}

export interface StageFieldsInput<F extends FieldMap> {
  ctx: AdapterContext;
  mode: EditorMode;
  /** Remote values (edit) or null (create). */
  remote: F | null;
  current: F;
  /** Draft `fieldPatch` keys the form has no input for; re-sent so `replaceFields` keeps them. */
  extra: Record<string, unknown>;
  draft: DraftRow | null;
}

export interface SendOptions {
  /** Create mode: publish (true) or send as a draft that is not live (false). */
  publish?: boolean;
}

export interface AdapterSendResult {
  /** Marketplace id of a listing the send created (create mode). */
  listingId: string | null;
  /** The send executed a queued delete (the listing is gone). */
  deleted?: boolean;
  warnings: Array<{ key?: string; params?: Record<string, string | number>; message?: string }>;
}

export interface ListingEditorAdapter<F extends FieldMap> {
  marketplace: EditorMarketplace;
  /** Shop-level display name of the marketplace ("Etsy", "eBay"). Not translated (brand). */
  displayName: string;

  /** Empty create workspace, optionally seeded with remembered defaults. */
  blankFields(defaults?: Partial<F>): F;
  /** `?copy=` / cross-list / research prefill → fields. */
  fieldsFromCopy(src: CopySourceData): Partial<F>;
  /** Defaults remembered from the last create on this shop (shipping profile, return policy, section). */
  readCreateDefaults(shopId: string): Partial<F>;
  writeCreateDefaults(shopId: string, fields: F): void;
  /** A fresh negative local listing id for a new listing (string). */
  newLocalListingId(): string;

  /** Remote listing (edit). Text is entity-decoded here (P5). Throws on failure. */
  load(ctx: AdapterContext): Promise<LoadedListing<F>>;
  /** Copy source (create `?copy=`): reads a listing and returns it as CopySourceData. */
  loadCopySource?(ctx: AdapterContext): Promise<CopySourceData | null>;
  /** Pending draft for the listing, or the draft with `draftId`. Throws on failure (Send is then disabled). */
  loadDraft(input: { shopId: string; listingId?: string | null; draftId?: string | null }): Promise<DraftRow | null>;
  /** Overlay a draft `fieldPatch` on remote / blank fields (I0 8b: the DB draft is loaded first). */
  overlay(base: F, draft: DraftRow | null): { fields: F; extra: Record<string, unknown>; applied: number };
  /** Field keys whose values differ (`[]` = no change). */
  changedKeys(remote: F | null, current: F): string[];

  /** Stage the form fields. Returns the draft after staging, or null when nothing was (or remains) staged. */
  stageFields(input: StageFieldsInput<F>): Promise<DraftRow | null>;
  /** Stage queued state actions (publish / deactivate / renew / delete / create_* ). */
  stageActions(ctx: AdapterContext, actions: QueuedAction[], fields?: Record<string, unknown>): Promise<DraftRow | null>;
  removeActions(draftId: string, types: string[]): Promise<DraftRow | null>;
  /** Create: stage copy / prefill image URLs as draft media (downloaded by the server only on Send). */
  stageImageUrls?(ctx: AdapterContext, urls: string[]): Promise<DraftRow | null>;
  discard(draftId: string): Promise<void>;
  /** Explicit Send. Throws; inspect with `errorInfo`. Never forces past a conflict. */
  send(draft: DraftRow, opts?: SendOptions): Promise<AdapterSendResult>;

  /** Client validation over the whole view (block_sync stops Send; block_save stops staging). */
  validate(fields: F, mode: EditorMode): FieldIssue[];
  errorInfo(err: unknown): AdapterErrorInfo;
  /** `lastSyncError` → full i18n key for the failed banner (never raw text). */
  failureCauseKey(draft: DraftRow): string;

  /** Offline fallback copy (`listing_draft_<id>`, try/catch inside). */
  readDeviceCopy(key: string): { fields: Partial<F>; savedAt: number } | null;
  writeDeviceCopy(key: string, fields: F): boolean;
  clearDeviceCopy(key: string): void;
}

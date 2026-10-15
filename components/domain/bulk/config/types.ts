// components/domain/bulk/config/types.ts — BulkGrid per-marketplace config (bulk-grid §1.2, §3.1, §5.2; M7-C).
// Like `ListingsConfig`, this is the only place marketplaces differ on the bulk page; `BulkEditPage` has no
// marketplace branching. Data only (plus href builders).
import type { ListingMarketplace } from '@/lib/listings/types';
import type { ListingsConfig } from '@/components/domain/listings/config/types';

/**
 * Grid fields that can be staged (the `field` of `GridColumn` and of `onCellsChange` patches).
 * `tags` has no column in v1 (the row API carries no tags); it is staged by "Add tags".
 */
export type BulkField = 'title' | 'price' | 'qty' | 'section' | 'tags';

export const BULK_FIELDS = ['title', 'price', 'qty', 'section', 'tags'] as const satisfies readonly BulkField[];

export function isBulkField(v: unknown): v is BulkField {
  return typeof v === 'string' && (BULK_FIELDS as readonly string[]).includes(v);
}

/** Grid columns in v1 (bulk-grid §3.1 table, minus the ones whose data the row API does not carry yet). */
export type BulkColumnKey = 'thumb' | 'title' | 'price' | 'qty' | 'section' | 'health' | 'photos' | 'status' | 'changes';

/** Which draft backend stages the edits (same split as `ListingsConfig.drafts`). */
export type BulkTransportKind = 'etsy' | 'ebay' | 'catalog';

export type BulkConfig = {
  marketplace: ListingMarketplace;
  /** The listings config of the same marketplace (route, store param, validation, tags limits, drafts). */
  listings: ListingsConfig;
  /** Display order. */
  columns: BulkColumnKey[];
  /** Hidden until turned on in the Columns menu. */
  hiddenByDefault: BulkColumnKey[];
  /** Fields this marketplace's grid can edit; every other column is read-only. */
  fields: BulkField[];
  /** Title limit (Etsy 140, eBay 80); null = no client-side limit. */
  titleMax: number | null;
  transport: BulkTransportKind;
  /** Bulk bar "Edit photos…" (PhotoStudio, Pro). Null = not offered on this marketplace. */
  photosHref: ((ids: string[], storeId: string | null) => string) | null;
  /** PhotoStudio route without ids (the locked entry point leads there, pro-gating §3.4). */
  photosRoute: string | null;
  /** Queued state actions the bulk bar offers (they stage `queuedActions`, never send). */
  stateActions: Array<'deactivate' | 'activate' | 'renew'>;
  /** "Delete N listings…" (stages a queued delete; sent only via "Send deletion…" on the listings page). */
  deleteAction: boolean;
  /** localStorage key for the Columns menu: `bulk.<marketplace>.columns`. */
  columnStateKey: string;
};

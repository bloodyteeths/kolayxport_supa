// components/domain/listing-editor/sections/sectionTypes.ts — Group B: the small surface the Etsy field sections
// read from the editor engine (`useEtsySection()` maps `useListingEditor()` onto it) and the AI hand-off shape
// the frame / `useListingAI` (Group H) passes in. Keeping it narrow means the sections never reach into the
// engine's internals and can be rendered in tests with a fake.
import type {
  DraftRow, DraftSection, EditorMode, EtsyEditorFields, EtsyFieldKey, FieldIssue, ListingFacts, QueuedAction,
} from '@/lib/listingEditor/types';

export interface EtsySectionApi {
  shopId: string;
  /** Etsy listing id, a negative local id (create, after the first save), or null (blank create). */
  listingId: string | null;
  mode: EditorMode;
  /** Fields are read-only while the draft is being sent (`syncing`). */
  readOnly: boolean;
  /** Remote values merged with the staged patch (entity-decoded by the adapter). */
  fields: EtsyEditorFields;
  /** Last refreshed Etsy values (null in create). */
  remote: EtsyEditorFields | null;
  /** Shop / listing currency (ISO 4217). */
  currency: string;
  facts: ListingFacts;
  draft: DraftRow | null;
  setField: <K extends EtsyFieldKey>(key: K, value: EtsyEditorFields[K]) => void;
  /** Field differs from Etsy (edit) — drives `FormField.dirty`. Always false in create. */
  isDirty: (key: EtsyFieldKey) => boolean;
  /** Back to the Etsy value. */
  revert: (key: EtsyFieldKey) => void;
  /** Issues to show inline (validation on Send, server 400). */
  issues: FieldIssue[];
  register: (section: DraftSection) => () => void;
  /** Tell the engine a registered section's unsaved state changed (schedules the autosave, marks dirty). */
  notifyChange: () => void;
  /**
   * Stage queued actions (create_shop_section / create_shipping_profile / create_return_policy). Rejects when
   * nothing could be staged. `fields` (the temp-id field pointing at the created entity) is staged in the same
   * request, so the draft never holds a create action nothing points at; the engine mirrors it into the form.
   */
  stageActions: (actions: QueuedAction[], fields?: Partial<EtsyEditorFields>) => Promise<void>;
  /** Report non-field facts (category attributes for the score, market band). */
  reportFacts: (patch: Partial<ListingFacts>) => void;
  /** Fields prefilled from the last create on this shop ("From your last listing"). */
  fromDefaults?: ReadonlySet<string>;
}

/** One inline AI action's state (listing-editor §4.3). Produced by `useListingAI` (Group H). */
export interface FieldAiState<V = string> {
  /** Click on the ghost "✦ Suggest a title" button. */
  run: () => void;
  loading: boolean;
  /** The proposal (null = no card). Already passed the seoRules guards. */
  value: V | null;
  /** true → default "didn't come out right" line. */
  error?: boolean | string;
  /** "Based on 48 Etsy listings for '…'" (already translated). */
  basis?: string;
  rationale?: string;
  dismiss: () => void;
  /** AI credits Try again costs (CRITIQUE X6). */
  credits?: number;
  /** Follow-up: revise the suggestion with the seller's instruction. */
  refine?: (instruction: string) => void;
  refineChips?: string[];
}

/** Market price band for Price & inventory (from `search_market` → `priceStats`, USD). */
export interface MarketBand {
  p25: number | null;
  median: number | null;
  p75: number | null;
  n: number;
  currency: string;
  query: string;
  fetchedAt: string | Date;
  excluded?: number;
  implausible?: boolean;
}

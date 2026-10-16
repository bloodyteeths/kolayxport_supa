// components/domain/listing-editor/ListingEditor.tsx — the full-page listing workspace (listing-editor §2–§6,
// DS §4.7 `ListingEditor`). Group A owns the frame: header, draft banners, section nav, the two-column body with
// the right rail, the sticky footer (save state + one primary), panels, responsive rules and keyboard.
// Sections (Groups B, C, D), rail parts (E) and AI / review / profile panels (H) plug into the slots below and
// read the engine through `useListingEditor()`.
//
// Staged-draft rules (unchanged from the legacy drawer): every edit goes to the DB draft; nothing reaches the
// marketplace without the footer primary; a conflict is only resolved through Review differences (no force);
// a draft with a queued delete is only sent after a type-to-confirm.
import * as React from 'react';
import { useRouter } from 'next/router';
import Box from '@mui/material/Box';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import { useFormatter, useTranslations } from 'next-intl';
import { Page } from '@/components/ds/page/Page';
import { PageHeader } from '@/components/ds/page/PageHeader';
import { SyncMeta } from '@/components/ds/page/SyncMeta';
import { StickyActionBar } from '@/components/ds/page/StickyActionBar';
import { SectionNav, type SectionNavItem } from '@/components/ds/page/SectionNav';
import { useIsMobile, useIsNarrow } from '@/components/ds/page/useViewport';
import type { ActionSpec } from '@/components/ds/types/actions';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { ScoreMeter } from '@/components/ds/data/ScoreMeter';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { Button } from '@/components/ds/inputs/Button';
import { SplitButton } from '@/components/ds/inputs/SplitButton';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { BottomSheet } from '@/components/ds/overlay/BottomSheet';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { Bone, PanelSkeleton, useDelayedVisible, SKELETON_DELAY_MS } from '@/components/ds/state/Skeletons';
import { icons } from '@/lib/ds/icons';
import { neutral, tone as toneTokens } from '@/lib/ds/tokens';
import { useShortcuts } from '@/lib/ds/useShortcuts';
import { usePageActions } from '@/lib/ds/usePageActions';
import { useCommands } from '@/lib/ds/useCommand';
import { listingStatus, syncStatus } from '@/lib/ds/status';
import { useLiveEvent } from '@/components/live/useLiveEvent';
import ListingHistoryPanel from '@/components/etsy-history/ListingHistoryPanel';
import { fieldAnchorId, resolveEditorHash, sectionAnchorId, sectionsFor } from '@/lib/listingEditor/sections';
import { editorHref, editorNeighbors, listHref, newListingHref, readEditorNav } from '@/lib/listingEditor/editorNav';
import { ConnectState } from '@/components/ds/state/ConnectState';
import {
  hasQueuedDelete,
  pendingActions,
  type ChangeSummary,
  type CopySourceData,
  type DraftRow,
  type EditorMarketplace,
  type EditorMode,
  type EtsyEditorFields,
  type FieldMap,
  type ListingSectionProps,
  type ListingView,
  type SectionId,
} from '@/lib/listingEditor/types';
import type { Check } from '@/lib/listingScore/types';
import type { ListingEditorAdapter } from './adapters/types';
import { changeCount, sectionStates } from './changeSummary';
import { ListingEditorContext, useListingDraft, type ListingEditorContextValue, type UseListingDraft } from './useListingDraft';
import { RailHealth, etsyScoreInputFromSource, fixTarget, useListingHealth, type ListingHealth } from './RailHealth';
import { RailChanges, type RailChangeItem, type ChangeGroup } from './RailChanges';
import { RailHistory, useSendHistory, type RailSyncAttempt } from './RailHistory';
import { MarketplacePreview, type PreviewModel } from '../MarketplacePreview';
import { useListingAI, type UseListingAI } from './useListingAI';
import { ReviewDifferencesPanel } from './ReviewDifferencesPanel';
import { ScheduleModal } from './ScheduleModal';
import { SCHEDULED_SENDS_ENABLED } from '@/components/domain/listings/config/shared';
import { PhotosSection } from './sections/PhotosSection';
import { TitleSection } from './sections/TitleSection';
import { TagsSection } from './sections/TagsSection';
import { PriceSection } from './sections/PriceSection';
import { DetailsSection } from './sections/DetailsSection';
import { ShippingSection } from './sections/ShippingSection';
import { VariationsSection } from './sections/VariationsSection';
import { PersonalizationSection } from './sections/PersonalizationSection';
import { useEtsyShopMeta } from './sections/etsyShared';
import { ProfilesModal } from './ProfilesModal';
import { AiFillCard } from './AiFillCard';
import { storedDraftSendError, storedDraftSendErrorParams } from './draftSendError';
import { useStagedMediaUndo } from './useStagedMediaUndo';
import { isRefusalKey } from './stagedMedia';
import { renderSendError, type SendErrorTranslator } from '@/lib/listings/sendError';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type EditorPanel = 'health' | 'preview' | 'review' | 'history' | 'profiles' | 'schedule';
export type SectionComponents = Partial<Record<SectionId, React.ComponentType<ListingSectionProps & Record<string, unknown>>>>;

export interface ListingEditorProps<F extends FieldMap> {
  /** Etsy/eBay (M6) or the CatalogDraft marketplaces Trendyol/Wix/Shopify (M6b, `CatalogEditorRoute`). */
  marketplace: EditorMarketplace;
  adapter: ListingEditorAdapter<F>;
  shopId: string;
  /** Shop display name (preview, delete type-to-confirm). */
  shopName?: string | null;
  mode: EditorMode;
  /** Edit: the marketplace id. Create: a negative local id when resuming (else null). */
  listingId: string | null;
  draftId?: string | null;
  copy?: CopySourceData | null;
  copyFromId?: string | null;
  /** Back link (list with its URL state). */
  backHref: string;
  /** Section components by id (default: the Etsy set). */
  sections?: SectionComponents;
  /** Extra props per section (AI proposal states, shared shop lists). */
  sectionProps?: Partial<Record<SectionId, Record<string, unknown>>>;
  /** Score input for the health rail; default Etsy mapping. */
  health?: (view: ListingView<F>, remote: F | null) => ListingHealth;
  /** Preview model; default Etsy mapping. */
  preview?: (view: ListingView<F>, shopName: string | null) => PreviewModel;
  /** Slots filled by other groups (H): rendered by the frame at fixed places. */
  slots?: EditorSlots<F>;
  onDraftCreated?: (draft: DraftRow) => void;
  onCreated?: (listingId: string) => void;
}

export interface EditorSlotContext<F extends FieldMap> {
  editor: ListingEditorContextValue<F>;
  open: EditorPanel | null;
  close: () => void;
}

export interface EditorSlots<F extends FieldMap> {
  /** Create-only "Start faster" card under Photos (H `AiFillCard`). */
  startFaster?: (c: EditorSlotContext<F>) => React.ReactNode;
  /** Review differences panel (H `ReviewDifferencesPanel`); open when `c.open === 'review'`. */
  review?: (c: EditorSlotContext<F>) => React.ReactNode;
  /** Apply / save profile modal (H `ProfilesModal`); open when `c.open === 'profiles'`. */
  profiles?: (c: EditorSlotContext<F>) => React.ReactNode;
  /** Health-check fix actions that need AI (`ai_title`, `ai_tags`, …). Return true when handled. */
  onFixAction?: (action: string, c: EditorSlotContext<F>) => boolean;
}

/** Space between two editor sections, rule included (USABILITY_FINDINGS density rule). */
export const SECTION_GAP = 24;
export const SECTION_GAP_MOBILE = 16;

const MP_NAME: Record<EditorMarketplace, string> = { etsy: 'Etsy', ebay: 'eBay', trendyol: 'Trendyol', wix: 'Wix', shopify: 'Shopify' };

/** The CatalogDraft marketplaces (marketplace-editors §1): no preview, no profiles, one create primary. */
const isCatalogMarketplace = (m: EditorMarketplace): m is 'trendyol' | 'wix' | 'shopify' => m === 'trendyol' || m === 'wix' || m === 'shopify';

/** Conflict causes that only restate the conflict banner's title (not shown under it). */
const GENERIC_CONFLICT_KEYS = new Set([
  'listings.sendError.conflict',
  'listings.draftError.conflict',
  'etsy.draftSync.remoteChanged',
  'ebay.draftSync.conflict',
]);
const CONFLICT_FALLBACK_KEY = 'listings.sendError.conflict';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Etsy defaults (health + preview mapping)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function etsyHealthSource(fields: EtsyEditorFields, view: ListingView<FieldMap> | null, useFacts: boolean) {
  const facts = useFacts && view ? view.facts : {};
  const photos = useFacts
    ? facts.images?.map((i) => ({ alt: i.alt, removed: i.staged === 'delete' })) ?? null
    : view?.meta.images.map((i) => ({ alt: i.alt })) ?? null;
  const price = parseFloat(String(fields.price ?? ''));
  return etsyScoreInputFromSource({
    title: fields.title,
    description: fields.description,
    tags: fields.tags,
    materials: fields.materials,
    photos,
    hasVideo: useFacts ? facts.hasVideo : undefined,
    requiredAttributes: useFacts ? facts.attributes ?? null : null,
    shippingLoaded: true,
    shippingProfileId: fields.shipping_profile_id === '' ? null : fields.shipping_profile_id,
    processingMin: typeof fields.processing_min === 'number' ? fields.processing_min : null,
    readinessStateId: fields.readiness_state_id === '' ? null : fields.readiness_state_id,
    itemWeight: typeof fields.item_weight === 'number' ? fields.item_weight : null,
    price: Number.isFinite(price) ? price : null,
    market: facts.market ? { p25: facts.market.p25, p75: facts.market.p75 } : null,
  });
}

function useEtsyHealth(view: ListingView<FieldMap>, remote: FieldMap | null): ListingHealth {
  const input = React.useMemo(() => etsyHealthSource(view.fields as EtsyEditorFields, view, true), [view]);
  const sent = React.useMemo(
    () => (remote ? etsyHealthSource(remote as EtsyEditorFields, { ...view, facts: {} }, false) : null),
    // the sent input only changes with the remote values and remote photos
    [remote, view.meta.images],
  );
  return useListingHealth('etsy', input, sent);
}

export function etsyPreviewModel(view: ListingView<FieldMap>, shopName: string | null): PreviewModel {
  const f = view.fields as EtsyEditorFields;
  const price = parseFloat(String(f.price ?? ''));
  const images = (view.facts.images ?? view.meta.images.map((i) => ({ id: i.id, src: i.src, alt: i.alt })))
    .filter((i) => (i as { staged?: string }).staged !== 'delete')
    .map((i) => ({ url: i.src || null, alt: i.alt }));
  const p = view.facts.personalization;
  return {
    title: f.title,
    description: f.description,
    price: Number.isFinite(price) ? price : null,
    priceRange: view.facts.variations?.priceRange ?? null,
    currency: view.meta.currency,
    images,
    shopName: view.facts.shopName ?? shopName,
    personalization: p?.enabled ? { required: p.required } : null,
    madeToOrder: f.when_made === 'made_to_order',
    processingDays:
      typeof f.processing_min === 'number' && typeof f.processing_max === 'number'
        ? { min: f.processing_min, max: f.processing_max }
        : null,
  };
}

/** Etsy sections by id (Group B fields, Group C photos; Group D's Variations / Personalization join here). */
export const DEFAULT_ETSY_SECTIONS: SectionComponents = {
  photos: PhotosSection as React.ComponentType<ListingSectionProps & Record<string, unknown>>,
  title: TitleSection as React.ComponentType<ListingSectionProps & Record<string, unknown>>,
  tags: TagsSection as React.ComponentType<ListingSectionProps & Record<string, unknown>>,
  price: PriceSection as React.ComponentType<ListingSectionProps & Record<string, unknown>>,
  variations: VariationsSection as React.ComponentType<ListingSectionProps & Record<string, unknown>>,
  details: DetailsSection as React.ComponentType<ListingSectionProps & Record<string, unknown>>,
  personalization: PersonalizationSection as React.ComponentType<ListingSectionProps & Record<string, unknown>>,
  shipping: ShippingSection as React.ComponentType<ListingSectionProps & Record<string, unknown>>,
};

/** The AI input (`useListingAI`) from the merged view; fields the marketplace lacks are left out. */
function aiInputFrom(view: ListingView<FieldMap>) {
  const f = view.fields;
  const price = parseFloat(String(f.price ?? ''));
  return {
    title: String(f.title ?? ''),
    description: String(f.description ?? ''),
    tags: Array.isArray(f.tags) ? (f.tags as readonly string[]) : undefined,
    materials: Array.isArray(f.materials) ? (f.materials as readonly string[]) : undefined,
    price: Number.isFinite(price) ? price : null,
    currency: view.meta.currency,
  };
}

/** Etsy per-section props: inline AI proposals (H) and the shop lists loaded once for Details + Shipping (B). */
function useEtsySectionProps(
  ai: UseListingAI,
  shopId: string | null,
  removeStagedMedia?: (draftMediaId: string) => Promise<void>,
): Partial<Record<SectionId, Record<string, unknown>>> {
  const shopMeta = useEtsyShopMeta(shopId);
  const price = ai.priceSectionProps();
  return {
    // Undo of one staged photo / video change (PATCH removeMediaIds); never sends.
    photos: { removeStagedMedia },
    title: { aiTitle: ai.fieldState('title'), aiDescription: ai.fieldState('description') },
    tags: { aiTags: ai.fieldState<string[]>('tags') },
    price: { ...price },
    details: { shopMeta },
    shipping: { shopMeta },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Small parts
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Maps the engine's change lines onto the rail list (E's group keys). */
export function toRailChanges(changes: readonly ChangeSummary[]): RailChangeItem[] {
  return changes.map((c) =>
    c.kind === 'action'
      ? { id: c.id, queuedAction: c.action, revertable: false }
      : { id: c.id, group: (c.group ?? undefined) as ChangeGroup | undefined, added: c.added, removed: c.removed, revertable: c.revertable },
  );
}

function toRailAttempts(draft: DraftRow | null): RailSyncAttempt[] {
  return (draft?.syncAttempts ?? []).map((a) => {
    // The drafts API returns the full attempt row; `result` carries the structured `{ code, key }` of a failure.
    const result = (a as { result?: unknown }).result;
    return {
      id: a.id, status: a.status, startedAt: a.startedAt, finishedAt: a.finishedAt, error: a.error, draftId: draft?.id ?? null,
      result: result && typeof result === 'object' ? (result as RailSyncAttempt['result']) : null,
    };
  });
}

function draftMediaUploads(draft: DraftRow | null): number {
  return (draft?.media ?? []).filter((m) => m.kind === 'image' && (m.operation === 'upload' || m.operation === 'ai_upload')).length;
}

/**
 * The editor header shows the whole listing title on up to 2 lines (a 129-character Etsy title was cut to
 * "…Boy First Birthday,…"). PageHeader keeps one line for list pages, so the editor relaxes it here.
 */
const headerSx = {
  '& header[data-layout="desktop"] > div': { height: 'auto', minHeight: 56, py: '6px' },
  '& header[data-layout="desktop"] h1': {
    whiteSpace: 'normal',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    fontSize: 18,
    lineHeight: '24px',
  },
} as const;

function Dot({ color }: { color: string }) {
  return <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0, display: 'inline-block' }} />;
}

function EditorSkeleton() {
  const visible = useDelayedVisible(SKELETON_DELAY_MS);
  if (!visible) return null;
  return (
    <Box data-testid="le-skeleton" aria-busy="true" sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Bone w="60%" h={28} />
      <Box sx={{ display: 'flex', gap: '8px' }}>
        <Bone w={72} h={20} r={10} />
        <Bone w={96} h={20} r={10} />
      </Box>
      <Box sx={{ display: 'flex', gap: '8px', overflow: 'hidden' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Bone key={i} w={96} h={96} r={6} />
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 360px' }, gap: '24px' }}>
        <PanelSkeleton sections={3} />
        <Box sx={{ display: { xs: 'none', lg: 'block' } }}>
          <PanelSkeleton sections={2} />
        </Box>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The editor
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ListingEditor<F extends FieldMap>(props: ListingEditorProps<F>) {
  const { marketplace, adapter, shopId, mode, backHref } = props;
  const t = useTranslations('listingEditor');
  const tRoot = useTranslations();
  const format = useFormatter();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const isMobile = useIsMobile();
  const isNarrow = useIsNarrow(); // < 1200: no rail
  const mpName = MP_NAME[marketplace];
  const mp = { marketplace: mpName, mp: marketplace };
  // Trendyol / Wix / Shopify (marketplace-editors §1): no MarketplacePreview (no verified rendering reference), no
  // Etsy/eBay profiles, one create primary "Send to {marketplace}" (no publish / draft split).
  const catalog = isCatalogMarketplace(marketplace);
  // Etsy/eBay-only children (preview, profiles) take the narrowed marketplace; never rendered for the catalog three.
  const etsyEbay: 'etsy' | 'ebay' = marketplace === 'ebay' ? 'ebay' : 'etsy';

  const engine: UseListingDraft<F> = useListingDraft<F>({
    adapter,
    shopId,
    mode,
    listingId: props.listingId,
    draftId: props.draftId,
    copy: props.copy,
    copyFromId: props.copyFromId,
    onDraftCreated: props.onDraftCreated,
    onCreated: props.onCreated,
  });
  const { view, draft, changes, saveState, sending } = engine;

  // ── AI (H): proposals only; Use writes through setField (autosave), never sends ──────────────────────
  const aiInput = React.useMemo(() => aiInputFrom(view as unknown as ListingView<FieldMap>), [view]);
  const ai = useListingAI({
    marketplace,
    input: aiInput,
    getField: (key) => (engine.view.fields as FieldMap)[key],
    setField: (key, value) => engine.setField(key as keyof F & string, value as F[keyof F]),
  });
  const mediaUndo = useStagedMediaUndo({ enabled: marketplace === 'etsy' && !props.sectionProps, draft: engine.draft, reloadDraft: engine.reloadDraft });
  const etsySectionProps = useEtsySectionProps(ai, marketplace === 'etsy' && engine.loadState === 'ready' ? shopId : null, mediaUndo.removeStagedMedia);
  const aiMarket = ai.priceSectionProps().market;
  const reportFacts = engine.reportFacts;
  React.useEffect(() => {
    if (aiMarket && typeof aiMarket.p25 === 'number' && typeof aiMarket.p75 === 'number' && !aiMarket.implausible) {
      reportFacts({ market: { p25: aiMarket.p25, p75: aiMarket.p75, median: aiMarket.median ?? undefined, n: aiMarket.n } });
    }
  }, [aiMarket, reportFacts]);

  const [panel, setPanel] = React.useState<EditorPanel | null>(null);
  const [revertingIds, setRevertingIds] = React.useState<string[]>([]);
  const [profileMode, setProfileMode] = React.useState<'apply' | 'save'>('apply');
  const openProfiles = React.useCallback((m: 'apply' | 'save') => {
    setProfileMode(m);
    setPanel('profiles');
  }, []);
  const [pulling, setPulling] = React.useState<'idle' | 'pulling' | 'failed'>('idle');
  const [pulledAt, setPulledAt] = React.useState<Date | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [statusAnchor, setStatusAnchor] = React.useState<HTMLElement | null>(null);
  const [slow, setSlow] = React.useState(false);
  const leaveConfirmed = React.useRef(false);

  React.useEffect(() => {
    if (engine.loadState === 'ready' && mode === 'edit') setPulledAt(new Date());
  }, [engine.loadState, mode]);

  // 15s → "Still loading… [Retry]" (the 30s error comes from the request itself).
  React.useEffect(() => {
    if (engine.loadState !== 'loading') {
      setSlow(false);
      return undefined;
    }
    const id = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(id);
  }, [engine.loadState]);

  const draftStatus = draft ? String(draft.status) : null;
  const syncingOnServer = draftStatus === 'syncing';
  const readOnly = sending || syncingOnServer;
  const queuedDelete = hasQueuedDelete(draft);
  // A queued delete must be the only staged change (server `deleteNotExclusive`): the form is locked until the
  // banner's "Remove delete"; the footer still sends it (with the type-to-confirm dialog).
  const formLocked = readOnly || queuedDelete;
  const count = changeCount(changes);
  // An open draft with no changes (e.g. after Undo) is not work: no Send/Discard, no "Not sent" pill. A failed,
  // conflicted or sending draft still needs attention even when its change list is empty.
  const draftNeedsAction = Boolean(draft) && ['failed', 'conflict', 'syncing'].includes(String((draft as { status?: unknown }).status ?? ''));
  const hasWork = count > 0 || (mode === 'create' ? Boolean(draft) : draftNeedsAction);

  // ── navigation helpers ────────────────────────────────────────────────────────────────────────────────
  const scrollTo = React.useCallback((section: string, field?: string) => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(sectionAnchorId(section as SectionId));
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!field) return;
    window.setTimeout(() => {
      const target =
        document.getElementById(fieldAnchorId(field)) ??
        (el?.querySelector('input, textarea, [role="combobox"], button') as HTMLElement | null);
      target?.focus({ preventScroll: true });
    }, 350);
  }, []);

  // Deep links (`#photos`, `#price`, `#tags`…) from the Listing doctor / score fixes: a section id or a field key.
  const deepLinked = React.useRef(false);
  React.useEffect(() => {
    if (engine.loadState !== 'ready' || deepLinked.current || typeof window === 'undefined') return undefined;
    deepLinked.current = true;
    const target = resolveEditorHash(window.location.hash, marketplace, mode);
    if (!target) return undefined;
    const id = window.setTimeout(() => scrollTo(target.section, target.field), 0);
    return () => window.clearTimeout(id);
  }, [engine.loadState, marketplace, mode, scrollTo]);

  const openPanel = React.useCallback((p: EditorPanel) => setPanel(p), []);
  const closePanel = React.useCallback(() => setPanel(null), []);

  const ctxValue = React.useMemo<ListingEditorContextValue<F>>(
    () => ({ ...engine, marketplaceName: mpName, readOnly: formLocked, scrollTo, openPanel }),
    [engine, mpName, formLocked, scrollTo, openPanel],
  );
  const slotCtx: EditorSlotContext<F> = { editor: ctxValue, open: panel, close: closePanel };

  // ‹ › from the list's current page (sessionStorage written by the list).
  const [nav, setNav] = React.useState<ReturnType<typeof readEditorNav>>(null);
  React.useEffect(() => setNav(readEditorNav()), []);
  const neighbors = mode === 'edit' && props.listingId ? editorNeighbors(nav, marketplace, shopId, props.listingId) : null;
  const goTo = React.useCallback(
    (id: string | null | undefined) => {
      if (!id) return;
      // editorNav adds the store param only where the marketplace has one (Etsy `shop`, Wix `site`, Shopify `shop`).
      void router.push(editorHref(marketplace, id, shopId));
    },
    [router, marketplace, shopId],
  );

  // ── health + preview ──────────────────────────────────────────────────────────────────────────────────
  const etsyHealth = useEtsyHealth(view as unknown as ListingView<FieldMap>, engine.remote as FieldMap | null);
  const customHealth = props.health ? props.health(view, engine.remote) : null;
  const health = customHealth ?? etsyHealth;
  const previewModel = React.useMemo(
    () => (props.preview ? props.preview(view, props.shopName ?? null) : etsyPreviewModel(view as unknown as ListingView<FieldMap>, props.shopName ?? null)),
    [view, props.shopName],
  );

  const onFix = React.useCallback(
    (check: Check) => {
      const target = fixTarget(check);
      if (!target) return;
      if (isMobile || isNarrow) setPanel(null);
      if (target.kind === 'field') {
        scrollTo(target.section, target.field);
        return;
      }
      if (props.slots?.onFixAction?.(target.action, { editor: ctxValue, open: panel, close: closePanel })) return;
      // AI fixes only produce a proposal card under the field (P6): scroll there and start it.
      if (target.action === 'ai_title') void ai.suggestTitle();
      else if (target.action === 'ai_description') void ai.writeDescription();
      else if (target.action === 'ai_tags') void ai.getTagIdeas();
      else if (target.action === 'check_price') void ai.checkPrice();
      const fallback: Record<string, [SectionId, string]> = {
        ai_title: ['title', 'title'],
        normalize_title: ['title', 'title'],
        ai_description: ['title', 'description'],
        ai_tags: ['tags', 'tags'],
        ai_alt_text: ['photos', 'photos'],
        check_price: ['price', 'price'],
      };
      const f = fallback[target.action];
      if (f) scrollTo(f[0], f[1]);
    },
    [isMobile, isNarrow, scrollTo, props.slots, ctxValue, panel, closePanel, ai],
  );

  // ── send history (rail) ───────────────────────────────────────────────────────────────────────────────
  const history = useSendHistory({ marketplace, shopId, listingId: mode === 'edit' ? props.listingId : null, enabled: !isNarrow });

  // ── live events: refresh the snapshot, never overwrite a dirty field ───────────────────────────────────
  const live = React.useRef({ sending, saveState, listingId: props.listingId, draftId: draft?.id ?? null });
  live.current = { sending, saveState, listingId: props.listingId, draftId: draft?.id ?? null };
  useLiveEvent(
    ['listing.changed'],
    (event) => {
      const l = live.current;
      if (l.sending) return;
      const e = event as unknown as { type?: string; listingId?: string | null; draftId?: string; attribution?: string | null; kind?: string };
      if (e.type === 'listing' && mode === 'edit' && e.listingId === l.listingId && e.attribution !== 'kolayxport_draft') {
        void engine.refreshRemote().then(() => setPulledAt(new Date())).catch(() => undefined);
      } else if (e.type === 'draft' && e.draftId && e.draftId === l.draftId && e.kind !== 'syncing') {
        void engine.reloadDraft();
      }
    },
    { enabled: engine.loadState === 'ready' },
  );

  // ── actions ───────────────────────────────────────────────────────────────────────────────────────────
  const refresh = React.useCallback(async () => {
    setPulling('pulling');
    try {
      await engine.refreshRemote();
      setPulledAt(new Date());
      setPulling('idle');
    } catch {
      setPulling('failed');
    }
  }, [engine]);

  const errorText = React.useCallback(
    (err: unknown, fallbackKey: string) => {
      const info = adapter.errorInfo(err);
      if (info.key && tRoot.has(info.key)) return tRoot(info.key, (info.params ?? {}) as Record<string, string | number>);
      return t(fallbackKey, mp);
    },
    [adapter, tRoot, t, mpName, marketplace],
  );

  const doSend = React.useCallback(
    async (publish?: boolean) => {
      let confirmedDelete = false;
      if (hasQueuedDelete(engine.draft)) {
        const ok = await confirm({
          title: t('confirm.deleteTitle', { title: view.fields.title as string }),
          body: t('confirm.deleteBody', { ...mp, shop: props.shopName || shopId }),
          confirmLabel: t('confirm.deleteConfirm'),
          tone: 'danger',
          typeToConfirm: props.shopName || shopId,
        });
        if (!ok) return;
        confirmedDelete = true;
      }
      setWarnings([]);
      const result = await engine.send({ publish, confirmedDelete });
      if (result.outcome === 'sent' && result.deleted) {
        // The listing no longer exists: never leave an editable workspace on it.
        toast.success(t('toast.deleted', mp));
        leaveConfirmed.current = true;
        void router.replace(backHref);
        return;
      }
      if (result.outcome === 'sent') {
        const w = (result.warnings ?? [])
          .map((x) => (x.key && tRoot.has(x.key) ? tRoot(x.key, (x.params ?? {}) as Record<string, string | number>) : null))
          .filter((x): x is string => Boolean(x));
        setWarnings(w);
        toast.success(w.length ? t('banner.warnings', { count: w.length }) : t('toast.sent', mp));
        history.retry();
        setPulledAt(new Date());
      } else if (result.outcome === 'blocked') {
        const first = engine.issues.find((i) => i.severity !== 'warn') ?? result.issues?.[0];
        if (first) scrollTo(first.section, first.field);
      } else if (result.outcome === 'conflict') {
        setPanel('review');
      } else if (result.outcome === 'failed') {
        toast.error(errorText(result.error, 'banner.rejected'));
      }
    },
    [engine, confirm, t, tRoot, toast, view.fields.title, props.shopName, shopId, history, scrollTo, errorText, router, backHref],
  );

  const doDiscard = React.useCallback(async () => {
    const ok = await confirm(
      mode === 'create'
        ? { title: t('confirm.discardNewTitle'), confirmLabel: t('action.discardNew'), tone: 'danger' }
        : {
            title: t('confirm.discardTitle', { count: Math.max(count, 1) }),
            body: t('confirm.discardBody', mp),
            confirmLabel: t('action.discard'),
            tone: 'danger',
          },
    );
    if (!ok) return;
    try {
      await engine.discard();
      toast.success(t('toast.discarded'));
      if (mode === 'create') {
        leaveConfirmed.current = true;
        void router.push(backHref);
      }
    } catch (err) {
      toast.error(errorText(err, 'toast.discardFailed'));
    }
  }, [confirm, mode, t, count, engine, toast, router, backHref, errorText]);

  const stageState = React.useCallback(
    async (type: 'deactivate' | 'publish' | 'renew' | 'delete') => {
      const title = view.fields.title as string;
      const opts =
        type === 'delete'
          ? {
              title: t('confirm.deleteTitle', { title }),
              body: t('confirm.deleteBody', { ...mp, shop: props.shopName || shopId }),
              confirmLabel: t('confirm.deleteConfirm'),
              tone: 'danger' as const,
              typeToConfirm: props.shopName || shopId,
            }
          : type === 'deactivate'
            ? { title: t('confirm.deactivateTitle', { title }), body: t('confirm.deactivateBody'), confirmLabel: t('confirm.stage') }
            : type === 'renew'
              ? { title: t('confirm.renewTitle', { title }), body: t('confirm.renewBody'), confirmLabel: t('confirm.stage') }
              : { title: t('confirm.publishTitle', { title }), body: t('confirm.publishBody', mp), confirmLabel: t('confirm.stage') };
      if (!(await confirm(opts))) return;
      try {
        await engine.stageActions([{ type }]);
      } catch (err) {
        toast.error(errorText(err, 'toast.stageFailed'));
      }
    },
    [confirm, engine, t, toast, view.fields.title, props.shopName, shopId, errorText],
  );

  const removeQueued = React.useCallback(
    async (types: string[]) => {
      try {
        await engine.removeActions(types);
      } catch (err) {
        toast.error(errorText(err, 'toast.stageFailed'));
      }
    },
    [engine, toast, errorText],
  );

  // ── footer: status line ───────────────────────────────────────────────────────────────────────────────
  const savedTime = engine.savedAt ? format.dateTime(engine.savedAt, { hour: '2-digit', minute: '2-digit' }) : null;
  let statusText: string;
  let statusDot: string | null = null;
  let statusClickable = false;
  let statusRetry = false;
  if (sending || syncingOnServer) {
    statusText = t('save.sending', mp);
    statusDot = toneTokens.info.solid;
  } else if (draftStatus === 'conflict') {
    statusText = t('save.conflict', mp);
    statusDot = toneTokens.warning.solid;
  } else if (draftStatus === 'failed' && saveState !== 'dirty' && saveState !== 'saving') {
    statusText = t('save.sendFailed');
    statusDot = toneTokens.danger.solid;
  } else if (saveState === 'dirty') {
    statusText = t('save.unsaved');
    statusDot = toneTokens.attention.solid;
  } else if (saveState === 'saving') {
    statusText = t('save.saving');
  } else if (saveState === 'error') {
    // A send in progress / a draft that can't be edited: say so (etsy|ebay.draftSync.*), Retry stays.
    const refusal = engine.saveError?.key && isRefusalKey(engine.saveError.key) && tRoot.has(engine.saveError.key) ? engine.saveError : null;
    statusText = refusal ? tRoot(refusal.key as string, (refusal.params ?? {}) as Record<string, string | number>) : t('save.failed');
    statusDot = toneTokens.danger.solid;
    statusRetry = true;
  } else if (saveState === 'offline') {
    statusText = t('save.device');
    statusDot = toneTokens.warning.solid;
    statusRetry = true;
  } else if (mode === 'create') {
    statusText = draft ? t('save.savedNew', mp) : t('save.notSavedYet');
  } else if (count === 0) {
    statusText = t('save.upToDate', mp);
  } else {
    statusText = savedTime ? t('save.saved', { time: savedTime, count }) : t('save.savedNoTime', { count });
    statusDot = toneTokens.attention.solid;
    statusClickable = true;
  }
  if (count > 0 && mode === 'edit') statusClickable = true;

  const statusNode = (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }} aria-live="polite">
      {statusDot ? <Dot color={statusDot} /> : null}
      {statusClickable && isNarrow ? (
        <ButtonBase
          onClick={(e) => setStatusAnchor(e.currentTarget)}
          aria-haspopup="dialog"
          data-testid="le-status-changes"
          sx={{ font: 'inherit', color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3, borderRadius: 1, minHeight: 32 }}
        >
          {statusText}
        </ButtonBase>
      ) : (
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-testid="le-status">
          {statusText}
        </Box>
      )}
      {statusRetry ? (
        <ButtonBase onClick={() => void engine.saveNow()} sx={{ font: 'inherit', color: toneTokens.info.fg, textDecoration: 'underline', minHeight: 32 }}>
          {t('save.retry')}
        </ButtonBase>
      ) : null}
    </Box>
  );

  // ── footer: primary / secondary / overflow ────────────────────────────────────────────────────────────
  const sendDisabledReason =
    saveState === 'error' || saveState === 'offline'
      ? t('save.saveFirstReason')
      : engine.draftCheckFailed
        ? t('save.draftCheckReason')
        : syncingOnServer
          ? t('save.sending', mp)
          : undefined;

  let primary: ActionSpec | undefined;
  let primarySlot: React.ReactNode = null;
  if (mode === 'create' && catalog) {
    primary = {
      id: 'publish',
      label: t('action.sendShort', mp),
      onClick: () => void doSend(),
      loading: sending,
      loadingLabel: t('action.sending'),
      disabled: Boolean(sendDisabledReason) || readOnly,
      disabledReason: sendDisabledReason,
      shortcut: '⌘↵',
    };
  } else if (mode === 'create') {
    const publishSpec: ActionSpec = {
      id: 'publish',
      label: marketplace === 'etsy' ? t('action.publishEtsy') : t('action.listEbay'),
      onClick: () => void doSend(true),
      loading: sending,
      loadingLabel: t('action.sending'),
      disabled: Boolean(sendDisabledReason) || readOnly,
      disabledReason: sendDisabledReason,
      shortcut: '⌘↵',
    };
    const draftSpec: ActionSpec = {
      id: 'sendAsDraft',
      label: marketplace === 'etsy' ? t('action.sendAsDraftEtsy') : t('action.saveUnpublishedEbay'),
      onClick: () => void doSend(false),
      disabled: Boolean(sendDisabledReason) || readOnly,
      disabledReason: sendDisabledReason,
    };
    primary = publishSpec;
    primarySlot = <SplitButton primary={publishSpec} options={[draftSpec]} size={isMobile ? 'xl' : 'md'} data-testid="le-primary" />;
  } else if (draftStatus === 'conflict') {
    primary = { id: 'review', label: t('action.review'), onClick: () => setPanel('review'), shortcut: '⌘↵' };
  } else if (hasWork || sending) {
    const label =
      draftStatus === 'failed' && saveState !== 'dirty'
        ? t('action.sendAgain')
        : isMobile
          ? t('action.sendShort', mp)
          : count > 1
            ? t('action.sendCount', { ...mp, count })
            : t('action.send', mp);
    primary = {
      id: 'send',
      label,
      onClick: () => void doSend(),
      loading: sending,
      loadingLabel: t('action.sending'),
      disabled: Boolean(sendDisabledReason) || readOnly,
      disabledReason: sendDisabledReason,
      shortcut: '⌘↵',
    };
  }

  const discardSpec: ActionSpec | undefined =
    (mode === 'create' || hasWork) && !sending && saveState !== 'offline'
      ? { id: 'discard', label: mode === 'create' ? t('action.discardNew') : t('action.discard'), onClick: () => void doDiscard() }
      : undefined;
  const previewSpec: ActionSpec = { id: 'preview', label: t('action.preview'), onClick: () => setPanel('preview') };

  const listingIdForLinks = mode === 'edit' ? props.listingId : null;
  const state = view.meta.state ? String(view.meta.state).toLowerCase() : null;
  const pending = pendingActions(draft).map((a) => a.type);
  const overflow: ActionSpec[] = [];
  if (mode === 'edit' && view.meta.url) {
    overflow.push({ id: 'viewOn', label: t('action.viewOn', mp), icon: icons.externalLink, onClick: () => window.open(String(view.meta.url), '_blank', 'noopener') });
  }
  if (listingIdForLinks) {
    overflow.push({
      id: 'copy',
      label: t('action.copy'),
      icon: icons.copy,
      onClick: () => void router.push(newListingHref(marketplace, shopId, { copy: listingIdForLinks })),
    });
    if (marketplace === 'etsy') {
      overflow.push({
        id: 'copyToEbay',
        label: t('action.copyToEbay'),
        onClick: () => void router.push(newListingHref('ebay', null, { crosslist: `etsy:${listingIdForLinks}` })),
      });
    }
  }
  if (!catalog) {
    overflow.push({ id: 'profiles', label: t('action.applyProfile'), onClick: () => openProfiles('apply') });
    overflow.push({ id: 'saveProfile', label: t('action.saveProfile'), onClick: () => openProfiles('save') });
  }
  // Scheduled sends need the backend (BR-1a `scheduledSendAt` + BR-8 cron): same build switch as the grid, so the
  // item is not offered before the backend can run it (it used to answer 503 inline).
  if (SCHEDULED_SENDS_ENABLED && mode === 'edit' && draft && !queuedDelete && draftStatus === 'draft') {
    overflow.push({ id: 'schedule', label: t('action.schedule'), icon: icons.schedule, onClick: () => setPanel('schedule') });
  }
  if (marketplace === 'etsy' && listingIdForLinks) {
    overflow.push({ id: 'history', label: t('action.history'), icon: icons.history, onClick: () => setPanel('history') });
    overflow.push({
      id: 'trackKeywords',
      label: t('action.trackKeywords'),
      onClick: () => window.open(`/app/research/keywords?listing=${encodeURIComponent(listingIdForLinks)}`, '_blank', 'noopener'),
    });
  }
  if (mode === 'edit' && marketplace === 'etsy' && !queuedDelete) {
    if (state === 'active' && !pending.includes('deactivate')) overflow.push({ id: 'deactivate', label: t('action.deactivate', mp), onClick: () => void stageState('deactivate') });
    if ((state === 'inactive' || state === 'draft') && !pending.includes('publish')) overflow.push({ id: 'publishState', label: t('action.publish', mp), onClick: () => void stageState('publish') });
    if ((state === 'expired' || state === 'sold_out') && !pending.includes('renew')) overflow.push({ id: 'renew', label: t('action.renew', mp), onClick: () => void stageState('renew') });
    overflow.push({ id: 'delete', label: t('action.delete'), icon: icons.delete, tone: 'danger', onClick: () => void stageState('delete') });
  }
  // Phone: Preview sits beside the send button; with nothing to send it moves to ⋯ so the bar stays one quiet line.
  const mobilePreviewInBar = isMobile && !catalog && Boolean(primary || primarySlot);
  if (isMobile && !catalog && !mobilePreviewInBar) overflow.unshift(previewSpec);
  if (isMobile && discardSpec) overflow.push({ ...discardSpec, tone: 'danger' });

  // ⌘K: the footer actions + "Jump to section…"
  usePageActions([primary, discardSpec, ...overflow], { enabled: !isMobile && engine.loadState === 'ready' });
  const sectionDefs = sectionsFor(marketplace, mode);
  useCommands(
    sectionDefs.map((s) => ({
      id: `listingEditor.jump.${s.id}`,
      label: t('nav.jumpTo', { section: tRoot(s.titleKey) }),
      group: 'actions' as const,
      run: () => scrollTo(s.id),
    })),
    { enabled: engine.loadState === 'ready' },
  );

  // ── keyboard ──────────────────────────────────────────────────────────────────────────────────────────
  useShortcuts(
    {
      'mod+s': { handler: () => void engine.saveNow(), allowInInput: true, description: t('keys.save') },
      'mod+enter': {
        handler: () => {
          if (primary && !primary.disabled && !primary.loading) primary.onClick?.();
        },
        allowInInput: true,
        description: t('keys.send'),
      },
      j: neighbors?.next ? { handler: () => goTo(neighbors.next), description: t('page.next') } : null,
      k: neighbors?.prev ? { handler: () => goTo(neighbors.prev), description: t('page.prev') } : null,
    },
    { scope: 'page', enabled: engine.loadState === 'ready', describe: true },
  );

  // ── leaving the page ──────────────────────────────────────────────────────────────────────────────────
  const leaveState = React.useRef(saveState);
  leaveState.current = saveState;
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = leaveState.current;
      if (s === 'dirty' || s === 'saving') void engine.saveNow();
      if (s === 'dirty' || s === 'saving' || s === 'error' || s === 'offline') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onRouteStart = (url: string) => {
      const s = leaveState.current;
      if (s === 'dirty' || s === 'saving') {
        // Everything else is already in the DB draft; flush the last edits (the request outlives the page).
        void engine.saveNow();
        return;
      }
      if ((s === 'error' || s === 'offline') && !leaveConfirmed.current) {
        router.events.emit('routeChangeError');
        void confirm({
          title: t('confirm.leaveTitle'),
          body: t('confirm.leaveBody'),
          confirmLabel: t('confirm.leave'),
          cancelLabel: t('confirm.keepEditing'),
          tone: 'danger',
        }).then((ok) => {
          if (!ok) return;
          leaveConfirmed.current = true;
          void router.push(url);
        });
        // Next.js cancels a route change only by throwing from this handler.
        throw new Error('kx-listing-editor: navigation held for confirmation');
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    router.events.on('routeChangeStart', onRouteStart);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      router.events.off('routeChangeStart', onRouteStart);
    };
  }, [engine, router, confirm, t]);

  // Flush on blur out of the form column (§5.1 "on field blur").
  const onFormBlur = React.useCallback(() => {
    if (leaveState.current === 'dirty') void engine.saveNow();
  }, [engine]);

  // ── banners (max 2 visible, most important first) ───────────────────────────────────────────────────
  const banners: React.ReactNode[] = [];
  if (queuedDelete) {
    banners.push(
      <Banner
        key="delete"
        tone="danger"
        title={t('banner.queuedDelete', mp)}
        action={{ id: 'removeDelete', label: t('banner.removeDelete'), onClick: () => void removeQueued(['delete']) }}
        data-testid="le-banner-delete"
      >
        {t('banner.queuedDeleteLocked')}
      </Banner>,
    );
  }
  if (engine.issues.some((i) => i.severity !== 'warn') && saveState !== 'saving') {
    const blocking = engine.issues.filter((i) => i.severity !== 'warn');
    banners.push(
      <Banner
        key="fix"
        tone="danger"
        title={t('banner.fixFields', { ...mp, count: blocking.length })}
        action={{ id: 'goFirst', label: t('banner.goToFirst'), onClick: () => scrollTo(blocking[0].section, blocking[0].field) }}
        data-testid="le-banner-fix"
      />,
    );
  }
  if (draftStatus === 'failed' && draft) {
    const causeKey = adapter.failureCauseKey(draft);
    // ICU params of the stored key come from the attempt that recorded it (also when the adapter added the
    // `etsy.` / `ebay.` namespace to a bare key); missing params render the generic cause.
    const cause = tRoot.has(causeKey)
      ? renderSendError(tRoot as unknown as SendErrorTranslator, { errorKey: causeKey, errorParams: storedDraftSendErrorParams(draft, causeKey) })
      : t('banner.rejected', mp);
    banners.push(
      <Banner
        key="failed"
        tone="danger"
        title={t('banner.failed', { ...mp, cause })}
        action={{ id: 'retrySend', label: t('action.sendAgain'), onClick: () => void doSend(), disabled: Boolean(sendDisabledReason) }}
        data-testid="le-banner-failed"
      />,
    );
  }
  if (draftStatus === 'conflict') {
    // A specific stored conflict cause (e.g. `ebay.draftSync.itemMissing`, `etsy.draftSync.deletedOnEtsy`) is shown
    // under the title; the generic "changed remotely" keys would only repeat it.
    const conflictKey = draft && storedDraftSendError(draft) ? adapter.failureCauseKey(draft) : null;
    let conflictCause = '';
    if (conflictKey && !GENERIC_CONFLICT_KEYS.has(conflictKey) && tRoot.has(conflictKey)) {
      const text = renderSendError(
        tRoot as unknown as SendErrorTranslator,
        { errorKey: conflictKey, errorParams: storedDraftSendErrorParams(draft, conflictKey) },
        CONFLICT_FALLBACK_KEY,
      );
      // Params the attempt did not record → renderSendError fell back to the generic conflict text: show nothing.
      if (text !== tRoot(CONFLICT_FALLBACK_KEY)) conflictCause = text;
    }
    banners.push(
      <Banner
        key="conflict"
        tone="warning"
        title={t('banner.conflict', mp)}
        action={{ id: 'review', label: t('action.review'), onClick: () => setPanel('review') }}
        data-testid="le-banner-conflict"
      >
        {conflictCause || undefined}
      </Banner>,
    );
  }
  if (syncingOnServer && !sending) {
    const started = draft?.syncAttempts?.[0]?.startedAt;
    banners.push(
      <Banner
        key="syncing"
        tone="info"
        title={t('banner.sending', { ...mp, time: started ? format.dateTime(new Date(started), { hour: '2-digit', minute: '2-digit' }) : '—' })}
        data-testid="le-banner-syncing"
      />,
    );
  }
  for (const type of ['deactivate', 'publish', 'renew'] as const) {
    if (!pending.includes(type) || mode === 'create') continue;
    banners.push(
      <Banner
        key={`q-${type}`}
        tone="info"
        title={t(`banner.queued.${type}`, mp)}
        action={{ id: `undo-${type}`, label: t('banner.undo'), onClick: () => void removeQueued([type]) }}
        data-testid={`le-banner-queued-${type}`}
      />,
    );
  }
  if (engine.deviceCopy) {
    banners.push(
      <Banner
        key="device"
        tone="attention"
        title={t('banner.deviceCopy')}
        action={{ id: 'restore', label: t('banner.restore'), onClick: () => engine.restoreDeviceCopy() }}
        onDismiss={() => engine.dismissDeviceCopy()}
        dismissKey={undefined}
        data-testid="le-banner-device"
      />,
    );
  }
  if (engine.draftCheckFailed) {
    banners.push(
      <Banner
        key="draftCheck"
        tone="warning"
        title={t('banner.draftCheckFailed')}
        action={{ id: 'retryDraft', label: t('save.retry'), onClick: () => void engine.reloadDraft() }}
        data-testid="le-banner-draftcheck"
      />,
    );
  }
  if (warnings.length) {
    banners.push(
      <Banner key="warnings" tone="warning" title={t('banner.warnings', { count: warnings.length })} onDismiss={() => setWarnings([])} data-testid="le-banner-warnings">
        {warnings.join(' · ')}
      </Banner>,
    );
  }

  // ── header ────────────────────────────────────────────────────────────────────────────────────────────
  const fieldTitle = String(view.fields.title ?? '').trim();
  const headerTitle = mode === 'create' ? fieldTitle || t('page.newTitle') : fieldTitle || t('page.editTitle');
  const pageTitle = isMobile ? (mode === 'create' ? t('page.newTitle') : t('page.editTitle')) : headerTitle;
  const listingPill = mode === 'edit' && view.meta.state ? listingStatus({ state: view.meta.state }, 'etsy') : null;
  const rawSyncPill = draft ? syncStatus({ status: draftStatus, syncedAt: draft.syncedAt, updatedAt: draft.updatedAt }) : saveState === 'dirty' && mode === 'edit' && count > 0 ? 'pending' : null;
  // "N changes not sent" (a link to the list) says what the plain "Not sent yet" pill said, with the number.
  const showChanges = mode === 'edit' && count > 0;
  // An empty open draft has nothing to send: no "Not sent yet" pill.
  const syncPill = (showChanges || (mode === 'edit' && count === 0)) && rawSyncPill === 'pending' ? null : rawSyncPill;
  const changesIndicator = showChanges ? (
    <ButtonBase
      onClick={(e) => setStatusAnchor(e.currentTarget)}
      aria-haspopup="dialog"
      data-testid="le-header-changes"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', height: 22, px: '8px', borderRadius: '9999px',
        bgcolor: toneTokens.attention.bg, color: toneTokens.attention.fg, border: `1px solid ${toneTokens.attention.border}`,
        fontSize: 12, lineHeight: '16px', fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0,
        '&:hover': { textDecoration: 'underline', textUnderlineOffset: 3 },
        '@media (pointer: coarse)': { height: 32 },
      }}
    >
      <Dot color={toneTokens.attention.solid} />
      {t('page.changesPending', { count })}
    </ButtonBase>
  ) : null;
  const pills = (
    <>
      {listingPill && marketplace === 'etsy' ? <StatusPill domain="listing" status={listingPill} raw={view.meta.state ?? undefined} /> : null}
      {syncPill ? <StatusPill domain="sync" status={syncPill} /> : null}
      {changesIndicator}
    </>
  );

  const subtitleParts: string[] = [];
  if (mode === 'edit' && view.meta.id) {
    subtitleParts.push(
      // Phones: the ID alone (the "refreshed" line right below already says how fresh it is).
      view.meta.updatedAt && !isMobile
        ? t('page.idMeta', { ...mp, id: view.meta.id, date: format.dateTime(view.meta.updatedAt, { day: 'numeric', month: 'short' }) })
        : t('page.idOnly', { id: view.meta.id }),
    );
    if (!isMobile && (view.meta.views > 0 || view.meta.favorites > 0)) subtitleParts.push(t('page.stats', { views: view.meta.views, favorites: view.meta.favorites }));
  } else if (mode === 'create') {
    subtitleParts.push(props.shopName || mpName);
  }

  const meta =
    mode === 'edit' ? (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <SyncMeta source={marketplace} lastPulledAt={pulledAt} state={pulling} onPull={() => void refresh()} />
        {engine.remoteChangedAt ? (
          <Typography component="span" variant="caption" sx={{ color: toneTokens.warning.fg }} data-testid="le-remote-changed">
            {t('page.remoteChanged', { ...mp, time: format.dateTime(engine.remoteChangedAt, { hour: '2-digit', minute: '2-digit' }) })}
          </Typography>
        ) : null}
      </Box>
    ) : null;

  const narrowHeaderTools =
    isNarrow && !isMobile ? (
      <>
        <ScoreMeter score={health.score} afterScore={health.afterScore} variant="cell" checksUsed={health.result.checksUsed} checksTotal={health.result.checksTotal} onClick={() => setPanel('health')} />
        {catalog ? null : (
          <Button variant="secondary" size="sm" onClick={() => setPanel('preview')}>
            {t('action.preview')}
          </Button>
        )}
      </>
    ) : null;
  const navArrows = neighbors ? (
    <>
      <IconButton icon={icons.back} label={t('page.prev')} shortcut="k" disabled={!neighbors.prev} onClick={() => goTo(neighbors.prev)} />
      <IconButton icon={icons.next} label={t('page.next')} shortcut="j" disabled={!neighbors.next} onClick={() => goTo(neighbors.next)} />
    </>
  ) : null;

  // ── section nav ───────────────────────────────────────────────────────────────────────────────────────
  const navStates = sectionStates(changes, engine.issues);
  const sectionComponents: SectionComponents = props.sections ?? (marketplace === 'etsy' ? DEFAULT_ETSY_SECTIONS : {});
  const renderedSections = sectionDefs.filter((s) => sectionComponents[s.id]);
  const navItems: SectionNavItem[] = renderedSections.map((s) => {
    const st = navStates[s.id];
    const label = tRoot(s.titleKey);
    return {
      id: sectionAnchorId(s.id),
      label,
      state: st?.error ? 'danger' : st && st.changes > 0 ? 'attention' : undefined,
      count: st?.error ? undefined : st?.changes,
    };
  });
  const extraProps = props.sectionProps ?? (marketplace === 'etsy' ? etsySectionProps : {});

  // ── rail ──────────────────────────────────────────────────────────────────────────────────────────────
  // Staged media groups (photos / order / alt / video) revert by un-staging their rows (Etsy, edit mode).
  const railChanges = toRailChanges(changes).map((r) => {
    const c = changes.find((x) => x.id === r.id);
    return c && mode === 'edit' && mediaUndo.canRevert(c) ? { ...r, revertable: true } : r;
  });
  const noPhotos = (view.facts.images ?? []).filter((i) => i.staged !== 'delete').length === 0 && draftMediaUploads(draft) === 0;
  const neededItems =
    mode === 'create'
      ? [
          ...(noPhotos ? [{ id: 'photos', labelKey: 'listingEditor.needed.photos', onSelect: () => scrollTo('photos') }] : []),
          ...engine.issues
            .concat(adapter.validate(view.fields, mode))
            .filter((i, idx, arr) => i.severity !== 'warn' && arr.findIndex((x) => x.field === i.field) === idx)
            .map((i) => ({ id: i.field, labelKey: `listingEditor.needed.${i.field}`, onSelect: () => scrollTo(i.section, i.field) }))
            .filter((i) => tRoot.has(i.labelKey)),
        ]
      : undefined;
  const onRevert = (item: RailChangeItem) => {
    const c = changes.find((x) => x.id === item.id);
    if (c && mediaUndo.canRevert(c)) {
      setRevertingIds((ids) => [...ids, c.id]);
      void mediaUndo.revert(c)
        .catch((err) => { toast.error(errorText(err, 'photos.stageFailed'), { persist: false }); })
        .finally(() => setRevertingIds((ids) => ids.filter((id) => id !== c.id)));
      return;
    }
    if (c?.revertable && c.fields.length) engine.revert(c.fields);
  };
  const changesList = (hideTitle?: boolean) => (
    <RailChanges marketplace={marketplace} changes={railChanges} onRevert={mode === 'edit' ? onRevert : undefined} revertingIds={revertingIds} needed={neededItems} hideTitle={hideTitle} />
  );

  const rail = (
    <Box
      component="aside"
      aria-label={t('rail.label')}
      data-testid="le-rail"
      sx={{
        position: 'sticky',
        top: 'calc(var(--kx-section-nav-top, 0px) + 56px)',
        alignSelf: 'start',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        maxHeight: 'calc(100vh - 160px)',
        overflowY: 'auto',
        pr: '2px',
        '& > * + *': { borderTop: `1px solid ${neutral[100]}`, pt: '16px' },
      }}
    >
      <RailHealth health={health} onFix={onFix} />
      {catalog ? null : <MarketplacePreview marketplace={etsyEbay} listing={previewModel} headingLevel={3} />}
      {changesList()}
      {mode === 'edit' ? (
        <RailHistory marketplace={marketplace} attempts={toRailAttempts(draft)} sent={history.sent} loading={history.loading} error={history.error} onRetry={history.retry} />
      ) : null}
    </Box>
  );

  // ── body ──────────────────────────────────────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (engine.loadState === 'loading') {
    body = slow ? <SlowState onRetry={() => router.reload()} /> : <EditorSkeleton />;
  } else if (engine.loadState === 'error') {
    const status = engine.loadError?.status ?? null;
    // eBay listings made on eBay's own site ("legacy-<itemId>") are refused with 409: say why and link to eBay's
    // revise page instead of a generic "couldn't load" (every legacy eBay listing hit this).
    const ebayLegacyId = marketplace === 'ebay' && status === 409 && props.listingId?.startsWith('legacy-') ? props.listingId.slice(7) : null;
    const title = ebayLegacyId ? t('state.ebayLegacyTitle') : status === 404 ? t('state.notFound', mp) : t('state.loadFailed', mp);
    const cause = ebayLegacyId ? t('state.ebayLegacyBody') : status === 401 ? t('state.reconnect', mp) : undefined;
    body = (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
        <ErrorState variant="page" title={title} cause={cause} onRetry={ebayLegacyId ? undefined : () => router.reload()} />
        <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {ebayLegacyId ? (
            <Button variant="primary" onClick={() => window.open(`https://www.ebay.com/sl/list?mode=ReviseItem&itemId=${encodeURIComponent(ebayLegacyId)}`, '_blank', 'noopener')}>
              {t('state.ebayLegacyAction')}
            </Button>
          ) : null}
          {status === 401 ? (
            <Button variant="secondary" href="/ayarlar?tab=connections">
              {t('state.reconnectAction', mp)}
            </Button>
          ) : null}
          <Button variant="ghost" href={backHref}>
            {t('page.back', mp)}
          </Button>
        </Box>
      </Box>
    );
  } else {
    const pristine = mode === 'create' && engine.saveState === 'idle' && !draft;
    const startFaster = !pristine
      ? null
      : props.slots?.startFaster
        ? props.slots.startFaster(slotCtx)
        : (
            <AiFillCard
              ai={ai}
              photoUrls={(view.facts.images ?? []).map((i) => i.src).filter(Boolean)}
              onApplyProfile={() => openProfiles('apply')}
            />
          );
    body = (
      <>
        {banners.length ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', mb: '12px' }} data-testid="le-banners">
            {banners.slice(0, 2)}
          </Box>
        ) : null}
        <SectionNav sections={navItems} aria-label={t('nav.label')} data-testid="le-section-nav" />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : 'minmax(0, 848px) 360px',
            justifyContent: 'space-between',
            columnGap: '24px',
            mt: isMobile ? '12px' : '16px',
          }}
        >
          <Box
            data-testid="le-form"
            onBlur={onFormBlur}
            aria-busy={readOnly || undefined}
            aria-disabled={formLocked || undefined}
            sx={{
              minWidth: 0,
              maxWidth: 848,
              display: 'flex',
              flexDirection: 'column',
              // fields ≤ 720 (founder: "1470px-wide fields")
              '& .MuiInputBase-root, & .MuiAutocomplete-root, & .MuiFormControl-root': { maxWidth: 720 },
              // Usability pass: one calm rhythm between sections (≤ 24px desktop, 16px phone incl. the rule), and the
              // DS Section's own 24px bottom margin is dropped here so gaps never stack into ~90px of white.
              '& > [data-le-section] > section': { mb: 0 },
              '& > [data-le-section] + [data-le-section]': {
                borderTop: `1px solid ${neutral[100]}`,
                mt: isMobile ? `${SECTION_GAP_MOBILE / 2}px` : `${SECTION_GAP / 2}px`,
                pt: isMobile ? `${SECTION_GAP_MOBILE / 2}px` : `${SECTION_GAP / 2}px`,
              },
              ...(formLocked ? { pointerEvents: 'none', opacity: 0.7 } : {}),
            }}
          >
            {renderedSections.map((s) => {
              const Comp = sectionComponents[s.id]!;
              return (
                <Box key={s.id} data-le-section={s.id}>
                  <Comp id={s.id} {...(extraProps[s.id] ?? {})} />
                  {s.id === 'photos' && startFaster ? <Box sx={{ mt: '16px' }}>{startFaster}</Box> : null}
                </Box>
              );
            })}
          </Box>
          {!isNarrow ? rail : null}
        </Box>
      </>
    );
  }

  // ── panels ────────────────────────────────────────────────────────────────────────────────────────────
  const healthPanel = isMobile ? (
    <BottomSheet open={panel === 'health'} onClose={closePanel} title={t('panel.health')}>
      <RailHealth health={health} onFix={onFix} />
    </BottomSheet>
  ) : (
    <SidePanel open={panel === 'health'} onClose={closePanel} size="sm" title={t('panel.health')}>
      <RailHealth health={health} onFix={onFix} />
    </SidePanel>
  );
  const previewPanel = catalog ? null : isMobile ? (
    <BottomSheet open={panel === 'preview'} onClose={closePanel} title={t('preview.title')} fullHeight>
      <MarketplacePreview marketplace={etsyEbay} listing={previewModel} forceDevice="mobile" />
    </BottomSheet>
  ) : (
    <SidePanel open={panel === 'preview'} onClose={closePanel} size="md" title={t('preview.title')}>
      <MarketplacePreview marketplace={etsyEbay} listing={previewModel} showHeader />
    </SidePanel>
  );
  const historyPanel =
    marketplace === 'etsy' && mode === 'edit' && props.listingId ? (
      <SidePanel open={panel === 'history'} onClose={closePanel} size="lg" title={t('panel.history')}>
        {panel === 'history' ? (
          <ListingHistoryPanel
            shopId={shopId}
            listingId={props.listingId}
            onRestored={() => {
              // "Restore as draft" staged on the server: show it in the form (never sent).
              void engine.adoptServerDraft();
              closePanel();
            }}
          />
        ) : null}
      </SidePanel>
    ) : null;

  // The changes list opens under the header indicator and above the footer status.
  const statusBelow = Boolean(statusAnchor && typeof window !== 'undefined' && statusAnchor.getBoundingClientRect().top < window.innerHeight / 2);

  return (
    <ListingEditorContext.Provider value={ctxValue as unknown as ListingEditorContextValue}>
      <Page title={pageTitle} width="detail" backHref={backHref} data-testid="listing-editor">
        <Box sx={headerSx}>
        <PageHeader
          title={headerTitle}
          titleAdornment={isMobile ? undefined : pills}
          subtitle={subtitleParts.length ? subtitleParts.join(' · ') : undefined}
          meta={meta}
          backHref={backHref}
          backLabel={t('page.back', mp)}
          actionsSlot={
            <>
              {narrowHeaderTools}
              {navArrows}
            </>
          }
          overflowActions={isMobile ? overflow : undefined}
          mobilePrimary="none"
        />
        </Box>
        {isMobile && engine.loadState === 'ready' ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', mb: '4px' }}>
            {pills}
            <Box sx={{ ml: 'auto' }}>
              <ScoreMeter score={health.score} afterScore={health.afterScore} variant="cell" checksUsed={health.result.checksUsed} checksTotal={health.result.checksTotal} onClick={() => setPanel('health')} />
            </Box>
          </Box>
        ) : null}
        {body}
        {/* The phone footer is fixed: leave its height (published as --kx-action-bar) free so it never covers the last field. */}
        {isMobile && engine.loadState === 'ready' ? (
          <Box aria-hidden data-testid="le-footer-spacer" sx={{ height: 'calc(var(--kx-action-bar, 0px) + 16px)' }} />
        ) : null}
        {engine.loadState === 'ready' ? (
          <StickyActionBar
            status={statusNode}
            primary={primarySlot ? undefined : primary}
            primarySlot={primarySlot || undefined}
            secondary={isMobile ? (mobilePreviewInBar ? previewSpec : undefined) : discardSpec}
            overflow={isMobile ? [] : overflow}
            ariaLabel={t('footer.label')}
            data-testid="le-footer"
          />
        ) : null}
      </Page>
      <Popover
        open={Boolean(statusAnchor)}
        anchorEl={statusAnchor}
        onClose={() => setStatusAnchor(null)}
        anchorOrigin={{ vertical: statusBelow ? 'bottom' : 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: statusBelow ? 'top' : 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: '16px', width: 360, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <Typography component="h2" variant="titleSm" sx={{ m: 0, mb: '8px' }}>
          {t('changes.title', { count })}
        </Typography>
        {changesList(true)}
      </Popover>
      {healthPanel}
      {previewPanel}
      {historyPanel}
      {props.slots?.review ? (
        props.slots.review(slotCtx)
      ) : (
        <ReviewDifferencesPanel
          open={panel === 'review'}
          onClose={closePanel}
          marketplace={marketplace}
          draftId={draft?.id ?? null}
          draftStartedAt={draft?.createdAt ?? null}
          currency={view.meta.currency}
          onResolved={() => {
            // Re-based on the live listing: pull it, then show the kept draft values. Nothing is sent.
            closePanel();
            void engine
              .refreshRemote()
              .catch(() => undefined)
              .then(() => engine.adoptServerDraft());
          }}
          onRemoveQueuedAction={(type) => removeQueued([type])}
          fallback={{ discard: () => void doDiscard(), refresh: () => void refresh() }}
        />
      )}
      {mode === 'edit' ? (
        <ScheduleModal
          open={panel === 'schedule'}
          onClose={closePanel}
          marketplace={marketplace}
          draftId={draft?.id ?? null}
          scheduledAt={((draft?.raw as { scheduledSendAt?: string | null } | undefined)?.scheduledSendAt) ?? null}
          hasQueuedDelete={queuedDelete}
          ensureSaved={async () => {
            await engine.saveNow();
            return engine.draft?.id ?? null;
          }}
          onScheduled={() => {
            closePanel();
            void engine.reloadDraft();
          }}
        />
      ) : null}
      {props.slots?.profiles ? (
        props.slots.profiles(slotCtx)
      ) : catalog ? null : (
        <ProfilesModal
          open={panel === 'profiles'}
          onClose={closePanel}
          mode={profileMode}
          marketplace={etsyEbay}
          fields={view.fields as Readonly<Record<string, unknown>>}
          setField={(key, value) => engine.setField(key as keyof F & string, value as F[keyof F])}
          getField={(key) => (engine.view.fields as FieldMap)[key]}
        />
      )}
    </ListingEditorContext.Provider>
  );
}

export default ListingEditor;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Route gate (pages/app/etsy-listings/{[listingId],new}.tsx): shop resolution, connect state
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A connected Etsy shop (`/api/integrations/etsy/shops`). */
export type EditorShop = { shopId: string; shopName: string | null };

export interface EtsyEditorGateProps {
  /** Rendered once the shop is known. */
  children: (shop: EditorShop) => React.ReactNode;
  /**
   * `?shop` missing and several shops: use the first one instead of going back to the list (cross-list hand-offs
   * from another marketplace, which do not know the Etsy shop; the workspace header names the shop).
   */
  firstShopFallback?: boolean;
}

/**
 * `?shop` missing: the only shop is used; several → back to the list with "Choose a shop first". No shop connected →
 * ConnectState.
 */
export function EtsyEditorGate({ children, firstShopFallback = false }: EtsyEditorGateProps) {
  const t = useTranslations('listingEditor');
  const router = useRouter();
  const toast = useToast();
  const [shops, setShops] = React.useState<EditorShop[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);
  const shopParam = typeof router.query.shop === 'string' ? router.query.shop : null;

  React.useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetch('/api/integrations/etsy/shops')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { shops?: Array<{ shopId?: unknown; shopName?: unknown }> }) => {
        if (cancelled) return;
        const list = (Array.isArray(d?.shops) ? d.shops : [])
          .filter((s) => s && s.shopId != null)
          .map((s) => ({ shopId: String(s.shopId), shopName: typeof s.shopName === 'string' ? s.shopName : null }));
        setShops(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const shop =
    shops && router.isReady
      ? shopParam
        ? shops.find((s) => s.shopId === shopParam) ?? null
        : shops.length === 1 || (firstShopFallback && shops.length > 0)
          ? shops[0]
          : null
      : null;
  const mismatch = Boolean(shops && shops.length > 0 && router.isReady && !shop);

  React.useEffect(() => {
    if (!mismatch) return;
    toast.info(t('state.chooseShop'));
    void router.replace(listHref('etsy', null));
  }, [mismatch, router, toast, t]);

  if (!router.isReady) return null;
  if (failed) {
    return (
      <Page title={t('page.editTitle')} width="detail">
        <ErrorState variant="page" title={t('state.shopsFailed')} onRetry={() => setNonce((n) => n + 1)} />
      </Page>
    );
  }
  if (!shops) return null;
  if (shops.length === 0) {
    return (
      <Page title={t('page.editTitle')} width="detail">
        <ConnectState brand="etsy" title={t('state.connectTitle')} body={t('state.connectBody')} connectHref="/ayarlar?tab=connections" />
      </Page>
    );
  }
  if (!shop) return null;
  return <>{children(shop)}</>;
}

/** Back link: the list's own URL state when the editor was opened from it (`kx:editorNav.query`). */
export function editorBackHref(shopId: string | null): string {
  const nav = readEditorNav();
  if (nav && nav.marketplace === 'etsy' && (!nav.shopId || nav.shopId === shopId) && nav.query) return listHref('etsy', shopId, nav.query);
  return listHref('etsy', shopId);
}

/** Unused-variable guard for the generic context cast. */
export type { ListingEditorContextValue };

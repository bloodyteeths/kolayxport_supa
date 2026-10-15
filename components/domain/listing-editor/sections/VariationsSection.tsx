// components/domain/listing-editor/sections/VariationsSection.tsx — listing-editor §2.1 #5 "Variations" (M6 Group D).
// Etsy: `components/etsy/VariationEditor` in embedded mode (its staging calls, kx_loaded_quantity stamp, managed-quantity
// chip and draft overlay unchanged). eBay: `components/ebay/VariationEditor` in embedded mode (per-variant drafts
// instead of the legacy direct eBay write). Edit mode starts as a one-line summary ("2 variations · 14 combinations ·
// Edit") because the editor is heavy; it expands in place on desktop and opens as a full-height sheet on mobile
// ([Cancel] [Done], Done stages into the same draft). While the sheet is open the section is held out of autosave
// (`useSheetHold`), so Cancel really drops the sheet's edits. Discard changes remounts the sub-editor
// (`useDiscardGeneration`) so it reloads what is live instead of the discarded staged values. Nothing here sends
// anything: the footer's Send does.
// Also exports `SubEditorFrame`, the summary-row + mobile-sheet wrapper PersonalizationSection reuses.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { Button } from '@/components/ds/inputs/Button';
import { BottomSheet, SheetFooter } from '@/components/ds/overlay/BottomSheet';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import { neutral, radius } from '@/lib/ds/tokens';
import { sectionAnchorId } from '@/lib/listingEditor/sections';
import type { DraftSection, FieldIssue, ListingFacts, ListingSectionProps } from '@/lib/listingEditor/types';
import EtsyVariationEditor, {
  summarizeEtsyInventory,
  type EtsyVariationSummary,
  type VariationEditorHandle,
} from '@/components/etsy/VariationEditor';
import EbayVariationEditor, {
  type EbayVariationEditorHandle,
  type EbayVariationSummary,
} from '@/components/ebay/VariationEditor';
import { useListingEditor, useRegisterDraftSection } from '../useListingDraft';
import { EbayCreateVariations } from './EbayCreateVariations';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Shared frame: collapsed summary row, inline expansion (desktop), full-height sheet (mobile)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SubEditorFrameProps {
  /** Section id (anchor `le-section-<id>`, test id `le-section-<id>`). */
  id: 'variations' | 'personalization';
  title: string;
  /** One-line summary shown while collapsed (and above the sheet trigger on mobile). */
  summary: React.ReactNode;
  /** "Edit" / "Add variations" / "Set up". */
  actionLabel: string;
  /** Desktop: render the editor inline without a summary row (create mode, small editors). */
  alwaysOpen?: boolean;
  /** Mobile sheet title. */
  sheetTitle: string;
  /** Mobile: Done → stage (throws on failure; the sheet stays open). */
  onSheetDone: () => Promise<void>;
  /** Mobile: Cancel → drop the edits made in the sheet. */
  onSheetCancel: () => void;
  /** Mobile: the sheet opened (true) or closed after Done / Cancel (false). Sections hold autosave meanwhile. */
  onSheetOpenChange?: (open: boolean) => void;
  /** Renders the sub-editor. Mounted only while expanded / while the sheet is open. */
  children: React.ReactNode;
  disabled?: boolean;
  /** Message shown when the sheet's Done failed (already translated). */
  stageFailedMessage: string;
}

export function SubEditorFrame({
  id, title, summary, actionLabel, alwaysOpen, sheetTitle, onSheetDone, onSheetCancel, onSheetOpenChange, children, disabled,
  stageFailedMessage,
}: SubEditorFrameProps) {
  const t = useTranslations('listingEditor.sheet');
  const isMobile = useIsMobile();
  const toast = useToast();
  // Desktop: once expanded the editor stays mounted (its unsaved state must survive a collapse).
  const [expanded, setExpanded] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const openSheet = () => {
    onSheetOpenChange?.(true);
    setSheetOpen(true);
  };
  const done = async () => {
    setBusy(true);
    try {
      await onSheetDone();
      setSheetOpen(false);
      onSheetOpenChange?.(false);
    } catch {
      toast.error(stageFailedMessage, { persist: false });
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    onSheetCancel();
    setSheetOpen(false);
    onSheetOpenChange?.(false);
  };

  const row = (onOpen: () => void) => (
    <Box
      data-testid={`le-${id}-summary`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minHeight: 44,
        px: '12px',
        py: '8px',
        border: `1px solid ${neutral[200]}`,
        borderRadius: `${radius.md}px`,
        maxWidth: 720,
      }}
    >
      <Typography variant="body2" component="div" sx={{ flex: 1, minWidth: 0, color: neutral[700] }}>{summary}</Typography>
      <Button variant="ghost" size="sm" icon={icons.edit} onClick={onOpen} disabled={disabled} aria-label={`${actionLabel} · ${title}`}>
        {actionLabel}
      </Button>
    </Box>
  );

  return (
    <Section id={sectionAnchorId(id)} title={title} variant="plain" data-testid={`le-section-${id}`}>
      {isMobile ? (
        <>
          {row(openSheet)}
          <BottomSheet
            open={sheetOpen}
            onClose={() => { void done(); }}
            title={sheetTitle}
            fullHeight
            footer={(
              <SheetFooter
                secondary={{ id: `${id}-sheet-cancel`, label: t('cancel'), onClick: cancel, disabled: busy }}
                primary={{ id: `${id}-sheet-done`, label: t('done'), onClick: () => { void done(); }, loading: busy }}
              />
            )}
            data-testid={`le-${id}-sheet`}
          >
            <Box sx={{ p: '16px' }}>{sheetOpen ? children : null}</Box>
          </BottomSheet>
        </>
      ) : alwaysOpen || expanded ? (
        children
      ) : (
        row(() => setExpanded(true))
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Etsy editor summary → the `variations` fact the frame, score, preview and PriceSection read. */
export function variationsFact(s: Pick<EtsyVariationSummary, 'variations' | 'combinations' | 'priceMin' | 'priceMax'>): NonNullable<ListingFacts['variations']> {
  return {
    count: s.variations,
    combinations: s.combinations,
    priceRange: s.variations > 0 && s.priceMin != null && s.priceMax != null ? { min: s.priceMin, max: s.priceMax } : null,
  };
}

/** eBay editor summary → fact (each variant is one "combination"; the group's axes are not loaded). */
export function ebayVariationsFact(s: EbayVariationSummary): NonNullable<ListingFacts['variations']> {
  return {
    count: s.variations > 0 ? 1 : 0,
    combinations: s.variations,
    priceRange: s.variations > 0 && s.priceMin != null && s.priceMax != null ? { min: s.priceMin, max: s.priceMax } : null,
  };
}

/** `etsy`-relative FieldErrors from the sub-editor → engine FieldIssues (full i18n keys, section `variations`). */
export function toVariationIssues(
  errors: Array<{ field: string; severity: string; key?: string; params?: Record<string, string | number>; message?: string }>,
  namespace: 'etsy' | 'listingEditor',
): FieldIssue[] {
  return errors.map((e) => ({
    field: 'variations',
    section: 'variations',
    severity: e.severity === 'block_save' ? 'block_save' : e.severity === 'warn' ? 'warn' : 'block_sync',
    key: e.key ? `${namespace}.${e.key}` : `${namespace}.variations.invalid`,
    params: e.params,
    message: e.message,
  }));
}

const OPEN_STATUSES = ['draft', 'failed', 'conflict'];

/** Staged inventory products of an open draft (server-draft overlay for the collapsed summary), else null. */
export function stagedInventoryProducts(draft: { status: string; inventoryPatch?: Record<string, unknown> | null } | null): unknown[] | null {
  if (!draft || !OPEN_STATUSES.includes(draft.status)) return null;
  const products = draft.inventoryPatch?.products;
  return Array.isArray(products) && products.length > 0 ? products : null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Section hooks shared with PersonalizationSection
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Mobile sheet contract ([Cancel] drops, [Done] stages): while the sheet is open the section reports itself
 * clean to the engine and does not call `notifyChange`, so the 1.5s autosave never stages the sheet's edits
 * behind the seller's back. `held()` is read by the section's registration and its editor `onChange`.
 */
export function useSheetHold() {
  const ref = React.useRef(false);
  return React.useMemo(() => ({
    held: () => ref.current,
    onSheetOpenChange: (open: boolean) => { ref.current = open; },
  }), []);
}

/**
 * Discard changes deletes the DB draft and then calls each section's `reset()`. The embedded editors' own
 * baseline is the staged overlay, so a plain revert would bring the discarded values back (and the next edit
 * would re-stage them). Instead `reset()` bumps a generation that is part of the editor's `key`: the editor
 * remounts and reloads from what is live on the marketplace.
 */
export function useDiscardGeneration() {
  const [generation, setGeneration] = React.useState(0);
  const bump = React.useCallback(() => setGeneration((g) => g + 1), []);
  return { generation, bump };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Section
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type VariationsSectionProps = Partial<ListingSectionProps>;

export function VariationsSection(props: VariationsSectionProps) {
  const ed = useListingEditor();
  return ed.marketplace === 'ebay' ? <EbayVariations {...props} /> : <EtsyVariations {...props} />;
}

function EtsyVariations({ id = 'variations' }: VariationsSectionProps) {
  const t = useTranslations('listingEditor');
  const ed = useListingEditor();
  const { ctx, mode, readOnly, notifyChange, reportFacts, reloadDraft } = ed;
  const listingId = ctx.listingId;
  const shopId = ctx.shopId;
  const isLocal = !listingId || Number(listingId) < 0;
  const taxonomy = Number(ed.view.fields.taxonomy_id);
  const currency = ed.view.meta.currency || 'USD';
  const handleRef = React.useRef<VariationEditorHandle | null>(null);
  const [summary, setSummary] = React.useState<EtsyVariationSummary | null>(null);
  const editorReported = React.useRef(false);
  const sheet = useSheetHold();
  const discardGen = useDiscardGeneration();

  const applySummary = React.useCallback((s: EtsyVariationSummary) => {
    setSummary(s);
    reportFacts({ variations: variationsFact(s) });
  }, [reportFacts]);

  // Collapsed summary without mounting the heavy editor: the open draft's staged inventory first (overlay), else
  // the live inventory. Also feeds PriceSection's read-only "set in Variations" state.
  const staged = stagedInventoryProducts(ed.draft);
  const stagedKey = staged ? JSON.stringify(staged) : '';
  const remoteUpdated = ed.view.meta.updatedAt ? new Date(ed.view.meta.updatedAt).getTime() : 0;
  React.useEffect(() => {
    if (editorReported.current) return undefined;
    if (staged) {
      applySummary(summarizeEtsyInventory(staged, currency));
      return undefined;
    }
    if (isLocal || !listingId) {
      applySummary(summarizeEtsyInventory([], currency));
      return undefined;
    }
    let cancelled = false;
    const params = new URLSearchParams({ action: 'get_listing_inventory', listing_id: listingId, shop_id: shopId });
    fetch(`/api/clawd/etsy?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && !editorReported.current) applySummary(summarizeEtsyInventory(data.products, currency));
      })
      .catch(() => { /* the summary stays unknown; the editor loads its own data when opened */ });
    return () => { cancelled = true; };
    // stagedKey stands for `staged` (a new array whenever the draft re-loads).
  }, [stagedKey, isLocal, listingId, shopId, currency, remoteUpdated, applySummary]);

  useRegisterDraftSection({
    id: 'variations',
    isDirty: () => !sheet.held() && (handleRef.current?.isDirty() ?? false),
    stage: async () => {
      const h = handleRef.current;
      if (sheet.held() || !h || !h.isDirty()) return;
      await h.stage();
      // The inventory patch lives on the draft row: re-read it so "Not sent yet" lists Variations.
      void reloadDraft();
    },
    validate: () => toVariationIssues(handleRef.current?.validate() ?? [], 'etsy'),
    reset: () => {
      // Discard: reload the live inventory (the editor's baseline is the discarded staged overlay).
      editorReported.current = false;
      discardGen.bump();
    },
    changes: () => [{ group: 'variations' }],
  } satisfies DraftSection);

  const onSummaryChange = React.useCallback((s: EtsyVariationSummary) => {
    editorReported.current = true;
    applySummary(s);
  }, [applySummary]);

  const summaryText = summary
    ? summary.variations > 0
      ? t('variations.summary', { variations: summary.variations, combos: summary.combinations })
      : t('variations.none')
    : t('variations.summaryUnknown');
  const actionLabel = summary && summary.variations === 0 ? t('variations.add') : t('variations.edit');

  if (!listingId) {
    // Blank create: the draft (negative local id) is created by the first save; variations stage into it.
    return (
      <Section id={sectionAnchorId(id)} title={t('section.variations')} variant="plain" data-testid="le-section-variations">
        <Typography variant="body2" sx={{ color: neutral[600], maxWidth: 720 }}>{t('variations.createNeedsDraft')}</Typography>
      </Section>
    );
  }

  return (
    <SubEditorFrame
      id="variations"
      title={t('section.variations')}
      summary={summaryText}
      actionLabel={actionLabel}
      alwaysOpen={mode === 'create'}
      sheetTitle={t('section.variations')}
      onSheetDone={async () => {
        const h = handleRef.current;
        if (h?.isDirty()) {
          await h.stage();
          void reloadDraft();
        }
      }}
      onSheetCancel={() => {
        handleRef.current?.revert();
      }}
      onSheetOpenChange={(open) => {
        sheet.onSheetOpenChange(open);
        if (!open) notifyChange();
      }}
      disabled={readOnly}
      stageFailedMessage={t('variations.stageFailed')}
    >
      <EtsyVariationEditor
        ref={handleRef}
        embedded
        key={`${shopId}:${listingId}:${discardGen.generation}`}
        listingId={listingId}
        shopId={shopId}
        taxonomyId={Number.isFinite(taxonomy) && taxonomy > 0 ? taxonomy : undefined}
        createMode={isLocal}
        currencyCode={currency}
        onChange={() => { if (!sheet.held()) notifyChange(); }}
        onSummaryChange={onSummaryChange}
      />
    </SubEditorFrame>
  );
}

function EbayVariations({ id = 'variations' }: VariationsSectionProps) {
  const t = useTranslations('listingEditor');
  const ed = useListingEditor();
  const { ctx, mode, readOnly, reportFacts } = ed;
  const sku = ctx.listingId;
  const handleRef = React.useRef<EbayVariationEditorHandle | null>(null);
  const [summary, setSummary] = React.useState<EbayVariationSummary | null>(null);
  const editorReported = React.useRef(false);

  // Read-only for now: per-variant changes would stage into separate variant drafts that the footer's Send does
  // not send (the engine has no related-draft send yet). The editor shows live prices and stock, stages nothing.
  // Collapsed summary: the group's variant count (one request; prices load with the editor).
  React.useEffect(() => {
    if (!sku || mode === 'create' || editorReported.current) return undefined;
    let cancelled = false;
    fetch(`/api/clawd/ebay?action=get_inventory_item_group&sku=${encodeURIComponent(sku)}`)
      .then(async (res) => {
        if (res.status === 404) return { variantSKUs: [] };
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (cancelled || !data || editorReported.current) return;
        const n = Array.isArray(data.variantSKUs) ? data.variantSKUs.length : 0;
        const s: EbayVariationSummary = { variations: n, priceMin: null, priceMax: null, currency: '', totalQuantity: 0 };
        setSummary(s);
        reportFacts({ variations: ebayVariationsFact(s) });
      })
      .catch(() => { /* unknown until opened */ });
    return () => { cancelled = true; };
  }, [sku, mode, reportFacts]);

  // Registered for validation only: the read-only editor is never dirty and stages nothing.
  useRegisterDraftSection({
    id: 'variations',
    isDirty: () => false,
    stage: async () => {},
    validate: () => toVariationIssues(handleRef.current?.validate() ?? [], 'listingEditor'),
    changes: () => [],
  } satisfies DraftSection);

  const onSummaryChange = React.useCallback((s: EbayVariationSummary) => {
    editorReported.current = true;
    setSummary(s);
    reportFacts({ variations: ebayVariationsFact(s) });
  }, [reportFacts]);

  if (mode === 'create') {
    // New eBay listing: options + a SKU / price / quantity per combination, staged as the draft's
    // variationPatch (EbayCreateVariations); Send creates the item group (server F1).
    return (
      <Section id={sectionAnchorId(id)} title={t('section.variations')} variant="plain" data-testid="le-section-variations">
        <EbayCreateVariations />
      </Section>
    );
  }
  if (!sku) {
    return (
      <Section id={sectionAnchorId(id)} title={t('section.variations')} variant="plain" data-testid="le-section-variations">
        <Typography variant="body2" sx={{ color: neutral[600], maxWidth: 720 }}>{t('variations.summaryUnknown')}</Typography>
      </Section>
    );
  }

  const summaryText = summary
    ? summary.variations > 0 ? t('variations.ebaySummary', { count: summary.variations }) : t('variations.none')
    : t('variations.summaryUnknown');

  return (
    <SubEditorFrame
      id="variations"
      title={t('section.variations')}
      summary={summaryText}
      actionLabel={t('variations.view')}
      sheetTitle={t('section.variations')}
      onSheetDone={async () => {}}
      onSheetCancel={() => {}}
      disabled={readOnly}
      stageFailedMessage={t('variations.stageFailed')}
    >
      <EbayVariationEditor
        ref={handleRef}
        embedded
        key={sku}
        sku={sku}
        userId=""
        disabled={readOnly}
        onSummaryChange={onSummaryChange}
      />
    </SubEditorFrame>
  );
}

export default VariationsSection;

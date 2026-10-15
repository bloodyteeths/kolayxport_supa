// components/domain/listings/QuickViewPanel.tsx — listings-grid §6.4 quick view (SidePanel md 560) and the
// CRITIQUE X3 step-1 bridge for Trendyol/Wix/Shopify (SidePanel xl 960 with the CatalogDraft v1 fields).
//
// Edits autosave to the DRAFT on blur (never a live write; feedback rule "autosave stays local"). ⌘S saves the
// focused field now, ⌘↵ runs the panel primary, j/k and ‹ › move within the page (SidePanel built-ins).
// Primary: "Send changes to {marketplace}" for this listing's draft, otherwise "Open editor". For a conflict the
// panel shows the warning Banner and the primary becomes "Review differences"; Send is never offered for it.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { Banner } from '@/components/ds/feedback/Banner';
import { FormField } from '@/components/ds/inputs/FormField';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { TextField } from '@/components/ds/inputs/TextField';
import { ScoreMeter } from '@/components/ds/data/ScoreMeter';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Thumb } from '@/components/ds/data/Thumb';
import { DateText } from '@/components/ds/format/DateText';
import type { ActionSpec } from '@/components/ds/page';
import { icons } from '@/lib/ds/icons';
import { neutral, tone } from '@/lib/ds/tokens';
import { LISTING_EDITABLE_REASON_I18N, type ListingDraftOverlay, type ListingRow, type StagePatch } from '@/lib/listings/types';
import { StockManagedQty } from './stockManaged';
import { displayPrice, displayQty, displayTitle, editReadOnlyReason, isStockManaged, overlayOf, rowSyncKey, validatePrice, validateQty, type ListingCellContext, type ListingsT } from './columns';

export type QuickViewPanelProps = {
  row: ListingRow | null;
  open: boolean;
  /** `md` (Etsy/eBay) or `xl` (marketplaces without a full editor yet, CRITIQUE X3). */
  size: 'md' | 'xl';
  /** Title is editable here only on the `xl` bridge (Etsy/eBay titles are edited in the full editor). */
  editTitle: boolean;
  ctx: ListingCellContext;
  t: ListingsT;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Stages a patch (autosave). Rejects on a stage error (the field reverts, a toast is shown by the page). */
  onStage: (row: ListingRow, patch: StagePatch) => Promise<void>;
  /** Sends this listing's draft (explicit). */
  onSend: (row: ListingRow) => void;
  onDiscard: (row: ListingRow) => void;
  /** Null when the full editor is not available (flag off or no route). */
  onOpenEditor: ((row: ListingRow) => void) | null;
  /** Opens the editor's conflict review; null without an editor. */
  onReviewDifferences: ((row: ListingRow) => void) | null;
  /** The row ⋯ items (same as the table's). */
  rowActions: (row: ListingRow) => ActionSpec[];
  /** Reconnect / usage limit reason that disables Send. */
  sendDisabledReason?: string;
};

type FieldKey = 'price' | 'qty' | 'title';

function changedFieldLabel(field: string, t: ListingsT): string {
  const key = `listings.field.${field}`;
  return t.has?.(key) ? t(key) : field;
}

const KNOWN_FAILS: Record<string, string> = {
  photos_count: 'listings.health.missingPhotos',
  missing_photos: 'listings.health.missingPhotos',
  tags_count: 'listings.health.missingTags',
  missing_tags: 'listings.health.missingTags',
  video: 'listings.health.noVideo',
  no_video: 'listings.health.noVideo',
  title_length: 'listings.health.shortTitle',
  short_title: 'listings.health.shortTitle',
};

export function QuickViewPanel({
  row,
  open,
  size,
  editTitle,
  ctx,
  t,
  onClose,
  onPrev,
  onNext,
  onStage,
  onSend,
  onDiscard,
  onOpenEditor,
  onReviewDifferences,
  rowActions,
  sendDisabledReason,
}: QuickViewPanelProps) {
  const mp = ctx.config.marketplace;
  const to = t('listings.mp.to', { marketplace: mp });
  const [price, setPrice] = React.useState<number | null>(null);
  const [qty, setQty] = React.useState<number | null>(null);
  const [title, setTitle] = React.useState('');
  const [errors, setErrors] = React.useState<Partial<Record<FieldKey, string | null>>>({});
  const [saving, setSaving] = React.useState(false);
  const focused = React.useRef<FieldKey | null>(null);

  // Reset the form when another listing opens or the staged values change underneath (refetch).
  const overlay: ListingDraftOverlay = row ? overlayOf(row, ctx.overlays) : {};
  const shownPrice = row ? displayPrice(row, ctx.overlays) : null;
  const shownQty = row ? displayQty(row, ctx.overlays) : null;
  const shownTitle = row ? displayTitle(row, ctx.overlays) : '';
  React.useEffect(() => {
    setPrice(shownPrice);
    setQty(shownQty);
    setTitle(shownTitle);
    setErrors({});
  }, [row?.id, shownPrice, shownQty, shownTitle]);

  if (!row) return null;

  const sync = row.sync;
  const syncKey = rowSyncKey(row, ctx.sendingIds, ctx.overlays);
  const sending = syncKey === 'syncing';
  const conflict = syncKey === 'conflict';
  const currency = row.price?.currency ?? ctx.storeCurrency;
  // Same reasons as the grid cells (sending, queued removal, variations, not tracked, stock sync).
  const readOnly = (field: 'price' | 'qty'): string | null => editReadOnlyReason(row, field, t, ctx);
  const removalQueued = Boolean(sync?.queuedDelete && sync.status !== 'synced');

  const commit = async (field: FieldKey) => {
    let patch: StagePatch | null = null;
    if (field === 'price') {
      const err = validatePrice(price, t, ctx, currency);
      setErrors((e) => ({ ...e, price: err }));
      if (err || price === shownPrice) return;
      patch = { price: price as number };
    } else if (field === 'qty') {
      const err = validateQty(qty, t, ctx);
      setErrors((e) => ({ ...e, qty: err }));
      if (err || qty === shownQty) return;
      patch = { qty: qty as number };
    } else {
      const next = title.trim();
      const err = next ? null : t('listings.validate.titleRequired');
      setErrors((e) => ({ ...e, title: err }));
      if (err || next === shownTitle) return;
      patch = { title: next };
    }
    setSaving(true);
    try {
      await onStage(row, patch);
    } catch {
      if (field === 'price') setPrice(shownPrice);
      else if (field === 'qty') setQty(shownQty);
      else setTitle(shownTitle);
    } finally {
      setSaving(false);
    }
  };

  const changed = sync?.changedFields ?? [];
  const editsNotSent = Math.max(changed.length, Object.keys(overlay).length);
  const hasDraft = Boolean(sync && sync.status !== 'synced') || ctx.overlays.has(row.id);

  const openEditorAction: ActionSpec | undefined = onOpenEditor
    ? { id: 'openEditor', label: t('listings.action.openEditor'), icon: icons.edit, onClick: () => onOpenEditor(row) }
    : undefined;
  const discardAction: ActionSpec | undefined =
    sync && sync.status !== 'synced' && !sending
      ? { id: 'discard', label: t('listings.action.discard'), onClick: () => onDiscard(row) }
      : undefined;

  let primary: ActionSpec | undefined;
  let secondary: ActionSpec | undefined;
  if (conflict) {
    primary = onReviewDifferences
      ? { id: 'reviewDiff', label: t('listings.action.reviewDiff'), onClick: () => onReviewDifferences(row) }
      : { id: 'send', label: t('listings.panel.send', { to }), disabled: true, disabledReason: t('listings.panel.conflictNoSend') };
    secondary = discardAction;
  } else if (hasDraft && sync && !sync.queuedDelete) {
    primary = {
      id: 'send',
      label: t('listings.panel.send', { to }),
      icon: icons.push,
      loading: sending,
      loadingLabel: t('listings.send.loading', { count: 1 }),
      disabled: Boolean(sendDisabledReason) || sync.status === 'syncing',
      disabledReason: sendDisabledReason,
      onClick: () => onSend(row),
    };
    secondary = openEditorAction ?? discardAction;
  } else {
    primary = openEditorAction;
    secondary = undefined;
  }

  const external = row.externalUrl;
  const meta = (
    <Box component="span" sx={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="mono">{row.metaLine[0] ?? row.id}</span>
      {row.updatedAt ? (
        <>
          <span aria-hidden>{'·'}</span>
          <span>{t('listings.panel.updated')}</span>
          <DateText value={row.updatedAt} mode="relative" />
        </>
      ) : null}
      {external ? (
        <>
          <span aria-hidden>{'·'}</span>
          <a href={external} target="_blank" rel="noopener noreferrer">
            {t('listings.action.viewOn', { marketplace: ctx.marketplaceName })}
          </a>
        </>
      ) : null}
    </Box>
  );

  const priceRo = readOnly('price');
  const qtyRo = readOnly('qty');
  const live = [
    row.price ? ctx.formatMoney(row.price.amount, row.price.currency) : null,
    row.qty !== null ? String(row.qty) : null,
  ].filter(Boolean);
  const fails = row.health.fails.map((f) => KNOWN_FAILS[f]).filter((k, i, a): k is string => Boolean(k) && a.indexOf(k) === i);

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size={size}
      title={displayTitle(row, ctx.overlays)}
      leading={<Thumb src={row.thumbUrl} alt="" size={40} />}
      status={<StatusPill domain="listing" status={row.status} raw={row.statusNote ?? row.statusRaw} />}
      meta={meta}
      onPrev={onPrev}
      onNext={onNext}
      primary={primary}
      secondary={secondary}
      overflow={rowActions(row)}
      saveState={saving ? 'saving' : 'idle'}
      saveNote={editsNotSent > 0 && !saving ? t('listings.panel.saved', { count: editsNotSent }) : undefined}
      onSave={() => {
        if (focused.current) void commit(focused.current);
      }}
      headerSlot={
        conflict ? (
          <Box sx={{ px: '20px', pt: '12px' }}>
            <Banner tone="warning" title={t('listings.panel.conflict', { on: t('listings.mp.on', { marketplace: mp }) })} data-testid="quickview-conflict" />
          </Box>
        ) : undefined
      }
      data-testid="listings-quickview"
    >
      {editTitle ? (
        <SidePanelSection id="title" title={t('listings.col.listing')}>
          <FormField label={t('listings.field.title')} error={errors.title ?? null} dirty={overlay.title !== undefined && overlay.title !== row.title}>
            <TextField
              value={title}
              onChange={(v) => setTitle(v)}
              disabled={sending || removalQueued}
              onFocus={() => {
                focused.current = 'title';
              }}
              onBlur={() => void commit('title')}
            />
          </FormField>
        </SidePanelSection>
      ) : null}

      <SidePanelSection id="price-stock" title={t('listings.panel.priceStock')}>
        <Box sx={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <FormField
            label={t('listings.col.price')}
            width="short"
            error={errors.price ?? null}
            helper={priceRo ?? undefined}
            dirty={overlay.price !== undefined && overlay.price !== row.price?.amount}
          >
            <Box
              component="span"
              sx={{ display: 'contents' }}
              onFocusCapture={() => {
                focused.current = 'price';
              }}
            >
            <MoneyField
              value={price}
              onChange={setPrice}
              currency={currency}
              readOnly={Boolean(priceRo)}
              disabled={Boolean(priceRo)}
              invalid={Boolean(errors.price)}
              onBlur={() => {
                focused.current = null;
                if (!priceRo) void commit('price');
              }}
              data-testid="quickview-price"
            />
            </Box>
          </FormField>
          <FormField
            label={t('listings.col.qty')}
            width="short"
            error={errors.qty ?? null}
            helper={qtyRo && isStockManaged(row, ctx) && qtyRo === t(LISTING_EDITABLE_REASON_I18N.stock_managed) ? <StockManagedQty text={qtyRo} label={t('listings.cell.stockManagedLink')} /> : qtyRo ?? undefined}
            dirty={overlay.qty !== undefined && overlay.qty !== row.qty}
          >
            <Box
              component="span"
              sx={{ display: 'contents' }}
              onFocusCapture={() => {
                focused.current = 'qty';
              }}
            >
            <NumberField
              value={qty}
              onChange={setQty}
              min={0}
              max={ctx.config.validation.qtyMax}
              readOnly={Boolean(qtyRo)}
              disabled={Boolean(qtyRo)}
              invalid={Boolean(errors.qty)}
              onBlur={() => {
                focused.current = null;
                if (!qtyRo) void commit('qty');
              }}
              data-testid="quickview-qty"
            />
            </Box>
          </FormField>
        </Box>
        {live.length ? (
          <Typography variant="caption" sx={{ display: 'block', mt: '4px', color: neutral[500] }}>
            {t('listings.cell.onMarketplace', { marketplace: ctx.marketplaceName, value: live.join(' · ') })}
          </Typography>
        ) : null}
      </SidePanelSection>

      <SidePanelSection id="health" title={t('listings.col.health')}>
        <ScoreMeter variant="panel" score={row.health.score} checksUsed={row.health.used} checksTotal={row.health.total} />
        {row.health.score === null ? (
          <Typography variant="caption" sx={{ display: 'block', mt: '4px', color: neutral[500] }}>
            {t('listings.cell.notScored')}
          </Typography>
        ) : fails.length ? (
          <Box component="ul" sx={{ m: '8px 0 0', p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {fails.map((k) => (
              <Box component="li" key={k} sx={{ fontSize: 13, color: tone.danger.fg }}>
                {t(k)}
              </Box>
            ))}
          </Box>
        ) : null}
      </SidePanelSection>

      {sync && (changed.length > 0 || sync.queuedDelete) ? (
        <SidePanelSection id="not-sent" title={t('listings.panel.notSent', { count: editsNotSent })}>
          <Box component="ul" sx={{ m: 0, pl: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }} data-testid="quickview-changes">
            {sync.draft.price !== undefined && row.price ? (
              <li>
                {t('listings.panel.changeFromTo', {
                  field: changedFieldLabel('price', t),
                  from: ctx.formatMoney(row.price.amount, row.price.currency),
                  to: ctx.formatMoney(sync.draft.price, row.price.currency),
                })}
              </li>
            ) : null}
            {sync.draft.qty !== undefined ? (
              <li>
                {t('listings.panel.changeFromTo', { field: changedFieldLabel('quantity', t), from: row.qty === null ? '—' : String(row.qty), to: String(sync.draft.qty) })}
              </li>
            ) : null}
            {changed
              .filter((f) => f !== 'price' && f !== 'quantity' && f !== 'qty')
              .map((f) => (
                <li key={f}>{changedFieldLabel(f, t)}</li>
              ))}
            {sync.queuedDelete ? (
              <Box component="li" sx={{ color: tone.danger.fg }}>
                {ctx.removalKind === 'archive' ? t('listings.cell.willArchive') : t('listings.cell.willDelete')}
              </Box>
            ) : null}
          </Box>
        </SidePanelSection>
      ) : null}
    </SidePanel>
  );
}

export default QuickViewPanel;

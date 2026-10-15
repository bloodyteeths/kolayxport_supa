import React, { useState, useEffect, useCallback, useImperativeHandle, useMemo, useRef, forwardRef } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Button,
  CircularProgress,
  Paper,
  Typography,
  Box,
  Chip,
} from '@mui/material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { fetchEbayDrafts, stageEbayDraft } from '@/lib/ebay/draftClient';
import { FormField, MoneyField, NumberField } from '@/components/ds/inputs';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { neutral, radius } from '@/lib/ds/tokens';
import { EMPTY } from '@/lib/format';

interface VariationItem {
  sku: string;
  title?: string;
  price?: { value: string; currency: string };
  quantity?: number;
  status?: string;
  /** Embedded: needed to stage a price change on the variant's offer. */
  offerId?: string;
}

/** Send-time issue of the embedded eBay editor (`key` relative to the `listingEditor` namespace). */
export interface EbayVariationIssue {
  field: string;
  severity: 'block_sync';
  key: string;
  params?: Record<string, string | number>;
  message: string;
}

export interface EbayVariationSummary {
  variations: number;
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  totalQuantity: number;
}

export interface EbayVariationDraftSection {
  id: 'variations';
  isDirty(): boolean;
  stage(): Promise<void>;
  validate(): EbayVariationIssue[];
  /** Variant SKUs whose own EbayListingDraft rows must be sent with the parent (listing-editor adapter F). */
  relatedDraftSkus(): string[];
}

export interface EbayVariationEditorHandle {
  isDirty(): boolean;
  /** Stages each changed variant into its own EbayListingDraft (never writes to eBay). */
  stage(): Promise<void>;
  revert(): void;
  validate(): EbayVariationIssue[];
  relatedDraftSkus(): string[];
  summary(): EbayVariationSummary | null;
}

export interface VariationEditorProps {
  sku: string;
  userId: string;
  /** Legacy drawer: called after the own Save button wrote to eBay. */
  onSaved?: () => void;
  /** listing-editor: DS inputs, no own save button, changes staged as variant drafts via `stage()`. */
  embedded?: boolean;
  register?: (section: EbayVariationDraftSection) => () => void;
  onChange?: (dirty: boolean) => void;
  onSummaryChange?: (summary: EbayVariationSummary) => void;
  disabled?: boolean;
  /**
   * Embedded only. Each variant stages into its own EbayListingDraft row, and the listing editor's Send only
   * sends the parent draft today, so staged variant changes would never reach eBay and never show in
   * "Not sent yet". Default (false): read-only, live values, nothing staged. Turn on only once the engine
   * sends `relatedDraftSkus()` with the parent (same conflict and queued-delete rules).
   */
  stageVariantDrafts?: boolean;
}

const OPEN_DRAFT_STATUSES = ['draft', 'failed', 'conflict'];

type Baseline = Record<string, { price: string | null; quantity: number }>;

/** Pure: the per-variant patches to stage (only what changed against the baseline). */
export function ebayVariantPatches(items: VariationItem[], baseline: Baseline) {
  const out: Array<{ sku: string; offerId?: string; inventoryFields?: Record<string, any>; offerFields?: Record<string, any> }> = [];
  for (const item of items) {
    const base = baseline[item.sku];
    if (!base) continue;
    const qty = item.quantity ?? 0;
    const qtyChanged = qty !== base.quantity;
    const price = item.price?.value ?? null;
    // An invalid price (blank, 0) is never staged: it stays a visible edit and a send-time issue.
    const priceChanged = Boolean(item.offerId) && price !== base.price && price != null && Number(price) > 0;
    if (!qtyChanged && !priceChanged) continue;
    out.push({
      sku: item.sku,
      offerId: item.offerId,
      ...(qtyChanged ? { inventoryFields: { availability: { shipToLocationAvailability: { quantity: qty } } } } : {}),
      ...(priceChanged ? { offerFields: { pricingSummary: { price: { value: price, currency: item.price?.currency } } } } : {}),
    });
  }
  return out;
}

/** Pure: variant SKUs that differ from the baseline at all (stageable or not). */
export function ebayChangedSkus(items: VariationItem[], baseline: Baseline): string[] {
  return items
    .filter((item) => {
      const base = baseline[item.sku];
      if (!base) return false;
      return (item.quantity ?? 0) !== base.quantity || (item.price?.value ?? null) !== base.price;
    })
    .map((item) => item.sku);
}

/** Pure: send-time checks (price > 0, whole non-negative quantity). */
export function ebayVariantIssues(items: VariationItem[]): EbayVariationIssue[] {
  const issues: EbayVariationIssue[] = [];
  items.forEach((item) => {
    const price = item.price ? Number(item.price.value) : null;
    if (price != null && !(price > 0)) {
      issues.push({ field: `variations.${item.sku}.price`, severity: 'block_sync', key: 'variations.ebayPriceInvalid', params: { sku: item.sku }, message: 'price' });
    }
    const qty = item.quantity ?? 0;
    if (!Number.isInteger(qty) || qty < 0) {
      issues.push({ field: `variations.${item.sku}.quantity`, severity: 'block_sync', key: 'variations.ebayQuantityInvalid', params: { sku: item.sku }, message: 'quantity' });
    }
  });
  return issues;
}

export function summarizeEbayVariations(items: VariationItem[]): EbayVariationSummary {
  let min: number | null = null;
  let max: number | null = null;
  let qty = 0;
  let currency = '';
  for (const item of items) {
    qty += item.quantity ?? 0;
    const p = item.price ? Number(item.price.value) : NaN;
    if (!currency && item.price?.currency) currency = item.price.currency;
    if (Number.isFinite(p)) {
      min = min == null ? p : Math.min(min, p);
      max = max == null ? p : Math.max(max, p);
    }
  }
  return { variations: items.length, priceMin: min, priceMax: max, currency: currency || 'USD', totalQuantity: qty };
}

/** Pure: applies an open variant draft (server-draft overlay) on top of the live values. */
export function overlayEbayVariantDraft(item: VariationItem, draft: any): VariationItem {
  if (!draft) return item;
  const next = { ...item };
  const q = draft.inventoryPatch?.availability?.shipToLocationAvailability?.quantity;
  if (q != null && Number.isFinite(Number(q))) next.quantity = Number(q);
  const p = draft.offerPatch?.pricingSummary?.price;
  if (p?.value != null && next.price) next.price = { value: String(p.value), currency: p.currency || next.price.currency };
  if (!next.offerId && draft.offerId) next.offerId = String(draft.offerId);
  return next;
}

const VariationEditor = forwardRef<EbayVariationEditorHandle, VariationEditorProps>(function VariationEditor(props, ref) {
  if (props.embedded) return <EmbeddedEbayVariations {...props} handleRef={ref} />;
  return <LegacyVariationEditor {...props} onSaved={props.onSaved ?? (() => {})} />;
});

export default VariationEditor;

function LegacyVariationEditor({ sku, userId, onSaved }: VariationEditorProps & { onSaved: () => void }) {
  const t = useTranslations('ebay.listing');
  const tTerms = useTranslations('ds.termNames');
  const [variations, setVariations] = useState<VariationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasGroup, setHasGroup] = useState(false);

  const fetchVariations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=get_inventory_item_group&sku=${encodeURIComponent(sku)}&user_id=${userId}`,
      );

      if (res.status === 404) {
        // No group found
        setHasGroup(false);
        setVariations([]);
        return;
      }

      if (!res.ok) throw new Error(t('variationsFetchFailed'));

      const data = await res.json();
      setHasGroup(true);

      if (data.variantSKUs && Array.isArray(data.variantSKUs)) {
        // Fetch each variant's details
        const items: VariationItem[] = [];
        for (const variantSku of data.variantSKUs) {
          try {
            const itemRes = await fetch(
              `/api/clawd/ebay?action=listing&sku=${encodeURIComponent(variantSku)}&user_id=${userId}`,
            );
            if (itemRes.ok) {
              const itemData = await itemRes.json();
              items.push({
                sku: variantSku,
                title: itemData.product?.title || variantSku,
                price: itemData.offers?.[0]?.pricingSummary?.price,
                quantity: itemData.availability?.shipToLocationAvailability?.quantity,
                status: itemData.offers?.[0]?.status,
              });
            } else {
              items.push({ sku: variantSku });
            }
          } catch {
            items.push({ sku: variantSku });
          }
        }
        setVariations(items);
      } else {
        setVariations([]);
      }
    } catch (err: any) {
      // If not a 404, it's a real error — but for MVP, just show empty
      setHasGroup(false);
      setVariations([]);
    } finally {
      setLoading(false);
    }
  }, [sku, userId]);

  useEffect(() => {
    fetchVariations();
  }, [fetchVariations]);

  const updateVariation = (index: number, field: string, value: string) => {
    setVariations((prev) => {
      const updated = [...prev];
      const item = { ...updated[index] };

      if (field === 'price' && item.price) {
        item.price = { ...item.price, value };
      } else if (field === 'quantity') {
        const qty = parseInt(value, 10);
        if (!isNaN(qty) && qty >= 0) {
          item.quantity = qty;
        }
      } else if (field === 'sku') {
        item.sku = value;
      }

      updated[index] = item;
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let successCount = 0;
      let errorCount = 0;

      for (const variation of variations) {
        try {
          const body: Record<string, any> = {
            availability: {
              shipToLocationAvailability: {
                quantity: variation.quantity ?? 0,
              },
            },
          };

          const res = await fetch(
            `/api/clawd/ebay?action=update_inventory_item&sku=${encodeURIComponent(variation.sku)}&user_id=${userId}`,
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            }
          );

          if (res.ok) {
            successCount++;
          } else {
            errorCount++;
          }
        } catch {
          errorCount++;
        }
      }

      if (errorCount === 0) {
        toast.success(t('variationsUpdated'));
      } else {
        toast.error(t('variationsPartialSuccess', { success: successCount, errors: errorCount }));
      }
      onSaved();
    } catch (err: any) {
      toast.error(err.message || t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={4}>
        <CircularProgress size={28} />
        <Typography sx={{ ml: 1.5 }} variant="body2" color="text.secondary">
          {t('variationsLoading')}
        </Typography>
      </Box>
    );
  }

  if (!hasGroup || variations.length === 0) {
    return (
      <Box sx={{ py: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {t('noVariations')}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {t('variationsManageOnEbay')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('variation')}</TableCell>
              <TableCell>{t('price')}</TableCell>
              <TableCell>{t('stock')}</TableCell>
              <TableCell>{tTerms('sku')}</TableCell>
              <TableCell align="center">{t('status')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {variations.map((variation, idx) => (
              <TableRow key={variation.sku || idx}>
                <TableCell>
                  <Typography variant="body2">
                    {variation.title || variation.sku}
                  </Typography>
                </TableCell>
                <TableCell>
                  {variation.price ? (
                    <TextField
                      size="small"
                      type="number"
                      value={variation.price.value}
                      onChange={(e) => updateVariation(idx, 'price', e.target.value)}
                      inputProps={{ min: 0, step: '0.01' }}
                      sx={{ width: { xs: '100%', sm: 100 } }}
                      InputProps={{
                        endAdornment: (
                          <Typography variant="caption" color="text.secondary">
                            {variation.price.currency}
                          </Typography>
                        ),
                      }}
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">{EMPTY}</Typography>
                  )}
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    type="number"
                    value={variation.quantity ?? 0}
                    onChange={(e) => updateVariation(idx, 'quantity', e.target.value)}
                    inputProps={{ min: 0 }}
                    sx={{ width: { xs: '100%', sm: 80 } }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {variation.sku}
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  {variation.status && (
                    <Chip
                      label={variation.status === 'PUBLISHED' ? t('statusPublished') : t('statusUnpublished')}
                      size="small"
                      color={variation.status === 'PUBLISHED' ? 'success' : 'default'}
                      sx={{ height: 26, fontSize: '0.85rem' }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Box display="flex" justifyContent="flex-end" mt={2} sx={{ position: 'sticky', bottom: 0, bgcolor: 'white', py: 1.5, zIndex: 5 }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {saving ? t('saving') : t('save')}
        </Button>
      </Box>
    </Box>
  );
}

// ─── Embedded mode (listing editor) ──────────────────────────────────────────

type EmbeddedProps = VariationEditorProps & { handleRef?: React.ForwardedRef<EbayVariationEditorHandle> };

function baselineOf(items: VariationItem[]): Baseline {
  const b: Baseline = {};
  for (const item of items) b[item.sku] = { price: item.price?.value ?? null, quantity: item.quantity ?? 0 };
  return b;
}

function EmbeddedEbayVariations({ sku, userId, register, onChange, onSummaryChange, disabled, stageVariantDrafts = false, handleRef }: EmbeddedProps) {
  const t = useTranslations('listingEditor.variations');
  const tEbay = useTranslations('ebay.listing');
  const tTerms = useTranslations('ds.termNames');
  const [items, setItems] = useState<VariationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasGroup, setHasGroup] = useState(false);
  const baselineRef = useRef<Baseline>({});
  const [baselineVersion, setBaselineVersion] = useState(0);
  const relatedRef = useRef<Set<string>>(new Set());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const loadedRef = useRef(false);
  const stagingRef = useRef<Promise<void> | null>(null);
  const editedRef = useRef(false);
  const canStageRef = useRef(stageVariantDrafts);
  canStageRef.current = stageVariantDrafts;
  const readOnly = disabled || !stageVariantDrafts;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    loadedRef.current = false;
    try {
      const res = await fetch(`/api/clawd/ebay?action=get_inventory_item_group&sku=${encodeURIComponent(sku)}&user_id=${userId}`);
      if (res.status === 404) {
        setHasGroup(false);
        setItems([]);
        baselineRef.current = {};
        loadedRef.current = true;
        return;
      }
      if (!res.ok) throw new Error('group');
      const data = await res.json();
      const variantSkus: string[] = Array.isArray(data.variantSKUs) ? data.variantSKUs.map(String) : [];
      // Server-draft overlay: a variant's open draft wins over its live values. A failed draft check is a load
      // error (never edit over an unseen draft).
      // Read-only (no variant staging): live values only, so nothing unsent is shown as if it were on eBay.
      const drafts: any[] = variantSkus.length && stageVariantDrafts ? await fetchEbayDrafts() : [];
      const openBySku = new Map<string, any>();
      for (const d of drafts) {
        if (OPEN_DRAFT_STATUSES.includes(d?.status) && variantSkus.includes(String(d.sku))) openBySku.set(String(d.sku), d);
      }
      const loaded: VariationItem[] = await Promise.all(variantSkus.map(async (variantSku) => {
        try {
          const itemRes = await fetch(`/api/clawd/ebay?action=listing&sku=${encodeURIComponent(variantSku)}&user_id=${userId}`);
          if (!itemRes.ok) return { sku: variantSku };
          const itemData = await itemRes.json();
          return {
            sku: variantSku,
            title: itemData.product?.title || variantSku,
            price: itemData.offers?.[0]?.pricingSummary?.price,
            quantity: itemData.availability?.shipToLocationAvailability?.quantity,
            status: itemData.offers?.[0]?.status,
            offerId: itemData.offers?.[0]?.offerId ? String(itemData.offers[0].offerId) : undefined,
          } as VariationItem;
        } catch {
          return { sku: variantSku };
        }
      }));
      const merged = loaded.map((item) => overlayEbayVariantDraft(item, openBySku.get(item.sku)));
      relatedRef.current = new Set(openBySku.keys());
      setHasGroup(true);
      setItems(merged);
      baselineRef.current = baselineOf(merged);
      setBaselineVersion((v) => v + 1);
      loadedRef.current = true;
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [sku, userId, stageVariantDrafts]);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(
    () => ebayChangedSkus(items, baselineRef.current).length > 0,
    // baselineVersion: the baseline lives in a ref.
    [items, baselineVersion],
  );

  const handle = useMemo<EbayVariationEditorHandle>(() => {
    const pending = () => (loadedRef.current && canStageRef.current ? ebayVariantPatches(itemsRef.current, baselineRef.current) : []);
    const stageOnce = async () => {
      const patches = pending();
      if (patches.length === 0) return;
      const snapshot = itemsRef.current.map((i) => ({ ...i, price: i.price ? { ...i.price } : undefined }));
      for (const patch of patches) {
        // Each variant is its own inventory item + offer, so it gets its own draft row (same contract as the
        // parent: merged patches, conflict snapshot on create). Nothing reaches eBay until those drafts are sent.
        await stageEbayDraft({ sku: patch.sku, offerId: patch.offerId, inventoryFields: patch.inventoryFields, offerFields: patch.offerFields });
        relatedRef.current.add(patch.sku);
        const staged = snapshot.find((i) => i.sku === patch.sku);
        const prev = baselineRef.current[patch.sku];
        if (staged && prev) {
          // Only the parts actually staged move the baseline (an unstaged invalid price stays dirty).
          baselineRef.current = {
            ...baselineRef.current,
            [patch.sku]: {
              price: patch.offerFields ? staged.price?.value ?? null : prev.price,
              quantity: patch.inventoryFields ? staged.quantity ?? 0 : prev.quantity,
            },
          };
        }
      }
      setBaselineVersion((v) => v + 1);
    };
    return {
      isDirty: () => (loadedRef.current && canStageRef.current ? ebayChangedSkus(itemsRef.current, baselineRef.current).length > 0 : false),
      stage: async () => {
        while (stagingRef.current) {
          try { await stagingRef.current; } catch { /* earlier caller reports its own failure */ }
        }
        const run = stageOnce();
        stagingRef.current = run;
        try { await run; } finally { stagingRef.current = null; }
      },
      revert: () => {
        const b = baselineRef.current;
        setItems((prev) => prev.map((i) => {
          const base = b[i.sku];
          if (!base) return i;
          return { ...i, quantity: base.quantity, price: i.price && base.price != null ? { ...i.price, value: base.price } : i.price };
        }));
      },
      validate: () => (loadedRef.current ? ebayVariantIssues(itemsRef.current) : []),
      relatedDraftSkus: () => Array.from(relatedRef.current),
      summary: () => (loadedRef.current ? summarizeEbayVariations(itemsRef.current) : null),
    };
  }, []);

  useImperativeHandle(handleRef, () => handle, [handle]);

  useEffect(() => {
    if (!register) return undefined;
    return register({
      id: 'variations', isDirty: handle.isDirty, stage: handle.stage, validate: handle.validate, relatedDraftSkus: handle.relatedDraftSkus,
    });
  }, [register, handle]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSummaryRef = useRef(onSummaryChange);
  onSummaryRef.current = onSummaryChange;
  useEffect(() => {
    if (loading || !loadedRef.current) return;
    onSummaryRef.current?.(summarizeEbayVariations(items));
    if (editedRef.current) onChangeRef.current?.(dirty);
  }, [items, dirty, loading]);

  const setItem = (index: number, fn: (i: VariationItem) => VariationItem) => {
    editedRef.current = true;
    setItems((prev) => prev.map((i, j) => (j === index ? fn(i) : i)));
  };

  if (loading) return <PanelSkeleton sections={1} data-testid="ebay-variations-loading" />;
  if (loadError) {
    return <ErrorState variant="inline" title={t('ebayLoadFailed')} onRetry={() => { void load(); }} data-testid="ebay-variations-error" />;
  }
  if (!hasGroup || items.length === 0) {
    return (
      <Box data-testid="ebay-variations-empty" sx={{ py: '8px' }}>
        <Typography variant="body2">{t('none')}</Typography>
        <Typography variant="caption" component="p" sx={{ m: 0, mt: '4px' }}>{t('ebayManageHint')}</Typography>
      </Box>
    );
  }

  const issues = ebayVariantIssues(items);
  const issueText = (field: string) => {
    const issue = issues.find((x) => x.field === field);
    return issue ? t(issue.key.replace(/^variations\./, '') as any, issue.params as any) : null;
  };
  const dirtyPatchSkus = new Set(ebayChangedSkus(items, baselineRef.current));

  return (
    <Box data-testid="ebay-variations-embedded" sx={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: 720 }}>
      <Typography variant="caption" component="p" sx={{ m: 0 }} data-testid="ebay-variations-hint">
        {stageVariantDrafts ? t('ebayEditHint') : t('ebayReadOnlyHint')}
      </Typography>
      {items.map((item, index) => {
        const base = baselineRef.current[item.sku];
        return (
          <Box
            key={item.sku}
            data-testid={`ebay-variant-${item.sku}`}
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: 'minmax(0, 1fr) 160px 120px' },
              gap: '12px',
              alignItems: 'start',
              p: '12px',
              border: `1px solid ${neutral[200]}`,
              borderRadius: `${radius.md}px`,
            }}
          >
            <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{item.title || item.sku}</Typography>
              <Typography variant="caption" component="p" sx={{ m: 0, fontFamily: 'monospace' }}>
                {tTerms('sku')}: {item.sku}
                {item.status ? ` · ${item.status === 'PUBLISHED' ? tEbay('statusPublished') : tEbay('statusUnpublished')}` : ''}
              </Typography>
            </Box>
            <FormField
              label={tEbay('price')}
              dirty={dirtyPatchSkus.has(item.sku) && (item.price?.value ?? null) !== (base?.price ?? null)}
              error={issueText(`variations.${item.sku}.price`)}
              helper={item.price && !item.offerId ? t('ebayNoOffer') : undefined}
            >
              {item.price ? (
                <MoneyField
                  currency={item.price.currency || 'USD'}
                  value={Number.isFinite(Number(item.price.value)) ? Number(item.price.value) : null}
                  onChange={(v) => setItem(index, (i) => ({ ...i, price: i.price ? { ...i.price, value: v == null ? '' : String(v) } : i.price }))}
                  disabled={readOnly || !item.offerId}
                />
              ) : (
                <Typography variant="body2">{EMPTY}</Typography>
              )}
            </FormField>
            <FormField
              label={tEbay('stock')}
              dirty={dirtyPatchSkus.has(item.sku) && (item.quantity ?? 0) !== (base?.quantity ?? 0)}
              error={issueText(`variations.${item.sku}.quantity`)}
            >
              <NumberField
                value={item.quantity ?? 0}
                onChange={(v) => setItem(index, (i) => ({ ...i, quantity: v == null ? 0 : v }))}
                min={0}
                disabled={readOnly}
              />
            </FormField>
          </Box>
        );
      })}
    </Box>
  );
}

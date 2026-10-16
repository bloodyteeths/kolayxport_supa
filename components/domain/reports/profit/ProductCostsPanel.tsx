// Reports › Profit "Product costs" SidePanel md (finance-analytics §2.4, §3 "Cost panel", §4.6). Two modes:
//   One product  — Combobox of sold products (creatable; picking one prefills Barcode/SKU and the name), unit cost
//                  MoneyField + CurrencySelect (default = dashboard currency), shipping per item, note.
//   Paste a list — one currency for every row (fixes B15), a TextArea, "28 rows ready · 2 rows skipped", a 5-row
//                  preview and the skipped rows with their reason; primary "Import 28 costs".
// "Saved costs" lists the marketplace's costs, each in its own currency, with money-edit cells (PUT on commit).
// Single adds and list imports both use the bulk upsert (barcode key), so "One product" needs a Barcode or SKU (a
// cost with no code can never match a sale). A saved shipping cost is a number in the cost's currency: changing
// the currency over a non-zero saved shipping asks for shipping in the new currency (the row is held back on a list
// import). A partly failed import keeps the rows that were not saved in the TextArea with their reason.
// Saves go straight to KolayXport (no marketplace write, so no staging). Errors: a 400 shows next to the field;
// anything else shows a danger Banner at the top of the panel plus a persistent toast. Sold products failing to
// load leaves plain free-text entry working with the helper "Couldn't load sold products".
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { FormField } from '@/components/ds/inputs/FormField';
import { Combobox, type ComboboxOption } from '@/components/ds/inputs/Combobox';
import { TextField } from '@/components/ds/inputs/TextField';
import { TextArea } from '@/components/ds/inputs/TextArea';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { CurrencySelect } from '@/components/ds/inputs/CurrencySelect';
import { DataTable } from '@/components/ds/data/DataTable';
import type { Column } from '@/components/ds/data/dataTableParts';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { neutral as n, px, space } from '@/lib/ds/tokens';
import { FinanceFetchError } from '@/lib/reports/useFinanceReport';
import {
  bulkCreateCosts, costListToItems, costsListKey, failedCodesFrom, findSavedCostByBarcode, listAllCosts, listCosts,
  listSoldProducts, parseCostList, shippingNeedsReentry, soldProductsKey, splitShippingConflicts, updateCost,
  type ParsedCostRow, type ProductCostEntry,
} from '@/lib/reports/productCosts';

/** A list row that was not saved, and why. */
export interface CostImportIssue { code: string; reason: 'reenterShipping' | 'saveFailed'; from?: string; to?: string }

/**
 * The pasted lines to keep after an import: every line whose code was not saved (held back or failed), in the
 * original order. Pure (unit-tested).
 */
export function remainingListText(text: string, rows: ParsedCostRow[], keepCodes: Set<string>): string {
  const lines = text.split(/\r?\n/);
  return rows.filter((r) => keepCodes.has(r.code)).map((r) => lines[r.line - 1]).join('\n');
}

export type CostsPanelMode = 'one' | 'list';

export interface CostsPanelProduct {
  productName: string;
  barcode?: string | null;
  sku?: string | null;
}

export interface ProductCostsPanelProps {
  open: boolean;
  onClose(): void;
  mp: string;
  /** Display name (lib/ds/logos). */
  mpName: string;
  /** Dashboard (settlement) currency: the default cost currency. */
  currency: string;
  /** Prefill from "Add cost" / Enter on a product row. */
  initialProduct?: CostsPanelProduct | null;
  /** Revalidate the dashboard after any save. */
  onSaved(): void;
}

export function ProductCostsPanel({ open, onClose, mp, mpName, currency, initialProduct, onSaved }: ProductCostsPanelProps) {
  const t = useTranslations('reports');
  const tOverlay = useTranslations('ds.overlay');
  const toast = useToast();
  const [mode, setMode] = useState<CostsPanelMode>('one');
  const [product, setProduct] = useState<ComboboxOption | null>(null);
  const [code, setCode] = useState('');
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [costCurrency, setCostCurrency] = useState<string>(currency);
  const [shipping, setShipping] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [listText, setListText] = useState('');
  const [listCurrency, setListCurrency] = useState<string>(currency);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [shipError, setShipError] = useState<string | null>(null);
  const [importIssues, setImportIssues] = useState<{ imported: number; issues: CostImportIssue[]; unmatched: number } | null>(null);
  const [panelError, setPanelError] = useState(false);
  const [search, setSearch] = useState('');

  // Reset the form every time the panel opens (new prefill, current dashboard currency).
  useEffect(() => {
    if (!open) return;
    setMode('one');
    setProduct(initialProduct ? { value: initialProduct.barcode || initialProduct.sku || initialProduct.productName, label: initialProduct.productName } : null);
    setCode(initialProduct?.barcode || initialProduct?.sku || '');
    setUnitCost(null);
    setCostCurrency(currency);
    setShipping(null);
    setNote('');
    setListText('');
    setListCurrency(currency);
    setFieldError(null);
    setCodeError(null);
    setShipError(null);
    setImportIssues(null);
    setPanelError(false);
    setSearch('');
  }, [open, initialProduct, currency]);

  const costs = useSWR<ProductCostEntry[]>(open ? costsListKey(mp) : null, () => listCosts(mp), { revalidateOnFocus: false });
  const sold = useSWR(open ? soldProductsKey(mp) : null, () => listSoldProducts(mp), { revalidateOnFocus: false, shouldRetryOnError: false });

  const soldOptions: ComboboxOption[] = useMemo(
    () => (sold.data ?? []).map((p) => ({ value: p.barcode || p.productName, label: p.productName || p.barcode, description: p.barcode || undefined })),
    [sold.data],
  );
  const parsed = useMemo(() => parseCostList(listText), [listText]);
  const savedRows = useMemo(() => {
    const s = search.trim().toLocaleLowerCase();
    const list = costs.data ?? [];
    return s ? list.filter((c) => [c.productName, c.barcode, c.sku].some((v) => v && v.toLocaleLowerCase().includes(s))) : list;
  }, [costs.data, search]);

  const fail = (err: unknown) => {
    if (err instanceof FinanceFetchError && err.status === 400) {
      setFieldError(t('costs.failed'));
      return;
    }
    setPanelError(true);
    toast.error(t('costs.failed'));
  };

  const pickProduct = (opt: ComboboxOption | null) => {
    setProduct(opt);
    if (opt && !opt.created) {
      const hit = (sold.data ?? []).find((p) => (p.barcode || p.productName) === opt.value);
      if (hit?.barcode) setCode(hit.barcode);
    }
  };

  const addOne = async () => {
    const c = code.trim();
    const name = product?.label?.trim() || c;
    // The code is the match key: without one the cost would be saved but never used.
    setCodeError(c ? null : t('costs.reason.noCode'));
    setFieldError(unitCost === null ? t('costs.reason.badCost') : null);
    setShipError(null);
    if (!c || !name || unitCost === null) return;
    setSaving(true);
    setPanelError(false);
    try {
      const saved = await findSavedCostByBarcode(mp, c);
      if (saved && shippingNeedsReentry(saved, costCurrency, shipping)) {
        setShipError(t('costs.reason.reenterShipping', { from: saved.costCurrency, to: costCurrency }));
        return;
      }
      // The bulk action upserts by barcode, so saving a product that already has a cost updates it (a plain
      // create would hit the unique barcode key). The code goes as barcode only: a saved SKU is kept.
      const res = await bulkCreateCosts(mp, [{ productName: name, barcode: c, costAmount: unitCost, costCurrency, shippingCost: shipping, notes: note.trim() || null }]);
      if (res.errors.length || res.total === 0) throw new Error('bulk');
      toast.success(t('costs.added'));
      setProduct(null); setCode(''); setUnitCost(null); setShipping(null); setNote('');
      void costs.mutate();
      onSaved();
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const importList = async () => {
    if (!parsed.valid.length) return;
    setSaving(true);
    setFieldError(null);
    setPanelError(false);
    setImportIssues(null);
    try {
      const { ok, conflicts } = splitShippingConflicts(costListToItems(parsed.valid, listCurrency), await listAllCosts(mp));
      const res = ok.length ? await bulkCreateCosts(mp, ok) : { created: 0, updated: 0, errors: [], total: 0 };
      const failed = failedCodesFrom(res.errors, ok.map((i) => i.barcode as string));
      const issues: CostImportIssue[] = [
        ...conflicts.map((x) => ({ code: x.item.barcode as string, reason: 'reenterShipping' as const, from: x.saved.costCurrency, to: listCurrency })),
        ...[...failed.codes].map((code) => ({ code, reason: 'saveFailed' as const })),
      ];
      const imported = res.created + res.updated;
      if (imported > 0) {
        void costs.mutate();
        onSaved();
      }
      if (!issues.length && !failed.unmatched) {
        toast.success(t('costs.imported', { count: imported }));
        setListText('');
        return;
      }
      // Partly saved: say so, keep what was not saved so it can be fixed and imported again.
      setImportIssues({ imported, issues, unmatched: failed.unmatched });
      if (failed.codes.size || conflicts.length) setListText(remainingListText(listText, parsed.valid, new Set(issues.map((i) => i.code))));
      toast.error(t('costs.importPartial', { imported, failed: issues.length + failed.unmatched }));
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const commitSaved = async (id: string, key: string, value: number | null) => {
    if (key === 'costAmount' && value === null) return;
    try {
      await updateCost(id, key === 'costAmount' ? { costAmount: value as number } : { shippingCost: value });
      toast.success(t('profit.products.costSaved'));
      void costs.mutate();
      onSaved();
    } catch (err) {
      fail(err);
    }
  };

  const savedColumns: Column<ProductCostEntry>[] = [
    { key: 'productName', header: t('costs.field.product'), mobile: 'title' },
    { key: 'costAmount', header: t('costs.field.unitCost'), type: 'money-edit', currency: (r) => r.costCurrency, mobile: 'trailing' },
    { key: 'shippingCost', header: t('costs.field.shipping'), type: 'money-edit', currency: (r) => r.costCurrency, mobile: 'meta' },
  ];
  const previewColumns: Column<ParsedCostRow>[] = [
    { key: 'code', header: t('costs.field.code'), mobile: 'subtitle' },
    { key: 'productName', header: t('costs.field.product'), mobile: 'title' },
    { key: 'costAmount', header: t('costs.field.unitCost'), type: 'money', currency: () => listCurrency, mobile: 'trailing' },
    { key: 'shippingCost', header: t('costs.field.shipping'), type: 'money', currency: () => listCurrency, mobile: 'meta' },
  ];

  const reasonText = (r: 'noCode' | 'badCost') => t(`costs.reason.${r}`);
  const primary = mode === 'one'
    ? { id: 'add-cost', label: t('costs.add'), onClick: () => { void addOne(); }, loading: saving }
    : {
        id: 'import-costs',
        label: t('costs.import', { count: parsed.valid.length }),
        onClick: () => { void importList(); },
        loading: saving,
        disabled: parsed.valid.length === 0,
        disabledReason: parsed.valid.length === 0 ? t('costs.listHelp') : undefined,
      };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size="md"
      title={t('costs.title')}
      leading={<LogoTile brand={mp} size={24} />}
      meta={t('costs.subtitle', { name: mpName })}
      primary={primary}
      secondary={{ id: 'cancel', label: tOverlay('cancel'), onClick: onClose }}
      headerSlot={panelError ? <Banner tone="danger" title={t('costs.failed')} /> : undefined}
      data-testid="product-costs-panel"
    >
      {/* The form above the saved list had no side padding (fields touched the panel edge); sections pad themselves. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[4]), p: '16px 16px 0', '& > section': { mx: '-16px' } }}>
        <SegmentedControl<CostsPanelMode>
          value={mode}
          onChange={(m) => { setMode(m); setFieldError(null); setCodeError(null); setShipError(null); }}
          options={[{ value: 'one', label: t('costs.mode.one') }, { value: 'list', label: t('costs.mode.list') }]}
          aria-label={t('costs.title')}
          fullWidth
          data-testid="costs-mode"
        />

        {mode === 'one' ? (
          <>
            <FormField label={t('costs.field.product')} helper={sold.error ? t('costs.soldLoadFailed') : t('costs.field.productHelp')}>
              <Combobox
                value={product}
                onChange={pickProduct}
                options={soldOptions}
                creatable
                data-testid="costs-product"
              />
            </FormField>
            <FormField label={t('costs.field.code')} error={codeError}>
              <TextField value={code} onChange={(v) => { setCode(v); if (v.trim()) setCodeError(null); }} mono data-testid="costs-code" />
            </FormField>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: px(space[3]) }}>
              <FormField label={t('costs.field.unitCost')} error={fieldError}>
                <MoneyField value={unitCost} onChange={setUnitCost} currency={costCurrency} data-testid="costs-unit" />
              </FormField>
              <FormField label={t('costs.field.currency')}>
                <CurrencySelect value={costCurrency} onChange={(c) => setCostCurrency(c ?? currency)} defaultCurrency={currency} data-testid="costs-currency" />
              </FormField>
            </Box>
            <FormField label={t('costs.field.shipping')} optional error={shipError}>
              <MoneyField value={shipping} onChange={(v) => { setShipping(v); setShipError(null); }} currency={costCurrency} data-testid="costs-shipping" />
            </FormField>
            <FormField label={t('costs.field.note')} optional>
              <TextField value={note} onChange={(v) => setNote(v)} maxLength={200} />
            </FormField>
          </>
        ) : (
          <>
            <FormField label={t('costs.field.currency')} width="short">
              <CurrencySelect value={listCurrency} onChange={(c) => setListCurrency(c ?? currency)} defaultCurrency={currency} data-testid="costs-list-currency" />
            </FormField>
            {importIssues ? (
              <Banner
                tone="warning"
                title={t('costs.importPartial', { imported: importIssues.imported, failed: importIssues.issues.length + importIssues.unmatched })}
                data-testid="costs-import-issues"
              >
                {importIssues.issues.length ? (
                  <Box component="span" sx={{ display: 'block' }}>
                    {importIssues.issues.map((x) => (
                      <Box component="span" key={`${x.reason}:${x.code}`} sx={{ display: 'block' }}>
                        {t('costs.importIssue', {
                          code: x.code,
                          reason: x.reason === 'reenterShipping'
                            ? t('costs.reason.reenterShipping', { from: x.from ?? '', to: x.to ?? listCurrency })
                            : t('costs.reason.saveFailed'),
                        })}
                      </Box>
                    ))}
                  </Box>
                ) : null}
              </Banner>
            ) : null}
            <FormField label={t('costs.field.list')} helper={t('costs.listHelp')} error={fieldError}>
              <TextArea value={listText} onChange={(v) => setListText(v)} minRows={6} data-testid="costs-list" />
            </FormField>
            {listText.trim() ? (
              <Box data-testid="costs-list-preview" sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
                <Box sx={{ color: n[700], fontSize: 13 }}>
                  {t('costs.listPreview', { valid: parsed.valid.length, invalid: parsed.invalid.length })}
                </Box>
                {parsed.valid.length ? (
                  <DataTable<ParsedCostRow>
                    rows={parsed.valid.slice(0, 5)}
                    columns={previewColumns}
                    getRowId={(r) => String(r.line)}
                    state="ready"
                    density="compact"
                    columnStateKey="reports.costs.preview"
                    ariaLabel={t('costs.listPreview', { valid: parsed.valid.length, invalid: parsed.invalid.length })}
                  />
                ) : null}
                {parsed.invalid.length ? (
                  <Box component="ul" sx={{ m: 0, pl: px(space[4]), color: n[600], fontSize: 12 }}>
                    {parsed.invalid.map((x) => (
                      <li key={x.line}>{t('costs.listRowInvalid', { row: x.line, reason: reasonText(x.reason) })}</li>
                    ))}
                  </Box>
                ) : null}
              </Box>
            ) : null}
          </>
        )}

        <SidePanelSection id="saved-costs" title={t('costs.saved')}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
            <SearchField value={search} onChange={setSearch} placeholder={t('sales.products.search')} size="sm" fullWidth shortcut={null} />
            {costs.data === undefined && !costs.error ? (
              <PanelSkeleton sections={1} />
            ) : savedRows.length === 0 && !costs.error ? (
              <Box sx={{ color: n[500], fontSize: 13 }} data-testid="costs-none">{t('costs.none')}</Box>
            ) : (
              <DataTable<ProductCostEntry>
                rows={savedRows}
                columns={savedColumns}
                getRowId={(r) => r.id}
                state={costs.error ? 'error' : 'ready'}
                error={<Banner tone="danger" title={t('costs.failed')} />}
                density="compact"
                onCellCommit={(id, key, value) => { void commitSaved(id, key, value); }}
                columnStateKey="reports.costs.saved"
                ariaLabel={t('costs.saved')}
                maxHeight={px(360)}
              />
            )}
          </Box>
        </SidePanelSection>
      </Box>
    </SidePanel>
  );
}

export default ProductCostsPanel;

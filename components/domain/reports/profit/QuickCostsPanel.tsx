// components/domain/reports/profit/QuickCostsPanel.tsx — "Enter costs": one list, one box per product, one save.
// Founder (2026-10-17): the detailed cost form was "impossible to use, nobody bothers". Sellers just want to type a
// unit cost next to each product they sold. Code (barcode/SKU), name and currency are filled in from the report;
// the detailed form (shipping per item, notes, paste a list) stays one tap away.
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { useToast } from '@/components/ds/feedback/toast';
import { neutral as n } from '@/lib/ds/tokens';
import type { FinanceProductRow } from '@/lib/reports/useFinanceReport';
import { bulkCreateCosts, type CostInput } from '@/lib/reports/productCosts';

export interface QuickCostsPanelProps {
  open: boolean;
  onClose(): void;
  mp: string;
  /** Report (settlement) currency: costs are entered in it. */
  currency: string;
  rows: FinanceProductRow[];
  /** Row to put first (opened from its "Add cost"). */
  focusKey?: string | null;
  onSaved(): void;
  onOpenDetailed(): void;
}

/** Products that can take a cost (they need a code to be matched), missing ones first, best sellers first. Pure. */
export function quickCostRows(rows: FinanceProductRow[], show: 'missing' | 'all', focusKey?: string | null): FinanceProductRow[] {
  const coded = rows.filter((r) => r.barcode || r.sku);
  const list = show === 'missing' ? coded.filter((r) => r.unitCost == null) : coded;
  return [...list].sort((a, b) => (a.key === focusKey ? -1 : b.key === focusKey ? 1 : b.quantity - a.quantity));
}

/** Entered values → bulk upsert items (only rows with a new or changed cost). Pure. */
export function quickCostItems(rows: FinanceProductRow[], values: Record<string, number | null>, currency: string): CostInput[] {
  return rows
    .filter((r) => values[r.key] != null && values[r.key] !== r.unitCost)
    .map((r) => ({ productName: r.productName, barcode: (r.barcode || r.sku) as string, costAmount: values[r.key] as number, costCurrency: currency, shippingCost: null, notes: null }));
}

export function QuickCostsPanel({ open, onClose, mp, currency, rows, focusKey, onSaved, onOpenDetailed }: QuickCostsPanelProps) {
  const t = useTranslations('reports.profit.quickCosts');
  const toast = useToast();
  const [show, setShow] = useState<'missing' | 'all'>('missing');
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues({});
    setShow(rows.some((r) => (r.barcode || r.sku) && r.unitCost == null) ? 'missing' : 'all');
  }, [open]);

  const list = useMemo(() => quickCostRows(rows, show, focusKey), [rows, show, focusKey]);
  const items = quickCostItems(list, values, currency);

  const save = async () => {
    if (!items.length) return;
    setSaving(true);
    try {
      const res = await bulkCreateCosts(mp, items);
      if (res.errors.length && res.created + res.updated === 0) throw new Error('bulk');
      toast.success(t('saved', { count: res.created + res.updated }));
      onSaved();
      onClose();
    } catch {
      toast.error(t('failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size="md"
      title={t('title')}
      meta={t('subtitle', { currency })}
      primary={{ id: 'qc-save', label: t('save', { count: items.length }), onClick: () => void save(), loading: saving, disabled: items.length === 0 }}
      secondary={{ id: 'qc-detailed', label: t('detailed'), onClick: onOpenDetailed }}
      data-testid="quick-costs-panel"
    >
      <Box sx={{ px: '16px', pt: '12px', pb: '8px', borderBottom: `1px solid ${n[100]}` }}>
        <SegmentedControl<'missing' | 'all'>
          value={show}
          onChange={setShow}
          size="sm"
          options={[
            { value: 'missing', label: t('missing', { count: rows.filter((r) => (r.barcode || r.sku) && r.unitCost == null).length }) },
            { value: 'all', label: t('all') },
          ]}
          aria-label={t('title')}
        />
      </Box>
      {list.length === 0 ? (
        <Box sx={{ p: '24px 16px', textAlign: 'center', color: n[600], fontSize: 14 }}>{t('allDone')}</Box>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }} data-testid="quick-costs-list">
          {list.map((r) => (
            <Box
              component="li"
              key={r.key}
              sx={{ display: 'flex', alignItems: 'center', gap: '12px', px: '16px', py: '10px', borderBottom: `1px solid ${n[100]}` }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box title={r.productName} sx={{ fontSize: 14, lineHeight: '20px', color: n[900], display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {r.productName}
                </Box>
                <Box sx={{ fontSize: 12, lineHeight: '16px', color: n[500], mt: '2px' }}>{t('sold', { count: r.quantity })}</Box>
              </Box>
              <Box sx={{ width: 120, flexShrink: 0 }}>
                <MoneyField
                  currency={currency}
                  value={values[r.key] !== undefined ? values[r.key] : r.unitCost}
                  onChange={(v) => setValues((prev) => ({ ...prev, [r.key]: v }))}
                  placeholder={t('placeholder')}
                  aria-label={t('costFor', { name: r.productName })}
                  size="sm"
                />
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SidePanel>
  );
}

export default QuickCostsPanel;

/**
 * /app/hepsiburada-urunler/new — create a Hepsiburada product.
 *
 * Two paths:
 *  - "New product" (catalog import): category (leaf, available) → its required attributes → product details →
 *    POST /api/hepsiburada/products?action=create. HB reviews the product (matching / approval); the page polls
 *    the import tracking id and shows HB's validation messages. A listing appears after approval (next listings pull).
 *  - "Already on Hepsiburada" (fast listing): the product exists in HB's catalog with this barcode → list it with
 *    price and stock, no review.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { Page, PageHeader, Section } from '@/components/ds/page';
import { FormField } from '@/components/ds/inputs/FormField';
import { TextField } from '@/components/ds/inputs/TextField';
import { TextArea } from '@/components/ds/inputs/TextArea';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { Select } from '@/components/ds/inputs/Select';
import { Combobox, type ComboboxOption } from '@/components/ds/inputs/Combobox';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { Banner, useToast } from '@/components/ds/feedback';
import { neutral as n, space, px } from '@/lib/ds/tokens';

type Attr = { id: string; name: string; mandatory: boolean; type?: string; multiValue?: boolean };
type AttrValue = { id: string; value: string };

/** Base attributes the form fields cover (never asked again in the category section). */
const BASE_KEYS = new Set(['merchantsku', 'varyantgroupid', 'barcode', 'urunadi', 'urunaciklamasi', 'marka', 'garantisuresi', 'kg', 'tax_vat_rate', 'price', 'stock', 'image1', 'image2', 'image3', 'image4', 'image5', 'video1']);

/** Category attribute response → the attributes the creator must ask for. Pure (tested). */
export function attributesToAsk(res: any): Attr[] {
  const pick = (list: unknown) => (Array.isArray(list) ? list : []) as any[];
  const all = [...pick(res?.attributes), ...pick(res?.variantAttributes), ...pick(res?.baseAttributes)];
  const seen = new Set<string>();
  const out: Attr[] = [];
  for (const a of all) {
    const id = typeof a?.id === 'string' ? a.id : '';
    if (!id || seen.has(id) || BASE_KEYS.has(id.toLowerCase())) continue;
    seen.add(id);
    out.push({ id, name: String(a?.name || id), mandatory: !!a?.mandatory, type: a?.type, multiValue: !!a?.multiValue });
  }
  return out.sort((x, y) => Number(y.mandatory) - Number(x.mandatory) || x.name.localeCompare(y.name, 'tr'));
}

/** Image URL text (one per line / comma separated) → https URLs. Pure (tested). */
export function parseImageUrls(text: string): string[] {
  return text.split(/[\n,]+/).map((s) => s.trim()).filter((s) => /^https:\/\/\S+$/i.test(s)).slice(0, 5);
}

type Mode = 'import' | 'fast';
type Status = { state: 'pending' | 'done' | 'failed'; messages: string[]; hbSku?: string | null };

const VAT_OPTIONS = [0, 1, 10, 20].map((v) => ({ value: v, label: `%${v}` }));

async function getJson(url: string) {
  const res = await fetch(url, { credentials: 'same-origin' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

async function postJson(url: string, data: unknown) {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { body });
  return body;
}

export function HepsiburadaCreatePage() {
  const t = useTranslations('hepsiburada.create');
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('import');
  const [category, setCategory] = useState<ComboboxOption | null>(null);
  const [attrs, setAttrs] = useState<Attr[]>([]);
  const [attrValues, setAttrValues] = useState<Record<string, AttrValue[]>>({});
  const [attrInput, setAttrInput] = useState<Record<string, string>>({});
  const [attrsLoading, setAttrsLoading] = useState(false);
  const [f, setF] = useState({
    merchantSku: '', barcode: '', title: '', description: '', brand: '', images: '',
    vatRate: 20 as number, warrantyMonths: 24 as number | null, weightKg: null as number | null,
    price: null as number | null, stock: null as number | null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const loadCategories = useCallback(async (q: string): Promise<ComboboxOption[]> => {
    const body = await getJson(`/api/hepsiburada/metadata?action=categories&q=${encodeURIComponent(q)}`);
    return (body.categories || []).map((c: any) => ({ value: String(c.id), label: c.name, description: c.path }));
  }, []);

  useEffect(() => {
    if (!category) { setAttrs([]); return; }
    let alive = true;
    setAttrsLoading(true);
    getJson(`/api/hepsiburada/metadata?action=category_attributes&categoryId=${category.value}`)
      .then(async (res) => {
        if (!alive) return;
        const list = attributesToAsk(res);
        setAttrs(list);
        // Listed values for enum attributes (first page; HB enum lists are short for most categories).
        const enums = list.filter((a) => String(a.type || '').toLowerCase() === 'enum').slice(0, 15);
        const entries = await Promise.all(enums.map(async (a) => {
          try {
            const v = await getJson(`/api/hepsiburada/metadata?action=attribute_values&categoryId=${category.value}&attributeId=${encodeURIComponent(a.id)}`);
            const rows: any[] = Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [];
            return [a.id, rows.map((r) => ({ id: String(r?.id ?? r?.value), value: String(r?.value ?? r?.id) }))] as const;
          } catch {
            return [a.id, []] as const;
          }
        }));
        if (alive) setAttrValues(Object.fromEntries(entries));
      })
      .catch((err) => toast.error(t('attributesFailed', { reason: String(err?.message || err).slice(0, 200) })))
      .finally(() => alive && setAttrsLoading(false));
    return () => { alive = false; };
  }, [category, t, toast]);

  const poll = useCallback((trackingId: string, attempt = 0) => {
    pollRef.current = setTimeout(async () => {
      try {
        const s = await getJson(`/api/hepsiburada/products?action=create_status&trackingId=${encodeURIComponent(trackingId)}`);
        const messages = (Array.isArray(s.validation) ? s.validation : []).map((v: any) => [v?.attributeName, v?.message].filter(Boolean).join(': ')).filter(Boolean);
        setStatus({ state: s.status, messages, hbSku: s.hbSku });
        if (s.status === 'pending' && attempt < 40) poll(trackingId, attempt + 1);
      } catch {
        if (attempt < 40) poll(trackingId, attempt + 1);
      }
    }, attempt === 0 ? 3000 : 6000);
  }, []);

  const missingMandatory = attrs.filter((a) => a.mandatory && !(attrInput[a.id] || '').trim());

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setFieldErrors([]);
    setStatus(null);
    try {
      if (mode === 'fast') {
        await postJson('/api/hepsiburada/products?action=fastlisting', {
          barcode: f.barcode, merchantSku: f.merchantSku, title: f.title, price: f.price, stock: f.stock,
        });
        toast.success(t('fastSent'));
        setStatus({ state: 'done', messages: [] });
        return;
      }
      const body = await postJson('/api/hepsiburada/products?action=create', {
        categoryId: category ? Number(category.value) : null,
        merchantSku: f.merchantSku, barcode: f.barcode || undefined, title: f.title, description: f.description, brand: f.brand,
        vatRate: f.vatRate, warrantyMonths: f.warrantyMonths ?? 0, weightKg: f.weightKg ?? undefined,
        price: f.price ?? undefined, stock: f.stock ?? undefined,
        images: parseImageUrls(f.images), attributes: attrInput,
      });
      setStatus({ state: 'pending', messages: [] });
      poll(String(body.trackingId));
    } catch (err: any) {
      if (Array.isArray(err?.body?.fields)) setFieldErrors(err.body.fields);
      toast.error(t('submitFailed', { reason: String(err?.message || err).slice(0, 200) }));
    } finally {
      setSubmitting(false);
    }
  };

  const errFor = (k: string) => (fieldErrors.includes(k) ? t('fieldInvalid') : null);
  const canSubmit = mode === 'fast'
    ? !!f.barcode && !!f.merchantSku && !!f.price && f.stock !== null
    : !!category && !!f.merchantSku && !!f.title && !!f.description && !!f.brand && parseImageUrls(f.images).length > 0 && missingMandatory.length === 0;

  return (
    <Page title={t('title')} width="form" backHref="/app/hepsiburada-urunler" data-testid="hb-create-page">
      <PageHeader
        title={t('title')}
        backHref="/app/hepsiburada-urunler"
        backLabel={t('back')}
        primaryAction={{
          id: 'hb-create-submit', label: mode === 'fast' ? t('submitFast') : t('submit'), onClick: () => void submit(), loading: submitting,
          disabled: !canSubmit, disabledReason: t('fillRequired'),
        }}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[5]) }}>
        <SegmentedControl<Mode>
          value={mode}
          onChange={(m) => { setMode(m); setStatus(null); }}
          options={[{ value: 'import', label: t('modeImport') }, { value: 'fast', label: t('modeFast') }]}
          aria-label={t('mode')}
        />
        <Typography variant="caption" sx={{ color: n[600] }}>{mode === 'fast' ? t('modeFastHelp') : t('modeImportHelp')}</Typography>

        {status && (
          <Banner
            tone={status.state === 'done' ? 'success' : status.state === 'failed' ? 'danger' : 'info'}
            title={status.state === 'done' ? (mode === 'fast' ? t('fastDone') : t('importDone')) : status.state === 'failed' ? t('importFailed') : t('importPending')}
          >
            {status.messages.length ? status.messages.join(' · ') : undefined}
          </Banner>
        )}

        {mode === 'import' && (
          <Section title={t('sectionCategory')} variant="card">
            <FormField label={t('category')} helper={t('categoryHelp')} error={errFor('categoryId')}>
              <Combobox value={category} onChange={setCategory} loadOptions={loadCategories} minQueryLength={2} placeholder={t('categoryPlaceholder')} noOptionsText={t('noCategories')} />
            </FormField>
            {attrsLoading && <Typography variant="caption" sx={{ color: n[500] }}>{t('attributesLoading')}</Typography>}
            {attrs.length > 0 && (
              <Box sx={{ mt: px(space[4]), display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: px(space[4]) }}>
                {attrs.map((a) => {
                  const values = attrValues[a.id] || [];
                  return (
                    <FormField key={a.id} label={a.name} optional={!a.mandatory}>
                      {values.length ? (
                        <Select<string>
                          value={attrInput[a.id] || null}
                          onChange={(v) => setAttrInput({ ...attrInput, [a.id]: v })}
                          options={values.map((v) => ({ value: v.value, label: v.value }))}
                          placeholder={t('choose')}
                          fullWidth
                        />
                      ) : (
                        <TextField value={attrInput[a.id] || ''} onChange={(v) => setAttrInput({ ...attrInput, [a.id]: v })} fullWidth />
                      )}
                    </FormField>
                  );
                })}
              </Box>
            )}
          </Section>
        )}

        <Section title={t('sectionProduct')} variant="card">
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: px(space[4]) }}>
            <FormField label={t('merchantSku')} helper={t('merchantSkuHelp')} error={errFor('merchantSku')}>
              <TextField value={f.merchantSku} onChange={(v) => setF({ ...f, merchantSku: v })} mono maxLength={100} fullWidth />
            </FormField>
            <FormField label={t('barcode')} optional={mode === 'import'} error={errFor('barcode')}>
              <TextField value={f.barcode} onChange={(v) => setF({ ...f, barcode: v })} mono maxLength={40} fullWidth />
            </FormField>
          </Box>
          <Box sx={{ mt: px(space[4]), display: 'flex', flexDirection: 'column', gap: px(space[4]) }}>
            <FormField label={t('productTitle')} counter={{ value: f.title.length, max: 200 }} error={errFor('title')} optional={mode === 'fast'}>
              <TextField value={f.title} onChange={(v) => setF({ ...f, title: v })} maxLength={200} fullWidth />
            </FormField>
            {mode === 'import' && (
              <>
                <FormField label={t('description')} error={errFor('description')}>
                  <TextArea value={f.description} onChange={(v) => setF({ ...f, description: v })} minRows={5} />
                </FormField>
                <FormField label={t('brand')} error={errFor('brand')}>
                  <TextField value={f.brand} onChange={(v) => setF({ ...f, brand: v })} fullWidth />
                </FormField>
                <FormField label={t('images')} helper={t('imagesHelp')} error={errFor('images')}>
                  <TextArea value={f.images} onChange={(v) => setF({ ...f, images: v })} minRows={3} />
                </FormField>
              </>
            )}
          </Box>
        </Section>

        <Section title={t('sectionSale')} variant="card">
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: px(space[4]) }}>
            <FormField label={t('price')} optional={mode === 'import'}>
              <MoneyField currency="TRY" value={f.price} onChange={(v) => setF({ ...f, price: v })} min={0.01} />
            </FormField>
            <FormField label={t('stock')} optional={mode === 'import'}>
              <NumberField value={f.stock} onChange={(v) => setF({ ...f, stock: v })} min={0} max={20000} />
            </FormField>
            {mode === 'import' && (
              <>
                <FormField label={t('vatRate')} error={errFor('vatRate')}>
                  <Select<number> value={f.vatRate} onChange={(v) => setF({ ...f, vatRate: v })} options={VAT_OPTIONS} fullWidth />
                </FormField>
                <FormField label={t('warranty')} error={errFor('warrantyMonths')}>
                  <NumberField value={f.warrantyMonths} onChange={(v) => setF({ ...f, warrantyMonths: v })} min={0} max={120} unit={t('months')} />
                </FormField>
                <FormField label={t('weight')} optional error={errFor('weightKg')}>
                  <NumberField value={f.weightKg} onChange={(v) => setF({ ...f, weightKg: v })} min={0} max={1000} decimals={2} unit="kg" />
                </FormField>
              </>
            )}
          </Box>
        </Section>
      </Box>
    </Page>
  );
}

export default HepsiburadaCreatePage;

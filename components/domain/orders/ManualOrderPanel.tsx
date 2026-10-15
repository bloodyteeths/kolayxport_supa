// components/domain/orders/ManualOrderPanel.tsx — orders §2.7 / §3.5 / §7.3 / §13 G5.
// SidePanel md (bottom sheet < 600) replacing components/ManualOrderForm.tsx. Same endpoint and body
// (`POST /api/orders/manual`, `ManualOrderData`); default currency = the account base currency, never a hard "USD";
// a duplicate order number (A8 `DUPLICATE_ORDER_NUMBER`) is a field error on Order number.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import useSWR, { useSWRConfig } from 'swr';
import { useLocale, useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { ConfirmDialog } from '@/components/ds/overlay/ConfirmDialog';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { FormField } from '@/components/ds/inputs/FormField';
import { TextField } from '@/components/ds/inputs/TextField';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { CountrySelect } from '@/components/ds/inputs/CountrySelect';
import { CurrencySelect } from '@/components/ds/inputs/CurrencySelect';
import { PhoneInput } from '@/components/ds/inputs/PhoneInput';
import { Combobox } from '@/components/ds/inputs/Combobox';
import { Button } from '@/components/ds/inputs/Button';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { icons } from '@/lib/ds/icons';
import { neutral as n } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import { getLocaleConfig } from '@/lib/i18n/localeConfig';
import { NAV_COUNTS_KEY } from '@/lib/nav/useNavCounts';
import {
  buildManualOrderPayload, classifyManualResponse, emptyItem, emptyManualOrder, formSnapshot, isOrdersKey,
  manualOrderTotal, resolveBaseCurrency, resolveManualDefaults, stateAfterCountryChange, stateOptionsFor,
  validateManualOrder, type ManualErrorCode, type ManualOrderForm, type ManualOrderItemForm,
} from '@/lib/orders/manualOrder';

export interface ManualOrderPanelProps {
  open: boolean;
  /** Close without creating (after the dirty guard). */
  onClose(): void;
  /** Called once the order exists. The parent swaps this panel for the new order's OrderPanel (§2.7). */
  onCreated(orderId: string): void;
}

/** Same SWR key as the shell (components/ds/shell/AppShell SETTINGS_KEY), so it is usually already cached. */
const SETTINGS_KEY = '/api/user/settings';
type SettingsSlice = {
  shipperProfile?: { defaultCurrencyCode?: string | null; shipperCountryCode?: string | null } | null;
} | null;

const settingsFetcher = async (url: string): Promise<SettingsSlice> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return res.json();
};

type BannerState = { kind: 'fix'; count: number } | { kind: 'failed' } | { kind: 'auth' } | null;

export function ManualOrderPanel({ open, onClose, onCreated }: ManualOrderPanelProps) {
  const t = useTranslations('orders.manual');
  const tOverlay = useTranslations('ds.overlay');
  const locale = useLocale();
  const f = useFormatters();
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const localeCfg = getLocaleConfig(locale === 'en' ? 'en' : 'tr');

  // Short dedupe so each opening refetches: useSettings saves via axios and never mutates this key, so a long dedupe
  // could seed the form with a sender country/currency changed minutes ago. The cached entry still renders at once;
  // a pristine form is re-seeded below when the fresh defaults differ.
  const { data: settings, error: settingsError } = useSWR<SettingsSlice>(open ? SETTINGS_KEY : null, settingsFetcher, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 2_000,
  });
  // Settings only feed defaults: a failed load falls back to the locale defaults instead of blocking the form.
  const settingsReady = settings !== undefined || settingsError !== undefined;
  const shipper = settings?.shipperProfile ?? null;
  const baseCurrency = resolveBaseCurrency({ shipperProfile: shipper, localeCurrency: localeCfg.defaultCurrency });
  const shipperCountry = shipper?.shipperCountryCode ?? null;
  const localeCountry = localeCfg.defaultCountryOfOrigin;
  const defaults = useMemo(
    () => resolveManualDefaults({ shipperCountryCode: shipperCountry }, localeCountry),
    [shipperCountry, localeCountry],
  );

  const [form, setForm] = useState<ManualOrderForm | null>(null);
  const [initialSnap, setInitialSnap] = useState('');
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerState>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  const [seededDefaults, setSeededDefaults] = useState(defaults);

  // Every opening starts a fresh order (no drafts, §8 ⌘S). Reset on open, not on close, so the exit animation does
  // not flash an empty form. Done during render (prev-prop pattern), so the previous order never paints for a frame.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setForm(null);
      setTouched(new Set());
      setSubmitted(false);
      setSubmitting(false);
      setDuplicateOf(null);
      setBanner(null);
      setConfirmDiscard(false);
    }
  }

  useEffect(() => {
    if (open && form === null && settingsReady) {
      const next = emptyManualOrder(defaults);
      setForm(next);
      setInitialSnap(formSnapshot(next));
      setSeededDefaults(defaults);
    }
  }, [open, form, settingsReady, defaults]);

  // Settings revalidated after the form was seeded from a stale cache: re-seed only while the form is untouched.
  useEffect(() => {
    if (!open || !form || defaults === seededDefaults) return;
    if (formSnapshot(form) === initialSnap) {
      const next = emptyManualOrder(defaults);
      setForm(next);
      setInitialSnap(formSnapshot(next));
    }
    setSeededDefaults(defaults);
  }, [open, form, defaults, seededDefaults, initialSnap]);

  // Focus the first invalid field after a submit attempt (DS §3.7).
  useEffect(() => {
    if (!focusTick) return;
    const el = bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (el) {
      el.focus();
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    }
  }, [focusTick]);

  const errors = useMemo(() => (form ? validateManualOrder(form) : {}), [form]);
  const dirty = !!form && formSnapshot(form) !== initialSnap;
  const currency = form?.currency || baseCurrency;
  const total = form ? manualOrderTotal(form.items) : 0;

  const errorFor = (name: string): string | null => {
    if (name === 'orderNumber' && form && duplicateOf && duplicateOf === form.orderNumber.trim()) return t('duplicate');
    const code: ManualErrorCode | undefined = errors[name];
    if (!code || !(submitted || touched.has(name))) return null;
    return t(`validation.${code}`);
  };
  const touch = (name: string) => setTouched((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));

  const set = <K extends keyof ManualOrderForm>(key: K, value: ManualOrderForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  const setItem = (index: number, patch: Partial<ManualOrderItemForm>) =>
    setForm((prev) => (prev ? { ...prev, items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) } : prev));
  const addItem = () => setForm((prev) => (prev ? { ...prev, items: [...prev.items, emptyItem(defaults.countryOfOrigin)] } : prev));
  const removeItem = (index: number) => {
    setForm((prev) => (prev && prev.items.length > 1 ? { ...prev, items: prev.items.filter((_, i) => i !== index) } : prev));
    // Item error keys are index-based: forget item blur state so errors do not jump to the next item.
    setTouched((prev) => new Set(Array.from(prev).filter((k) => !k.startsWith('items.'))));
  };
  const setCountry = (country: string | null) =>
    setForm((prev) => (prev ? { ...prev, country, state: stateAfterCountryChange(prev.country, country, prev.state) } : prev));

  const requestClose = useCallback(() => {
    if (submitting) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [dirty, submitting, onClose]);

  const submit = async () => {
    if (!form || submitting) return;
    setSubmitted(true);
    const count = Object.keys(errors).length;
    if (count > 0) {
      setBanner({ kind: 'fix', count });
      setFocusTick((x) => x + 1);
      return;
    }
    setBanner(null);
    setSubmitting(true);
    const payload = buildManualOrderPayload(form, baseCurrency);
    let status = 0;
    let body: unknown = null;
    try {
      const res = await fetch('/api/orders/manual', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    setSubmitting(false);
    const result = classifyManualResponse(status, body);
    if (result.kind === 'created') {
      setInitialSnap(formSnapshot(form));
      toast.success(t('created', { number: result.orderNumber || payload.orderNumber }));
      // manual.ts emits no live 'order' event, so refresh the sidebar "To ship" count here too.
      void mutate((key) => isOrdersKey(key) || key === NAV_COUNTS_KEY);
      onCreated(result.orderId);
      return;
    }
    if (result.kind === 'duplicate') {
      setDuplicateOf(payload.orderNumber);
      setFocusTick((x) => x + 1);
      return;
    }
    setBanner(result.kind === 'auth' ? { kind: 'auth' } : { kind: 'failed' });
  };

  const bannerNode =
    banner?.kind === 'fix' && Object.keys(errors).length > 0 ? (
      <Banner tone="danger" title={t('validation.fixFields', { count: Object.keys(errors).length })} />
    ) : banner?.kind === 'failed' ? (
      <Banner tone="danger" title={t('failed')}>{t('failedBody')}</Banner>
    ) : banner?.kind === 'auth' ? (
      <Banner tone="danger" title={t('failed')}>{t('sessionExpired')}</Banner>
    ) : null;

  const saveNote = form ? (
    <span data-testid="manual-total">
      {t('total', { amount: f.money(total, currency) })}
      {dirty ? ` · ${tOverlay('saveState.dirty')}` : ''}
    </span>
  ) : undefined;

  const stateOptions = form ? stateOptionsFor(form.country) : null;
  const selectedState = form && stateOptions ? stateOptions.find((s) => s.value === form.state) ?? null : null;
  const twoCol = { display: 'grid', gap: '16px', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } } as const;
  const stack = { display: 'flex', flexDirection: 'column', gap: '16px' } as const;

  return (
    <>
      <SidePanel
        open={open}
        onClose={requestClose}
        size="md"
        title={t('title')}
        data-testid="manual-order-panel"
        headerSlot={bannerNode ? <Box sx={{ px: '20px', pt: '12px' }}>{bannerNode}</Box> : undefined}
        saveNote={saveNote}
        secondary={{ id: 'manual-cancel', label: tOverlay('cancel'), onClick: requestClose, disabled: submitting }}
        primary={
          form
            ? { id: 'manual-create', label: t('submit'), onClick: () => void submit(), loading: submitting, loadingLabel: t('submitting'), shortcut: '⌘↵' }
            : undefined
        }
      >
        {!form ? (
          <PanelSkeleton sections={3} />
        ) : (
          <Box ref={bodyRef}>
            <SidePanelSection id="manual-customer" title={t('customer')}>
              <Box sx={stack}>
                <Field label={t('name')} error={errorFor('customerName')} onBlur={() => touch('customerName')} width="medium">
                  <TextField value={form.customerName} onChange={(v) => set('customerName', v)} autoComplete="off" />
                </Field>
                <Field label={t('email')} optional width="medium">
                  <TextField type="email" inputMode="email" value={form.customerEmail} onChange={(v) => set('customerEmail', v)} autoComplete="off" />
                </Field>
                <Field label={t('phone')} optional width="medium">
                  <PhoneInput value={form.customerPhone} onChange={(v) => set('customerPhone', v)} defaultCountry={form.country || defaults.country || 'TR'} />
                </Field>
                <Field
                  label={t('orderNumber')}
                  helper={t('orderNumberHint')}
                  error={errorFor('orderNumber')}
                  onBlur={() => touch('orderNumber')}
                  width="medium"
                >
                  <TextField mono value={form.orderNumber} onChange={(v) => set('orderNumber', v)} autoComplete="off" data-testid="manual-order-number" />
                </Field>
                <Field label={t('currency')} width="short">
                  <CurrencySelect
                    value={currency}
                    onChange={(c) => set('currency', c)}
                    defaultCurrency={baseCurrency}
                    data-testid="manual-currency"
                  />
                </Field>
              </Box>
            </SidePanelSection>

            <SidePanelSection id="manual-address" title={t('address')}>
              <Box sx={stack}>
                <Field label={t('country')} error={errorFor('country')} onBlur={() => touch('country')} width="medium">
                  <CountrySelect value={form.country} onChange={setCountry} defaultCountry={defaults.country || 'TR'} />
                </Field>
                <Field label={t('street1')} error={errorFor('street1')} onBlur={() => touch('street1')} width="long">
                  <TextField value={form.street1} onChange={(v) => set('street1', v)} autoComplete="off" />
                </Field>
                <Field label={t('street2')} optional width="long">
                  <TextField value={form.street2} onChange={(v) => set('street2', v)} autoComplete="off" />
                </Field>
                <Box sx={twoCol}>
                  <Field label={t('city')} error={errorFor('city')} onBlur={() => touch('city')}>
                    <TextField value={form.city} onChange={(v) => set('city', v)} autoComplete="off" />
                  </Field>
                  <Field label={t('postal')} error={errorFor('postal')} onBlur={() => touch('postal')} width="short">
                    <TextField value={form.postal} onChange={(v) => set('postal', v)} autoComplete="off" />
                  </Field>
                </Box>
                {stateOptions ? (
                  <Field
                    label={form.country === 'CA' ? t('province') : t('state')}
                    error={errorFor('state')}
                    onBlur={() => touch('state')}
                    width="medium"
                  >
                    <Combobox
                      value={selectedState ? { value: selectedState.value, label: selectedState.label, description: selectedState.value } : null}
                      onChange={(o) => set('state', o ? o.value : '')}
                      options={stateOptions.map((s) => ({ value: s.value, label: s.label, description: s.value }))}
                      data-testid="manual-state"
                    />
                  </Field>
                ) : (
                  <Field label={t('stateProvince')} optional width="medium">
                    <TextField value={form.state} onChange={(v) => set('state', v)} autoComplete="off" />
                  </Field>
                )}
              </Box>
            </SidePanelSection>

            <SidePanelSection id="manual-items" title={t('items')}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {form.items.map((item, i) => (
                  <Box
                    key={item.key}
                    data-testid={`manual-item-${i}`}
                    sx={{ ...stack, '& + &': { borderTop: `1px solid ${n[100]}`, pt: '20px' } }}
                  >
                    {form.items.length > 1 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 32 }}>
                        <Box component="span" sx={{ flex: 1, fontSize: 13, fontWeight: 500, color: n[700] }}>
                          {t('itemN', { n: i + 1 })}
                        </Box>
                        <IconButton
                          icon={icons.close}
                          label={t('removeItem')}
                          size="sm"
                          onClick={() => removeItem(i)}
                          data-testid={`manual-remove-item-${i}`}
                        />
                      </Box>
                    )}
                    <Field
                      label={t('productName')}
                      error={errorFor(`items.${i}.productName`)}
                      onBlur={() => touch(`items.${i}.productName`)}
                      width="long"
                    >
                      <TextField value={item.productName} onChange={(v) => setItem(i, { productName: v })} autoComplete="off" />
                    </Field>
                    <Field label={t('sku')} optional width="short">
                      <TextField mono value={item.sku} onChange={(v) => setItem(i, { sku: v })} autoComplete="off" />
                    </Field>
                    <Box sx={{ display: 'grid', gap: '16px', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' } }}>
                      <Field label={t('price')} error={errorFor(`items.${i}.unitPrice`)} onBlur={() => touch(`items.${i}.unitPrice`)}>
                        <MoneyField currency={currency} value={item.unitPrice} onChange={(v) => setItem(i, { unitPrice: v })} />
                      </Field>
                      <Field label={t('quantity')} error={errorFor(`items.${i}.quantity`)} onBlur={() => touch(`items.${i}.quantity`)}>
                        <NumberField value={item.quantity} onChange={(v) => setItem(i, { quantity: v })} min={1} step={1} />
                      </Field>
                      <Field label={t('weight')} error={errorFor(`items.${i}.weight`)} onBlur={() => touch(`items.${i}.weight`)}>
                        <NumberField value={item.weight} onChange={(v) => setItem(i, { weight: v })} min={0.01} step={0.1} decimals={3} unit="kg" />
                      </Field>
                    </Box>
                  </Box>
                ))}
                <Box>
                  <Button variant="ghost" size="sm" icon={icons.add} onClick={addItem} data-testid="manual-add-item">
                    {t('addItem')}
                  </Button>
                </Box>
              </Box>
            </SidePanelSection>
          </Box>
        )}
      </SidePanel>
      <ConfirmDialog
        open={confirmDiscard}
        nested
        title={t('discardTitle')}
        body={tOverlay('dirtyGuard.body')}
        confirmLabel={tOverlay('dirtyGuard.discard')}
        cancelLabel={tOverlay('dirtyGuard.keep')}
        tone="danger"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    </>
  );
}

/** FormField + blur tracking (validation on blur, DS §3.7). */
function Field({
  onBlur, children, ...rest
}: {
  label: string;
  error?: string | null;
  helper?: React.ReactNode;
  optional?: boolean;
  width?: 'short' | 'medium' | 'long' | 'full';
  onBlur?: () => void;
  children: React.ReactNode;
}) {
  return (
    <FormField {...rest}>
      <Box onBlur={onBlur} sx={{ width: '100%' }}>
        {children}
      </Box>
    </FormField>
  );
}

export default ManualOrderPanel;

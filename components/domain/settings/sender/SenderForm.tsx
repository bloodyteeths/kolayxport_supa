// components/domain/settings/sender/SenderForm.tsx — Settings › Sender profile (settings §6), DS parts only.
// Controlled: the values live in useSettings (group A); this form emits field changes with the same
// (name, value) contract as the legacy SenderProfilePanel, so `handleInputChange('shipperProfile', …)` still works.
// When `onSave` is passed the form owns the StickyActionBar (only while dirty) and validates before saving.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import ImporterFormCollapsible from '@/components/ImporterFormCollapsible';
import {
  Button, CountrySelect, CurrencySelect, PhoneInput, Select, Switch, TextField, FormField,
  type SelectOption,
} from '@/components/ds/inputs';
import { Section, StickyActionBar } from '@/components/ds/page';
import { ErrorState, PanelSkeleton } from '@/components/ds/state';
import { useShortcuts } from '@/lib/ds/useShortcuts';
import { useLocale } from '@/lib/i18n/useLocale';
import { fedexOptionsData, type FedExOption } from '@/lib/fedex/fedex.config';
import { neutral, px, space } from '@/lib/ds/tokens';
import { SettingsRow } from './SettingsRow';
import { LabelPreview } from './LabelPreview';
import { PanelHeading } from './PanelHeading';
import {
  COUNTRY_PRIORITY, LABEL_FALLBACK_CURRENCY, TIN_TYPES, errorCount, phoneForStorage, phoneToE164, senderCurrencies, tinTypeLabel,
  validateSender, type SenderErrors, type SenderField, type SenderProfile, type SenderShipping,
} from './senderModel';

export interface SenderFormProps {
  shipperProfile: SenderProfile;
  shippingSettings: SenderShipping;
  /** Same contract as the legacy panel: (shipperProfile field name, value). */
  onChangeProfile: (name: string, value: string) => void;
  /** (shippingSettings field name, value): `etgbRecipientEmail` string, `etgbEnabled` boolean. */
  onChangeShipping: (name: string, value: string | boolean) => void;
  importerJsonError: string | null;
  /** EN locale config: the ETGB card starts collapsed (`config.etgbProminence === 'collapsed'`). */
  etgbCollapsed: boolean;
  /** `loading` → form skeleton; `error` → ErrorState inline + Retry. Default `ready`. */
  state?: 'loading' | 'ready' | 'error';
  onRetry?: () => void;
  /** Save bar (rendered only when `onSave` is given and `dirty`). */
  dirty?: boolean;
  saving?: boolean;
  /** Called only when validation passes. */
  onSave?: () => void | Promise<unknown>;
  onDiscard?: () => void;
  /**
   * Show validation errors now (when the page owns the save bar: run `validateSender` before `saveSlice`
   * and pass true after a failed attempt). The form's own bar sets this itself.
   */
  showErrors?: boolean;
  /** Default true: the section title + description (settings §1.3). False when the page renders it. */
  heading?: boolean;
}

type FieldErrorKey = SenderField | 'etgbRecipientEmail';

export function SenderForm(props: SenderFormProps) {
  const {
    shipperProfile: p, shippingSettings: sh, onChangeProfile, onChangeShipping, importerJsonError, etgbCollapsed,
    state = 'ready', onRetry, dirty = false, saving = false, onSave, onDiscard, heading = true, showErrors = false,
  } = props;
  const t = useTranslations('settings.sender');
  const tSettings = useTranslations('settings');
  const tBar = useTranslations('settings.saveBar');
  const { config } = useLocale();
  const [attempted, setAttempted] = useState(false);
  const [etgbOpen, setEtgbOpen] = useState(!etgbCollapsed);

  const pv = (name: SenderField) => (typeof p?.[name] === 'string' ? (p[name] as string) : '');
  const errors: SenderErrors = useMemo(() => (attempted || showErrors ? validateSender(p, sh) : {}), [attempted, showErrors, p, sh]);
  const err = (k: FieldErrorKey): string | null => {
    const kind = errors[k];
    if (!kind) return null;
    return kind === 'email' ? t('error.email') : t('error.required');
  };

  const currencies = useMemo(() => senderCurrencies(config.currencyListFirst), [config.currencyListFirst]);
  const tinOptions: SelectOption<string>[] = useMemo(() => TIN_TYPES.map((c) => ({ value: c, label: tinTypeLabel(c) })), []);
  const partyLabel = useCallback(
    (group: 'paymentParty' | 'shippingChargesParty', opt: FedExOption) => {
      const key = `${group}.${opt.value}`;
      return tSettings.has(key as never) ? tSettings(key as never) : opt.label;
    },
    [tSettings],
  );
  const dutiesOptions = useMemo(
    () => (fedexOptionsData.dutiesPaymentTypes as FedExOption[]).map((o) => ({ value: o.value, label: partyLabel('paymentParty', o) })),
    [partyLabel],
  );
  const chargesOptions = useMemo(
    () => (fedexOptionsData.shippingChargesPaymentTypes as FedExOption[]).map((o) => ({ value: o.value, label: partyLabel('shippingChargesParty', o) })),
    [partyLabel],
  );

  const country = pv('shipperCountryCode') || 'TR';
  const storedPhone = pv('shipperPhoneNumber');
  // PhoneInput is controlled with E.164 but storage is digits only, and digits alone are ambiguous while the
  // user is typing ("905" reads as national → "+90905"). Keep the last emitted E.164 and use it while the stored
  // value is still what we wrote; re-derive from storage only when it changed elsewhere (load, discard).
  const [typedPhone, setTypedPhone] = useState<string | null>(null);
  const phoneValue = useMemo(
    () => (typedPhone !== null && phoneForStorage(typedPhone) === storedPhone ? typedPhone : phoneToE164(storedPhone, country)),
    [typedPhone, storedPhone, country],
  );
  const onPhoneChange = useCallback((e164: string) => {
    setTypedPhone(e164);
    onChangeProfile('shipperPhoneNumber', phoneForStorage(e164));
  }, [onChangeProfile]);

  const save = useCallback(async () => {
    if (!onSave || saving) return;
    setAttempted(true);
    const e = validateSender(p, sh);
    if (errorCount(e) > 0) {
      if (e.etgbRecipientEmail) setEtgbOpen(true);
      const first = Object.keys(e)[0];
      if (typeof document !== 'undefined') {
        const el = document.querySelector<HTMLElement>(`[data-sender-field="${first}"] input, [data-sender-field="${first}"] [role="combobox"]`);
        el?.focus();
      }
      return;
    }
    await onSave();
  }, [onSave, saving, p, sh]);

  const discard = useCallback(() => {
    setAttempted(false);
    onDiscard?.();
  }, [onDiscard]);

  useShortcuts({ 'mod+s': { handler: () => { void save(); }, allowInInput: true, enabled: Boolean(onSave) && dirty } }, { scope: 'page', enabled: Boolean(onSave) });

  const head = heading ? <PanelHeading title={t('title')} description={t('description')} /> : null;
  if (state === 'loading') return <div data-testid="sender-form">{head}<PanelSkeleton sections={4} data-testid="sender-skeleton" /></div>;
  if (state === 'error') {
    return <div data-testid="sender-form">{head}<ErrorState variant="inline" title={t('loadFailed')} onRetry={onRetry} /></div>;
  }

  const fieldWrap = (name: FieldErrorKey, node: ReactNode) => <div data-sender-field={name}>{node}</div>;
  const text = (name: SenderField, label: string, opts: { optional?: boolean; width?: 'short' | 'medium' | 'long'; inputMode?: 'numeric' | 'text' } = {}) => (
    <SettingsRow label={label} optional={opts.optional} required={!opts.optional} error={err(name)} width={opts.width ?? 'medium'} data-testid={`sender-row-${name}`}>
      {(id) => fieldWrap(name, (
        <TextField id={id} name={name} value={pv(name)} onChange={(v) => onChangeProfile(name, v)} invalid={Boolean(err(name))} inputMode={opts.inputMode} />
      ))}
    </SettingsRow>
  );

  const missing = errorCount(errors);
  const showBar = Boolean(onSave) && (dirty || missing > 0);

  return (
    <div data-testid="sender-form">
      {head}
      <Section variant="card" id="sender-business" title={t('group.business')}>
        {text('shipperName', t('field.companyName'), { width: 'long' })}
        {text('shipperPersonName', t('field.authorizedPerson'))}
        <SettingsRow label={t('field.phone')} required error={err('shipperPhoneNumber')} data-testid="sender-row-shipperPhoneNumber">
          {(id) => fieldWrap('shipperPhoneNumber', (
            <PhoneInput id={id} value={phoneValue} defaultCountry={country} invalid={Boolean(err('shipperPhoneNumber'))} onChange={onPhoneChange} />
          ))}
        </SettingsRow>
        <SettingsRow label={t('field.taxNumber')} required error={err('shipperTinNumber') ?? err('shipperTinType')} bare data-testid="sender-row-shipperTinNumber">
          {() => (
            <div style={{ display: 'flex', gap: px(space[2]), flexWrap: 'wrap', maxWidth: 400 }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }} data-sender-field="shipperTinNumber">
                <FormField label={t('field.taxNumber')} hideLabel required error={err('shipperTinNumber')}>
                  <TextField name="shipperTinNumber" value={pv('shipperTinNumber')} onChange={(v) => onChangeProfile('shipperTinNumber', v)} invalid={Boolean(err('shipperTinNumber'))} />
                </FormField>
              </div>
              <div style={{ flex: '0 1 160px', minWidth: 0 }} data-sender-field="shipperTinType">
                <FormField label={t('field.taxType')} hideLabel required error={err('shipperTinType')}>
                  <Select<string>
                    value={pv('shipperTinType') || null}
                    onChange={(v) => onChangeProfile('shipperTinType', v)}
                    options={tinOptions}
                    placeholder={t('field.taxType')}
                    invalid={Boolean(err('shipperTinType'))}
                    fullWidth
                  />
                </FormField>
              </div>
            </div>
          )}
        </SettingsRow>
      </Section>

      <Section variant="card" id="sender-address" title={t('group.address')}>
        {text('shipperStreet1', t('field.address1'), { width: 'long' })}
        {text('shipperStreet2', t('field.address2'), { width: 'long', optional: true })}
        {text('shipperCity', t('field.city'))}
        {text('shipperStateCode', t('field.stateRegion'), { optional: true, width: 'short' })}
        {text('shipperPostalCode', t('field.postalCode'), { width: 'short' })}
        <SettingsRow label={t('field.country')} required error={err('shipperCountryCode')} data-testid="sender-row-shipperCountryCode">
          {(id) => fieldWrap('shipperCountryCode', (
            <CountrySelect id={id} value={pv('shipperCountryCode') || null} onChange={(c) => onChangeProfile('shipperCountryCode', c ?? '')} priority={COUNTRY_PRIORITY} invalid={Boolean(err('shipperCountryCode'))} />
          ))}
        </SettingsRow>
        <SettingsRow label={t('labelPreview')} bare data-testid="sender-row-preview">
          {() => <LabelPreview profile={p} />}
        </SettingsRow>
      </Section>

      <Section variant="card" id="sender-customs" title={t('group.customs')}>
        <SettingsRow label={t('field.defaultCurrency')} helper={pv('defaultCurrencyCode') ? undefined : t('currencyDefaultHelp', { currency: LABEL_FALLBACK_CURRENCY })} width="short" data-testid="sender-row-defaultCurrencyCode">
          {(id) => (
            <CurrencySelect
              id={id}
              value={pv('defaultCurrencyCode') || null}
              onChange={(c) => onChangeProfile('defaultCurrencyCode', c ?? '')}
              currencies={currencies}
              defaultCurrency={config.currencyListFirst}
            />
          )}
        </SettingsRow>
        <SettingsRow label={t('field.dutiesPaidBy')} width="short" data-testid="sender-row-dutiesPaymentType">
          {(id) => (
            <Select<string> id={id} value={pv('dutiesPaymentType') || 'SENDER'} onChange={(v) => onChangeProfile('dutiesPaymentType', v)} options={dutiesOptions} fullWidth />
          )}
        </SettingsRow>
        <SettingsRow label={t('field.shippingPaidBy')} width="short" data-testid="sender-row-defaultShippingChargesPaymentType">
          {(id) => (
            <Select<string> id={id} value={pv('defaultShippingChargesPaymentType') || 'SENDER'} onChange={(v) => onChangeProfile('defaultShippingChargesPaymentType', v)} options={chargesOptions} fullWidth />
          )}
        </SettingsRow>
        {text('fedexFolderId', t('field.fedexFolderId'), { optional: true })}
      </Section>

      <Section variant="card" id="sender-importer" title={t('group.importer')} description={t('importerHelp')}>
        <ImporterFormCollapsible
          value={pv('importerOfRecord')}
          onChange={(json: string) => onChangeProfile('importerOfRecord', json)}
          error={importerJsonError}
        />
      </Section>

      <Section
        variant="card"
        id="sender-etgb"
        title={t('group.etgb')}
        description={tSettings('etgbDesc')}
        headerSlot={!etgbOpen ? <Button variant="ghost" size="sm" onClick={() => setEtgbOpen(true)} data-testid="sender-etgb-edit">{t('edit')}</Button> : undefined}
      >
        {etgbOpen ? (
          <div data-testid="sender-etgb-body">
            <SettingsRow label={t('etgbSwitch')} helper={tSettings('etgbFeatureHelper')} data-testid="sender-row-etgbEnabled">
              {(id) => (
                <Switch id={id} checked={Boolean(sh?.etgbEnabled)} onChange={(on) => onChangeShipping('etgbEnabled', on)} />
              )}
            </SettingsRow>
            {sh?.etgbEnabled ? (
              <SettingsRow label={t('field.etgbRecipientEmail')} required helper={tSettings('etgbRecipientEmailHelper')} error={err('etgbRecipientEmail')} data-testid="sender-row-etgbRecipientEmail">
                {(id) => fieldWrap('etgbRecipientEmail', (
                  <TextField id={id} type="email" inputMode="email" autoComplete="email" name="etgbRecipientEmail" value={sh?.etgbRecipientEmail || ''} onChange={(v) => onChangeShipping('etgbRecipientEmail', v)} invalid={Boolean(err('etgbRecipientEmail'))} />
                ))}
              </SettingsRow>
            ) : null}
          </div>
        ) : (
          <div style={{ color: neutral[500], fontSize: 13 }} data-testid="sender-etgb-summary">
            {sh?.etgbEnabled ? t('etgbOn', { email: sh?.etgbRecipientEmail || '—' }) : t('etgbOff')}
          </div>
        )}
      </Section>

      {onSave ? (
        <StickyActionBar
          visible={showBar}
          ariaLabel={t('title')}
          status={missing > 0 ? t('fixFields', { count: missing }) : tBar('status')}
          secondary={onDiscard ? { id: 'sender-discard', label: tBar('discard'), onClick: discard, disabled: saving } : undefined}
          primary={{ id: 'sender-save', label: tBar('save'), onClick: () => { void save(); }, loading: saving, loadingLabel: tBar('saving'), shortcut: 'mod+s' }}
          data-testid="sender-save-bar"
        />
      ) : null}
    </div>
  );
}

export default SenderForm;

// components/domain/listings/bulk/SetFieldModal.tsx — Etsy "Set field…" (bulk bar, listings grid).
// Port of the legacy BulkEditor's per-field bulk edits that the grid had no home for: shipping profile, return
// policy, processing profile, category, who made / when made / what it is, materials (replace / add / remove),
// description (replace / add before / add after), personalization (one text question, or off), weight and size.
// One field per run (Modal sm: the field picker plus at most four value inputs). Primary STAGES the value on every selected
// listing's draft (`fieldPatch` keys of the draft service, through the Etsy staging adapter); nothing reaches Etsy
// until the seller sends. Shop lists come from the editor's loaders (listing-editor/sections/etsyShared.ts) and are
// fetched only while the modal is open.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { Button, Checkbox, FormField, NumberField, SegmentedControl, Select, TagInput, TextArea } from '@/components/ds/inputs';
import { useToast } from '@/components/ds/feedback/toast';
import { neutral } from '@/lib/ds/tokens';
import { WHEN_MADE_OPTIONS } from '@/lib/etsy/validation';
import type { ListingRow } from '@/lib/listings/types';
import { CategoryCombobox } from '@/components/domain/listing-editor/sections/CategoryCombobox';
import {
  DIMENSION_UNITS,
  MATERIAL_MAX,
  MATERIAL_MAX_LEN,
  WEIGHT_UNITS,
  WHO_MADE_I18N,
  WHO_MADE_VALUES,
  useEtsyShopMeta,
  type ReadinessStateOption,
  type ReturnPolicyOption,
  type ShopMetaList,
} from '@/components/domain/listing-editor/sections/etsyShared';
import type { ExtendedStagePatch } from '../useStagedChanges';

// ─── Pure model (unit-tested) ─────────────────────────────────────────────────────────────────────────────

/** Fields this modal sets. Order = picker order (the ones sellers change across many listings first). */
export const SET_FIELD_KEYS = ['shipping', 'returnPolicy', 'processing', 'category', 'itemDetails', 'materials', 'description', 'personalization', 'weight', 'dimensions'] as const;
export type SetFieldKey = (typeof SET_FIELD_KEYS)[number];

export type SetFieldValue = {
  shippingProfileId?: number | null;
  returnPolicyId?: number | null;
  readinessStateId?: number | null;
  taxonomyId?: number | null;
  whoMade?: string | null;
  whenMade?: string | null;
  /** 'product' | 'supply'. */
  supply?: 'product' | 'supply' | null;
  materials?: string[];
  /** Materials: replace the list (default), or add / remove these materials on each listing's own list. */
  materialsMode?: MaterialsMode;
  /** Description text: replaces the description, or is added before / after each listing's own description. */
  description?: string;
  descriptionMode?: DescriptionMode;
  /** Personalization: one text question (legacy bulk "simple personalization"), or off. */
  personalization?: 'on' | 'off' | null;
  personalizationRequired?: boolean;
  personalizationInstructions?: string;
  personalizationMaxChars?: number | null;
  weight?: number | null;
  weightUnit?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  dimensionsUnit?: string | null;
};

export type MaterialsMode = 'replace' | 'add' | 'remove';

/**
 * A listing's materials after an add / remove (pure). Case-insensitive, keeps the listing's order, adds at the
 * end, caps at Etsy's limits. Null when nothing changes.
 */
export function applyMaterialsMode(current: readonly string[], list: readonly string[], mode: Exclude<MaterialsMode, 'replace'>): string[] | null {
  const key = (s: string) => s.trim().toLocaleLowerCase('tr');
  const wanted = list.map((m) => m.trim()).filter(Boolean);
  let next: string[];
  if (mode === 'add') {
    next = [...current];
    for (const m of wanted) if (!next.some((c) => key(c) === key(m))) next.push(m.slice(0, MATERIAL_MAX_LEN));
    next = next.slice(0, MATERIAL_MAX);
  } else {
    const drop = new Set(wanted.map(key));
    next = current.filter((c) => !drop.has(key(c)));
  }
  return next.length === current.length && next.every((m, i) => m === current[i]) ? null : next;
}

export type DescriptionMode = 'replace' | 'prepend' | 'append';

/** Etsy's description limit (characters). */
export const ETSY_DESCRIPTION_MAX = 102400;

/** A listing's description after adding `text` before / after it (pure). Blank line between. Null when too long. */
export function applyDescriptionMode(current: string, text: string, mode: Exclude<DescriptionMode, 'replace'>): string | null {
  const add = text.trim();
  if (!add) return null;
  const base = current.trim();
  const next = !base ? add : mode === 'prepend' ? `${add}\n\n${base}` : `${base}\n\n${add}`;
  return next.length > ETSY_DESCRIPTION_MAX ? null : next;
}

/** Etsy personalization limits (PersonalizationEditor's checks). */
export const PERSONALIZATION_LIMITS = { instructionsMax: 120, maxCharsMin: 1, maxCharsMax: 1024, maxCharsDefault: 256 } as const;

/**
 * The patch for one "Set field" value, placed where the Etsy staging adapter reads it (pure): description →
 * `description`, personalization → `etsy.personalization`, everything else → `etsy.fields`.
 */
export function setFieldStagePatch(key: SetFieldKey, patch: Record<string, unknown>): ExtendedStagePatch {
  if (key === 'description') return { description: String(patch.description ?? '') };
  if (key === 'personalization') return { etsy: { personalization: patch } };
  return { etsy: { fields: patch } };
}

const pos = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const id = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isInteger(n) && n !== 0;

/**
 * The draft `fieldPatch` for one run, or null when the value is not complete yet (the primary stays disabled).
 * Keys and shapes match the editor's payload (listing-editor/adapters/etsy.ts `buildEtsyEditPayload`).
 */
export function buildSetFieldPatch(key: SetFieldKey, v: SetFieldValue): Record<string, unknown> | null {
  switch (key) {
    case 'shipping':
      return id(v.shippingProfileId) ? { shipping_profile_id: v.shippingProfileId } : null;
    case 'returnPolicy':
      return id(v.returnPolicyId) ? { return_policy_id: v.returnPolicyId } : null;
    case 'processing':
      return id(v.readinessStateId) ? { readiness_state_id: v.readinessStateId } : null;
    case 'category':
      return id(v.taxonomyId) && v.taxonomyId > 0 ? { taxonomy_id: v.taxonomyId } : null;
    case 'itemDetails': {
      const out: Record<string, unknown> = {};
      if (v.whoMade) out.who_made = v.whoMade;
      if (v.whenMade) out.when_made = v.whenMade;
      if (v.supply) out.is_supply = v.supply === 'supply';
      return Object.keys(out).length ? out : null;
    }
    case 'materials': {
      const list = (v.materials ?? []).map((m) => m.trim()).filter(Boolean).slice(0, MATERIAL_MAX).map((m) => m.slice(0, MATERIAL_MAX_LEN));
      return list.length ? { materials: list } : null;
    }
    case 'description': {
      const text = (v.description ?? '').trim();
      return text && text.length <= ETSY_DESCRIPTION_MAX ? { description: text } : null;
    }
    case 'personalization': {
      if (v.personalization === 'off') return { remove: true };
      if (v.personalization !== 'on') return null;
      const max = v.personalizationMaxChars ?? PERSONALIZATION_LIMITS.maxCharsDefault;
      const instructions = (v.personalizationInstructions ?? '').trim();
      if (instructions.length > PERSONALIZATION_LIMITS.instructionsMax) return null;
      if (!Number.isInteger(max) || max < PERSONALIZATION_LIMITS.maxCharsMin || max > PERSONALIZATION_LIMITS.maxCharsMax) return null;
      return {
        personalization_questions: [
          {
            question_type: 'text_input',
            question_text: 'Personalization',
            required: Boolean(v.personalizationRequired),
            ...(instructions ? { instructions } : {}),
            max_allowed_characters: max,
          },
        ],
      };
    }
    case 'weight':
      return pos(v.weight) && v.weightUnit ? { item_weight: v.weight, item_weight_unit: v.weightUnit } : null;
    case 'dimensions':
      return pos(v.length) && pos(v.width) && pos(v.height) && v.dimensionsUnit
        ? { item_length: v.length, item_width: v.width, item_height: v.height, item_dimensions_unit: v.dimensionsUnit }
        : null;
    default:
      return null;
  }
}

/** Rows a field can be staged on (pure): a queued removal must stay the draft's only change. */
export function setFieldTargets(rows: ListingRow[]): ListingRow[] {
  return rows.filter((r) => !(r.sync?.queuedDelete && r.sync.status !== 'synced'));
}

// ─── Component ────────────────────────────────────────────────────────────────────────────────────────────

export type SetFieldModalProps = {
  open: boolean;
  onClose: () => void;
  rows: ListingRow[];
  /** Etsy shop id (shop lists, taxonomy). */
  shopId: string | null;
  onStage: (patches: Array<{ id: string; patch: ExtendedStagePatch }>) => Promise<{ ok: string[]; failed: string[] }>;
  /**
   * Live materials of these listings (the listings export), for "Add" / "Remove". Null for a listing the export
   * did not return. Without it only "Replace" is offered.
   */
  loadMaterials?: (rows: ListingRow[]) => Promise<Map<string, string[] | null>>;
  /** Live descriptions (the listings export), for "Add before" / "Add after". Without it only "Replace" is offered. */
  loadDescriptions?: (rows: ListingRow[]) => Promise<Map<string, string | null>>;
};

export function SetFieldModal(props: SetFieldModalProps) {
  // The body (and its four shop-list requests) mounts only while open.
  if (!props.open || !props.shopId) return null;
  return <SetFieldModalBody {...props} shopId={props.shopId} />;
}

const DEFAULT_VALUE: SetFieldValue = { weightUnit: 'g', dimensionsUnit: 'cm' };

function SetFieldModalBody({ onClose, rows, shopId, onStage, loadMaterials, loadDescriptions }: SetFieldModalProps & { shopId: string }) {
  const toast = useToast();
  const t = useTranslations('listings');
  const tl = useTranslations('listingEditor');
  const tEtsy = useTranslations('etsy');
  const meta = useEtsyShopMeta(shopId);
  const [key, setKey] = React.useState<SetFieldKey>('shipping');
  const [value, setValue] = React.useState<SetFieldValue>(DEFAULT_VALUE);
  const [busy, setBusy] = React.useState(false);
  const set = (patch: Partial<SetFieldValue>) => setValue((cur) => ({ ...cur, ...patch }));

  const targets = React.useMemo(() => setFieldTargets(rows), [rows]);
  const patch = buildSetFieldPatch(key, value);
  const count = patch ? targets.length : 0;

  const materialsMode: MaterialsMode = loadMaterials ? value.materialsMode ?? 'replace' : 'replace';
  const descriptionMode: DescriptionMode = loadDescriptions ? value.descriptionMode ?? 'replace' : 'replace';
  /** An unsent change of `field` on this row's draft (its staged value is not readable here). */
  const unsentField = (r: ListingRow, field: string) => Boolean(r.sync && r.sync.status !== 'synced' && r.sync.changedFields.includes(field));

  const stage = async () => {
    if (!patch || !targets.length || busy) return;
    setBusy(true);
    try {
      if (key === 'materials' && materialsMode !== 'replace' && loadMaterials) {
        // Add / remove works on each listing's own list. A listing whose materials have an unsent change is
        // skipped (its staged list is not readable here, and staging would replace it).
        const current = await loadMaterials(targets);
        const patches: Array<{ id: string; patch: ExtendedStagePatch }> = [];
        let skippedRows = 0;
        for (const r of targets) {
          const unsent = unsentField(r, 'materials');
          const cur = current.get(r.id);
          if (unsent || cur == null) {
            skippedRows++;
            continue;
          }
          const next = applyMaterialsMode(cur, value.materials ?? [], materialsMode);
          if (next) patches.push({ id: r.id, patch: { etsy: { fields: { materials: next } } } });
        }
        if (skippedRows) toast.info(t('setField.materialsSkipped', { count: skippedRows }));
        if (patches.length) await onStage(patches);
        else if (!skippedRows) toast.info(t('setField.materialsNoChange'));
      } else if (key === 'description' && descriptionMode !== 'replace' && loadDescriptions) {
        // Same rule as materials: a listing whose description has an unsent change is skipped.
        const current = await loadDescriptions(targets);
        const patches: Array<{ id: string; patch: ExtendedStagePatch }> = [];
        let skippedRows = 0;
        for (const r of targets) {
          const cur = current.get(r.id);
          const next = unsentField(r, 'description') || cur == null ? null : applyDescriptionMode(cur, value.description ?? '', descriptionMode);
          if (next === null) skippedRows++;
          else patches.push({ id: r.id, patch: { description: next } });
        }
        if (skippedRows) toast.info(t('setField.descriptionSkipped', { count: skippedRows }));
        if (patches.length) await onStage(patches);
      } else {
        await onStage(targets.map((r) => ({ id: r.id, patch: setFieldStagePatch(key, patch) })));
      }
      onClose();
    } catch {
      toast.error(t('tools.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const fieldLabel: Record<SetFieldKey, string> = {
    shipping: tl('field.shippingProfile'),
    returnPolicy: tl('field.returnPolicy'),
    processing: tl('field.processing'),
    category: tl('field.category'),
    itemDetails: t('setField.itemDetails'),
    materials: tl('field.materials'),
    description: tl('field.description'),
    personalization: t('setField.personalization'),
    weight: tl('field.weight'),
    dimensions: t('setField.dimensions'),
  };

  const loadFailed = (list: ShopMetaList<unknown>) =>
    list.status === 'error' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 12, color: neutral[600] }}>
        {tl('field.profilesLoadFailed')}
        <Button variant="ghost" size="sm" onClick={list.retry}>
          {tl('save.retry')}
        </Button>
      </Box>
    ) : null;

  const policyLabel = (p: ReturnPolicyOption) => {
    const base =
      !p.accepts_returns && !p.accepts_exchanges
        ? tl('returnForm.none')
        : p.accepts_returns && p.accepts_exchanges
          ? tl('returnForm.returnsAndExchanges')
          : p.accepts_returns
            ? tl('returnForm.returnsOnly')
            : tl('returnForm.exchangesOnly');
    return p.return_deadline && (p.accepts_returns || p.accepts_exchanges) ? `${base} · ${tl('returnForm.days', { count: p.return_deadline })}` : base;
  };
  const readinessLabel = (s: ReadinessStateOption) => {
    const state = s.readiness_state === 'ready_to_ship' ? tEtsy('processingProfile.readyToShip') : tEtsy('processingProfile.madeToOrder');
    const range = s.min_processing_days != null && s.max_processing_days != null
      ? tEtsy('processingProfile.daysRange', { min: s.min_processing_days, max: s.max_processing_days })
      : s.processing_days_display_label || tEtsy('processingProfile.daysRange', { min: s.min_processing_days ?? '?', max: s.max_processing_days ?? '?' });
    return `${state} · ${range}`;
  };
  const keep = { value: '', label: t('setField.keep') };

  const body = (() => {
    switch (key) {
      case 'shipping':
        return (
          <FormField label={tl('field.shippingProfile')} helper={loadFailed(meta.shippingProfiles)}>
            <Select<string>
              value={value.shippingProfileId ? String(value.shippingProfileId) : null}
              onChange={(v) => set({ shippingProfileId: Number(v) || null })}
              placeholder={tl('field.choose')}
              options={meta.shippingProfiles.items.map((p) => ({ value: String(p.shipping_profile_id), label: p.title }))}
              data-testid="set-field-shipping"
            />
          </FormField>
        );
      case 'returnPolicy':
        return (
          <FormField label={tl('field.returnPolicy')} helper={loadFailed(meta.returnPolicies)}>
            <Select<string>
              value={value.returnPolicyId ? String(value.returnPolicyId) : null}
              onChange={(v) => set({ returnPolicyId: Number(v) || null })}
              placeholder={tl('field.choose')}
              options={meta.returnPolicies.items.map((p) => ({ value: String(p.return_policy_id), label: policyLabel(p) }))}
              data-testid="set-field-return"
            />
          </FormField>
        );
      case 'processing':
        return (
          <FormField label={tl('field.processing')} helper={loadFailed(meta.readinessStates) ?? tl('field.processingHelper')}>
            <Select<string>
              value={value.readinessStateId ? String(value.readinessStateId) : null}
              onChange={(v) => set({ readinessStateId: Number(v) || null })}
              placeholder={tl('field.choose')}
              options={meta.readinessStates.items.map((s) => ({ value: String(s.readiness_state_id), label: readinessLabel(s) }))}
              data-testid="set-field-processing"
            />
          </FormField>
        );
      case 'category':
        return (
          <FormField label={tl('field.category')} helper={t('setField.categoryHelp')}>
            <CategoryCombobox shopId={shopId} value={value.taxonomyId ?? ''} onChange={(v) => set({ taxonomyId: v === '' ? null : v })} />
          </FormField>
        );
      case 'itemDetails':
        return (
          <>
            <FormField label={tl('field.whoMade')}>
              <Select<string>
                value={value.whoMade ?? ''}
                onChange={(v) => set({ whoMade: v || null })}
                options={[keep, ...WHO_MADE_VALUES.map((v) => ({ value: v, label: tEtsy(`whoMade.${WHO_MADE_I18N[v]}`) }))]}
                data-testid="set-field-who"
              />
            </FormField>
            <FormField label={tl('field.whenMade')}>
              <Select<string>
                value={value.whenMade ?? ''}
                onChange={(v) => set({ whenMade: v || null })}
                options={[keep, ...WHEN_MADE_OPTIONS.map((o) => ({ value: o.value, label: tEtsy(`whenMade.${o.labelKey}`) }))]}
                data-testid="set-field-when"
              />
            </FormField>
            <FormField label={tl('field.whatIsIt')}>
              <Select<string>
                value={value.supply ?? ''}
                onChange={(v) => set({ supply: v === 'product' || v === 'supply' ? v : null })}
                options={[keep, { value: 'product', label: tl('field.finishedProduct') }, { value: 'supply', label: tl('field.supplyOrTool') }]}
                data-testid="set-field-supply"
              />
            </FormField>
          </>
        );
      case 'materials':
        return (
          <>
            {loadMaterials ? (
              <SegmentedControl<MaterialsMode>
                value={materialsMode}
                onChange={(m) => set({ materialsMode: m })}
                options={[
                  { value: 'replace', label: t('setField.materialsReplace') },
                  { value: 'add', label: t('setField.materialsAdd') },
                  { value: 'remove', label: t('setField.materialsRemove') },
                ]}
                aria-label={tl('field.materials')}
                data-testid="set-field-materials-mode"
              />
            ) : null}
            <FormField label={tl('field.materials')} helper={materialsMode === 'replace' ? t('setField.materialsHelp') : materialsMode === 'add' ? t('setField.materialsAddHelp') : t('setField.materialsRemoveHelp')}>
              <TagInput value={value.materials ?? []} onChange={(m) => set({ materials: m })} max={MATERIAL_MAX} maxLength={MATERIAL_MAX_LEN} data-testid="set-field-materials" />
            </FormField>
          </>
        );
      case 'description':
        return (
          <>
            {loadDescriptions ? (
              <SegmentedControl<DescriptionMode>
                value={descriptionMode}
                onChange={(m) => set({ descriptionMode: m })}
                options={[
                  { value: 'replace', label: t('setField.descriptionReplace') },
                  { value: 'prepend', label: t('setField.descriptionPrepend') },
                  { value: 'append', label: t('setField.descriptionAppend') },
                ]}
                aria-label={tl('field.description')}
                data-testid="set-field-description-mode"
              />
            ) : null}
            <FormField label={tl('field.description')} helper={descriptionMode === 'replace' ? t('setField.descriptionReplaceHelp') : t('setField.descriptionAddHelp')}>
              <TextArea value={value.description ?? ''} onChange={(d) => set({ description: d })} minRows={4} maxRows={12} maxLength={ETSY_DESCRIPTION_MAX} data-testid="set-field-description" />
            </FormField>
          </>
        );
      case 'personalization':
        return (
          <>
            <FormField label={t('setField.personalization')}>
              <Select<string>
                value={value.personalization ?? ''}
                onChange={(v) => set({ personalization: v === 'on' || v === 'off' ? v : null })}
                options={[keep, { value: 'on', label: t('setField.personalizationOn') }, { value: 'off', label: t('setField.personalizationOff') }]}
                data-testid="set-field-personalization"
              />
            </FormField>
            {value.personalization === 'on' ? (
              <>
                <Checkbox
                  checked={Boolean(value.personalizationRequired)}
                  onChange={(c) => set({ personalizationRequired: c })}
                  label={t('setField.personalizationRequired')}
                />
                <FormField label={t('setField.personalizationInstructions')} helper={t('setField.personalizationInstructionsHelp', { max: PERSONALIZATION_LIMITS.instructionsMax })}>
                  <TextArea
                    value={value.personalizationInstructions ?? ''}
                    onChange={(s) => set({ personalizationInstructions: s })}
                    minRows={2}
                    maxRows={4}
                    maxLength={PERSONALIZATION_LIMITS.instructionsMax}
                    data-testid="set-field-personalization-instructions"
                  />
                </FormField>
                <FormField label={t('setField.personalizationMaxChars')}>
                  <NumberField
                    value={value.personalizationMaxChars ?? PERSONALIZATION_LIMITS.maxCharsDefault}
                    onChange={(n) => set({ personalizationMaxChars: n })}
                    min={PERSONALIZATION_LIMITS.maxCharsMin}
                    max={PERSONALIZATION_LIMITS.maxCharsMax}
                    decimals={0}
                    data-testid="set-field-personalization-max"
                  />
                </FormField>
              </>
            ) : value.personalization === 'off' ? (
              <Box sx={{ fontSize: 12, lineHeight: '16px', color: neutral[600] }}>{t('setField.personalizationOffHelp')}</Box>
            ) : null}
          </>
        );
      case 'weight':
        return (
          <Box sx={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <FormField label={tl('field.weight')}>
              <NumberField value={value.weight ?? null} onChange={(n) => set({ weight: n })} min={0} decimals={3} data-testid="set-field-weight" />
            </FormField>
            <FormField label={tl('field.weightUnit')} hideLabel>
              <Select<string>
                value={value.weightUnit ?? 'g'}
                onChange={(u) => set({ weightUnit: u })}
                options={WEIGHT_UNITS.map((u) => ({ value: u, label: u }))}
                aria-label={tl('field.weightUnit')}
              />
            </FormField>
          </Box>
        );
      case 'dimensions':
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px', alignItems: 'flex-end' }}>
            <FormField label={tl('field.length')}>
              <NumberField value={value.length ?? null} onChange={(n) => set({ length: n })} min={0} decimals={2} data-testid="set-field-length" />
            </FormField>
            <FormField label={tl('field.width')}>
              <NumberField value={value.width ?? null} onChange={(n) => set({ width: n })} min={0} decimals={2} data-testid="set-field-width" />
            </FormField>
            <FormField label={tl('field.height')}>
              <NumberField value={value.height ?? null} onChange={(n) => set({ height: n })} min={0} decimals={2} data-testid="set-field-height" />
            </FormField>
            <FormField label={tl('field.dimensionsUnit')} hideLabel>
              <Select<string>
                value={value.dimensionsUnit ?? 'cm'}
                onChange={(u) => set({ dimensionsUnit: u })}
                options={DIMENSION_UNITS.map((u) => ({ value: u, label: u }))}
                aria-label={tl('field.dimensionsUnit')}
              />
            </FormField>
          </Box>
        );
      default:
        return null;
    }
  })();

  const skipped = rows.length - targets.length;

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t('setField.title', { count: rows.length })}
      description={t('setField.help')}
      primary={{
        id: 'stageSetField',
        label: t('setField.stage', { count }),
        onClick: () => void stage(),
        loading: busy,
        disabled: count === 0,
        disabledReason: count === 0 ? t('setField.pickValue') : undefined,
      }}
      data-testid="listings-set-field"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <FormField label={t('setField.field')}>
          <Select<SetFieldKey>
            value={key}
            onChange={(k) => {
              setKey(k);
              setValue(DEFAULT_VALUE);
            }}
            options={SET_FIELD_KEYS.map((k) => ({ value: k, label: fieldLabel[k] }))}
            data-testid="set-field-key"
          />
        </FormField>
        {body}
        {skipped > 0 ? (
          <Box sx={{ fontSize: 12, lineHeight: '16px', color: neutral[600] }}>{t('bulk.skippedRemovals', { count: skipped, kind: 'delete' })}</Box>
        ) : null}
      </Box>
    </Modal>
  );
}

export default SetFieldModal;

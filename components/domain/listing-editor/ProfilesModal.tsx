// components/domain/listing-editor/ProfilesModal.tsx — listing-editor §6.5 "Profiles", §4.1, §10 Group H; CRITIQUE U5.
// "Apply profile…" / "Save as profile…" (footer ⋯ and the Start faster card). Modal md: one profile Select plus a
// checkbox per section the profile holds (≤ 4 fields). Applying FILLS THE DRAFT ONLY: every field goes through the
// engine's setField (dirty markers, autosave stages it), one toast "Applied 'Baby blankets' · Undo". Nothing
// reaches the marketplace until the seller presses Send (Vela pushes profiles straight to live listings).
//
// Storage is the legacy ListingTemplates storage, read and written in the same format so profiles saved in the
// old drawer show up here and vice versa (components/{etsy,ebay}/ListingTemplates.tsx are import-only; their
// storage helpers are not exported, so the key + shape are mirrored here):
//   Etsy  localStorage['etsy_listing_templates'] = ListingTemplate[]
//   eBay  localStorage['ebay_listing_templates'] = EbayListingTemplate[]
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select } from '@/components/ds/inputs/Select';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { TextField } from '@/components/ds/inputs/TextField';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { useToast } from '@/components/ds/feedback/toast';
import { useFormatters } from '@/lib/format';
import { neutral } from '@/lib/ds/tokens';
import { decodeEntities } from '@/lib/text/decodeEntities';
import type { ListingTemplate } from '@/components/etsy/ListingTemplates';
import type { EbayListingTemplate } from '@/components/ebay/ListingTemplates';
import { decodeAspects, encodeAspects, toPriceString } from './adapters/ebay';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Pure model (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ProfileMarketplace = 'etsy' | 'ebay';
export type ProfileSection = 'title' | 'tags' | 'specifics' | 'price' | 'details' | 'shipping';

export interface StoredProfile {
  id: string;
  name: string;
  createdAt: string;
  fields: Record<string, unknown>;
}

export const PROFILE_STORAGE_KEY: Record<ProfileMarketplace, string> = {
  etsy: 'etsy_listing_templates',
  ebay: 'ebay_listing_templates',
};

/** Editor field keys per profile section (Etsy keys = EtsyEditorFields; eBay keys = EbayListingTemplate.fields). */
export const PROFILE_SECTIONS: Record<ProfileMarketplace, Array<{ id: ProfileSection; keys: string[] }>> = {
  etsy: [
    { id: 'title', keys: ['title', 'description'] },
    { id: 'tags', keys: ['tags', 'materials'] },
    { id: 'price', keys: ['price', 'quantity'] },
    { id: 'details', keys: ['who_made', 'when_made', 'is_supply', 'shop_section_id'] },
    {
      id: 'shipping',
      keys: [
        'shipping_profile_id', 'return_policy_id', 'processing_min', 'processing_max', 'item_weight', 'item_weight_unit',
        'item_length', 'item_width', 'item_height', 'item_dimensions_unit',
      ],
    },
  ],
  ebay: [
    { id: 'title', keys: ['title', 'description'] },
    { id: 'specifics', keys: ['aspects'] },
    { id: 'price', keys: ['price'] },
    { id: 'details', keys: ['condition', 'conditionDescription', 'categoryId', 'categoryName'] },
    { id: 'shipping', keys: ['listingPolicies'] },
  ],
};

/**
 * eBay keys the legacy template stores but the editor contract has no field for (EbayEditorFields): read for
 * section detection, never written into the draft (the category name follows from categoryId).
 */
const EBAY_STORE_ONLY: ReadonlySet<string> = new Set(['categoryName']);

/** Title & description are rarely what a profile is for: unchecked by default. */
const DEFAULT_OFF: ReadonlySet<ProfileSection> = new Set(['title']);

const hasValue = (v: unknown): boolean => {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(hasValue);
  return true;
};

/** Sections this profile holds at least one value for, in the editor's section order. */
export function profileSections(marketplace: ProfileMarketplace, profile: Pick<StoredProfile, 'fields'> | null | undefined): ProfileSection[] {
  if (!profile) return [];
  return PROFILE_SECTIONS[marketplace].filter((s) => s.keys.some((k) => hasValue(profile.fields?.[k]))).map((s) => s.id);
}

export function defaultSelection(sections: readonly ProfileSection[]): ProfileSection[] {
  const on = sections.filter((s) => !DEFAULT_OFF.has(s));
  return on.length ? on : [...sections];
}

/** Text from storage may carry Etsy entities ("one&#39;s"): decoded so they are never staged back. */
function cleanValue(v: unknown): unknown {
  if (typeof v === 'string') return decodeEntities(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? decodeEntities(x) : x));
  return v;
}

/**
 * Legacy eBay template value → the editor's field shape (adapters/ebay EbayEditorFields): `aspects` is the
 * encodeAspects string, `price` a decimal string. Returns undefined when nothing usable is stored.
 */
function ebayEditorValue(key: string, v: unknown): unknown {
  if (key === 'aspects') {
    const encoded = encodeAspects(decodeAspects(v as string | Record<string, unknown>));
    return encoded || undefined;
  }
  if (key === 'price') {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) && n > 0 ? toPriceString(n) : undefined;
  }
  return cleanValue(v);
}

/**
 * Editor value → the legacy EbayListingTemplate shape (components/ebay/ListingTemplates.tsx), so a profile saved
 * here still opens in the legacy drawer: `price?: number`, `aspects?: Record<string, string[]>`.
 */
function ebayStoredValue(key: string, v: unknown): unknown {
  if (key === 'aspects') {
    const map = decodeAspects(v as string | Record<string, unknown>);
    return Object.keys(map).length ? map : undefined;
  }
  if (key === 'price') {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
  }
  return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? decodeEntities(x) : x)) : cleanValue(v);
}

/**
 * Field patch for the chosen sections, in the editor's field shapes. eBay `listingPolicies` is flattened to
 * fulfillmentPolicyId / returnPolicyId / paymentPolicyId (the editor's offer field keys); eBay aspects / price are
 * converted from the legacy map / number; `categoryName` is not an editor field and is never written.
 */
export function buildProfilePatch(marketplace: ProfileMarketplace, profile: Pick<StoredProfile, 'fields'>, sections: readonly ProfileSection[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const s of PROFILE_SECTIONS[marketplace]) {
    if (!sections.includes(s.id)) continue;
    for (const k of s.keys) {
      const v = profile.fields?.[k];
      if (!hasValue(v)) continue;
      if (marketplace === 'ebay' && k === 'listingPolicies' && v && typeof v === 'object') {
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) if (hasValue(pv)) patch[pk] = pv;
        continue;
      }
      if (marketplace === 'ebay') {
        if (EBAY_STORE_ONLY.has(k)) continue;
        const ev = ebayEditorValue(k, v);
        if (ev !== undefined) patch[k] = ev;
        continue;
      }
      patch[k] = cleanValue(v);
    }
  }
  return patch;
}

/**
 * Profile fields from the current view for the chosen sections, in the legacy storage shape (eBay policies folded
 * back into listingPolicies, aspects as a map, price as a number).
 */
export function buildProfileFields(marketplace: ProfileMarketplace, current: Readonly<Record<string, unknown>>, sections: readonly ProfileSection[]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const s of PROFILE_SECTIONS[marketplace]) {
    if (!sections.includes(s.id)) continue;
    for (const k of s.keys) {
      if (marketplace === 'ebay' && k === 'listingPolicies') {
        const pol: Record<string, unknown> = {};
        for (const pk of ['fulfillmentPolicyId', 'paymentPolicyId', 'returnPolicyId']) if (hasValue(current[pk])) pol[pk] = current[pk];
        if (Object.keys(pol).length) fields.listingPolicies = pol;
        continue;
      }
      const v = current[k];
      if (!hasValue(v)) continue;
      if (marketplace === 'ebay') {
        const sv = ebayStoredValue(k, v);
        if (sv !== undefined) fields[k] = sv;
        continue;
      }
      fields[k] = Array.isArray(v) ? [...v] : cleanValue(v);
    }
  }
  return fields;
}

export function loadProfiles(marketplace: ProfileMarketplace, storage?: Pick<Storage, 'getItem'> | null): StoredProfile[] {
  try {
    const s = storage === undefined ? (typeof window !== 'undefined' ? window.localStorage : null) : storage;
    const raw = s?.getItem(PROFILE_STORAGE_KEY[marketplace]);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((p): p is StoredProfile => !!p && typeof p.id === 'string' && typeof p.name === 'string' && !!p.fields && typeof p.fields === 'object')
      .map((p) => ({ ...p, name: decodeEntities(p.name) }));
  } catch {
    return [];
  }
}

/**
 * Saves (or replaces, by case-insensitive name) a profile in the legacy storage. Returns the stored list, or null
 * when storage is unavailable (private window, quota) so the UI can say so.
 */
export function saveProfile(
  marketplace: ProfileMarketplace,
  name: string,
  fields: Record<string, unknown>,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
  now: Date = new Date(),
): StoredProfile[] | null {
  try {
    const s = storage === undefined ? (typeof window !== 'undefined' ? window.localStorage : null) : storage;
    if (!s) return null;
    const list = loadProfiles(marketplace, s);
    const trimmed = name.trim();
    const existing = list.find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
    const entry: StoredProfile = {
      id: existing?.id ?? `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      createdAt: now.toISOString(),
      fields,
    };
    const next = existing ? list.map((p) => (p.id === existing.id ? entry : p)) : [...list, entry];
    s.setItem(PROFILE_STORAGE_KEY[marketplace], JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

// Compile-time check that the mirrored shape stays compatible with the legacy types.
type _EtsyCompat = ListingTemplate extends { id: string; name: string; createdAt: string; fields: object } ? true : never;
type _EbayCompat = EbayListingTemplate extends { id: string; name: string; createdAt: string; fields: object } ? true : never;
export const __profileShapeCompat: [_EtsyCompat, _EbayCompat] = [true, true];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const PROFILE_NAME_MAX = 60;

export interface ProfilesModalProps {
  open: boolean;
  onClose: () => void;
  /** 'apply' = Apply profile… · 'save' = Save as profile… (the empty apply state offers a switch to save). */
  mode: 'apply' | 'save';
  marketplace: ProfileMarketplace;
  /** Current merged view fields (save) — `useListingEditor().view.fields`. */
  fields: Readonly<Record<string, unknown>>;
  /** Engine write (apply): marks the field dirty and schedules autosave. */
  setField(key: string, value: unknown): void;
  /** Engine read for Undo (defaults to `fields[key]`). */
  getField?(key: string): unknown;
  /** After a profile was applied (keys written), e.g. to hide the Start faster card. */
  onApplied?: (name: string, keys: string[]) => void;
  /** Test seam. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export function ProfilesModal({ open, onClose, mode: modeProp, marketplace, fields, setField, getField, onApplied, storage }: ProfilesModalProps) {
  const t = useTranslations('listingEditor');
  const fmt = useFormatters();
  const toast = useToast();
  const [mode, setMode] = useState(modeProp);
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sections, setSections] = useState<ProfileSection[]>([]);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const available = useMemo<ProfileSection[]>(() => {
    if (mode === 'save') return PROFILE_SECTIONS[marketplace].filter((s) => s.keys.some((k) => (k === 'listingPolicies'
      ? ['fulfillmentPolicyId', 'paymentPolicyId', 'returnPolicyId'].some((pk) => hasValue(fields[pk]))
      : hasValue(fields[k])))).map((s) => s.id);
    return profileSections(marketplace, profiles.find((p) => p.id === selectedId));
  }, [mode, marketplace, fields, profiles, selectedId]);

  useEffect(() => {
    if (!open) return;
    setMode(modeProp);
    const list = loadProfiles(marketplace, storage);
    setProfiles(list);
    const first = list[list.length - 1] ?? null; // newest last in legacy storage
    setSelectedId(first?.id ?? null);
    setName('');
    setSaveError(null);
  }, [open, modeProp, marketplace, storage]);

  // Section defaults follow the chosen profile (apply) or what the listing holds (save).
  useEffect(() => {
    setSections(mode === 'save' ? [...available] : defaultSelection(available));
  }, [available, mode]);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const toggle = (s: ProfileSection, on: boolean) => setSections((cur) => (on ? Array.from(new Set([...cur, s])) : cur.filter((x) => x !== s)));
  const sectionLabel = (s: ProfileSection) => t(s === 'title' ? 'section.title' : s === 'tags' ? 'section.tags' : s === 'specifics' ? 'section.specifics' : s === 'price' ? 'section.price' : s === 'details' ? 'section.details' : 'section.shipping');

  const apply = () => {
    if (!selected || !sections.length) return;
    const patch = buildProfilePatch(marketplace, selected, sections);
    const keys = Object.keys(patch);
    const read = getField ?? ((k: string) => fields[k]);
    const prev = Object.fromEntries(keys.map((k) => [k, read(k)]));
    for (const k of keys) setField(k, patch[k]);
    toast.success(t('profile.applied', { name: selected.name }), { undo: () => { for (const k of keys) setField(k, prev[k]); } });
    onApplied?.(selected.name, keys);
    onClose();
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || !sections.length) return;
    const stored = saveProfile(marketplace, trimmed, buildProfileFields(marketplace, fields, sections), storage);
    if (!stored) {
      setSaveError(t('profile.storageFailed'));
      return;
    }
    toast.success(t('profile.saved', { name: trimmed }));
    onClose();
  };

  const replaces = mode === 'save' && name.trim() !== '' && profiles.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
  const emptyApply = mode === 'apply' && profiles.length === 0;

  const sectionChecks = (
    <FormField label={t('profile.sections')} helper={available.length ? undefined : t('profile.nothingToSave')}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }} data-testid="le-profile-sections">
        {available.map((s) => (
          <Checkbox
            key={s}
            checked={sections.includes(s)}
            onChange={(on) => toggle(s, on)}
            label={sectionLabel(s)}
            data-testid={`le-profile-section-${s}`}
          />
        ))}
      </Box>
    </FormField>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={mode === 'apply' ? t('profile.title') : t('profile.saveTitle')}
      description={mode === 'apply' ? t('profile.applyHelp') : t('profile.saveHelp')}
      primary={mode === 'apply'
        ? {
            id: 'le-profile-apply',
            label: t('profile.apply'),
            onClick: apply,
            disabled: !selected || !sections.length,
            disabledReason: !selected ? t('profile.pick') : t('profile.pickSection'),
          }
        : {
            id: 'le-profile-save',
            label: t('profile.save'),
            onClick: save,
            disabled: !name.trim() || !sections.length,
            disabledReason: !name.trim() ? t('profile.nameRequired') : t('profile.pickSection'),
          }}
      data-testid="le-profiles-modal"
    >
      {emptyApply ? (
        <EmptyState
          kind="first-use"
          compact
          title={t('profile.emptyTitle')}
          body={t('profile.emptyBody')}
          action={{ id: 'le-profile-to-save', label: t('action.saveProfile'), onClick: () => setMode('save') }}
          data-testid="le-profile-empty"
        />
      ) : mode === 'apply' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField label={t('profile.pickLabel')}>
            <Select<string>
              value={selectedId}
              onChange={setSelectedId}
              options={[...profiles].reverse().map((p) => ({ value: p.id, label: p.name, description: t('profile.savedOn', { date: fmt.date(p.createdAt, 'date') }) }))}
              data-testid="le-profile-select"
            />
          </FormField>
          {selected ? sectionChecks : null}
          <Box sx={{ fontSize: 12, lineHeight: '16px', color: neutral[600] }}>{t('profile.draftOnly')}</Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField
            label={t('profile.name')}
            counter={{ value: name.length, max: PROFILE_NAME_MAX }}
            helper={replaces ? t('profile.replaces') : undefined}
            error={saveError}
          >
            <TextField value={name} onChange={(v) => { setName(v.slice(0, PROFILE_NAME_MAX)); setSaveError(null); }} autoFocus maxLength={PROFILE_NAME_MAX} data-testid="le-profile-name" />
          </FormField>
          {sectionChecks}
        </Box>
      )}
    </Modal>
  );
}

export default ProfilesModal;

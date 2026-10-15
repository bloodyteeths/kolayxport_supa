// lib/shipping/usePackagePresets.ts — orders §6.5 (A5: no server change). Presets live in
// `User.shippingSettings.packagePresets[]` (max 20). PATCH /api/user/settings REPLACES `shippingSettings`
// as a whole (settings.ts L91–112), so every write is read-merge-write: fetch the current object first,
// change only `packagePresets`, send everything else back untouched.
import { useCallback, useMemo } from 'react';
import { mutate as globalMutate } from 'swr';
import { MAX_PACKAGE_PRESETS, type PackagePreset } from './labelDraft';
import { USER_SETTINGS_KEY, fetchUserSettings, useSenderProfile, type ShippingSettingsJson } from './useSenderProfile';

export function sanitizePresets(list: unknown): PackagePreset[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p): p is PackagePreset => !!p && typeof p === 'object' && typeof (p as PackagePreset).name === 'string')
    .map((p) => ({ ...p, weightKg: Number(p.weightKg) || 0 }))
    .slice(0, MAX_PACKAGE_PRESETS);
}

/** Pure merge: add or replace by id; `isDefault` is exclusive; the list never exceeds the max (oldest dropped). */
export function mergePreset(current: readonly PackagePreset[], preset: PackagePreset): PackagePreset[] {
  const rest = current.filter((p) => p.id !== preset.id).map((p) => (preset.isDefault ? { ...p, isDefault: false } : p));
  const next = [...rest, preset];
  return next.length > MAX_PACKAGE_PRESETS ? next.slice(next.length - MAX_PACKAGE_PRESETS) : next;
}

/** Pure: the PATCH body that keeps every other `shippingSettings` key (ETGB email, etc.). */
export function presetsPatchBody(current: ShippingSettingsJson | null | undefined, presets: PackagePreset[]) {
  return { shippingSettings: { ...(current || {}), packagePresets: presets } };
}

export function newPresetId(): string {
  return `pp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface UsePackagePresets {
  presets: PackagePreset[];
  defaultPreset: PackagePreset | null;
  /** Read-merge-write. Resolves with the saved list; throws on HTTP failure. */
  save: (preset: Omit<PackagePreset, 'id'> & { id?: string }) => Promise<PackagePreset>;
}

export function usePackagePresets(enabled = true): UsePackagePresets {
  const { shippingSettings } = useSenderProfile(enabled);
  const presets = useMemo(() => sanitizePresets(shippingSettings.packagePresets), [shippingSettings.packagePresets]);

  const save = useCallback(async (input: Omit<PackagePreset, 'id'> & { id?: string }) => {
    const preset: PackagePreset = { ...input, id: input.id || newPresetId() };
    const fresh = await fetchUserSettings();
    const current = (fresh.shippingSettings || {}) as ShippingSettingsJson;
    const next = mergePreset(sanitizePresets(current.packagePresets), preset);
    const res = await fetch(USER_SETTINGS_KEY, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(presetsPatchBody(current, next)),
    });
    if (!res.ok) throw new Error(`settings ${res.status}`);
    await globalMutate(USER_SETTINGS_KEY);
    return preset;
  }, []);

  return { presets, defaultPreset: presets.find((p) => p.isDefault) ?? null, save };
}

export default usePackagePresets;

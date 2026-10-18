import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
// @ts-ignore
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// Mirrored from the /api/user/settings route — the GET body (and the PATCH payload shape).
export interface UserSettingsResponse {
  subscription?: {
    /** 'shopify_free' when billingProvider is shopify_free or the account has an active Shopify store. */
    subscriptionPlan: 'trial' | 'starter' | 'growth' | 'pro' | 'enterprise' | 'shopify_free' | null;
    subscriptionStatus: 'trialing' | 'active' | 'canceled' | 'past_due' | 'expired' | null;
    billingInterval: 'month' | 'year' | null;
    /** Effective provider: 'stripe' | 'shopify_free' | null (other legacy values pass through). */
    billingProvider?: 'stripe' | 'shopify_free' | string | null;
    trialExpiresAt: string | null;
    usageResetAt: string | null;
    orderSyncCount: number;
    labelCount: number;
    /**
     * Limits enforced for this plan/status (lib/billing/planLimits.ts getPlanLimits).
     * null = unlimited; 0 = blocked (no active subscription / invalid plan).
     * Optional so older cached responses still type-check.
     */
    limits?: { orderSync: number | null; label: number | null };
    /** Usage window the counters belong to: whole trial, monthly reset period, or none (unlimited/blocked). */
    period?: 'trial' | 'month' | null;
  };
  /** Free-form JSON on User (ETGB fields, package presets, …). Always saved as the whole object. */
  shippingSettings?: {
    etgbRecipientEmail?: string | null;
    etgbEnabled?: boolean;
    trendyolAutoPicking?: boolean;
    [key: string]: unknown;
  } | null;
  integrationSettings?: Record<string, string | null | undefined> | null;
  shipperProfile?: Record<string, string | null | undefined> | null;
  /**
   * Account preferences (settings §2.3 A6 / BUILD_PLAN BR-2). Present in the GET body only once the
   * backend serves it; until then `preferencesSupported` is false and `saveSlice('preferences')`
   * refuses to send (the server would silently drop the key).
   */
  preferences?: { timezone: string | null } | null;
}

/** The PATCH-backed parts of the payload. */
export type SettingsSlice = 'integrationSettings' | 'shipperProfile' | 'shippingSettings' | 'preferences';
export const SETTINGS_SLICES: readonly SettingsSlice[] = ['integrationSettings', 'shipperProfile', 'shippingSettings', 'preferences'];

/** Settings tabs whose content is a PATCH-backed form (settings §1.2). */
export type SettingsFormSection = 'apiKeys' | 'senderProfile' | 'preferences';
export const SECTION_SLICES: Record<SettingsFormSection, readonly SettingsSlice[]> = {
  apiKeys: ['integrationSettings'],
  senderProfile: ['shipperProfile', 'shippingSettings'],
  preferences: ['preferences'],
};

// GET /api/user/settings returns secret fields masked ('••••' + last 4).
// Mirrors SECRET_MASK_CHAR / SECRET_FIELDS in lib/encryption.ts (server-only module).
export const SECRET_MASK_CHAR = '•';

export function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.includes(SECRET_MASK_CHAR);
}

/** Never send a mask back as a new value: drop masked fields so the server keeps the stored secret. */
function withoutMaskedSecrets(data: UserSettingsResponse): UserSettingsResponse {
  if (!data.integrationSettings) return data;
  const integrationSettings = Object.fromEntries(
    Object.entries(data.integrationSettings).filter(([, v]) => !isMaskedSecret(v)),
  );
  return { ...data, integrationSettings };
}

// mngAppId / mngAppSecret / mngApiEnvironment and parasutBaseUrl / parasutRedirectUri are gone (settings
// §0.1, §16): the MNG client reads app id/secret/environment from env, and the Paraşüt URLs were never
// saved. The server PATCH still accepts and ignores them.
export const initialFormData: UserSettingsResponse = {
  shippingSettings: { etgbRecipientEmail: '', etgbEnabled: false },
  integrationSettings: {
    veeqoApiKey: '', shippoToken: '', trendyolApiKey: '', trendyolApiSecret: '', trendyolSupplierId: '',
    hepsiburadaMerchantId: '', hepsiburadaApiKey: '',
    fedexApiKey: '', fedexApiSecret: '', fedexAccountNumber: '', upsApiKey: '', upsApiSecret: '', upsAccountNumber: '',
    mngCustomerNumber: '', mngPassword: '',
    parasutClientId: '', parasutClientSecret: '', parasutUsername: '', parasutPassword: '', parasutCompanyId: '',
  },
  shipperProfile: {
    shipperName: '', shipperPersonName: '', shipperPhoneNumber: '', shipperStreet1: '', shipperStreet2: '',
    shipperCity: '', shipperStateCode: '', shipperPostalCode: '', shipperCountryCode: '', shipperTinNumber: '',
    shipperTinType: '', importerOfRecord: '', fedexFolderId: '', defaultCurrencyCode: 'USD',
    dutiesPaymentType: 'SENDER', defaultShippingChargesPaymentType: 'SENDER',
  },
  preferences: { timezone: null },
};

type SliceValue = Record<string, unknown>;

/** '' / null / undefined are the same "empty" value: a field typed and cleared again is not dirty. */
function normalizeValue(v: unknown): unknown {
  return v === '' || v === null || v === undefined ? null : v;
}

/** Known boolean fields where a missing key means `false` (free-form JSON columns, e.g. `etgbEnabled`). */
const BOOLEAN_FIELDS: Partial<Record<SettingsSlice, readonly string[]>> = {
  shippingSettings: ['etgbEnabled'],
};

function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeValue(a);
  const nb = normalizeValue(b);
  if (na === nb) return true;
  if (na && nb && typeof na === 'object' && typeof nb === 'object') return JSON.stringify(na) === JSON.stringify(nb);
  return false;
}

function asSlice(v: unknown): SliceValue {
  return v && typeof v === 'object' ? (v as SliceValue) : {};
}

/**
 * Pure: is `slice` (optionally only `fields` of it) different between the form and the last saved object?
 */
export function sliceDiffers(
  form: UserSettingsResponse,
  saved: UserSettingsResponse,
  slice: SettingsSlice,
  fields?: readonly string[],
): boolean {
  const f = asSlice(form[slice]);
  const s = asSlice(saved[slice]);
  const keys = fields ?? Array.from(new Set([...Object.keys(f), ...Object.keys(s)]));
  const bools = BOOLEAN_FIELDS[slice] ?? [];
  return keys.some((k) => (bools.includes(k) ? Boolean(f[k]) !== Boolean(s[k]) : !valuesEqual(f[k], s[k])));
}

/**
 * Pure: the PATCH body for a slice save (settings §5.2; `useSettings.saveSlice` tests).
 * - Only the named slices are sent; the server leaves the others untouched.
 * - `integrationSettings` (+ optional `fields`): only those fields; masked secrets are always stripped.
 * - `shipperProfile` + `fields`: only those fields, plus `defaultWeightKg` from the `saved` snapshot — the
 *   PATCH handler writes `defaultWeightKg: value ? parseFloat(value) : null`, so leaving it out would clear
 *   it (every other shipper field is left untouched when omitted).
 * - `shippingSettings` always goes as the whole object: the server replaces the JSON column.
 */
export function buildSlicePatch(
  form: UserSettingsResponse,
  slices: readonly SettingsSlice[],
  fields?: readonly string[],
  saved?: UserSettingsResponse,
): Partial<UserSettingsResponse> {
  const body: Partial<UserSettingsResponse> = {};
  for (const slice of slices) {
    const value = asSlice(form[slice]);
    if (slice === 'integrationSettings') {
      // A field missing from the form stays undefined (dropped by JSON = untouched server-side). To clear a
      // credential ("Remove credentials…"), set it to '' with setField first.
      const picked = fields ? Object.fromEntries(fields.filter((k) => value[k] !== undefined).map((k) => [k, value[k]])) : value;
      body.integrationSettings = withoutMaskedSecrets({ integrationSettings: picked as Record<string, string> }).integrationSettings;
    } else if (slice === 'shipperProfile') {
      const picked: SliceValue = fields ? Object.fromEntries(fields.filter((k) => value[k] !== undefined).map((k) => [k, value[k]])) : value;
      if (fields && !fields.includes('defaultWeightKg')) {
        const keep = asSlice((saved ?? form).shipperProfile).defaultWeightKg;
        if (keep !== undefined && keep !== null && keep !== '') picked.defaultWeightKg = keep;
      }
      body.shipperProfile = picked as Record<string, string>;
    } else if (slice === 'shippingSettings') {
      body.shippingSettings = value as UserSettingsResponse['shippingSettings'];
    } else if (slice === 'preferences') {
      body.preferences = { timezone: (value.timezone as string | null | undefined) || null };
    }
  }
  return body;
}

/** Result of `saveSlice`. Never carries raw server text: callers map `status` / `code` to i18n copy. */
export type SaveSliceResult =
  | { ok: true }
  | {
      ok: false;
      /** HTTP status when the server answered (402 = store limit, tiers plan). */
      status?: number;
      /**
       * Machine code from the body (`reason` / `code` / `error`, snake_case only — e.g. `invalid_preferences`
       * from this endpoint's 400), or 'unsupported' / 'network'.
       */
      code?: string;
    };

export interface SaveSliceOptions {
  /** Re-read the settings after a successful save (secrets come back masked). Default false. */
  refetch?: boolean;
}

function machineCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const snake = (v: unknown) => (typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(v) ? v : undefined);
  // `error` last: on other responses it carries human text ("Failed to …"), which the regex rejects.
  return snake(b.reason) ?? snake(b.code) ?? snake(b.error);
}

function pickSlices(data: UserSettingsResponse): UserSettingsResponse {
  return {
    shippingSettings: data.shippingSettings || initialFormData.shippingSettings,
    integrationSettings: data.integrationSettings || initialFormData.integrationSettings,
    shipperProfile: data.shipperProfile || initialFormData.shipperProfile,
    preferences: data.preferences || initialFormData.preferences,
  };
}

/** Owns the settings form lifecycle (load, edit, save) for the PATCH-backed slices. */
export function useSettings() {
  const t = useTranslations('settings');
  const [formData, setFormDataState] = useState<UserSettingsResponse>(initialFormData);
  const [subscriptionData, setSubscriptionData] = useState<UserSettingsResponse['subscription'] | null>(null);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importerJsonError, setImporterJsonError] = useState<string | null>(null);
  const [preferencesSupported, setPreferencesSupported] = useState(false);
  /** Bumped whenever `savedRef` changes so the dirty flags recompute. */
  const [savedVersion, setSavedVersion] = useState(0);

  /** The last object the server confirmed (load, refetch or a successful save). */
  const savedRef = useRef<UserSettingsResponse>(initialFormData);
  const formRef = useRef<UserSettingsResponse>(initialFormData);
  formRef.current = formData;
  const tRef = useRef(t);
  tRef.current = t;

  const setFormData = useCallback((next: UserSettingsResponse | ((prev: UserSettingsResponse) => UserSettingsResponse)) => {
    setFormDataState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      formRef.current = value;
      return value;
    });
  }, []);

  const setSaved = useCallback((next: UserSettingsResponse) => {
    savedRef.current = next;
    setSavedVersion((v) => v + 1);
  }, []);

  const load = useCallback(async (mode: 'initial' | 'refetch'): Promise<boolean> => {
    if (mode === 'initial') setIsLoading(true);
    setFetchError(null);
    try {
      const response = await axios.get<UserSettingsResponse>('/api/user/settings', { timeout: 10000 });
      const data: UserSettingsResponse = response.data || {};
      const server = pickSlices(data);
      setPreferencesSupported(Boolean(data.preferences && typeof data.preferences === 'object'));
      if (mode === 'initial') {
        setFormData(server);
      } else {
        // Keep unsaved edits: only clean slices take the server values.
        const form = formRef.current;
        const prevSaved = savedRef.current;
        const merged: UserSettingsResponse = { ...form };
        for (const slice of SETTINGS_SLICES) {
          if (!sliceDiffers(form, prevSaved, slice)) (merged as Record<string, unknown>)[slice] = server[slice];
        }
        setFormData(merged);
      }
      setSaved(server);
      setSubscriptionData(data.subscription || null);
      setInitialDataLoaded(true);
      return true;
    } catch {
      setFetchError(tRef.current('settingsLoadError'));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [setFormData, setSaved]);

  useEffect(() => {
    void load('initial');
  }, [load]);

  /** Re-read the payload; slices with unsaved edits keep them. Resolves false on failure. */
  const refetch = useCallback(() => {
    if (!initialDataLoaded) setIsLoading(true);
    return load('refetch');
  }, [initialDataLoaded, load]);

  const handleInputChange = useCallback((section: keyof UserSettingsResponse, name: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [section]: { ...(prev[section] as object), [name]: value } }));
    if (section === 'shipperProfile' && name === 'importerOfRecord') {
      setImporterJsonError(null);
    }
  }, [setFormData]);

  /** `handleInputChange` with the slice type (null clears a field, e.g. timezone back to the default). */
  const setField = useCallback((slice: SettingsSlice, name: string, value: string | boolean | null) => {
    setFormData((prev) => ({ ...prev, [slice]: { ...(prev[slice] as object), [name]: value } }));
    if (slice === 'shipperProfile' && name === 'importerOfRecord') setImporterJsonError(null);
  }, [setFormData]);

  const dirtySlices = useMemo<SettingsSlice[]>(
    () => SETTINGS_SLICES.filter((s) => sliceDiffers(formData, savedRef.current, s)),
    // savedVersion stands in for savedRef.current
    [formData, savedVersion],
  );

  /** Is any of `slice` (or only `fields` of it) different from the last saved values? */
  const isSliceDirty = useCallback(
    (slice: SettingsSlice | readonly SettingsSlice[], fields?: readonly string[]) => {
      const list: readonly SettingsSlice[] = typeof slice === 'string' ? [slice] : slice;
      return list.some((s) => sliceDiffers(formData, savedRef.current, s, fields));
    },
    [formData, savedVersion],
  );

  const dirtySections = useMemo<SettingsFormSection[]>(
    () => (Object.keys(SECTION_SLICES) as SettingsFormSection[]).filter((sec) => SECTION_SLICES[sec].some((s) => dirtySlices.includes(s))),
    [dirtySlices],
  );

  const isDirty = dirtySlices.length > 0;

  /** Reset `slices` (all when omitted), or only `fields` of them, to the last saved values. */
  const discard = useCallback((slices?: SettingsSlice | readonly SettingsSlice[], fields?: readonly string[]) => {
    const list: readonly SettingsSlice[] = slices === undefined ? SETTINGS_SLICES : typeof slices === 'string' ? [slices] : slices;
    setFormData((prev) => {
      const next: UserSettingsResponse = { ...prev };
      for (const s of list) {
        if (fields) {
          const saved = asSlice(savedRef.current[s]);
          const cur = { ...asSlice(prev[s]) };
          for (const k of fields) cur[k] = saved[k];
          (next as Record<string, unknown>)[s] = cur;
        } else {
          (next as Record<string, unknown>)[s] = savedRef.current[s];
        }
      }
      return next;
    });
    if (list.includes('shipperProfile')) setImporterJsonError(null);
  }, [setFormData]);

  /**
   * PATCH only `slices` (and only `fields` of integrationSettings / shipperProfile when given); masks are
   * stripped. On success the saved ref takes the sent values, so those fields turn clean. No toasts and
   * no raw server text: callers own the copy (settings §5.2, §6). Never throws.
   */
  const saveSlice = useCallback(async (
    slices: SettingsSlice | readonly SettingsSlice[],
    fields?: readonly string[],
    options: SaveSliceOptions = {},
  ): Promise<SaveSliceResult> => {
    const list: SettingsSlice[] = typeof slices === 'string' ? [slices] : [...slices];
    if (list.includes('preferences') && !preferencesSupported) return { ok: false, code: 'unsupported' };
    const form = formRef.current;
    const body = buildSlicePatch(form, list, fields, savedRef.current);
    setIsSubmitting(true);
    try {
      await axios.patch('/api/user/settings', body, { withCredentials: true });
      const nextSaved: UserSettingsResponse = { ...savedRef.current };
      for (const s of list) {
        if (fields && (s === 'integrationSettings' || s === 'shipperProfile')) {
          const merged = { ...asSlice(savedRef.current[s]) };
          for (const k of fields) merged[k] = asSlice(form[s])[k];
          (nextSaved as Record<string, unknown>)[s] = merged;
        } else {
          (nextSaved as Record<string, unknown>)[s] = form[s];
        }
      }
      setSaved(nextSaved);
      if (options.refetch) await load('refetch');
      return { ok: true };
    } catch (error: unknown) {
      const res = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
      if (res) return { ok: false, status: res.status, code: machineCode(res.data) };
      return { ok: false, code: 'network' };
    } finally {
      setIsSubmitting(false);
    }
  }, [load, preferencesSupported, setSaved]);

  /** Legacy whole-form save (legacy settings page only). New code uses `saveSlice`. */
  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      const sent = formRef.current;
      await axios.patch('/api/user/settings', withoutMaskedSecrets({
        shippingSettings: sent.shippingSettings,
        integrationSettings: sent.integrationSettings,
        shipperProfile: sent.shipperProfile,
      }), { withCredentials: true });
      setSaved({ ...sent, preferences: savedRef.current.preferences });
      toast.success(t('settingsSaved'));
    } catch (error: any) {
      let errorMessage = t('settingsSaveFailed');
      if (axios.isAxiosError?.(error) && error.response?.data?.error) errorMessage += ` ${error.response.data.error}`;
      else if (error?.message) errorMessage += ` ${error.message}`;
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    formData, setFormData, subscriptionData,
    initialDataLoaded, isLoading, fetchError, isSubmitting, isDirty,
    handleInputChange, handleSave,
    importerJsonError, setImporterJsonError,
    // settings §17 Group A additions
    /** The first load failed and nothing is shown yet. */
    loadFailed: Boolean(fetchError) && !initialDataLoaded,
    /** The server returned `preferences` (A6 / BR-2 shipped); Preferences can be saved. */
    preferencesSupported,
    /** Last server-confirmed object (load, refetch, successful save). Read-only for callers. */
    savedRef: savedRef as MutableRefObject<UserSettingsResponse>,
    setField,
    isSliceDirty,
    dirtySlices,
    dirtySections,
    discard,
    saveSlice,
    refetch,
  };
}

export type UseSettingsResult = ReturnType<typeof useSettings>;

const SettingsContext = createContext<UseSettingsResult | null>(null);

/** `SettingsPage` mounts one `useSettings()` and shares it with every section through this provider. */
export function SettingsProvider({ value, children }: { value: UseSettingsResult; children?: ReactNode }) {
  return createElement(SettingsContext.Provider, { value }, children);
}

/** The page's settings instance, or null outside `SettingsProvider` (legacy page, isolated tests). */
export function useSettingsContext(): UseSettingsResult | null {
  return useContext(SettingsContext);
}

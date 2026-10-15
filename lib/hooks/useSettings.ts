import { useEffect, useRef, useState } from 'react';
// @ts-ignore
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// Mirrored from the /api/user/settings route — the GET body (and the PATCH payload shape).
export interface UserSettingsResponse {
  subscription?: {
    /** 'shopify_free' when billingProvider is shopify_free or the account has an active Shopify store. */
    subscriptionPlan: 'trial' | 'starter' | 'growth' | 'enterprise' | 'shopify_free' | null;
    subscriptionStatus: 'trialing' | 'active' | 'canceled' | 'past_due' | null;
    billingInterval: 'month' | 'year' | null;
    /** 'stripe' | 'shopify_free' | null (other legacy values pass through). */
    billingProvider?: string | null;
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
  shippingSettings?: {
    etgbRecipientEmail?: string | null;
    etgbEnabled?: boolean;
  } | null;
  integrationSettings?: Record<string, string | null | undefined> | null;
  shipperProfile?: Record<string, string | null | undefined> | null;
}

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

export const initialFormData: UserSettingsResponse = {
  shippingSettings: { etgbRecipientEmail: '', etgbEnabled: false },
  integrationSettings: {
    veeqoApiKey: '', shippoToken: '', trendyolApiKey: '', trendyolApiSecret: '', trendyolSupplierId: '',
    fedexApiKey: '', fedexApiSecret: '', fedexAccountNumber: '', upsApiKey: '', upsApiSecret: '', upsAccountNumber: '',
    mngCustomerNumber: '', mngPassword: '', mngAppId: '', mngAppSecret: '',
    parasutClientId: '', parasutClientSecret: '', parasutUsername: '', parasutPassword: '', parasutCompanyId: '',
    parasutBaseUrl: '', parasutRedirectUri: '',
  },
  shipperProfile: {
    shipperName: '', shipperPersonName: '', shipperPhoneNumber: '', shipperStreet1: '', shipperStreet2: '',
    shipperCity: '', shipperStateCode: '', shipperPostalCode: '', shipperCountryCode: '', shipperTinNumber: '',
    shipperTinType: '', importerOfRecord: '', fedexFolderId: '', defaultCurrencyCode: 'USD',
    dutiesPaymentType: 'SENDER', defaultShippingChargesPaymentType: 'SENDER',
  },
};

/** Owns the settings form lifecycle (load, edit, save) for the PATCH-backed slices. */
export function useSettings() {
  const t = useTranslations('settings');
  const [formData, setFormData] = useState<UserSettingsResponse>(initialFormData);
  const [subscriptionData, setSubscriptionData] = useState<UserSettingsResponse['subscription'] | null>(null);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importerJsonError, setImporterJsonError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const lastSavedRef = useRef<string>('');

  const snapshot = (data: UserSettingsResponse) => JSON.stringify({
    shippingSettings: data.shippingSettings,
    integrationSettings: data.integrationSettings,
    shipperProfile: data.shipperProfile,
  });

  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoading(true);
      setFetchError(null);
      try {
        const response = await axios.get<UserSettingsResponse>('/api/user/settings', { timeout: 10000 });
        const next: UserSettingsResponse = {
          shippingSettings: response.data.shippingSettings || initialFormData.shippingSettings,
          integrationSettings: response.data.integrationSettings || initialFormData.integrationSettings,
          shipperProfile: response.data.shipperProfile || initialFormData.shipperProfile,
        };
        setFormData(next);
        lastSavedRef.current = snapshot(next);
        setIsDirty(false);
        setSubscriptionData(response.data.subscription || null);
        setInitialDataLoaded(true);
      } catch (error) {
        setFetchError(t('settingsLoadError'));
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInputChange = (section: keyof UserSettingsResponse, name: string, value: string | boolean) => {
    setFormData(prev => {
      const next = { ...prev, [section]: { ...(prev[section] as object), [name]: value } };
      setIsDirty(snapshot(next) !== lastSavedRef.current);
      return next;
    });
    if (section === 'shipperProfile' && name === 'importerOfRecord') {
      setImporterJsonError(null);
    }
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      await axios.patch('/api/user/settings', withoutMaskedSecrets(formData), { withCredentials: true });
      lastSavedRef.current = snapshot(formData);
      setIsDirty(false);
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
  };
}

import { useEffect, useRef, useState } from 'react';
// @ts-ignore
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// Mirrored from the /api/user/settings route — the PATCH payload shape.
export interface UserSettingsResponse {
  subscription?: {
    subscriptionPlan: 'trial' | 'starter' | 'growth' | 'enterprise' | null;
    subscriptionStatus: 'trialing' | 'active' | 'canceled' | 'past_due' | null;
    billingInterval: 'month' | 'year' | null;
    trialExpiresAt: string | null;
    usageResetAt: string | null;
    orderSyncCount: number;
    labelCount: number;
  };
  shippingSettings?: {
    etgbRecipientEmail?: string | null;
    etgbEnabled?: boolean;
  } | null;
  integrationSettings?: Record<string, string | null | undefined> | null;
  shipperProfile?: Record<string, string | null | undefined> | null;
}

export const initialFormData: UserSettingsResponse = {
  shippingSettings: { etgbRecipientEmail: '', etgbEnabled: false },
  integrationSettings: {
    veeqoApiKey: '', shippoToken: '', trendyolApiKey: '', trendyolApiSecret: '', trendyolSupplierId: '',
    fedexApiKey: '', fedexApiSecret: '', fedexAccountNumber: '', upsApiKey: '', upsApiSecret: '', upsAccountNumber: '',
    mngCustomerNumber: '', mngPassword: '', mngAppId: '', mngAppSecret: '', mngApiEnvironment: 'test',
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
      await axios.patch('/api/user/settings', formData, { withCredentials: true });
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

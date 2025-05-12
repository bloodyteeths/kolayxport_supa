import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import { Settings, Save, Key, ShoppingCart, Truck, Check, Edit, Info, FileText, Package, UserSquare, FolderCog, ClipboardCopy } from 'lucide-react';
import { motion } from 'framer-motion';
import { NextSeo } from 'next-seo';
import { supabase } from '@/lib/supabase';

const InputField = ({ label, type = 'text', value, onChange, placeholder, id, disabled }) => (
  <div className="mb-4">
    <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">
      {label}
    </label>
    <input
      type={type}
      id={id}
      name={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={`mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${disabled ? "bg-slate-50 text-slate-500" : ""}`}
    />
  </div>
);

const ApiSection = ({ title, icon: Icon, children, description }) => (
  <motion.div
    className="bg-white p-6 md:p-8 rounded-lg shadow-md mb-8"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
  >
    <div className="flex items-center mb-6">
      {Icon && <Icon size={28} className="mr-3 text-blue-600" />}
      <h2 className="text-xl font-semibold text-slate-800">{title}</h2>
    </div>
    {description && <p className="mb-4 text-sm text-slate-500">{description}</p>}
    <div className="space-y-4">
      {children}
    </div>
  </motion.div>
);

export default function SettingsPage() {
  const { user, isLoading: authLoading, refreshUser } = useAuth();
  const router = useRouter();

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const status = authLoading ? 'loading' : (user ? 'authenticated' : 'unauthenticated');

  const [trendyolApiKey, setTrendyolApiKey] = useState('');
  const [isTrendyolApiKeyEditing, setIsTrendyolApiKeyEditing] = useState(true);
  const [trendyolApiKeySaveStatus, setTrendyolApiKeySaveStatus] = useState('idle');

  const [trendyolApiSecret, setTrendyolApiSecret] = useState('');
  const [isTrendyolApiSecretEditing, setIsTrendyolApiSecretEditing] = useState(true);
  const [trendyolApiSecretSaveStatus, setTrendyolApiSecretSaveStatus] = useState('idle');
  
  const [trendyolSupplierId, setTrendyolSupplierId] = useState('');
  const [isTrendyolSupplierIdEditing, setIsTrendyolSupplierIdEditing] = useState(true);
  const [trendyolSupplierIdSaveStatus, setTrendyolSupplierIdSaveStatus] = useState('idle');

  const [shippoApiToken, setShippoApiToken] = useState('');
  const [isShippoApiTokenEditing, setIsShippoApiTokenEditing] = useState(true);
  const [shippoApiTokenSaveStatus, setShippoApiTokenSaveStatus] = useState('idle');

  const [veeqoApiKey, setVeeqoApiKey] = useState('');
  const [isVeeqoApiKeyEditing, setIsVeeqoApiKeyEditing] = useState(true);
  const [veeqoApiKeySaveStatus, setVeeqoApiKeySaveStatus] = useState('idle');

  const [defaultCurrencyCode, setDefaultCurrencyCode] = useState('');
  const [isDefaultCurrencyCodeEditing, setIsDefaultCurrencyCodeEditing] = useState(true);
  const [defaultCurrencyCodeSaveStatus, setDefaultCurrencyCodeSaveStatus] = useState('idle');

  const [dutiesPaymentType, setDutiesPaymentType] = useState('');
  const [isDutiesPaymentTypeEditing, setIsDutiesPaymentTypeEditing] = useState(true);
  const [dutiesPaymentTypeSaveStatus, setDutiesPaymentTypeSaveStatus] = useState('idle');

  const [fedexAccountNumber, setFedexAccountNumber] = useState('');
  const [isFedexAccountNumberEditing, setIsFedexAccountNumberEditing] = useState(true);
  const [fedexAccountNumberSaveStatus, setFedexAccountNumberSaveStatus] = useState('idle');

  const [fedexApiKey, setFedexApiKey] = useState('');
  const [isFedexApiKeyEditing, setIsFedexApiKeyEditing] = useState(true);
  const [fedexApiKeySaveStatus, setFedexApiKeySaveStatus] = useState('idle');

  const [fedexApiSecret, setFedexApiSecret] = useState('');
  const [isFedexApiSecretEditing, setIsFedexApiSecretEditing] = useState(true);
  const [fedexApiSecretSaveStatus, setFedexApiSecretSaveStatus] = useState('idle');

  const [importerContactPersonName, setImporterContactPersonName] = useState('');
  const [importerContactCompanyName, setImporterContactCompanyName] = useState('');
  const [importerContactPhoneNumber, setImporterContactPhoneNumber] = useState('');
  const [importerContactEmailAddress, setImporterContactEmailAddress] = useState('');
  const [importerAddressStreetLines, setImporterAddressStreetLines] = useState('');
  const [importerAddressCity, setImporterAddressCity] = useState('');
  const [importerAddressStateCode, setImporterAddressStateCode] = useState('');
  const [importerAddressPostalCode, setImporterAddressPostalCode] = useState('');
  const [importerAddressCountryCode, setImporterAddressCountryCode] = useState('');
  
  const [isImporterSectionEditing, setIsImporterSectionEditing] = useState(true);
  const [importerSectionSaveStatus, setImporterSectionSaveStatus] = useState('idle');

  const [shipperCity, setShipperCity] = useState('');
  const [isShipperCityEditing, setIsShipperCityEditing] = useState(true);
  const [shipperCitySaveStatus, setShipperCitySaveStatus] = useState('idle');

  const [shipperCountryCode, setShipperCountryCode] = useState('');
  const [isShipperCountryCodeEditing, setIsShipperCountryCodeEditing] = useState(true);
  const [shipperCountryCodeSaveStatus, setShipperCountryCodeSaveStatus] = useState('idle');

  const [shipperName, setShipperName] = useState('');
  const [isShipperNameEditing, setIsShipperNameEditing] = useState(true);
  const [shipperNameSaveStatus, setShipperNameSaveStatus] = useState('idle');

  const [shipperPersonName, setShipperPersonName] = useState('');
  const [isShipperPersonNameEditing, setIsShipperPersonNameEditing] = useState(true);
  const [shipperPersonNameSaveStatus, setShipperPersonNameSaveStatus] = useState('idle');

  const [shipperPhoneNumber, setShipperPhoneNumber] = useState('');
  const [isShipperPhoneNumberEditing, setIsShipperPhoneNumberEditing] = useState(true);
  const [shipperPhoneNumberSaveStatus, setShipperPhoneNumberSaveStatus] = useState('idle');

  const [shipperPostalCode, setShipperPostalCode] = useState('');
  const [isShipperPostalCodeEditing, setIsShipperPostalCodeEditing] = useState(true);
  const [shipperPostalCodeSaveStatus, setShipperPostalCodeSaveStatus] = useState('idle');

  const [shipperStateCode, setShipperStateCode] = useState('');
  const [isShipperStateCodeEditing, setIsShipperStateCodeEditing] = useState(true);
  const [shipperStateCodeSaveStatus, setShipperStateCodeSaveStatus] = useState('idle');

  const [shipperStreet1, setShipperStreet1] = useState('');
  const [isShipperStreet1Editing, setIsShipperStreet1Editing] = useState(true);
  const [shipperStreet1SaveStatus, setShipperStreet1SaveStatus] = useState('idle');

  const [shipperStreet2, setShipperStreet2] = useState('');
  const [isShipperStreet2Editing, setIsShipperStreet2Editing] = useState(true);
  const [shipperStreet2SaveStatus, setShipperStreet2SaveStatus] = useState('idle');

  const [shipperTinNumber, setShipperTinNumber] = useState('');
  const [isShipperTinNumberEditing, setIsShipperTinNumberEditing] = useState(true);
  const [shipperTinNumberSaveStatus, setShipperTinNumberSaveStatus] = useState('idle');

  const [fedexFolderId, setFedexFolderId] = useState('');

  const fetchAndSetUserProperties = useCallback(async () => {
    if (!user) {
      setIsLoadingData(false);
      return;
    }
    setIsLoadingData(true);
    setFetchError(null);
    try {
      const response = await fetch('/api/user/settings'); 
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch settings. Status: ${response.status}. Response: ${errorText}`);
      }
      
      const data = await response.json();

      const setDataField = (value, setter, setEditing, setSaveStatus) => {
        if (value !== undefined && value !== null && value !== '') {
          setter(value);
          setEditing(false);
          setSaveStatus('success');
        } else {
          setter('');
          setEditing(true);
          setSaveStatus('idle');
        }
      };

      setDataField(data.veeqoApiKey, setVeeqoApiKey, setIsVeeqoApiKeyEditing, setVeeqoApiKeySaveStatus);
      setDataField(data.trendyolApiKey, setTrendyolApiKey, setIsTrendyolApiKeyEditing, setTrendyolApiKeySaveStatus);
      setDataField(data.trendyolApiSecret, setTrendyolApiSecret, setIsTrendyolApiSecretEditing, setTrendyolApiSecretSaveStatus);
      setDataField(data.trendyolSupplierId, setTrendyolSupplierId, setIsTrendyolSupplierIdEditing, setTrendyolSupplierIdSaveStatus);
      setDataField(data.shippoToken, setShippoApiToken, setIsShippoApiTokenEditing, setShippoApiTokenSaveStatus);
      setDataField(data.fedexAccountNumber, setFedexAccountNumber, setIsFedexAccountNumberEditing, setFedexAccountNumberSaveStatus);
      setDataField(data.fedexApiKey, setFedexApiKey, setIsFedexApiKeyEditing, setFedexApiKeySaveStatus);
      setDataField(data.fedexApiSecret, setFedexApiSecret, setIsFedexApiSecretEditing, setFedexApiSecretSaveStatus);
      setDataField(data.hepsiburadaMerchantId, setHepsiburadaMerchantId, setIsHepsiburadaMerchantIdEditing, setHepsiburadaMerchantIdSaveStatus);
      setDataField(data.hepsiburadaApiKey, setHepsiburadaApiKey, setIsHepsiburadaApiKeyEditing, setHepsiburadaApiKeySaveStatus);

      if (data.hasOwnProperty('IMPORTER_OF_RECORD')) { 
        try {
          const importerData = JSON.parse(data.IMPORTER_OF_RECORD);
          if (importerData && importerData.contact && importerData.address) {
            setImporterContactPersonName(importerData.contact.personName || '');
            setImporterContactCompanyName(importerData.contact.companyName || '');
            setImporterContactPhoneNumber(importerData.contact.phoneNumber || '');
            setImporterContactEmailAddress(importerData.contact.emailAddress || '');
            setImporterAddressStreetLines(Array.isArray(importerData.address.streetLines) ? importerData.address.streetLines.join('\n') : importerData.address.streetLines || '');
            setImporterAddressCity(importerData.address.city || '');
            setImporterAddressStateCode(importerData.address.stateOrProvinceCode || '');
            setImporterAddressPostalCode(importerData.address.postalCode || '');
            setImporterAddressCountryCode(importerData.address.countryCode || '');
            
            setIsImporterSectionEditing(false);
            setImporterSectionSaveStatus('success');
          } else {
            setIsImporterSectionEditing(true);
            setImporterSectionSaveStatus('idle');
          }
        } catch (e) {
          console.error("Error parsing IMPORTER_OF_RECORD JSON:", e);
          setIsImporterSectionEditing(true);
          setImporterSectionSaveStatus('idle');
        }
      }
      if (data.hasOwnProperty('SHIPPER_CITY')) { setShipperCity(data.SHIPPER_CITY); setIsShipperCityEditing(false); setShipperCitySaveStatus('success'); }
      if (data.hasOwnProperty('SHIPPER_COUNTRY_CODE')) { setShipperCountryCode(data.SHIPPER_COUNTRY_CODE); setIsShipperCountryCodeEditing(false); setShipperCountryCodeSaveStatus('success'); }
      if (data.hasOwnProperty('SHIPPER_POSTAL_CODE')) { setShipperPostalCode(data.SHIPPER_POSTAL_CODE); setIsShipperPostalCodeEditing(false); setShipperPostalCodeSaveStatus('success'); }
      if (data.hasOwnProperty('SHIPPER_STATE_CODE')) { setShipperStateCode(data.SHIPPER_STATE_CODE); setIsShipperStateCodeEditing(false); setShipperStateCodeSaveStatus('success'); }
      if (data.hasOwnProperty('SHIPPER_TIN_NUMBER')) { setShipperTinNumber(data.SHIPPER_TIN_NUMBER); setIsShipperTinNumberEditing(false); setShipperTinNumberSaveStatus('success'); }
      
      if (data.hasOwnProperty('FEDEX_FOLDER_ID')) {
        setFedexFolderId(data.FEDEX_FOLDER_ID);
      }

    } catch (error) {
      console.error("Error fetching user settings in component:", error);
      setFetchError(error.message);
    } finally {
      setIsLoadingData(false);
    }
  }, [user]);

  useEffect(() => {
    if (status === 'authenticated' && user) {
      fetchAndSetUserProperties();
    } else if (status === 'loading') {
      setIsLoadingData(true);
    }
  }, [status, user, fetchAndSetUserProperties]);

  const handleSaveProperty = async (propertyName, value, setSaveStatus, setIsEditing) => {
    if (!user?.id) {
      console.error('Cannot save property: User not authenticated.');
      setSaveStatus('error');
      return;
    }
    setSaveStatus('saving');
    try {
      const response = await fetch('/api/setScriptProps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ [propertyName]: value }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setSaveStatus('success');
        setIsEditing(false);
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        throw new Error(data.error || 'Failed to save property.');
      }
    } catch (error) {
      console.error(`Error saving ${propertyName}:`, error);
      setSaveStatus('error');
    }
  };

  const handleSaveImporterOfRecord = async () => {
    if (!user?.id) { 
      setImporterSectionSaveStatus('error'); 
      console.error('User not authenticated for saving importer details.'); 
      return; 
    }
    setImporterSectionSaveStatus('saving');
    const payload = {
      contact: {
        personName: importerContactPersonName,
        companyName: importerContactCompanyName,
        phoneNumber: importerContactPhoneNumber,
        emailAddress: importerContactEmailAddress,
      },
      address: {
        streetLines: importerAddressStreetLines.split('\n'),
        city: importerAddressCity,
        stateOrProvinceCode: importerAddressStateCode,
        postalCode: importerAddressPostalCode,
        countryCode: importerAddressCountryCode,
      }
    };
    try {
      const response = await fetch('/api/setScriptProps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ IMPORTER_OF_RECORD: JSON.stringify(payload) })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setImporterSectionSaveStatus('success');
        setIsImporterSectionEditing(false);
        setTimeout(() => setImporterSectionSaveStatus('idle'), 2000);
      } else {
        throw new Error(data.error || 'Failed to save Importer of Record.');
      }
    } catch (error) {
      console.error("Error saving Importer of Record:", error);
      setImporterSectionSaveStatus('error');
    }
  };

  const handleSaveShipperTinNumber = async () => {
    if (!user?.id) { setShipperTinNumberSaveStatus('error'); return; }
    setShipperTinNumberSaveStatus('saving');
    try {
      const response = await fetch('/api/setScriptProps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ SHIPPER_TIN_NUMBER: shipperTinNumber })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setShipperTinNumberSaveStatus('success');
        setIsShipperTinNumberEditing(false);
        setTimeout(() => setShipperTinNumberSaveStatus('idle'), 2000);
      } else {
        throw new Error(data.error || 'Failed to save Shipper TIN.');
      }
    } catch (error) {
      setShipperTinNumberSaveStatus('error');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('ID Kopyalandı!');
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      alert('Kopyalama başarısız oldu.');
    });
  };

  if (authLoading || (status === 'authenticated' && isLoadingData)) {
    return <AppLayout title="Ayarlar Yükleniyor..."><div className="flex justify-center items-center h-screen"><Loader2 className='animate-spin w-10 h-10 text-blue-500' /> <p className='ml-3 text-slate-500'>Ayarlar yükleniyor...</p></div></AppLayout>;
  }

  if (status === 'unauthenticated') {
    if (typeof window !== 'undefined') {
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/app/settings',
        },
      });
    }
    return <AppLayout title="Yönlendiriliyor..."><div className="flex justify-center items-center h-screen"><p>Giriş sayfasına yönlendiriliyor...</p></div></AppLayout>;
  }

  if (fetchError) {
    return (
      <AppLayout title="Hata - Ayarlar">
        <div className="p-8 text-center">
          <p className="text-red-500">Ayarlar yüklenirken bir hata oluştu: {fetchError}</p>
          <button onClick={fetchAndSetUserProperties} className="mt-4 btn-primary">Tekrar Dene</button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="API Ayarları - KolayXport">
      <NextSeo noindex={true} nofollow={true} />

      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="bg-white p-6 rounded-lg shadow">
          <h1 className="text-3xl font-bold text-slate-800 flex items-center">
            <Settings size={36} className="mr-3 text-blue-600" />
            Entegrasyon Ayarları & Script Özellikleri
          </h1>
          <p className="mt-2 text-slate-600">
            Pazaryerleri, kargo servisleri ve diğer e-ticaret entegrasyonları için API anahtarlarınızı ve genel script ayarlarınızı buradan yönetebilirsiniz.
          </p>
        </div>
      </motion.div>

      <ApiSection title="Genel Ayarlar" icon={Settings} description="Uygulama genelinde kullanılacak temel ayarlar.">
        <div className="flex items-end space-x-2">
          <div className="flex-grow">
            <InputField
              id="defaultCurrencyCode"
              label="Varsayılan Para Birimi Kodu (Default Currency Code)"
              value={defaultCurrencyCode}
              onChange={(e) => setDefaultCurrencyCode(e.target.value)}
              placeholder="Örn: TRY, USD, EUR"
              disabled={!isDefaultCurrencyCodeEditing}
            />
          </div>
          {isDefaultCurrencyCodeEditing ? (
            <button
              onClick={() => handleSaveProperty('DEFAULT_CURRENCY_CODE', defaultCurrencyCode, setDefaultCurrencyCodeSaveStatus, setIsDefaultCurrencyCodeEditing)}
              disabled={defaultCurrencyCodeSaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {defaultCurrencyCodeSaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : defaultCurrencyCodeSaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsDefaultCurrencyCodeEditing(true);
                setDefaultCurrencyCodeSaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {defaultCurrencyCodeSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>
      </ApiSection>

      <ApiSection title="Gümrük ve Ödeme Ayarları" icon={FileText} description="Gümrük işlemleri ve ödeme türü ile ilgili ayarlar.">
        <div className="flex items-end space-x-2">
          <div className="flex-grow">
            <InputField
              id="dutiesPaymentType"
              label="Gümrük Vergisi Ödeme Türü (Duties Payment Type)"
              value={dutiesPaymentType}
              onChange={(e) => setDutiesPaymentType(e.target.value)}
              placeholder="Örn: SENDER, RECIPIENT"
              disabled={!isDutiesPaymentTypeEditing}
            />
          </div>
          {isDutiesPaymentTypeEditing ? (
            <button
              onClick={() => handleSaveProperty('DUTIES_PAYMENT_TYPE', dutiesPaymentType, setDutiesPaymentTypeSaveStatus, setIsDutiesPaymentTypeEditing)}
              disabled={dutiesPaymentTypeSaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {dutiesPaymentTypeSaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : dutiesPaymentTypeSaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsDutiesPaymentTypeEditing(true);
                setDutiesPaymentTypeSaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {dutiesPaymentTypeSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>
      </ApiSection>

      <ApiSection title="Trendyol API Bilgileri" icon={ShoppingCart} description="Trendyol mağazanız için API anahtar ve bilgileri.">
        <div className="flex items-end space-x-2">
          <div className="flex-grow">
            <InputField
              id="trendyolSupplierId"
              label="Trendyol Satıcı ID (Supplier ID)"
              value={trendyolSupplierId}
              onChange={(e) => setTrendyolSupplierId(e.target.value)}
              placeholder="123456"
              disabled={!isTrendyolSupplierIdEditing}
            />
          </div>
          {isTrendyolSupplierIdEditing ? (
            <button
              onClick={() => handleSaveProperty('TRENDYOL_SUPPLIER_ID', trendyolSupplierId, setTrendyolSupplierIdSaveStatus, setIsTrendyolSupplierIdEditing)}
              disabled={trendyolSupplierIdSaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {trendyolSupplierIdSaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : trendyolSupplierIdSaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsTrendyolSupplierIdEditing(true);
                setTrendyolSupplierIdSaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {trendyolSupplierIdSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="trendyolApiKey"
              label="Trendyol API Anahtarı (API Key)"
              value={trendyolApiKey}
              onChange={(e) => setTrendyolApiKey(e.target.value)}
              placeholder="ABC123XYZ789..."
              disabled={!isTrendyolApiKeyEditing}
            />
          </div>
          {isTrendyolApiKeyEditing ? (
            <button
              onClick={() => handleSaveProperty('TRENDYOL_API_KEY', trendyolApiKey, setTrendyolApiKeySaveStatus, setIsTrendyolApiKeyEditing)}
              disabled={trendyolApiKeySaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {trendyolApiKeySaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : trendyolApiKeySaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsTrendyolApiKeyEditing(true);
                setTrendyolApiKeySaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {trendyolApiKeySaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="trendyolApiSecret"
              label="Trendyol API Gizli Anahtarı (API Secret)"
              type="password"
              value={trendyolApiSecret}
              onChange={(e) => setTrendyolApiSecret(e.target.value)}
              placeholder="••••••••••••••••••••"
              disabled={!isTrendyolApiSecretEditing}
            />
          </div>
          {isTrendyolApiSecretEditing ? (
            <button
              onClick={() => handleSaveProperty('TRENDYOL_API_SECRET', trendyolApiSecret, setTrendyolApiSecretSaveStatus, setIsTrendyolApiSecretEditing)}
              disabled={trendyolApiSecretSaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {trendyolApiSecretSaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : trendyolApiSecretSaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsTrendyolApiSecretEditing(true);
                setTrendyolApiSecretSaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {trendyolApiSecretSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>
      </ApiSection>

      <ApiSection title="Shippo API Bilgileri" icon={Package} description="Shippo kargo entegrasyonu için API token.">
        <div className="flex items-end space-x-2">
          <div className="flex-grow">
            <InputField
              id="shippoApiToken"
              label="Shippo Özel API Token (Private API Token)"
              type="password"
              value={shippoApiToken}
              onChange={(e) => setShippoApiToken(e.target.value)}
              placeholder="shippo_live_abcdef12345..."
              disabled={!isShippoApiTokenEditing}
            />
          </div>
          {isShippoApiTokenEditing ? (
            <button
              onClick={() => handleSaveProperty('SHIPPO_TOKEN', shippoApiToken, setShippoApiTokenSaveStatus, setIsShippoApiTokenEditing)}
              disabled={shippoApiTokenSaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {shippoApiTokenSaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : shippoApiTokenSaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsShippoApiTokenEditing(true);
                setShippoApiTokenSaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {shippoApiTokenSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>
      </ApiSection>

      <ApiSection title="FedEx API Bilgileri" icon={Truck} description="FedEx kargo entegrasyonu için hesap, API ve gönderici bilgileri.">
        <div className="flex items-end space-x-2">
          <div className="flex-grow">
            <InputField
              id="fedexAccountNumber"
              label="FedEx Hesap Numarası (Account Number)"
              value={fedexAccountNumber}
              onChange={(e) => setFedexAccountNumber(e.target.value)}
              placeholder="FedEx Hesap Numaranız"
              disabled={!isFedexAccountNumberEditing}
            />
          </div>
          {isFedexAccountNumberEditing ? (
            <button
              onClick={() => handleSaveProperty('FEDEX_ACCOUNT_NUMBER', fedexAccountNumber, setFedexAccountNumberSaveStatus, setIsFedexAccountNumberEditing)}
              disabled={fedexAccountNumberSaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {fedexAccountNumberSaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : fedexAccountNumberSaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsFedexAccountNumberEditing(true);
                setFedexAccountNumberSaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {fedexAccountNumberSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="fedexApiKey"
              label="FedEx API Anahtarı (API Key)"
              type="password"
              value={fedexApiKey}
              onChange={(e) => setFedexApiKey(e.target.value)}
              placeholder="FedEx API Anahtarınız"
              disabled={!isFedexApiKeyEditing}
            />
          </div>
          {isFedexApiKeyEditing ? (
            <button
              onClick={() => handleSaveProperty('FEDEX_API_KEY', fedexApiKey, setFedexApiKeySaveStatus, setIsFedexApiKeyEditing)}
              disabled={fedexApiKeySaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {fedexApiKeySaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : fedexApiKeySaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsFedexApiKeyEditing(true);
                setFedexApiKeySaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {fedexApiKeySaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="fedexApiSecret"
              label="FedEx API Gizli Anahtarı (API Secret)"
              type="password"
              value={fedexApiSecret}
              onChange={(e) => setFedexApiSecret(e.target.value)}
              placeholder="FedEx API Gizli Anahtarınız"
              disabled={!isFedexApiSecretEditing}
            />
          </div>
          {isFedexApiSecretEditing ? (
            <button
              onClick={() => handleSaveProperty('FEDEX_API_SECRET', fedexApiSecret, setFedexApiSecretSaveStatus, setIsFedexApiSecretEditing)}
              disabled={fedexApiSecretSaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {fedexApiSecretSaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : fedexApiSecretSaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsFedexApiSecretEditing(true);
                setFedexApiSecretSaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {fedexApiSecretSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>
      </ApiSection>

      <ApiSection title="İthalatçı Kaydı Detayları (Importer of Record Details)" icon={FileText} description="Gönderileriniz için ithalatçı firma/kişi bilgileri. Bir alan doldurulduysa tüm alanların doldurulması zorunludur.">
        <InputField
          id="importerContactCompanyName"
          label="Firma Adı"
          value={importerContactCompanyName}
          onChange={(e) => setImporterContactCompanyName(e.target.value)}
          placeholder="İthalatçı Firma Tam Adı"
          disabled={!isImporterSectionEditing}
        />
        <InputField
          id="importerContactPersonName"
          label="Yetkili Kişi Adı"
          value={importerContactPersonName}
          onChange={(e) => setImporterContactPersonName(e.target.value)}
          placeholder="Adı Soyadı"
          disabled={!isImporterSectionEditing}
        />
        <InputField
          id="importerContactPhoneNumber"
          label="Telefon Numarası"
          value={importerContactPhoneNumber}
          onChange={(e) => setImporterContactPhoneNumber(e.target.value)}
          placeholder="+90XXXXXXXXXX"
          disabled={!isImporterSectionEditing}
        />
        <InputField
          id="importerContactEmailAddress"
          label="E-posta Adresi"
          type="email"
          value={importerContactEmailAddress}
          onChange={(e) => setImporterContactEmailAddress(e.target.value)}
          placeholder="eposta@ornek.com"
          disabled={!isImporterSectionEditing}
        />
        <div>
          <label htmlFor="importerAddressStreetLines" className="block text-sm font-medium text-slate-700 mb-1">
            Adres Satırları
          </label>
          <textarea
            id="importerAddressStreetLines"
            name="importerAddressStreetLines"
            rows={3}
            value={importerAddressStreetLines}
            onChange={(e) => setImporterAddressStreetLines(e.target.value)}
            placeholder="Mahalle, Cadde, Sokak, No (Yeni satır için Enter tuşunu kullanabilirsiniz)"
            disabled={!isImporterSectionEditing}
            className={`mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${!isImporterSectionEditing ? "bg-slate-50 text-slate-500" : ""}`}
          />
        </div>
        <InputField
          id="importerAddressCity"
          label="Şehir"
          value={importerAddressCity}
          onChange={(e) => setImporterAddressCity(e.target.value)}
          placeholder="Örn: Adana"
          disabled={!isImporterSectionEditing}
        />
        <InputField
          id="importerAddressStateCode"
          label="İl Kodu (Sayısal Plaka Kodu)"
          value={importerAddressStateCode}
          onChange={(e) => setImporterAddressStateCode(e.target.value)}
          placeholder="Örn: 01 (Adana için), 34 (İstanbul için)"
          disabled={!isImporterSectionEditing}
        />
        <InputField
          id="importerAddressPostalCode"
          label="Posta Kodu"
          value={importerAddressPostalCode}
          onChange={(e) => setImporterAddressPostalCode(e.target.value)}
          placeholder="Örn: 01170"
          disabled={!isImporterSectionEditing}
        />
        <InputField
          id="importerAddressCountryCode"
          label="Ülke Kodu (ISO Alpha-2)"
          value={importerAddressCountryCode}
          onChange={(e) => setImporterAddressCountryCode(e.target.value.toUpperCase())}
          placeholder="Örn: TR, US"
          disabled={!isImporterSectionEditing}
        />
        <div className="flex justify-end mt-6">
          {isImporterSectionEditing ? (
            <button 
              onClick={handleSaveImporterOfRecord} 
              disabled={importerSectionSaveStatus === 'saving'}
              className="px-6 py-2.5 bg-orange-600 text-white font-semibold text-sm rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {importerSectionSaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : importerSectionSaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />İthalatçı Bilgilerini Kaydet</>)}
            </button>
          ) : (
            <button 
              onClick={() => { setIsImporterSectionEditing(true); setImporterSectionSaveStatus('idle'); }}
              className="px-6 py-2.5 bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> İthalatçı Bilgilerini Değiştir {importerSectionSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>
      </ApiSection>

      <ApiSection title="Veeqo API Bilgileri" icon={ShoppingCart} description="Veeqo envanter ve sipariş yönetimi entegrasyonu.">
        <div className="flex items-end space-x-2">
          <div className="flex-grow">
            <InputField
              id="veeqoApiKey"
              label="Veeqo API Anahtarı"
              type="password"
              value={veeqoApiKey}
              onChange={(e) => setVeeqoApiKey(e.target.value)}
              placeholder="Veeqo API anahtarınız"
              disabled={!isVeeqoApiKeyEditing}
            />
          </div>
          {isVeeqoApiKeyEditing ? (
            <button
              onClick={() => handleSaveProperty('VEEQO_API_KEY', veeqoApiKey, setVeeqoApiKeySaveStatus, setIsVeeqoApiKeyEditing)}
              disabled={veeqoApiKeySaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {veeqoApiKeySaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : veeqoApiKeySaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsVeeqoApiKeyEditing(true);
                setVeeqoApiKeySaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {veeqoApiKeySaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>
      </ApiSection>

      <ApiSection 
        title="Otomatik Ayarlar (Sistem)" 
        icon={FolderCog} 
        description="Bu ayarlar sistem tarafından yönetilir ve onboarding sırasında otomatik olarak oluşturulur."
      >
        <div className="flex items-center space-x-2">
          <div className="flex-grow">
            <label htmlFor="fedexFolderIdDisplay" className="block text-sm font-medium text-slate-700 mb-1">
              FedEx Etiket Klasör ID (FedEx Label Folder ID)
            </label>
            <div 
              id="fedexFolderIdDisplay"
              className="mt-1 block w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-md shadow-sm sm:text-sm text-slate-700 overflow-x-auto"
            >
              {fedexFolderId || "Yükleniyor veya ayarlanmamış..."}
            </div>
          </div>
          {fedexFolderId && (
            <button
              onClick={() => copyToClipboard(fedexFolderId)}
              title="Klasör ID'sini Kopyala"
              className="p-2 h-[38px] mt-6 bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <ClipboardCopy size={18} />
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Bu ID, FedEx kargo etiketlerinizin kaydedildiği Google Drive klasörünü belirtir. Onboarding sırasında otomatik oluşturulur.
        </p>
      </ApiSection>

    </AppLayout>
  );
} 
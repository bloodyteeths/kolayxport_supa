import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import { Settings, Save, Key, ShoppingCart, Truck, Check, Edit, Info, FileText, Package, UserSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import { NextSeo } from 'next-seo';

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
  const { data: session, status } = useSession();
  const router = useRouter();

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

  const [veeqoOrdersUrl, setVeeqoOrdersUrl] = useState('');
  const [isVeeqoOrdersUrlEditing, setIsVeeqoOrdersUrlEditing] = useState(true);
  const [veeqoOrdersUrlSaveStatus, setVeeqoOrdersUrlSaveStatus] = useState('idle');

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

  // Shipper Information States
  const [importerOfRecord, setImporterOfRecord] = useState('');
  const [isImporterOfRecordEditing, setIsImporterOfRecordEditing] = useState(true);
  const [importerOfRecordSaveStatus, setImporterOfRecordSaveStatus] = useState('idle');

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

  const [shipperTinType, setShipperTinType] = useState('');
  const [isShipperTinTypeEditing, setIsShipperTinTypeEditing] = useState(true);
  const [shipperTinTypeSaveStatus, setShipperTinTypeSaveStatus] = useState('idle');

  useEffect(() => {
    const fetchUserProperties = async () => {
      const mockData = {
        VEEQO_API_KEY: "EXISTING_VEEQO_KEY_FROM_DB",
        VEEQO_ORDERS_URL: "https://api.veeqo.com/orders/existing",
        DEFAULT_CURRENCY_CODE: "USD",
        TRENDYOL_API_KEY: "EXISTING_TRENDYOL_KEY",
        TRENDYOL_API_SECRET: "EXISTING_TRENDYOL_SECRET",
        TRENDYOL_SUPPLIER_ID: "EXISTING_TRENDYOL_ID",
        SHIPPO_TOKEN: "EXISTING_SHIPPO_TOKEN",
        DUTIES_PAYMENT_TYPE: "SENDER",
        FEDEX_ACCOUNT_NUMBER: "123456789",
        FEDEX_API_KEY: "FEDEX_KEY_FROM_DB",
        FEDEX_API_SECRET: "FEDEX_SECRET_FROM_DB",
        IMPORTER_OF_RECORD: "KolayXport Inc.",
        SHIPPER_CITY: "Istanbul",
        SHIPPER_COUNTRY_CODE: "TR",
        SHIPPER_NAME: "KolayXport Depo",
        SHIPPER_PERSON_NAME: "Ahmet Yilmaz",
        SHIPPER_PHONE_NUMBER: "+905551234567",
        SHIPPER_POSTAL_CODE: "34700",
        SHIPPER_STATE_CODE: "IST",
        SHIPPER_STREET_1: "Eksioglu Mah. Atabey Cad. No:1 D:2",
        SHIPPER_STREET_2: "Cekmekoy",
        SHIPPER_TIN_NUMBER: "1234567890",
        SHIPPER_TIN_TYPE: "VAT",
      };

      if (mockData.VEEQO_API_KEY) {
        setVeeqoApiKey(mockData.VEEQO_API_KEY);
        setIsVeeqoApiKeyEditing(false);
        setVeeqoApiKeySaveStatus('success');
      }
      if (mockData.VEEQO_ORDERS_URL) {
        setVeeqoOrdersUrl(mockData.VEEQO_ORDERS_URL);
        setIsVeeqoOrdersUrlEditing(false);
        setVeeqoOrdersUrlSaveStatus('success');
      }
      if (mockData.DEFAULT_CURRENCY_CODE) {
        setDefaultCurrencyCode(mockData.DEFAULT_CURRENCY_CODE);
        setIsDefaultCurrencyCodeEditing(false);
        setDefaultCurrencyCodeSaveStatus('success');
      }
      if (mockData.TRENDYOL_API_KEY) {
        setTrendyolApiKey(mockData.TRENDYOL_API_KEY);
        setIsTrendyolApiKeyEditing(false);
        setTrendyolApiKeySaveStatus('success');
      }
      if (mockData.TRENDYOL_API_SECRET) {
        setTrendyolApiSecret(mockData.TRENDYOL_API_SECRET);
        setIsTrendyolApiSecretEditing(false);
        setTrendyolApiSecretSaveStatus('success');
      }
      if (mockData.TRENDYOL_SUPPLIER_ID) {
        setTrendyolSupplierId(mockData.TRENDYOL_SUPPLIER_ID);
        setIsTrendyolSupplierIdEditing(false);
        setTrendyolSupplierIdSaveStatus('success');
      }
      if (mockData.SHIPPO_TOKEN) {
        setShippoApiToken(mockData.SHIPPO_TOKEN);
        setIsShippoApiTokenEditing(false);
        setShippoApiTokenSaveStatus('success');
      }
      if (mockData.DUTIES_PAYMENT_TYPE) {
        setDutiesPaymentType(mockData.DUTIES_PAYMENT_TYPE);
        setIsDutiesPaymentTypeEditing(false);
        setDutiesPaymentTypeSaveStatus('success');
      }
      if (mockData.FEDEX_ACCOUNT_NUMBER) {
        setFedexAccountNumber(mockData.FEDEX_ACCOUNT_NUMBER);
        setIsFedexAccountNumberEditing(false);
        setFedexAccountNumberSaveStatus('success');
      }
      if (mockData.FEDEX_API_KEY) {
        setFedexApiKey(mockData.FEDEX_API_KEY);
        setIsFedexApiKeyEditing(false);
        setFedexApiKeySaveStatus('success');
      }
      if (mockData.FEDEX_API_SECRET) {
        setFedexApiSecret(mockData.FEDEX_API_SECRET);
        setIsFedexApiSecretEditing(false);
        setFedexApiSecretSaveStatus('success');
      }
      
      // Shipper Information
      if (mockData.IMPORTER_OF_RECORD) { setImporterOfRecord(mockData.IMPORTER_OF_RECORD); setIsImporterOfRecordEditing(false); setImporterOfRecordSaveStatus('success'); }
      if (mockData.SHIPPER_CITY) { setShipperCity(mockData.SHIPPER_CITY); setIsShipperCityEditing(false); setShipperCitySaveStatus('success'); }
      if (mockData.SHIPPER_COUNTRY_CODE) { setShipperCountryCode(mockData.SHIPPER_COUNTRY_CODE); setIsShipperCountryCodeEditing(false); setShipperCountryCodeSaveStatus('success'); }
      if (mockData.SHIPPER_NAME) { setShipperName(mockData.SHIPPER_NAME); setIsShipperNameEditing(false); setShipperNameSaveStatus('success'); }
      if (mockData.SHIPPER_PERSON_NAME) { setShipperPersonName(mockData.SHIPPER_PERSON_NAME); setIsShipperPersonNameEditing(false); setShipperPersonNameSaveStatus('success'); }
      if (mockData.SHIPPER_PHONE_NUMBER) { setShipperPhoneNumber(mockData.SHIPPER_PHONE_NUMBER); setIsShipperPhoneNumberEditing(false); setShipperPhoneNumberSaveStatus('success'); }
      if (mockData.SHIPPER_POSTAL_CODE) { setShipperPostalCode(mockData.SHIPPER_POSTAL_CODE); setIsShipperPostalCodeEditing(false); setShipperPostalCodeSaveStatus('success'); }
      if (mockData.SHIPPER_STATE_CODE) { setShipperStateCode(mockData.SHIPPER_STATE_CODE); setIsShipperStateCodeEditing(false); setShipperStateCodeSaveStatus('success'); }
      if (mockData.SHIPPER_STREET_1) { setShipperStreet1(mockData.SHIPPER_STREET_1); setIsShipperStreet1Editing(false); setShipperStreet1SaveStatus('success'); }
      if (mockData.SHIPPER_STREET_2) { setShipperStreet2(mockData.SHIPPER_STREET_2); setIsShipperStreet2Editing(false); setShipperStreet2SaveStatus('success'); }
      if (mockData.SHIPPER_TIN_NUMBER) { setShipperTinNumber(mockData.SHIPPER_TIN_NUMBER); setIsShipperTinNumberEditing(false); setShipperTinNumberSaveStatus('success'); }
      if (mockData.SHIPPER_TIN_TYPE) { setShipperTinType(mockData.SHIPPER_TIN_TYPE); setIsShipperTinTypeEditing(false); setShipperTinTypeSaveStatus('success'); }

    };

    if (status === 'authenticated') {
      fetchUserProperties();
    }
  }, [status]);

  const handleSaveProperty = async (propertyName, value, setSaveStatus, setIsEditing) => {
    setSaveStatus('saving');
    try {
      console.log(`Saving ${propertyName}: ${value} to user's script properties via Next.js API route`);
      const response = await fetch('/api/gscript/set-user-property', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: session.user.id, propertyName, value }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to save property. Server response not JSON.' }));
        throw new Error(errorData.message || `Failed to save ${propertyName}. Status: ${response.status}`);
      }
      
      setSaveStatus('success');
      setIsEditing(false);

    } catch (error) {
      console.error(`Error saving ${propertyName}:`, error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  if (status === 'loading') {
    return <AppLayout title="Ayarlar Yükleniyor..."><div className="flex justify-center items-center h-screen"><p>Yükleniyor...</p></div></AppLayout>;
  }

  if (status === 'unauthenticated') {
    router.push('/api/auth/signin');
    return null;
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

      <ApiSection title="FedEx API Bilgileri" icon={Truck} description="FedEx kargo entegrasyonu için hesap ve API bilgileri.">
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

      <ApiSection title="Gönderici Bilgileri (Shipper Information)" icon={UserSquare} description="Gönderileriniz için varsayılan gönderici adres ve iletişim bilgileri.">
        {/* IMPORTER_OF_RECORD */}
        <div className="flex items-end space-x-2">
          <div className="flex-grow">
            <InputField
              id="importerOfRecord"
              label="İthalatçı Kaydı (Importer of Record)"
              value={importerOfRecord}
              onChange={(e) => setImporterOfRecord(e.target.value)}
              placeholder="İthalatçı firma adı"
              disabled={!isImporterOfRecordEditing}
            />
          </div>
          {isImporterOfRecordEditing ? (
            <button onClick={() => handleSaveProperty('IMPORTER_OF_RECORD', importerOfRecord, setImporterOfRecordSaveStatus, setIsImporterOfRecordEditing)} disabled={importerOfRecordSaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {importerOfRecordSaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : importerOfRecordSaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsImporterOfRecordEditing(true); setImporterOfRecordSaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {importerOfRecordSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        {/* SHIPPER_NAME */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperName"
              label="Gönderici Adı (Shipper Name)"
              value={shipperName}
              onChange={(e) => setShipperName(e.target.value)}
              placeholder="Gönderici firma veya kişi adı"
              disabled={!isShipperNameEditing}
            />
          </div>
          {isShipperNameEditing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_NAME', shipperName, setShipperNameSaveStatus, setIsShipperNameEditing)} disabled={shipperNameSaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperNameSaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperNameSaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperNameEditing(true); setShipperNameSaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperNameSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>
        
        {/* SHIPPER_PERSON_NAME */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperPersonName"
              label="Gönderici Yetkili Kişi (Shipper Person Name)"
              value={shipperPersonName}
              onChange={(e) => setShipperPersonName(e.target.value)}
              placeholder="Yetkili kişi adı soyadı"
              disabled={!isShipperPersonNameEditing}
            />
          </div>
          {isShipperPersonNameEditing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_PERSON_NAME', shipperPersonName, setShipperPersonNameSaveStatus, setIsShipperPersonNameEditing)} disabled={shipperPersonNameSaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperPersonNameSaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperPersonNameSaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperPersonNameEditing(true); setShipperPersonNameSaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperPersonNameSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        {/* SHIPPER_PHONE_NUMBER */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperPhoneNumber"
              label="Gönderici Telefon Numarası (Shipper Phone Number)"
              value={shipperPhoneNumber}
              onChange={(e) => setShipperPhoneNumber(e.target.value)}
              placeholder="+90XXXXXXXXXX"
              disabled={!isShipperPhoneNumberEditing}
            />
          </div>
          {isShipperPhoneNumberEditing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_PHONE_NUMBER', shipperPhoneNumber, setShipperPhoneNumberSaveStatus, setIsShipperPhoneNumberEditing)} disabled={shipperPhoneNumberSaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperPhoneNumberSaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperPhoneNumberSaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperPhoneNumberEditing(true); setShipperPhoneNumberSaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperPhoneNumberSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        {/* SHIPPER_STREET_1 */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperStreet1"
              label="Gönderici Adres Satırı 1 (Shipper Street 1)"
              value={shipperStreet1}
              onChange={(e) => setShipperStreet1(e.target.value)}
              placeholder="Mahalle, Cadde, Sokak, No"
              disabled={!isShipperStreet1Editing}
            />
          </div>
          {isShipperStreet1Editing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_STREET_1', shipperStreet1, setShipperStreet1SaveStatus, setIsShipperStreet1Editing)} disabled={shipperStreet1SaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperStreet1SaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperStreet1SaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperStreet1Editing(true); setShipperStreet1SaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperStreet1SaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        {/* SHIPPER_STREET_2 */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperStreet2"
              label="Gönderici Adres Satırı 2 (Shipper Street 2 - Opsiyonel)"
              value={shipperStreet2}
              onChange={(e) => setShipperStreet2(e.target.value)}
              placeholder="Bina adı, İç kapı no vb."
              disabled={!isShipperStreet2Editing}
            />
          </div>
          {isShipperStreet2Editing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_STREET_2', shipperStreet2, setShipperStreet2SaveStatus, setIsShipperStreet2Editing)} disabled={shipperStreet2SaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperStreet2SaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperStreet2SaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperStreet2Editing(true); setShipperStreet2SaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperStreet2SaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        {/* SHIPPER_CITY */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperCity"
              label="Gönderici Şehir (Shipper City)"
              value={shipperCity}
              onChange={(e) => setShipperCity(e.target.value)}
              placeholder="Örn: İstanbul"
              disabled={!isShipperCityEditing}
            />
          </div>
          {isShipperCityEditing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_CITY', shipperCity, setShipperCitySaveStatus, setIsShipperCityEditing)} disabled={shipperCitySaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperCitySaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperCitySaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperCityEditing(true); setShipperCitySaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperCitySaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        {/* SHIPPER_POSTAL_CODE */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperPostalCode"
              label="Gönderici Posta Kodu (Shipper Postal Code)"
              value={shipperPostalCode}
              onChange={(e) => setShipperPostalCode(e.target.value)}
              placeholder="Örn: 34700"
              disabled={!isShipperPostalCodeEditing}
            />
          </div>
          {isShipperPostalCodeEditing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_POSTAL_CODE', shipperPostalCode, setShipperPostalCodeSaveStatus, setIsShipperPostalCodeEditing)} disabled={shipperPostalCodeSaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperPostalCodeSaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperPostalCodeSaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperPostalCodeEditing(true); setShipperPostalCodeSaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperPostalCodeSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        {/* SHIPPER_STATE_CODE */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperStateCode"
              label="Gönderici Eyalet/İl Kodu (Shipper State Code - Opsiyonel)"
              value={shipperStateCode}
              onChange={(e) => setShipperStateCode(e.target.value)}
              placeholder="Örn: IST (TR için), CA (US için)"
              disabled={!isShipperStateCodeEditing}
            />
          </div>
          {isShipperStateCodeEditing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_STATE_CODE', shipperStateCode, setShipperStateCodeSaveStatus, setIsShipperStateCodeEditing)} disabled={shipperStateCodeSaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperStateCodeSaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperStateCodeSaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperStateCodeEditing(true); setShipperStateCodeSaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperStateCodeSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        {/* SHIPPER_COUNTRY_CODE */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperCountryCode"
              label="Gönderici Ülke Kodu (Shipper Country Code)"
              value={shipperCountryCode}
              onChange={(e) => setShipperCountryCode(e.target.value)}
              placeholder="Örn: TR, US, DE (ISO 3166-1 alpha-2)"
              disabled={!isShipperCountryCodeEditing}
            />
          </div>
          {isShipperCountryCodeEditing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_COUNTRY_CODE', shipperCountryCode, setShipperCountryCodeSaveStatus, setIsShipperCountryCodeEditing)} disabled={shipperCountryCodeSaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperCountryCodeSaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperCountryCodeSaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperCountryCodeEditing(true); setShipperCountryCodeSaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperCountryCodeSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        {/* SHIPPER_TIN_NUMBER */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperTinNumber"
              label="Gönderici Vergi Numarası (Shipper TIN Number)"
              value={shipperTinNumber}
              onChange={(e) => setShipperTinNumber(e.target.value)}
              placeholder="Vergi Kimlik Numarası"
              disabled={!isShipperTinNumberEditing}
            />
          </div>
          {isShipperTinNumberEditing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_TIN_NUMBER', shipperTinNumber, setShipperTinNumberSaveStatus, setIsShipperTinNumberEditing)} disabled={shipperTinNumberSaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperTinNumberSaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperTinNumberSaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperTinNumberEditing(true); setShipperTinNumberSaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperTinNumberSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>

        {/* SHIPPER_TIN_TYPE */}
        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="shipperTinType"
              label="Gönderici Vergi Numarası Türü (Shipper TIN Type)"
              value={shipperTinType}
              onChange={(e) => setShipperTinType(e.target.value)}
              placeholder="Örn: VAT, EORI, TCNO"
              disabled={!isShipperTinTypeEditing}
            />
          </div>
          {isShipperTinTypeEditing ? (
            <button onClick={() => handleSaveProperty('SHIPPER_TIN_TYPE', shipperTinType, setShipperTinTypeSaveStatus, setIsShipperTinTypeEditing)} disabled={shipperTinTypeSaveStatus === 'saving'} className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              {shipperTinTypeSaveStatus === 'saving' ? (<><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>) : shipperTinTypeSaveStatus === 'error' ? (<>Hata! Tekrar Dene</>) : (<><Save size={16} className="mr-2" />Kaydet</>)}
            </button>
          ) : (
            <button onClick={() => { setIsShipperTinTypeEditing(true); setShipperTinTypeSaveStatus('idle'); }} className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap">
              <Edit size={16} className="mr-2" /> Değiştir {shipperTinTypeSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>
      </ApiSection>

      <ApiSection title="Veeqo API Bilgileri" icon={Truck} description="Veeqo envanter ve sipariş yönetimi entegrasyonu.">
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

        <div className="flex items-end space-x-2 mt-4">
          <div className="flex-grow">
            <InputField
              id="veeqoOrdersUrl"
              label="Veeqo Siparişler URL (Veeqo Orders URL)"
              value={veeqoOrdersUrl}
              onChange={(e) => setVeeqoOrdersUrl(e.target.value)}
              placeholder="https://api.veeqo.com/orders"
              disabled={!isVeeqoOrdersUrlEditing}
            />
          </div>
          {isVeeqoOrdersUrlEditing ? (
            <button
              onClick={() => handleSaveProperty('VEEQO_ORDERS_URL', veeqoOrdersUrl, setVeeqoOrdersUrlSaveStatus, setIsVeeqoOrdersUrlEditing)}
              disabled={veeqoOrdersUrlSaveStatus === 'saving'}
              className="px-4 py-2 h-[38px] bg-blue-600 text-white font-semibold text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              {veeqoOrdersUrlSaveStatus === 'saving' ? (
                <><Save size={16} className="mr-2 animate-spin" />Kaydediliyor...</>
              ) : veeqoOrdersUrlSaveStatus === 'error' ? (
                <>Hata! Tekrar Dene</>
              ) : (
                <><Save size={16} className="mr-2" />Kaydet</>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                setIsVeeqoOrdersUrlEditing(true);
                setVeeqoOrdersUrlSaveStatus('idle');
              }}
              className="px-4 py-2 h-[38px] bg-slate-200 text-slate-700 font-semibold text-sm rounded-md hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 flex items-center justify-center whitespace-nowrap"
            >
              <Edit size={16} className="mr-2" /> Değiştir
              {veeqoOrdersUrlSaveStatus === 'success' && <Check size={16} className="ml-2 text-green-500" />}
            </button>
          )}
        </div>
      </ApiSection>

    </AppLayout>
  );
} 
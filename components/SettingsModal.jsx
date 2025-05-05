import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// TODO: Fetch existing props when modal opens
// async function fetchScriptProps() {
//   // Call backend API like /api/getScriptProps
//   // This API would call an Apps Script function getProperties()
// }

export default function SettingsModal({ onClose }) {
  // State for all script properties
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Veeqo
  const [veeqoApiKey, setVeeqoApiKey] = useState('');
  // Trendyol
  const [trendyolSupplierId, setTrendyolSupplierId] = useState('');
  const [trendyolApiKey, setTrendyolApiKey] = useState('');
  const [trendyolApiSecret, setTrendyolApiSecret] = useState('');
  // Shippo (if needed for label sheet/logic)
  const [shippoToken, setShippoToken] = useState('');
  // FedEx
  const [fedexApiKey, setFedexApiKey] = useState('');
  const [fedexApiSecret, setFedexApiSecret] = useState('');
  const [fedexAccountNumber, setFedexAccountNumber] = useState('');
  const [fedexFolderId, setFedexFolderId] = useState('');
  // Shipper Info (for FedEx)
  const [shipperName, setShipperName] = useState('');
  const [shipperPersonName, setShipperPersonName] = useState('');
  const [shipperPhoneNumber, setShipperPhoneNumber] = useState('');
  const [shipperStreet1, setShipperStreet1] = useState('');
  const [shipperStreet2, setShipperStreet2] = useState(''); // Optional
  const [shipperCity, setShipperCity] = useState('');
  const [shipperStateCode, setShipperStateCode] = useState('');
  const [shipperPostalCode, setShipperPostalCode] = useState('');
  const [shipperCountryCode, setShipperCountryCode] = useState('');
  const [shipperTinNumber, setShipperTinNumber] = useState('');
  const [shipperTinType, setShipperTinType] = useState(''); // e.g., EIN, VAT, EORI
  // FedEx Label Defaults
  const [dutiesPaymentType, setDutiesPaymentType] = useState('SENDER'); // Or RECIPIENT, THIRD_PARTY
  const [defaultCurrencyCode, setDefaultCurrencyCode] = useState('USD'); // Or TRY, EUR etc.

  // TODO: Populate state with fetched props on mount
  // useEffect(() => {
  //   fetchScriptProps().then(props => {
  //     setVeeqoApiKey(props.VEEQO_API_KEY || '');
  //     // ... set all other states ...
  //   });
  // }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessMessage('');

    const propertiesToSave = {
      VEEQO_API_KEY: veeqoApiKey,
      TRENDYOL_SUPPLIER_ID: trendyolSupplierId,
      TRENDYOL_API_KEY: trendyolApiKey,
      TRENDYOL_API_SECRET: trendyolApiSecret,
      SHIPPO_TOKEN: shippoToken, // Include if label logic uses it
      FEDEX_API_KEY: fedexApiKey,
      FEDEX_API_SECRET: fedexApiSecret,
      FEDEX_ACCOUNT_NUMBER: fedexAccountNumber,
      FEDEX_FOLDER_ID: fedexFolderId,
      SHIPPER_NAME: shipperName,
      SHIPPER_PERSON_NAME: shipperPersonName,
      SHIPPER_PHONE_NUMBER: shipperPhoneNumber,
      SHIPPER_STREET_1: shipperStreet1,
      SHIPPER_STREET_2: shipperStreet2,
      SHIPPER_CITY: shipperCity,
      SHIPPER_STATE_CODE: shipperStateCode,
      SHIPPER_POSTAL_CODE: shipperPostalCode,
      SHIPPER_COUNTRY_CODE: shipperCountryCode,
      SHIPPER_TIN_NUMBER: shipperTinNumber,
      SHIPPER_TIN_TYPE: shipperTinType,
      DUTIES_PAYMENT_TYPE: dutiesPaymentType,
      DEFAULT_CURRENCY_CODE: defaultCurrencyCode,
      // Add any other properties your script needs
    };

    try {
      const res = await fetch('/api/setScriptProps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(propertiesToSave),
      });

      const result = await res.json();

      if (res.ok && result.success) {
        setSuccessMessage('Ayarlar başarıyla kaydedildi!');
        // Optionally close modal after a delay
        setTimeout(() => {
          onClose(); 
        }, 1500);
      } else {
        setError(result.error || 'Ayarlar kaydedilemedi.');
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError('Bir ağ hatası oluştu. Lütfen tekrar deneyin.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSave}>
          <h2 className="text-xl font-semibold mb-6 border-b pb-3">API Anahtarları ve Ayarlar</h2>

          {error && <p className="mb-4 text-red-600 bg-red-100 p-3 rounded">Hata: {error}</p>}
          {successMessage && <p className="mb-4 text-green-600 bg-green-100 p-3 rounded">{successMessage}</p>}

          {/* --- Veeqo --- */}
          <section className="mb-6">
            <h3 className="text-lg font-medium mb-3 text-gray-800">Veeqo</h3>
            <Input 
              label="Veeqo API Key"
              placeholder="Veeqo API Anahtarınız"
              value={veeqoApiKey}
              onChange={e => setVeeqoApiKey(e.target.value)}
              required
            />
          </section>

          {/* --- Trendyol --- */}
          <section className="mb-6">
            <h3 className="text-lg font-medium mb-3 text-gray-800">Trendyol</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="Tedarikçi ID (Supplier ID)" value={trendyolSupplierId} onChange={e => setTrendyolSupplierId(e.target.value)} required />
              <Input label="API Key" value={trendyolApiKey} onChange={e => setTrendyolApiKey(e.target.value)} required />
              <Input label="API Secret" type="password" value={trendyolApiSecret} onChange={e => setTrendyolApiSecret(e.target.value)} required />
            </div>
          </section>
          
          {/* --- Shippo (Optional for Label Sheet?) --- */}
          <section className="mb-6">
            <h3 className="text-lg font-medium mb-3 text-gray-800">Shippo</h3>
            <Input 
              label="Shippo Token (Etiketleme için gerekliyse)"
              placeholder="Shippo API Token"
              value={shippoToken}
              onChange={e => setShippoToken(e.target.value)}
            />
          </section>

          {/* --- FedEx API --- */}
          <section className="mb-6">
            <h3 className="text-lg font-medium mb-3 text-gray-800">FedEx API</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="FedEx API Key" value={fedexApiKey} onChange={e => setFedexApiKey(e.target.value)} required />
                <Input label="FedEx API Secret" type="password" value={fedexApiSecret} onChange={e => setFedexApiSecret(e.target.value)} required />
                <Input label="FedEx Hesap Numarası" value={fedexAccountNumber} onChange={e => setFedexAccountNumber(e.target.value)} required />
                <Input label="Google Drive Klasör ID (Etiketler için)" value={fedexFolderId} onChange={e => setFedexFolderId(e.target.value)} required />
             </div>
          </section>
          
          {/* --- Shipper Info --- */}
          <section className="mb-6">
             <h3 className="text-lg font-medium mb-3 text-gray-800">Gönderici Bilgileri (FedEx için)</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Şirket Adı" value={shipperName} onChange={e => setShipperName(e.target.value)} required />
                <Input label="Yetkili Kişi" value={shipperPersonName} onChange={e => setShipperPersonName(e.target.value)} required />
                <Input label="Telefon Numarası" value={shipperPhoneNumber} onChange={e => setShipperPhoneNumber(e.target.value)} required />
                <Input label="Adres Satırı 1" value={shipperStreet1} onChange={e => setShipperStreet1(e.target.value)} required />
                <Input label="Adres Satırı 2 (Opsiyonel)" value={shipperStreet2} onChange={e => setShipperStreet2(e.target.value)} />
                <Input label="Şehir" value={shipperCity} onChange={e => setShipperCity(e.target.value)} required />
                <Input label="Eyalet/İl Kodu (State Code)" value={shipperStateCode} onChange={e => setShipperStateCode(e.target.value)} required />
                <Input label="Posta Kodu" value={shipperPostalCode} onChange={e => setShipperPostalCode(e.target.value)} required />
                <Input label="Ülke Kodu (örn: TR, US)" value={shipperCountryCode} onChange={e => setShipperCountryCode(e.target.value)} required />
                <Input label="Vergi Numarası (TIN)" value={shipperTinNumber} onChange={e => setShipperTinNumber(e.target.value)} required />
                 {/* TODO: Make TIN Type a dropdown? */}
                 <Input label="Vergi No Tipi (TIN Type - Örn: VAT, EORI, TIN)" value={shipperTinType} onChange={e => setShipperTinType(e.target.value)} required />
             </div>
          </section>

          {/* --- FedEx Defaults --- */}
           <section className="mb-8">
             <h3 className="text-lg font-medium mb-3 text-gray-800">FedEx Etiket Varsayılanları</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {/* TODO: Make Duties Payment Type a dropdown */}
                 <Input label="Gümrük Vergisi Ödeme Tipi (DUTIES_PAYMENT_TYPE)" placeholder="SENDER veya RECIPIENT" value={dutiesPaymentType} onChange={e => setDutiesPaymentType(e.target.value)} required />
                 <Input label="Varsayılan Para Birimi (DEFAULT_CURRENCY_CODE)" placeholder="örn: TRY, USD, EUR" value={defaultCurrencyCode} onChange={e => setDefaultCurrencyCode(e.target.value)} required />
             </div>
           </section>

          {/* --- Actions --- */}
          <div className="flex justify-end space-x-3 border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              İptal
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Kaydediliyor...' : 'Ayarları Kaydet'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
} 
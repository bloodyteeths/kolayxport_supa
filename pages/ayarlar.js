import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

export default function Ayarlar() {
  const [loadingFullSync, setLoadingFullSync] = useState(false);
  const [fullSyncStarted, setFullSyncStarted] = useState(false);

  // ...rest of the code

  // Full sync handler
  const handleFullSync = async () => {
    setLoadingFullSync(true);
    setFullSyncStarted(false);
    try {
      await fetch('/api/orders/full-sync', { method: 'POST' });
      setFullSyncStarted(true);
    } catch (err) {
      toast.error('Senkronizasyon başlatılamadı.');
    } finally {
      setLoadingFullSync(false);
    }
  };

  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    veeqoApiKey: '',
    shippoToken: '',
    fedexApiKey: '',
    fedexApiSecret: '',
    fedexAccountNumber: '',
    fedexMeterNumber: '',
    trendyolSupplierId: '',
    trendyolApiKey: '',
    trendyolApiSecret: '',
    hepsiburadaMerchantId: '',
    hepsiburadaApiKey: '',
    importerOfRecord: '',
    shipperName: '',
    shipperPersonName: '',
    shipperPhoneNumber: '',
    shipperStreet1: '',
    shipperStreet2: '',
    shipperCity: '',
    shipperStateCode: '',
    shipperPostalCode: '',
    shipperCountryCode: '',
    shipperTinNumber: '',
    fedexFolderId: '',
    defaultCurrencyCode: 'USD',
    dutiesPaymentType: 'SENDER'
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else if (status === 'authenticated') {
      fetchSettings();
    }
  }, [status, router]);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/user/settings');
      if (!response.ok) throw new Error('Failed to fetch settings');
      const data = await response.json();
      setSettings(data);
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name, value) => {
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      
      if (!response.ok) throw new Error('Failed to save settings');
      
      toast.success('Settings saved successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      
      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Integration Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="veeqoApiKey">Veeqo API Key</Label>
                <Input
                  id="veeqoApiKey"
                  name="veeqoApiKey"
                  value={settings.veeqoApiKey}
                  onChange={handleChange}
                />
              </div>
              </div>

              {/* Veeqo Full Sync Section */}
              {settings.veeqoApiKey && (
                <div className="space-y-2 border border-blue-200 rounded p-4 bg-blue-50 mt-4">
                  <div className="font-bold text-blue-800 mb-2">Tüm siparişleri senkronize et</div>
                  <Button
                    type="button"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    disabled={saving || loadingFullSync}
                    onClick={handleFullSync}
                  >
                    {loadingFullSync ? 'Senkronizasyon Başlatılıyor...' : 'Başla'}
                  </Button>
                  {fullSyncStarted && (
                    <div className="text-green-700 mt-2">Senkronizasyon başlatıldı, bu sayfadan ayrılabilirsiniz</div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="shippoToken">Shippo Token</Label>
                <Input
                  id="shippoToken"
                  name="shippoToken"
                  value={settings.shippoToken}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fedexApiKey">FedEx API Key</Label>
                <Input
                  id="fedexApiKey"
                  name="fedexApiKey"
                  value={settings.fedexApiKey}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fedexApiSecret">FedEx API Secret</Label>
                <Input
                  id="fedexApiSecret"
                  name="fedexApiSecret"
                  value={settings.fedexApiSecret}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fedexAccountNumber">FedEx Account Number</Label>
                <Input
                  id="fedexAccountNumber"
                  name="fedexAccountNumber"
                  value={settings.fedexAccountNumber}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fedexMeterNumber">FedEx Meter Number</Label>
                <Input
                  id="fedexMeterNumber"
                  name="fedexMeterNumber"
                  value={settings.fedexMeterNumber}
                  onChange={handleChange}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Marketplace Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="trendyolSupplierId">Trendyol Supplier ID</Label>
                <Input
                  id="trendyolSupplierId"
                  name="trendyolSupplierId"
                  value={settings.trendyolSupplierId}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="trendyolApiKey">Trendyol API Key</Label>
                <Input
                  id="trendyolApiKey"
                  name="trendyolApiKey"
                  value={settings.trendyolApiKey}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="trendyolApiSecret">Trendyol API Secret</Label>
                <Input
                  id="trendyolApiSecret"
                  name="trendyolApiSecret"
                  value={settings.trendyolApiSecret}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hepsiburadaMerchantId">Hepsiburada Merchant ID</Label>
                <Input
                  id="hepsiburadaMerchantId"
                  name="hepsiburadaMerchantId"
                  value={settings.hepsiburadaMerchantId}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hepsiburadaApiKey">Hepsiburada API Key</Label>
                <Input
                  id="hepsiburadaApiKey"
                  name="hepsiburadaApiKey"
                  value={settings.hepsiburadaApiKey}
                  onChange={handleChange}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shipper Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="shipperName">Company Name</Label>
                <Input
                  id="shipperName"
                  name="shipperName"
                  value={settings.shipperName}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shipperPersonName">Contact Person</Label>
                <Input
                  id="shipperPersonName"
                  name="shipperPersonName"
                  value={settings.shipperPersonName}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shipperPhoneNumber">Phone Number</Label>
                <Input
                  id="shipperPhoneNumber"
                  name="shipperPhoneNumber"
                  value={settings.shipperPhoneNumber}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shipperStreet1">Street Address 1</Label>
                <Input
                  id="shipperStreet1"
                  name="shipperStreet1"
                  value={settings.shipperStreet1}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shipperStreet2">Street Address 2</Label>
                <Input
                  id="shipperStreet2"
                  name="shipperStreet2"
                  value={settings.shipperStreet2}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shipperCity">City</Label>
                <Input
                  id="shipperCity"
                  name="shipperCity"
                  value={settings.shipperCity}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shipperStateCode">State/Province</Label>
                <Input
                  id="shipperStateCode"
                  name="shipperStateCode"
                  value={settings.shipperStateCode}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shipperPostalCode">Postal Code</Label>
                <Input
                  id="shipperPostalCode"
                  name="shipperPostalCode"
                  value={settings.shipperPostalCode}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shipperCountryCode">Country Code</Label>
                <Input
                  id="shipperCountryCode"
                  name="shipperCountryCode"
                  value={settings.shipperCountryCode}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shipperTinNumber">TIN Number</Label>
                <Input
                  id="shipperTinNumber"
                  name="shipperTinNumber"
                  value={settings.shipperTinNumber}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fedexFolderId">FedEx Folder ID</Label>
                <Input
                  id="fedexFolderId"
                  name="fedexFolderId"
                  value={settings.fedexFolderId}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultCurrencyCode">Default Currency</Label>
                <Select
                  value={settings.defaultCurrencyCode}
                  onValueChange={(value) => handleSelectChange('defaultCurrencyCode', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="TRY">TRY</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dutiesPaymentType">Duties Payment Type</Label>
                <Select
                  value={settings.dutiesPaymentType}
                  onValueChange={(value) => handleSelectChange('dutiesPaymentType', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select payment type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SENDER">Sender</SelectItem>
                    <SelectItem value="RECIPIENT">Recipient</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </form>
    </div>
  );
} 
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, DownloadCloud, Ticket, ShoppingCart } from 'lucide-react'; // Icons
import Link from 'next/link'; // For label link

// Helper to render image formula or plain text
const renderCellContent = (content) => {
  if (typeof content === 'string' && content.startsWith('=IMAGE(')) {
    try {
      // Extract URL and dimensions (basic parsing)
      const urlMatch = content.match(/=IMAGE\("([^"]+)"/);
      if (urlMatch && urlMatch[1]) {
        return <img src={urlMatch[1]} alt="Order item" className="h-16 w-16 object-contain" />; // Adjust size as needed
      }
    } catch (e) {
      console.error("Error parsing IMAGE formula:", e);
    }
  }
  return content; // Return text if not an image formula
};

export default function OrdersTable() {
  // All hooks must run unconditionally at the top level
  const { user, session: supabaseSession, isLoading: authLoading, refreshUser } = useAuth();
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [requireSetup, setRequireSetup] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState(null);
  const [labelStates, setLabelStates] = useState({});
  // Editable state for each row
  const [editRows, setEditRows] = useState({}); // { [orderId]: { ...fields } }

  // Derived variables for auth state
  const status = authLoading ? 'loading' : (user ? 'authenticated' : 'unauthenticated');
  const isAuthenticated = status === 'authenticated';

  // Conditional render variables (single declaration only)
  const shouldShowLoading = status === 'loading';
  const shouldShowSignIn = !isAuthenticated || !user;

  // Render logic (never call hooks after this)

  const fetchOrders = useCallback(async () => {
    setRequireSetup(false);
    setSetupError(null);
    setIsLoading(true);
    setError(null);
    setSyncMessage(''); // Clear sync message on refresh
    setSyncError(null); // Clear sync error on refresh
    setLabelStates({}); // Reset label states when refreshing orders
    console.log('Fetching orders...');
    try {
      const res = await fetch('/api/orders', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok && json.success) {
        setOrders(json.data || []);
        console.log(`Orders fetched successfully: ${json.data?.length || 0} rows`);
      } else {
        throw new Error(json.error || 'Failed to fetch orders');
      }
    } catch (err) {
      console.error("Fetch Orders Error:", err);
      setError(err.message);
      setOrders([]); // Clear orders on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSetup = useCallback(async () => {
    console.warn("handleSetup called, but it's likely obsolete.");
    setSetupLoading(true);
    setSetupError(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      setSetupLoading(false);
      setRequireSetup(false); // Assume setup is no longer required if called
    } catch (err) {
      console.error('Onboarding setup error:', err);
      setSetupError(err.message);
      setSetupLoading(false);
    }
  }, [refreshUser]);

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchOrders();
    }
  }, [isAuthenticated, user, fetchOrders]); // Only one useEffect for fetching orders

  useEffect(() => {
    if (requireSetup && !setupLoading) {
      // Decide if this auto-setup trigger is still needed or should be removed.
      // For now, let's not auto-trigger it.
    }
  }, [requireSetup, setupLoading]);

  // --- End of hooks section ---

  if (shouldShowLoading) {
    return <p>Loading session...</p>;
  }
  if (shouldShowSignIn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Please Sign In</CardTitle>
          <CardDescription>You need to sign in with Google to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={async () => {
            const { error } = await supabase.auth.signInWithOAuth({ 
              provider: 'google',
              options: { redirectTo: window.location.href }
            });
            if (error) console.error('Error signing in with Google:', error);
          }}>Sign in with Google</Button>
        </CardContent>
      </Card>
    );
  }

  const handleSync = async (marketplace) => {
    if (!marketplace) {
      console.error("Marketplace not specified for sync.");
      setSyncError("Marketplace not specified.");
      return;
    }
    setSyncLoading(true);
    setSyncError(null);
    setSyncMessage('');
    setError(null); // Clear fetch error before sync
    console.log(`Starting order sync for ${marketplace}...`);
    try {
      const res = await fetch('/api/orders/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ marketplace }),
      });
      const json = await res.json();
      
      if (res.ok) { // Status 200-299
        console.log(`Sync for ${marketplace} initiated:`, json.message, json.details);
        setSyncMessage(json.message || `Sync for ${marketplace} completed.`);
        if (json.details) {
          setSyncMessage(prev => `${prev} New: ${json.details.newOrders}, Updated: ${json.details.updatedOrders}.`);
          if (json.details.errors && json.details.errors.length > 0) {
            console.warn(`Sync for ${marketplace} had errors:`, json.details.errors);
            setSyncError(`Sync for ${marketplace} completed with errors: ${json.details.errors.map(e => Object.values(e)).join(', ')}`);
          }
        }
        await fetchOrders();
      } else if (res.status === 207) { // Partial success
        console.warn(`Sync for ${marketplace} completed with some errors:`, json.message, json.details);
        setSyncMessage(json.message || `Sync for ${marketplace} completed with some issues.`);
        if (json.details && json.details.errors && json.details.errors.length > 0) {
          setSyncError(`Errors: ${json.details.errors.map(e => Object.values(e)).join(', ')}`);
        }
        await fetchOrders();
      } else {
        throw new Error(json.error || json.message || `Failed to sync ${marketplace} orders`);
      }
    } catch (err) {
      console.error(`Sync ${marketplace} Orders Error:`, err);
      setSyncError(err.message);
    } finally {
      setSyncLoading(false);
    }
  };

  // --- Label Generation Handler ---
  const handleGenerateLabel = async (rowData, rowIndex) => {
    // Use orderNumber or id as unique key
    const orderKey = rowData.orderNumber || rowData.id || `row-${rowIndex}`;
    setLabelStates(prev => ({ ...prev, [orderKey]: { loading: true, error: null, tracking: null, url: null } }));

    // Map object fields to the structure expected by generateLabelForOrder
    const firstItem = rowData.items?.[0] || {};
    const orderDataForApi = {
      orderId: rowData.id || null, // Internal Order ID
      marketplaceOrderKey: rowData.orderNumber || null, // Marketplace Order ID
      recipientName: rowData.customerName || '',
      recipientPhone: firstItem.recipientPhone || '', // Add mapping if available
      recipientStreet: firstItem.recipientStreet || '', // Add mapping if available
      recipientCity: firstItem.recipientCity || '', // Add mapping if available
      recipientState: firstItem.recipientState || '', // Add mapping if available
      recipientPostal: firstItem.recipientPostal || '', // Add mapping if available
      recipientCountry: firstItem.recipientCountry || '', // Add mapping if available
      weight: firstItem.weight || 1, // Add mapping if available
      // Add other necessary fields required by FedEx API & your `generateLabelForOrder` function
    };

    console.log(`Generating label for order key: ${orderKey}`, orderDataForApi);

    // Basic frontend validation before sending
    const requiredApiFields = ['recipientName', 'recipientStreet', 'recipientCity', 'recipientPostal', 'recipientCountry', 'weight'];
    const missingApiFields = requiredApiFields.filter(field => !orderDataForApi[field]);

    if (missingApiFields.length > 0) {
        const errorMsg = `Missing required details for label: ${missingApiFields.join(', ')}.`;
        console.error(errorMsg, orderDataForApi);
        setLabelStates(prev => ({
            ...prev,
            [orderKey]: { loading: false, error: errorMsg, tracking: null, url: null }
        }));
        // Provide user feedback - highlight the need for complete data in the sheet
        alert(errorMsg + "\nPlease ensure the necessary columns exist and have values in your Google Sheet for this order, or adjust the mapping in OrdersTable.jsx."); 
        return;
    }

    try {
      const response = await fetch('/api/generateLabel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderDataForApi),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Label generation failed (HTTP ${response.status})`);
      }

      // Success
      console.log("Label generated successfully:", result);
      setLabelStates(prev => ({
        ...prev,
        [orderKey]: { loading: false, error: null, tracking: result.trackingNumber, url: result.labelUrl }
      }));

    } catch (error) {
      console.error(`Failed to generate label for ${orderKey}:`, error);
      setLabelStates(prev => ({
        ...prev,
        [orderKey]: { loading: false, error: error.message, tracking: null, url: null }
      }));
    }
  };

  // --- Editable Orders Table Columns ---
  // Fallback settings stub (replace with real settings fetch if needed)
  const userSettingsFallback = {
    COL_RECIPIENT_FNAME: '',
    COL_RECIPIENT_LNAME: '',
    COL_RECIPIENT_COMPANY: '',
    COL_RECIPIENT_STREET1: '',
    COL_RECIPIENT_STREET2: '',
    COL_RECIPIENT_CITY: '',
    COL_RECIPIENT_STATE: '',
    COL_RECIPIENT_POSTAL: '',
    COL_RECIPIENT_COUNTRY: '',
    COL_RECIPIENT_PHONE: '',
    COL_WEIGHT: '',
    COL_SERVICE_TYPE: '',
    COL_PACKAGING_TYPE: '',
    COL_CUSTOMS_VALUE: '',
    COL_LABEL_TRIGGER: '',
    COL_LABEL_URL: '',
    COL_COMMODITY_DESC: '',
    COL_COUNTRY_OF_MFG: '',
    COL_HARMONIZED_CODE: '',
    COL_CURRENCY: '',
  };


  // Column definitions
  const columns = [
    { header: 'Sipariş Kimliği', key: 'COL_ORDER_ID', get: row => row.id || '' },
    { header: 'Alıcı Adı', key: 'COL_RECIPIENT_FNAME', get: row => row.recipientFirstName || userSettingsFallback.COL_RECIPIENT_FNAME },
    { header: 'Alıcı Soyadı', key: 'COL_RECIPIENT_LNAME', get: row => row.recipientLastName || userSettingsFallback.COL_RECIPIENT_LNAME },
    { header: 'Alıcı Şirketi', key: 'COL_RECIPIENT_COMPANY', get: row => row.recipientCompany || userSettingsFallback.COL_RECIPIENT_COMPANY },
    { header: 'Adres Satırı 1', key: 'COL_RECIPIENT_STREET1', get: row => row.recipientStreet1 || userSettingsFallback.COL_RECIPIENT_STREET1 },
    { header: 'Adres Satırı 2', key: 'COL_RECIPIENT_STREET2', get: row => row.recipientStreet2 || userSettingsFallback.COL_RECIPIENT_STREET2 },
    { header: 'Şehir', key: 'COL_RECIPIENT_CITY', get: row => row.recipientCity || userSettingsFallback.COL_RECIPIENT_CITY },
    { header: 'Eyalet / İl', key: 'COL_RECIPIENT_STATE', get: row => row.recipientState || userSettingsFallback.COL_RECIPIENT_STATE },
    { header: 'Posta Kodu', key: 'COL_RECIPIENT_POSTAL', get: row => row.recipientPostal || userSettingsFallback.COL_RECIPIENT_POSTAL },
    { header: 'Ülke', key: 'COL_RECIPIENT_COUNTRY', get: row => row.recipientCountry || userSettingsFallback.COL_RECIPIENT_COUNTRY },
    { header: 'Telefon', key: 'COL_RECIPIENT_PHONE', get: row => row.recipientPhone || userSettingsFallback.COL_RECIPIENT_PHONE },
    { header: 'Ağırlık (kg)', key: 'COL_WEIGHT', get: row => row.weight || userSettingsFallback.COL_WEIGHT },
    { header: 'Servis Türü', key: 'COL_SERVICE_TYPE', get: row => row.serviceType || userSettingsFallback.COL_SERVICE_TYPE },
    { header: 'Paket Türü', key: 'COL_PACKAGING_TYPE', get: row => row.packagingType || userSettingsFallback.COL_PACKAGING_TYPE },
    { header: 'Gümrük Değeri', key: 'COL_CUSTOMS_VALUE', get: row => row.customsValue || userSettingsFallback.COL_CUSTOMS_VALUE },
    { header: 'Etiket Oluşturma Onay', key: 'COL_LABEL_TRIGGER', get: row => row.labelTrigger || userSettingsFallback.COL_LABEL_TRIGGER },
    { header: 'Etiket URL', key: 'COL_LABEL_URL', get: row => row.labelUrl || userSettingsFallback.COL_LABEL_URL },
    { header: 'Eşya Açıklaması', key: 'COL_COMMODITY_DESC', get: row => row.commodityDesc || userSettingsFallback.COL_COMMODITY_DESC },
    { header: 'Üretim Ülkesi', key: 'COL_COUNTRY_OF_MFG', get: row => row.countryOfMfg || userSettingsFallback.COL_COUNTRY_OF_MFG },
    { header: 'Harmonize Kodu', key: 'COL_HARMONIZED_CODE', get: row => row.harmonizedCode || userSettingsFallback.COL_HARMONIZED_CODE },
    { header: 'Para Birimi', key: 'COL_CURRENCY', get: row => row.currency || userSettingsFallback.COL_CURRENCY },
  ];

  if (requireSetup) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Welcome to MyBabySync</CardTitle>
          <CardDescription>Get started by creating your Google Sheet and Drive folder.</CardDescription>
        </CardHeader>
        <CardContent>
          {setupError && <p className="text-red-600 mb-2">Error: {setupError}</p>}
          <Button onClick={handleSetup} disabled={setupLoading}>
            {setupLoading ? 'Creating...' : 'Get Started'}
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Siparişler</CardTitle>
        <CardDescription>
          Pazaryerlerinden gelen siparişlerinizi buradan yönetebilirsiniz.
        </CardDescription>
        <div className="flex items-center space-x-2 mt-4">
          <Button onClick={() => fetchOrders()} disabled={isLoading || setupLoading}> 
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Yenile
          </Button>
          <Button onClick={() => handleSync('veeqo')} disabled={syncLoading || setupLoading}>
            <ShoppingCart className={`mr-2 h-4 w-4 ${syncLoading ? 'animate-spin' : ''}`} />
            Veeqo Siparişlerini Senkronize Et
          </Button>
          <Button onClick={() => handleSync('shippo')} disabled={syncLoading || setupLoading}>
            <ShoppingCart className={`mr-2 h-4 w-4 ${syncLoading ? 'animate-spin' : ''}`} />
            Shippo Siparişlerini Senkronize Et
          </Button>
        </div>
        {syncLoading && <p className="text-sm text-blue-600 mt-2">Senkronize ediliyor...</p>}
        {syncMessage && <p className="text-sm text-green-600 mt-2">{syncMessage}</p>}
        {syncError && <p className="text-sm text-red-600 mt-2">Sync Hatası: {syncError}</p>}
        {isLoading && <p className="text-sm text-blue-600 mt-2">Siparişler yükleniyor...</p>}
        {error && <p className="text-sm text-red-600 mt-2">Hata: {error}</p>}
        {setupError && <p className="text-sm text-red-600 mt-2">Kurulum Hatası: {setupError}</p>}
      </CardHeader>

      <CardContent>
        {/* Orders Table (Unified) */}
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.header}>{col.header}</TableHead>
              ))}
              <TableHead>Aksiyonlar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length > 0 ? (
              orders.map((row, rowIndex) => {
                // Log the first order for debugging the API shape
                if (rowIndex === 0) {
                  console.log('one order from DB:', row);
                }
                const orderKey = row.orderNumber || row.id || `row-${rowIndex}`;
                const currentLabelState = labelStates[orderKey] || { loading: false, error: null, tracking: null, url: null };
                return (
                  <TableRow key={orderKey}>
                    {columns.map((col, colIndex) => {
                      const orderId = row.id || row.orderNumber || `row-${rowIndex}`;
                      const editValue =
                        editRows[orderId]?.[col.key] !== undefined
                          ? editRows[orderId][col.key]
                          : col.get(row);
                      return (
                        <TableCell key={col.key}>
                          <input
                            type="text"
                            value={editValue}
                            onChange={e => {
                              const value = e.target.value;
                              setEditRows(prev => ({
                                ...prev,
                                [orderId]: {
                                  ...(prev[orderId] || {}),
                                  [col.key]: value,
                                },
                              }));
                            }}
                            className="border rounded px-2 py-1 w-full text-sm"
                            style={{ minWidth: 80 }}
                          />
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      <Button 
                        onClick={() => handleGenerateLabel(row, rowIndex)} 
                        disabled={currentLabelState.loading} 
                        size="sm"
                        variant="outline"
                      >
                        {currentLabelState.loading ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Ticket className="h-4 w-4" />
                        )}
                        <span className="ml-2">Etiket Oluştur</span>
                      </Button>
                      {currentLabelState.error && <p className="text-xs text-red-500 mt-1">{currentLabelState.error}</p>}
                      {currentLabelState.url && (
                        <Link href={currentLabelState.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline mt-1 block">
                          Etiketi Görüntüle
                        </Link>
                      )}
                      {currentLabelState.tracking && <p className="text-xs mt-1">Takip No: {currentLabelState.tracking}</p>}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="text-center">
                  {isLoading || setupLoading ? 'Yükleniyor...' : (error || setupError || requireSetup) ? 'Siparişler yüklenemedi.' : 'Gösterilecek sipariş bulunmamaktadır.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
} 
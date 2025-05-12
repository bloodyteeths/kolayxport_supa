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
  const { user, session: supabaseSession, isLoading: authLoading, refreshUser } = useAuth();
  
  // Determine authentication status based on Supabase auth state
  const status = authLoading ? 'loading' : (user ? 'authenticated' : 'unauthenticated');
  const isAuthenticated = status === 'authenticated';
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [requireSetup, setRequireSetup] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState(null);

  // State for label generation (per row)
  const [labelStates, setLabelStates] = useState({});

  if (status === 'loading') {
    return <p>Loading session...</p>;
  }
  if (!isAuthenticated || !user) {
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
      const res = await fetch('/api/orders');
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
  }, [isAuthenticated, user, fetchOrders]);

  useEffect(() => {
    if (requireSetup && !setupLoading) {
      // Decide if this auto-setup trigger is still needed or should be removed.
      // For now, let's not auto-trigger it.
    }
  }, [requireSetup, setupLoading]);

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
    // Use unique key from sheet (index 8) if available, otherwise fallback to row index
    const orderKey = rowData[9] ? String(rowData[9]) : (rowData[8] ? String(rowData[8]) : `row-${rowIndex}`);
    
    setLabelStates(prev => ({ ...prev, [orderKey]: { loading: true, error: null, tracking: null, url: null } }));

    // **CRITICAL TODO:** Map rowData columns to the structure expected by generateLabelForOrder
    // This depends HEAVILY on your Sheet's column order and the required fields for FedEx.
    // Ensure your sheet has columns for ALL required FedEx data (address parts, weight, phone etc.)
    // Example mapping (ADJUST INDICES AND FIELD NAMES BASED ON YOUR SHEET AND FEDEX REQUIREMENTS):
    const orderDataForApi = {
       orderId: rowData[9] || null, // Internal Order ID
       marketplaceOrderKey: rowData[8] || null, // Marketplace Order ID
       recipientName: rowData[1],    // Example: Index 1 = Customer Name
       recipientPhone: "",            // TODO: Get from sheet column index ?
       recipientStreet: "",         // TODO: Get from sheet column index ?
       recipientCity: "",           // TODO: Get from sheet column index ?
       recipientState: "",          // TODO: Get from sheet column index ? (State/Province Code)
       recipientPostal: "",         // TODO: Get from sheet column index ?
       recipientCountry: "",        // TODO: Get from sheet column index ? (Country Code, e.g., 'US', 'TR')
       weight: 1,                  // TODO: Get from sheet column index ? or use a default?
       // Add other necessary fields required by FedEx API & your `generateLabelForOrder` function
       // e.g., serviceType: "FEDEX_GROUND", dimensions: { length: 10, width: 10, height: 10, units: "CM" }
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

  // Define table columns
  // Indices reference columns from the getOrdersFromSheet Apps Script function
  // 0: Image, 1: Name, 2: Variant, 3: DecorNote, 4: EtsyNote,
  // 5: Status, 6: ShipBy, 7: Market, 8: Key
  const columns = [
    { header: 'Image', index: 0 },
    { header: 'Name', index: 1 }, // Customer Name
    { header: 'Variant', index: 2 }, // Product Name / Variant Info
    { header: 'Decorsweet Notu', index: 3 }, // Custom notes
    { header: 'Etsy Notu', index: 4 }, // Custom notes
    { header: 'Durum', index: 5 }, // Status
    { header: 'Son Teslim Tarihi', index: 6 }, // ShipByDate
    { header: 'Pazaryeri', index: 7 }, // Marketplace
    { header: 'Pazaryeri No', index: 8 } // MarketplaceKey
    // Add more columns as needed from your Prisma schema for orders
  ];

  // Render onboarding or orders table
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
          {/* TODO: Add buttons for other marketplaces like Trendyol, Shippo later */}
        </div>
        {syncLoading && <p className="text-sm text-blue-600 mt-2">Senkronize ediliyor...</p>}
        {syncMessage && <p className="text-sm text-green-600 mt-2">{syncMessage}</p>}
        {syncError && <p className="text-sm text-red-600 mt-2">Sync Hatası: {syncError}</p>}
        {isLoading && <p className="text-sm text-blue-600 mt-2">Siparişler yükleniyor...</p>}
        {error && <p className="text-sm text-red-600 mt-2">Hata: {error}</p>}
        {setupError && <p className="text-sm text-red-600 mt-2">Kurulum Hatası: {setupError}</p>}
      </CardHeader>

      <CardContent>
        {requireSetup ? (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col.header}>{col.header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length > 0 ? (
                orders.map((row, rowIndex) => {
                  const orderKey = row[8] ? String(row[8]) : `row-${rowIndex}`; // Using marketplaceKey as the unique key
                  const currentLabelState = labelStates[orderKey] || { loading: false, error: null, url: null, tracking: null };

                  // Ensure row is an array and has enough elements before trying to access them
                  if (!Array.isArray(row) || row.length < columns.length) {
                    console.warn("Skipping malformed row:", row);
                    return (
                      <TableRow key={orderKey || rowIndex}>
                        <TableCell colSpan={columns.length + 1}> {/* +1 for actions */}
                          Hatalı satır verisi.
                        </TableCell>
                      </TableRow>
                    );
                  }
                  
                  return (
                    <TableRow key={orderKey || rowIndex}>
                      {columns.map((col, colIndex) => (
                        <TableCell key={colIndex}>
                          {renderCellContent(row[col.index])}
                        </TableCell>
                      ))}
                      <TableCell>
                        <Button 
                          onClick={() => handleGenerateLabel(row, rowIndex)} 
                          disabled={currentLabelState.loading || (!row[8] && !row[9])} // Disable if no marketplace key or internal ID
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
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col.header}>{col.header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((row, rowIndex) => {
                const orderKey = row[8] ? String(row[8]) : `row-${rowIndex}`;
                const currentLabelState = labelStates[orderKey] || { loading: false, error: null, tracking: null, url: null };

                return (
                  <TableRow key={orderKey}>
                    {columns.map((col) => {
                      if (col.header === 'Label') {
                        return (
                          <TableCell key={`${col.header}-${orderKey}`} className="text-xs w-[150px]">
                            {currentLabelState.loading && "Generating..."}
                            {currentLabelState.error && <span className="text-red-600">Error: {currentLabelState.error.substring(0, 100)}{currentLabelState.error.length > 100 ? '...' : ''}</span>}
                            {currentLabelState.url && (
                              <Link href={currentLabelState.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                View Label (PDF)
                              </Link>
                            )}
                            {currentLabelState.tracking && (
                              <span className="block mt-1">Tracking: {currentLabelState.tracking}</span>
                            )}
                            {!currentLabelState.loading && !currentLabelState.error && !currentLabelState.url && !currentLabelState.tracking && "-"}
                          </TableCell>
                        );
                      }

                      if (col.header === 'Actions') {
                        return (
                          <TableCell key={`${col.header}-${orderKey}`} className="w-[80px]">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleGenerateLabel(row, rowIndex)}
                              disabled={currentLabelState.loading}
                              title="Generate FedEx Label"
                            >
                              <Ticket className="mr-1 h-4 w-4" />
                              {currentLabelState.loading ? '...' : 'Label'}
                            </Button>
                          </TableCell>
                        );
                      }

                      return (
                        <TableCell key={`${col.header}-${orderKey}`}>
                          {renderCellContent(row[col.index])}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
} 
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
import { RefreshCw, DownloadCloud, Ticket } from 'lucide-react'; // Icons
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
      const res = await fetch('/api/getOrders');
      const json = await res.json();
      if (res.ok && json.success) {
        setOrders(json.data || []);
        console.log(`Orders fetched successfully: ${json.data?.length || 0} rows`);
      } else {
        throw new Error(json.error || 'Failed to fetch orders');
      }
    } catch (err) {
      console.error("Fetch Orders Error:", err);
      if (err.message.includes('Google Sheet ID missing')) {
        setRequireSetup(true);
      } else {
        setError(err.message);
      }
      setOrders([]); // Clear orders on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSetup = useCallback(async () => {
    setSetupLoading(true);
    setSetupError(null);
    try {
      const res = await fetch('/api/onboarding/setup', { method: 'POST' });
      if (res.status === 401) {
        const { error: signInError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
        if (signInError) console.error('Redirect to sign-in failed during setup:', signInError);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Setup failed');
      
      if (json.success) {
        console.log('Onboarding setup successful, refetching orders with new IDs...');
        if (refreshUser) await refreshUser();
        await fetchOrders(); 
      } else {
        throw new Error(json.error || 'Failed to setup');
      }
    } catch (err) {
      console.error('Onboarding setup error:', err);
      setSetupError(err.message);
    } finally {
      setSetupLoading(false);
    }
  }, [fetchOrders, refreshUser]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (requireSetup && !setupLoading) {
      handleSetup();
    }
  }, [requireSetup, setupLoading]);

  const handleSync = async () => {
    setSyncLoading(true);
    setSyncError(null);
    setSyncMessage('');
    setError(null); // Clear fetch error before sync
    console.log('Starting order sync...');
    try {
      const res = await fetch('/api/syncOrders');
      const json = await res.json();
      if (res.ok && json.success) {
        console.log("Sync successful:", json.message);
        setSyncMessage(json.message || 'Sync completed successfully!');
        // Refresh the orders table after successful sync
        await fetchOrders();
      } else {
        throw new Error(json.error || 'Failed to sync orders');
      }
    } catch (err) {
      console.error("Sync Orders Error:", err);
      setSyncError(err.message);
    } finally {
      setSyncLoading(false);
    }
  };

  // --- Label Generation Handler ---
  const handleGenerateLabel = async (rowData, rowIndex) => {
    // Use unique key from sheet (index 8) if available, otherwise fallback to row index
    const orderKey = rowData[8] ? String(rowData[8]) : `row-${rowIndex}`; 
    
    setLabelStates(prev => ({ ...prev, [orderKey]: { loading: true, error: null, tracking: null, url: null } }));

    // **CRITICAL TODO:** Map rowData columns to the structure expected by generateLabelForOrder
    // This depends HEAVILY on your Sheet's column order and the required fields for FedEx.
    // Ensure your sheet has columns for ALL required FedEx data (address parts, weight, phone etc.)
    // Example mapping (ADJUST INDICES AND FIELD NAMES BASED ON YOUR SHEET AND FEDEX REQUIREMENTS):
    const orderDataForApi = {
       orderKey: rowData[8] || null, // Pass the actual key if present
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
    { header: 'Market', index: 7 },
    { header: 'Customer Name', index: 1 },
    { header: 'Variant/Product', index: 2 },
    { header: 'Status', index: 5 },
    // { header: 'Order Key', index: 8 }, // Optional: Can display key if needed
    { header: 'Label', index: -1 }, // Special column, rendered based on labelStates
    { header: 'Actions', index: -2 }, // Special column for buttons
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
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Synced Orders</CardTitle>
            <CardDescription>Orders fetched from your Google Sheet.</CardDescription>
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" size="icon" onClick={fetchOrders} disabled={isLoading || syncLoading} title="Refresh Orders">
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={handleSync} disabled={isLoading || syncLoading} title="Sync Orders from Veeqo/Trendyol">
              <DownloadCloud className={`mr-2 h-4 w-4 ${syncLoading ? 'animate-spin' : ''}`} />
              {syncLoading ? 'Syncing...' : 'Sync Orders'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {(error || syncError) && (
          <p className="text-red-600 mb-4">Error: {error || syncError}</p>
        )}
        {syncMessage && (
          <p className="text-green-600 mb-4">{syncMessage}</p>
        )}
        {isLoading && !orders.length && <p>Loading orders...</p>}
        {!isLoading && !orders.length && !error && <p>No orders found in the sheet. Try syncing.</p>}
        {orders.length > 0 && (
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
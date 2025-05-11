import { google } from 'googleapis';
// Remove direct fetcher imports - logic moves to Apps Script
// import { fetchVeeqoOrders } from '@/lib/veeqo';
// import { fetchCreatedOrders, fetchShipmentUpdates } from '@/lib/trendyol';
// import { fetchShippoOrders } from '@/lib/shippo';
// import { appendSheetValues } from '@/lib/googleSheets';
import dotenv from 'dotenv';
// import { getSession } from 'next-auth/react'; // REMOVED
import { createPagesRouteHandlerClient } from '@/lib/supabase/server'; // ADDED
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

dotenv.config();

const prisma = new PrismaClient();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  // const supabase = createRouteHandlerClient({ cookies }); // REMOVED
  const supabase = createPagesRouteHandlerClient({ req, res }); // ADDED

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Supabase session error in syncOrders:', sessionError);
      return res.status(401).json({ message: 'Supabase session error', error: sessionError.message });
    }
    if (!session) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const userId = session.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.userAppsScriptId || !user.googleSheetId) {
      return res.status(400).json({ message: 'User Apps Script ID or Google Sheet ID is not configured.' });
    }

    const scriptId = user.userAppsScriptId;
    // IMPORTANT: Replace with your actual Apps Script API endpoint and deployment ID
    // This usually looks like: `https://script.google.com/macros/s/${deploymentId}/exec`
    // For testing, it might be a dev mode URL.
    // Ensure the Apps Script is deployed as a Web App accessible by "anyone" or "anyone, even anonymous"
    // if you are calling it from Vercel serverlessly, or configure OAuth2 correctly if restricted.
    const appsScriptUrl = `https://script.google.com/macros/s/${scriptId}/exec`; // Ensure this is the correct exec URL

    const tokenResponse = await supabase.auth.getSession(); // Re-fetch to ensure fresh token if needed for script
    const accessToken = tokenResponse?.data?.session?.provider_token; // Or access_token depending on provider and setup

    if (!accessToken) {
        // This might happen if the original OAuth token isn't stored or accessible as provider_token
        // Depending on Apps Script permissions, you might not need it if script is "execute as me" and "anyone" can run
        console.warn("Provider token (for Apps Script) not found in session. Proceeding without it.");
    }

    // Call the Google Apps Script function
    // The body of this request will depend on what your Apps Script `doPost` function expects
    const response = await axios.post(appsScriptUrl, {
      action: 'syncOrdersToSheet', // Example action
      sheetId: user.googleSheetId,
      // Potentially include other necessary parameters for your script
      // e.g., marketplace API keys if the script needs to fetch orders directly
      // trendyolApiKey: user.trendyolApiKey, 
      // ... other keys
    }, {
      headers: {
        // 'Authorization': `Bearer ${accessToken}`, // Conditionally add if your script requires it and token is available
        ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 200 && response.data) {
      // Assuming the Apps Script returns some data, e.g., number of orders synced or status
      return res.status(200).json({ message: 'Orders sync initiated successfully with Apps Script.', data: response.data });
    } else {
      // Handle non-200 responses or missing data from Apps Script
      console.error('Apps Script execution failed or returned unexpected data:', response.status, response.data);
      return res.status(response.status || 500).json({ message: 'Failed to execute Apps Script order sync.', details: response.data });
    }

  } catch (error) {
    console.error('Error in syncOrders API route:', error.response ? error.response.data : error.message);
    // If axios error, error.response might contain more details
    if (error.isAxiosError && error.response) {
        return res.status(error.response.status || 500).json({ message: 'Error calling Apps Script', details: error.response.data });
    }
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
} 
import { google } from 'googleapis';
// Remove direct fetcher imports - logic moves to Apps Script
// import { fetchVeeqoOrders } from '@/lib/veeqo';
// import { fetchCreatedOrders, fetchShipmentUpdates } from '@/lib/trendyol';
// import { fetchShippoOrders } from '@/lib/shippo';
// import { appendSheetValues } from '@/lib/googleSheets';
import dotenv from 'dotenv';
import { getSession } from 'next-auth/react';
import prisma from '@/lib/prisma';

dotenv.config();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Use the Apps Script project/script ID or fallback to the deployment ID env var
  const scriptId = process.env.TEMP_USER_SCRIPT_ID || process.env.NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID;
  console.log('/api/syncOrders – using script ID:', scriptId);
  if (!scriptId) {
    console.error('/api/syncOrders Error: Missing script ID in environment variables.');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let session;
  try {
    // Authenticate user via NextAuth
    session = await getSession({ req });
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = session.user.id;

    // Fetch user-specific Google Sheet ID and API keys
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        googleSheetId: true,
        veeqoApiKey: true,
        shippoToken: true,
        // Include other keys needed by the Core Library's syncOrderData_
        // fedexAccountNumber: true, 
        // fedexMeterNumber: true,
        // fedexApiKey: true,
        // fedexSecretKey: true,
        // Add TRENDYOL keys if used by syncOrderData_
      },
    });

    if (!userRecord?.googleSheetId) {
      // User might not have completed onboarding
      return res.status(400).json({ error: 'User setup incomplete: Google Sheet ID missing.' });
    }

    // Prepare the API keys object required by the Apps Script function
    // Ensure these keys match what syncOrdersToSheet expects, and ultimately what syncOrderData_ in the core library expects
    const userApiKeys = {
      VEEQO_API_KEY: userRecord.veeqoApiKey,
      SHIPPO_TOKEN: userRecord.shippoToken,
      // Add other necessary keys from userRecord here...
    };

    // Basic check if essential keys are present before calling script
    if (!userApiKeys.VEEQO_API_KEY /* && !userApiKeys.SHIPPO_TOKEN etc.*/) {
        console.warn(`User ${userId} attempting sync without necessary API keys.`);
        return res.status(400).json({ error: 'API keys missing in settings.' });
    }

    // Authenticate as the user for Apps Script operations
    const oauthAccount = await prisma.account.findFirst({ where: { userId, provider: 'google' } });
    if (!oauthAccount?.access_token) {
      console.error(`Sync Error: Missing OAuth access token for user ${userId}`);
      return res.status(500).json({ error: 'Server configuration error.' });
    }
    const userAuth = new google.auth.OAuth2();
    userAuth.setCredentials({ access_token: oauthAccount.access_token });
    const scriptAPI = google.script({ version: 'v1', auth: userAuth });
    
    console.log(`Executing Apps Script function 'syncOrdersToSheet' via Script ID: ${scriptId} for user ${userId}`);

    const scriptResponse = await scriptAPI.scripts.run({
      scriptId, // script project ID
      resource: {
        function: 'syncOrdersToSheet',
        parameters: [userRecord.googleSheetId, userApiKeys],
      },
    });

    console.log('Apps Script execution response:', JSON.stringify(scriptResponse.data, null, 2));

    if (scriptResponse.data.error) {
      // Handle script execution errors (e.g., script threw an error)
      console.error('Apps Script Error:', scriptResponse.data.error);
      // Check if the error is from the script itself (e.g., missing props)
      const scriptError = scriptResponse.data.error.details?.[0]?.error?.message || scriptResponse.data.error.message || 'Unknown script error';
      return res.status(500).json({ error: `Script Execution Failed: ${scriptError}` });
    }

    // Handle script success
    const result = scriptResponse.data.response?.result;
    if (result?.error) {
       // Handle errors returned explicitly by the script function
       console.error('Apps Script Function Returned Error:', result.error);
       return res.status(500).json({ error: `Sync Failed: ${result.error}` });
    }

    // Assuming success, return relevant data from the script if needed
    // The current script returns { success: true, appendedRows: N }
    return res.status(200).json({ 
        success: true, 
        message: `Sync completed. ${result?.appendedRows || 0} new rows added.`,
        scriptResult: result // Include the full script result if useful for frontend
    });

  } catch (err) {
    console.error('API Route /api/syncOrders Error:', err);
    // Handle errors in the API route itself (auth, network, etc.)
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
} 
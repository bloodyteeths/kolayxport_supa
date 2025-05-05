import { google } from 'googleapis';
import dotenv from 'dotenv';
import { getSession } from 'next-auth/react';
import prisma from '@/lib/prisma';

dotenv.config();

// --- Helper Functions (Copied from syncOrders.js) ---
async function getAppsScriptAPI() {
  const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  } = process.env;
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error('Missing Google Service Account credentials.');
  }
  const auth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/script.projects']
  );
  await auth.authorize();
  return google.script({ version: 'v1', auth });
}

// No longer needed, we use the central deployment ID
// async function getUserScriptId(req) { ... }

// --- End Helper Functions ---

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Use the Apps Script deployment ID, or fallback to the project SCRIPT ID
  const scriptId = process.env.NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID || process.env.TEMP_USER_SCRIPT_ID;
  if (!scriptId) {
    console.error('/api/getOrders Error: Missing script deployment ID or script ID in environment variable.');
    return res.status(500).json({ error: 'Server configuration error.'});
  }

  let session;
  try {
    // Authenticate user via NextAuth
    session = await getSession({ req });
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = session.user.id;

    // Fetch user-specific Google Sheet ID
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleSheetId: true },
    });
    
    if (!userRecord?.googleSheetId) {
      // User might not have completed onboarding
      return res.status(400).json({ error: 'User setup incomplete: Google Sheet ID missing.' });
    }
    
    const oauthAccount = await prisma.account.findFirst({ where: { userId, provider: 'google' } });
    if (!oauthAccount?.access_token) {
      console.error(`Missing OAuth access token for user ${userId}`);
      return res.status(500).json({ error: 'Server configuration error.' });
    }
    // Create an OAuth2 client with client credentials allowing refresh
    const userAuth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    // Set both the current access token and refresh token
    userAuth.setCredentials({
      access_token: oauthAccount.access_token,
      refresh_token: oauthAccount.refresh_token,
    });
    // Re-enable explicit refresh and add detailed logging
    try {
      console.log('Attempting to get/refresh access token...');
      const { token } = await userAuth.getAccessToken();
      console.log('Successfully obtained/refreshed access token for Sheets API:', token ? 'Token received' : 'Token NOT received');
      // Ensure the client uses the potentially new token
      userAuth.setCredentials({ access_token: token }); 
    } catch (refreshErr) {
      console.error('Detailed error obtaining/refreshing access token:', JSON.stringify(refreshErr, null, 2));
      // Log the specific error properties if available
      if (refreshErr.response?.data) {
         console.error('Refresh token error details:', JSON.stringify(refreshErr.response.data, null, 2));
      }
      return res.status(500).json({ error: `Failed to obtain valid access token: ${refreshErr.message}` });
    }

/* // Remove Drive API test call
    // --- TEST DRIVE API CALL --- 
    try {
      console.log('Initializing Google Drive client...');
      const drive = google.drive({ version: 'v3', auth: userAuth });
      console.log('Attempting Drive API call (files.list, pageSize 1)...');
      const driveResponse = await drive.files.list({ pageSize: 1, fields: 'files(id, name)' });
      console.log('Drive API call successful:', JSON.stringify(driveResponse.data, null, 2));
      // If Drive works, return a temporary success message
      return res.status(200).json({ success: true, message: "Drive API test successful.", driveData: driveResponse.data });
    } catch (driveErr) {
      console.error('Drive API Call Error:', JSON.stringify(driveErr, null, 2));
       if (driveErr.response?.data) {
         console.error('Drive API error details:', JSON.stringify(driveErr.response.data, null, 2));
      }
      // Return Drive error if it occurs
      return res.status(500).json({ error: `Drive API test failed: ${driveErr.message}` });
    }
    // --- END TEST DRIVE API CALL ---
*/
 // Restore Sheets API call
    // const scriptAPI = google.script({ version: 'v1', auth: userAuth }); // Not used in this API route

    // Use the Google Sheets API directly to fetch rows from the 'integration' sheet
    console.log(`Fetching rows via Sheets API for sheet ${userRecord.googleSheetId}`);
    const sheets = google.sheets({ version: 'v4', auth: userAuth });
    const SHEET_NAME = 'Kargov2';
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: userRecord.googleSheetId,
        range: `${SHEET_NAME}!A2:I`,
        valueRenderOption: 'FORMATTED_VALUE',
      });
      const sheetData = response.data.values || [];
      console.log(`Fetched ${sheetData.length} rows from sheet.`);
      return res.status(200).json({ success: true, data: sheetData });
    } catch (sheetsErr) {
      console.error('Sheets API Error (getOrders):', sheetsErr);
      return res.status(500).json({ error: `Failed to fetch sheet data: ${sheetsErr.message}` });
    }
 // End Restore Sheets API call

  } catch (err) {
    console.error('API Route /api/getOrders Error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
} 
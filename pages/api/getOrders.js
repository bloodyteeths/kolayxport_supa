import { google } from 'googleapis';
import dotenv from 'dotenv';
// import { getSession } from 'next-auth/react'; // REMOVED
import { createPagesRouteHandlerClient } from '@/lib/supabase/server'; // ADDED
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();

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

async function getGoogleSheetData(auth, spreadsheetId, range) {
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    return response.data.values;
  } catch (err) {
    console.error('The API returned an error: ' + err);
    throw new Error(`Failed to retrieve data from Google Sheet: ${err.message}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  // const supabase = createRouteHandlerClient({ cookies }); // REMOVED
  const supabase = createPagesRouteHandlerClient({ req, res }); // ADDED

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Supabase session error in getOrders:', sessionError);
      return res.status(401).json({ message: 'Supabase session error', error: sessionError.message });
    }
    if (!session) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const userId = session.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleSheetId: true }
    });

    if (!user || !user.googleSheetId) {
      return res.status(400).json({ message: 'Google Sheet ID not configured for this user.' });
    }

    // Fetch Google OAuth token from Account table for this user
    const account = await prisma.account.findFirst({
        where: {
            userId: userId,
            provider: 'google' // Assuming you store Google OAuth tokens with provider 'google'
        }
    });

    if (!account || !account.access_token) {
        return res.status(401).json({ message: "User's Google OAuth token not found or expired. Please re-authenticate." });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: account.access_token });
    // Note: For long-lived access, you'd typically handle token refresh using account.refresh_token
    // This example assumes the access_token is still valid.

    const sheetData = await getGoogleSheetData(auth, user.googleSheetId, 'Kargov2!A:Z'); // Or your specific sheet name and range

    if (!sheetData || sheetData.length === 0) {
      return res.status(404).json({ message: 'No data found in the Google Sheet or sheet is empty.' });
    }

    // Assuming the first row is headers
    const headers = sheetData[0];
    const orders = sheetData.slice(1).map(row => {
      let order = {};
      headers.forEach((header, index) => {
        order[header] = row[index];
      });
      return order;
    });

    return res.status(200).json(orders);

  } catch (error) {
    console.error('Error in getOrders API route:', error.message);
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
} 
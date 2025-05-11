// import { getSession } from 'next-auth/react'; // REMOVED
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'; // ADDED
import { cookies } from 'next/headers'; // ADDED
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import prisma from '@/lib/prisma'; // Your prisma client instance
import dotenv from 'dotenv';

dotenv.config();

// --- Helper: Get Google API Client authenticated AS THE USER (with auto-refresh) ---
function getUserGoogleApiClient({ access_token, refresh_token, expires_at }) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({
    access_token,
    refresh_token,
    expiry_date: expires_at ? new Date(expires_at * 1000).getTime() : undefined // Ensure expiry_date is a number
  });
  auth.requestOptions = { quotaProjectId: process.env.GCP_PROJECT_ID };
  return auth;
}

// Helper function to get Google API client authenticated as the service account (if needed for sharing)
async function getServiceAccountAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON environment variable is not set');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'], // Scope for sharing
    clientOptions: { quotaProjectId: process.env.GCP_PROJECT_ID }
  });
  return auth.getClient();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // const session = await getSession({ req }); // REMOVED
  const supabase = createRouteHandlerClient({ cookies }); // ADDED
  const { data: { session }, error: sessionError } = await supabase.auth.getSession(); // ADDED

  if (sessionError) { // ADDED
    console.error('Supabase getSession error in onboarding/setup:', sessionError); // ADDED
    return res.status(500).json({ error: 'Authentication error' }); // ADDED
  } // ADDED

  if (!session || !session.user?.id) {
    console.error('Onboarding Error: Unauthorized. No session or user ID.');
    return res.status(401).json({ message: 'Authentication required.' });
  }
  const userId = session.user.id;
  const oauthAccount = await prisma.account.findFirst({
    where: { userId, provider: 'google' }
  });
  if (!oauthAccount?.access_token) {
    console.error(`Onboarding Error: No OAuth access token found for user ${userId}.`);
    return res.status(401).json({ message: 'Authentication required (no access token).' });
  }
  const { access_token, refresh_token, expires_at } = oauthAccount;

  // Use the ID of the template Google Sheet that has the script bound to it
  const TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID = process.env.TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID; 
  // const MASTER_TEMPLATE_SCRIPT_PROJECT_ID = process.env.MASTER_TEMPLATE_SCRIPT_PROJECT_ID; // No longer used here

  if (!TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID) {
    console.error('Onboarding Error: TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID not configured.');
    return res.status(500).json({ error: 'Server configuration error: Missing template sheet ID.' });
  }
  // if (!MASTER_TEMPLATE_SCRIPT_PROJECT_ID) { // No longer used here
  //   console.error('Onboarding Error: MASTER_TEMPLATE_SCRIPT_PROJECT_ID not configured.');
  //   return res.status(500).json({ error: 'Server configuration error: Missing master script project ID.' });
  // }

  let driveFolderId;
  // googleSheetId, userAppsScriptId, and spreadsheetUrl are no longer determined by this API.

  try {
    let existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { driveFolderId: true, googleSheetId: true, userAppsScriptId: true } // Select all for context, though we mainly act on driveFolderId
    });

    driveFolderId = existingUser?.driveFolderId;
    
    console.log(`Starting user resource check/setup for user ${userId}...`);

    const userAuth = getUserGoogleApiClient({ access_token, refresh_token, expires_at });
    const drive = google.drive({ version: 'v3', auth: userAuth });
    // const scriptApi = google.script({ version: 'v1', auth: userAuth }); // No longer used here

    let folderJustCreated = false;
    if (!driveFolderId) {
      console.log(`User ${userId}: Creating Drive folder 'KolayXport Kullanıcı Dosyaları'...`);
      const folderMetadata = {
        name: `KolayXport Kullanıcı Dosyaları - ${session.user.name || userId}`,
        mimeType: 'application/vnd.google-apps.folder'
      };
      try {
        const folder = await drive.files.create({
           resource: folderMetadata,
           fields: 'id' 
        });
        driveFolderId = folder.data.id;
        if (!driveFolderId) throw new Error('Drive folder created but ID was not returned.');
        console.log(`User ${userId}: Created Drive folder ID: ${driveFolderId}`);
        folderJustCreated = true;
      } catch (driveErr) {
         console.error(`User ${userId}: Drive folder creation failed:`, driveErr);
         if (driveErr.code === 403) { // Check for 403 specifically
           return res.status(500).json({ error: 'Google Drive API permission denied or API not enabled for user.'});
         }
         throw new Error(`Failed to create Drive folder.`);
      }
    } else {
       console.log(`User ${userId}: Drive folder already exists: ${driveFolderId}`);
    }
    
    // If folder was just created, update the user record in Prisma with the new driveFolderId.
    // We do not touch googleSheetId or userAppsScriptId here.
    if (folderJustCreated && driveFolderId) {
      console.log(`User ${userId}: Updating database with new Drive Folder ID: ${driveFolderId}`);
      await prisma.user.update({
        where: { id: userId },
        data: {
          driveFolderId: driveFolderId,
          // Explicitly NOT setting googleSheetId or userAppsScriptId here
        },
      });
      console.log(`User ${userId}: Database updated with Drive Folder ID.`);
    } else if (driveFolderId && !existingUser?.driveFolderId) {
      // This case handles if the user record somehow didn't have the folderId stored
      // but we retrieved or created one. Ensures it's linked.
      console.log(`User ${userId}: Linking existing/newly created Drive Folder ID ${driveFolderId} to user in database.`);
       await prisma.user.update({
        where: { id: userId },
        data: {
          driveFolderId: driveFolderId,
        },
      });
      console.log(`User ${userId}: Database updated with Drive Folder ID linkage.`);
    }


    // --- Construct the manual copy URL ---
    const copyUrl = `https://docs.google.com/spreadsheets/d/${TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID}/copy`;
    console.log(`User ${userId}: Generated manual copy URL: ${copyUrl}`);

    // --- Remove all sheet copying and Apps Script API logic ---
    // (All previous code for drive.files.copy and scriptApi.* calls is removed)

    // --- Remove Service Account Sharing Logic ---
    // (The section for sharing with GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL is removed)


    // --- Update Prisma Database (removed, handled above for driveFolderId only) ---
    
    console.log(`User ${userId}: Onboarding setup prepared for manual sheet copy.`);
    return res.status(200).json({
      success: true, 
      message: 'Folder ready. Please use the provided URL to make a copy of the template sheet.',
      data: {
        driveFolderId: driveFolderId, // ensure this is the one we confirmed or created
        copyUrl: copyUrl,
        // googleSheetId, userAppsScriptId, spreadsheetUrl are no longer returned by this API directly.
        // The frontend will know if these are already set for the user via its own session/user state.
      },
    });

  } catch (error) {
    console.error(`User ${userId}: Critical onboarding error in main try-catch:`, error.message, error.stack);
    // Log the full error object if it's available and might contain more details (like a GaxiosError)
    if (error.response && error.errors) {
        console.error(`User ${userId}: Full Google API error object:`, JSON.stringify(error.response.data, null, 2));
    } else {
        console.error(`User ${userId}: Full error object:`, error);
    }
    
    return res.status(500).json({
      error: 'An unexpected error occurred during the onboarding process.',
      details: error.message,
    });
  }
} 
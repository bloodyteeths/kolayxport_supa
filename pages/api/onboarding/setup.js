import { getSession } from 'next-auth/react';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import prisma from '@/lib/prisma'; // Your prisma client instance
import dotenv from 'dotenv';

dotenv.config();

// --- Helper: Get Google API Client authenticated AS THE USER (with auto-refresh) ---
// Accepts access_token, refresh_token, and expiry to auto-refresh tokens
function getUserGoogleApiClient({ access_token, refresh_token, expires_at }) {
  // Include clientId and clientSecret so OAuth2 can auto-refresh
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({
    access_token,
    refresh_token,
    expiry_date: expires_at * 1000
  });
  return auth;
}

// Helper function to get Google API client authenticated as the service account
async function getServiceAccountGoogleApiClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON environment variable is not set');
  }
  
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.projects',
    ],
  });
  
  return auth.getClient();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const session = await getSession({ req });
  if (!session || !session.user?.id) {
    console.error('Onboarding Error: Unauthorized. No session or user ID.');
    return res.status(401).json({ message: 'Authentication required.' });
  }
  const userId = session.user.id;
  // Retrieve the stored OAuth access token from Prisma's Account table
  const oauthAccount = await prisma.account.findFirst({
    where: { userId, provider: 'google' }
  });
  if (!oauthAccount?.access_token) {
    console.error(`Onboarding Error: No OAuth access token found for user ${userId}.`);
    return res.status(401).json({ message: 'Authentication required.' });
  }
  // Destructure access and refresh tokens for user authentication
  const { access_token, refresh_token, expires_at } = oauthAccount;

  // Read master template sheet ID and WRAPPER SCRIPT template ID from environment
  const TEMPLATE_SHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const TEMPLATE_WRAPPER_SCRIPT_FILE_ID = process.env.TEMPLATE_WRAPPER_SCRIPT_FILE_ID;

  if (!TEMPLATE_SHEET_ID) {
    console.error('Onboarding Error: GOOGLE_SHEETS_SPREADSHEET_ID not configured.');
    return res.status(500).json({ error: 'Server configuration error: Missing template sheet ID.' });
  }
  if (!TEMPLATE_WRAPPER_SCRIPT_FILE_ID) {
    console.error('Onboarding Error: TEMPLATE_WRAPPER_SCRIPT_FILE_ID not configured.');
    return res.status(500).json({ error: 'Server configuration error: Missing template script ID.' });
  }

  let googleSheetId, driveFolderId, userAppsScriptId;

  try {
    // --- Check if user already fully onboarded --- 
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleSheetId: true, driveFolderId: true, userAppsScriptId: true } // Select all relevant IDs
    });

    // If all IDs exist, onboarding is complete
    if (existingUser?.googleSheetId && existingUser?.driveFolderId && existingUser?.userAppsScriptId) {
      console.log(`User ${userId} already fully onboarded.`);
      return res.status(200).json({ 
          success: true, 
          message: 'User already onboarded.', 
          data: { 
              googleSheetId: existingUser.googleSheetId, 
              driveFolderId: existingUser.driveFolderId, 
              userAppsScriptId: existingUser.userAppsScriptId 
            }
      });
    }

    // Assign existing values if partially onboarded
    googleSheetId = existingUser?.googleSheetId;
    driveFolderId = existingUser?.driveFolderId;
    userAppsScriptId = existingUser?.userAppsScriptId;

    console.log(`Starting/Resuming onboarding for user ${userId}...`);

    // --- Authenticate as the User for Drive/Sheet operations (with refresh) ---
    const userAuth = getUserGoogleApiClient({ access_token, refresh_token, expires_at });
    const drive = google.drive({ version: 'v3', auth: userAuth });
    const sheets = google.sheets({ version: 'v4', auth: userAuth });

    // --- 1. Create "myBabySync_ShippingLabels" Folder (if needed) --- 
    if (!driveFolderId) {
      console.log(`User ${userId}: Creating Drive folder...`);
      const folderMetadata = {
        name: 'myBabySync_ShippingLabels', // Consider making name more unique per user if needed
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
      } catch (driveErr) {
         console.error(`User ${userId}: Drive folder creation failed:`, driveErr);
         // If the Drive API is not enabled in the GCP project, return a helpful error
         if (driveErr.code === 403) {
           return res.status(500).json({
             error: 'Google Drive API is disabled for your Google Cloud project. Please enable it at https://console.developers.google.com/apis/api/drive.googleapis.com/overview'
           });
         }
         throw new Error(`Failed to create Drive folder.`);
      }
    } else {
       console.log(`User ${userId}: Drive folder already exists: ${driveFolderId}`);
    }
    
    // --- 2. Create New Google Sheet (if needed) --- 
    if (!googleSheetId) {
      console.log(`User ${userId}: Creating new Google Sheet...`);
      try {
        const spreadsheet = await sheets.spreadsheets.create({
          resource: {
            properties: {
              // Dynamically set title using user's name/email for uniqueness
              title: `KolayXport Kargo Takip - ${session.user.name || session.user.email || userId}` 
            }
          },
          fields: 'spreadsheetId,spreadsheetUrl' // Get ID and URL
        });

        googleSheetId = spreadsheet.data.spreadsheetId;
        if (!googleSheetId) throw new Error('Spreadsheet created but ID was not returned.');
        console.log(`User ${userId}: Created new Sheet ID: ${googleSheetId}, URL: ${spreadsheet.data.spreadsheetUrl}`);

        // Move the newly created sheet to the user's Drive folder
        if (driveFolderId) {
          console.log(`User ${userId}: Moving sheet ${googleSheetId} to folder ${driveFolderId}...`);
          await drive.files.update({
            fileId: googleSheetId,
            addParents: driveFolderId,
            removeParents: 'root', // Remove from root if it was added there by default
            fields: 'id, parents'
          });
          console.log(`User ${userId}: Successfully moved sheet ${googleSheetId} to folder ${driveFolderId}.`);
        } else {
          console.warn(`User ${userId}: driveFolderId is not defined, cannot move sheet ${googleSheetId} to a folder.`);
        }

        // Rename the first sheet (gid=0) to "Kargov2"
        console.log(`User ${userId}: Renaming first sheet in ${googleSheetId} to 'Kargov2'...`);
        // Find the sheetId of the first sheet (usually 0, but safer to fetch)
        const sheetMetadata = await sheets.spreadsheets.get({
            spreadsheetId: googleSheetId,
            fields: 'sheets(properties(sheetId,index))',
        });
        const firstSheetId = sheetMetadata.data.sheets?.find(s => s.properties?.index === 0)?.properties?.sheetId;

        if (firstSheetId === undefined || firstSheetId === null) {
           console.warn(`User ${userId}: Could not find the first sheet (index 0) in new spreadsheet ${googleSheetId} to rename.`);
        } else {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: googleSheetId,
            requestBody: {
              requests: [
                {
                  updateSheetProperties: {
                    properties: {
                      sheetId: firstSheetId, // Use the fetched sheetId
                      title: "Kargov2",
                    },
                    fields: "title",
                  },
                },
              ],
            },
          });
          console.log(`User ${userId}: Renamed first sheet to 'Kargov2'.`);
        }
      } catch (sheetCreateErr) {
         console.error(`User ${userId}: Failed to create or rename new Google Sheet:`, sheetCreateErr);
         // Add specific error handling if needed (e.g., Sheets API disabled)
         if (sheetCreateErr.code === 403) {
           return res.status(500).json({
             error: 'Google Sheets API may be disabled or user lacks permission to create sheets. Please check Google Cloud Console.'
           });
         }
         throw new Error(`Failed to create/setup new Google Sheet. ${sheetCreateErr.message || ''}`);
      }
    } else {
      console.log(`User ${userId}: Sheet already exists: ${googleSheetId}`);
    }

    // --- 3. Copy Template Wrapper Script (if needed) --- 
    if (!userAppsScriptId) {
      console.log(`User ${userId}: Preparing to copy template wrapper script using USER authentication...`);
      console.log(`User ${userId}: Template Script ID from env: ${TEMPLATE_WRAPPER_SCRIPT_FILE_ID}`);
      console.log(`User ${userId}: User email attempting copy: ${session.user.email}`);
      
      try {
        // Verify template script details first
        try {
          console.log(`User ${userId}: Verifying details for template script ID: ${TEMPLATE_WRAPPER_SCRIPT_FILE_ID}`);
          const templateFileMeta = await drive.files.get({
            fileId: TEMPLATE_WRAPPER_SCRIPT_FILE_ID,
            fields: 'id, name, mimeType, trashed',
            supportsAllDrives: true,
          });
          console.log(`User ${userId}: Template script details: Name: ${templateFileMeta.data.name}, MIME Type: ${templateFileMeta.data.mimeType}, ID: ${templateFileMeta.data.id}, Trashed: ${templateFileMeta.data.trashed}`);
          if (templateFileMeta.data.mimeType !== 'application/vnd.google-apps.script') {
            throw new Error(`Template script has incorrect MIME type: ${templateFileMeta.data.mimeType}`);
          }
          if (templateFileMeta.data.trashed) {
            throw new Error('Template script is in the trash.');
          }
        } catch (verifyErr) {
          console.error(`User ${userId}: Failed to verify template script:`, verifyErr);
          // Rethrow or handle as critical error, as copy will likely fail
          throw new Error(`Critical error verifying template script before copy: ${verifyErr.message}`);
        }
        
        const scriptCopyMetadata = { 
          name: `KolayXport Wrapper Script - ${session.user.name || session.user.email || userId}`, // Unique name
          mimeType: 'application/vnd.google-apps.script',
          parents: [driveFolderId] // CRITICAL: Place copy in the user's folder
        }; 

        console.log(`User ${userId}: Attempting to copy script with metadata:`, JSON.stringify(scriptCopyMetadata));

        // Perform the copy using USER auth
        const copiedScriptFile = await drive.files.copy({ // Using `drive` which is user-authenticated
          fileId: TEMPLATE_WRAPPER_SCRIPT_FILE_ID,
          requestBody: scriptCopyMetadata, 
          fields: 'id, name, webViewLink', // Request id, name, and webViewLink
          supportsAllDrives: true 
        });
        
        userAppsScriptId = copiedScriptFile.data.id;
        console.log(`User ${userId}: Copied script successfully. New Script ID: ${userAppsScriptId}, Name: ${copiedScriptFile.data.name}, Link: ${copiedScriptFile.data.webViewLink}`);

      } catch (scriptCopyErr) {
        console.error(`User ${userId}: USER failed Wrapper script copy attempt:`, scriptCopyErr);
        console.error(`User ${userId}: Detailed error from Google:`, JSON.stringify(scriptCopyErr.response?.data, null, 2));
        let rawErrorString = 'Error details not available or stringification failed.';
        try {
          rawErrorString = JSON.stringify(scriptCopyErr, Object.getOwnPropertyNames(scriptCopyErr), 2);
        } catch (e) {
          rawErrorString = `Error stringifying scriptCopyErr: ${e.message}. Raw error message: ${scriptCopyErr.message}`;
        }
        console.error(`User ${userId}: Raw user scriptCopyErr object:`, rawErrorString);

        let errorMessage = 'Failed to copy the template script using your Google account.';
        if (scriptCopyErr.code) {
          errorMessage += ` (Code: ${scriptCopyErr.code})`;
          if (scriptCopyErr.code === 404) {
            errorMessage += ` Please ensure the template script (ID starting ${TEMPLATE_WRAPPER_SCRIPT_FILE_ID.substring(0, 6)}...) is shared correctly (Anyone with link -> Viewer).`;
          } else if (scriptCopyErr.code === 403) {
             errorMessage += ` You might lack permission to copy this specific file, or the Drive API might be disabled for the project.`;
          }
        }
        if (scriptCopyErr.errors && scriptCopyErr.errors[0] && scriptCopyErr.errors[0].message) {
          errorMessage += ` Details: ${scriptCopyErr.errors[0].message}`;
        }

        return res.status(500).json({ error: errorMessage, details: rawErrorString });
      }
    } else {
      console.log(`User ${userId}: Wrapper script already exists: ${userAppsScriptId}`);
    }

    // --- 4. Save IDs to Database --- 
    if (driveFolderId || googleSheetId || userAppsScriptId) { // Only update if at least one new ID was generated
      console.log(`User ${userId}: Updating database with IDs - Sheet: ${googleSheetId}, Folder: ${driveFolderId}, Script: ${userAppsScriptId}`);
      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            ...(googleSheetId && { googleSheetId }), // Conditionally add if defined
            ...(driveFolderId && { driveFolderId }), // Conditionally add if defined
            ...(userAppsScriptId && { userAppsScriptId }), // Conditionally add if defined
          },
        });
        console.log(`User ${userId}: Database updated successfully with new IDs.`);
      } catch (dbError) {
        console.error(`User ${userId}: Database update failed:`, dbError);
        // Critical: If DB update fails after creating Google resources, user is in an inconsistent state.
        // This specific error should be clearly logged and communicated.
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to save setup progress to database. Please contact support.',
            details: dbError.message // Provide some detail for debugging
        });
      }
    }

    // --- 5. Set FEDEX_FOLDER_ID in the new script's UserProperties on the server ---
    try {
      console.log(`User ${userId}: Setting FEDEX_FOLDER_ID (${driveFolderId}) in Apps Script ${userAppsScriptId}`);
      const scriptApi = google.script({ version: 'v1', auth: userAuth });
      const execResponse = await scriptApi.scripts.run({
        // Use the locked-down API executable deployment
        scriptId: 'AKfycby4D7mkv-F3ZVJ1-MJcFbx23wy8q-B7TEkkNc6p68S4-We50VZlfUStrBktzoPAaBblJA',
        resource: {
          function: 'saveToUserProperties',
          parameters: ['FEDEX_FOLDER_ID', driveFolderId],
        },
      });
      if (execResponse.data.error) {
        console.error(`User ${userId}: Apps Script error setting FEDEX_FOLDER_ID:`, JSON.stringify(execResponse.data.error, null, 2));
      } else {
        console.log(`User ${userId}: FEDEX_FOLDER_ID set successfully in Apps Script.`);
      }
    } catch (propErr) {
      console.error(`User ${userId}: Failed to set FEDEX_FOLDER_ID in Apps Script:`, propErr);
    }

    // --- Success --- 
    console.log(`User ${userId}: Onboarding process completed successfully.`);
    return res.status(200).json({
      success: true,
      message: 'Onboarding complete. Resources created and IDs saved.',
      data: {
        googleSheetId,
        driveFolderId,
        userAppsScriptId,
      },
    });

  } catch (error) {
    // This is a general catch-all for errors during the onboarding steps (Drive/Sheet/Script creation)
    console.error(`User ${userId}: Critical onboarding error in main try-catch:`, error.message);
    console.error(`User ${userId}: Full error object:`, error);
    // Ensure a JSON response is always sent for errors caught here
    return res.status(500).json({ 
        success: false, 
        error: error.message || 'An unexpected error occurred during account setup.', 
        details: error.stack // Include stack for debugging if available
    });
  }
} 
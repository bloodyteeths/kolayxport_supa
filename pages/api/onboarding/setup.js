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
  auth.requestOptions = { quotaProjectId: process.env.GCP_PROJECT_ID };
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
    clientOptions: { quotaProjectId: process.env.GCP_PROJECT_ID }
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

  let googleSheetId, driveFolderId, userAppsScriptId, spreadsheetUrl, scriptWebViewLink;

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
        // Store the spreadsheet URL to return later
        spreadsheetUrl = spreadsheet.data.spreadsheetUrl; 

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
      
      let templateScriptWebViewLinkForManualCopy = null; // For fallback

      try {
        // First, try to get the webViewLink of the template itself for fallback
        try {
          console.log(`User ${userId}: Fetching webViewLink for template script ID: ${TEMPLATE_WRAPPER_SCRIPT_FILE_ID}`);
          const templateFileForLink = await drive.files.get({
            fileId: TEMPLATE_WRAPPER_SCRIPT_FILE_ID,
            fields: 'webViewLink, id, name, mimeType, trashed', // Include verification fields too
            supportsAllDrives: true,
          });
          templateScriptWebViewLinkForManualCopy = templateFileForLink.data.webViewLink;
          console.log(`User ${userId}: Template script details: Name: ${templateFileForLink.data.name}, MIME Type: ${templateFileForLink.data.mimeType}, ID: ${templateFileForLink.data.id}, Trashed: ${templateFileForLink.data.trashed}, WebViewLink: ${templateScriptWebViewLinkForManualCopy}`);
          
          if (templateFileForLink.data.mimeType !== 'application/vnd.google-apps.script') {
            throw new Error(`Template script has incorrect MIME type: ${templateFileForLink.data.mimeType}`);
          }
          if (templateFileForLink.data.trashed) {
            throw new Error('Template script is in the trash.');
          }
        } catch (verifyErr) {
          console.error(`User ${userId}: Failed to verify template script or get its webViewLink:`, verifyErr.message);
          // This is critical. If we can't verify or get the link, the copy will likely fail or fallback won't work.
          // For now, we'll throw, but this could be handled by trying to proceed without templateScriptWebViewLinkForManualCopy
          throw new Error(`Critical error verifying template script before copy: ${verifyErr.message}`);
        }
        
        const scriptCopyMetadata = { 
          name: `KolayXport Wrapper Script - ${session.user.name || session.user.email || userId}`, // Unique name
          mimeType: 'application/vnd.google-apps.script',
          parents: [driveFolderId] // CRITICAL: Place copy in the user's folder
        }; 

        console.log(`User ${userId}: Attempting to copy script with metadata:`, JSON.stringify(scriptCopyMetadata));

        // Perform the copy using USER auth with enhanced retry logic
        let copiedScriptFile = null;
        const maxRetries = 3;
        let copyAttempt = 0; // Renamed from 'attempt' to avoid conflict if declared elsewhere
        let lastScriptCopyError = null;

        while (copyAttempt < maxRetries) {
          copyAttempt++;
          try {
            copiedScriptFile = await drive.files.copy({
              fileId: TEMPLATE_WRAPPER_SCRIPT_FILE_ID,
              requestBody: scriptCopyMetadata, 
              fields: 'id, name, webViewLink',
              supportsAllDrives: true 
            });
            lastScriptCopyError = null; // Clear last error on success
            console.log(`User ${userId}: Script copy successful on attempt ${copyAttempt}.`);
            break; // Exit loop on success
          } catch (scriptCopyAttemptErr) {
            lastScriptCopyError = scriptCopyAttemptErr;
            console.warn(`User ${userId}: Attempt ${copyAttempt} to copy script failed. Error Code: ${scriptCopyAttemptErr.code}. Message: ${scriptCopyAttemptErr.message}`);
            
            // Only retry for 500-series errors and if not max retries
            if (scriptCopyAttemptErr.code && scriptCopyAttemptErr.code >= 500 && scriptCopyAttemptErr.code < 600 && copyAttempt < maxRetries) {
              const delay = Math.pow(2, copyAttempt -1) * 500 + Math.random() * 200; // attempt is 1-based for pow
              console.log(`User ${userId}: Retrying in ${delay.toFixed(0)}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              console.error(`User ${userId}: Script copy failed after ${copyAttempt} attempts or error is non-retryable (Code: ${scriptCopyAttemptErr.code}).`);
              // Do not rethrow here; we'll handle it after the loop
              break; 
            }
          }
        }

        if (copiedScriptFile && copiedScriptFile.data && copiedScriptFile.data.id) {
          userAppsScriptId = copiedScriptFile.data.id;
          scriptWebViewLink = copiedScriptFile.data.webViewLink;
          console.log(`User ${userId}: Copied script successfully. New Script ID: ${userAppsScriptId}, Name: ${copiedScriptFile.data.name}, Link: ${scriptWebViewLink}`);

          // --- Share the newly copied script with the Service Account ---
          const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
          if (userAppsScriptId && serviceAccountEmail) {
            console.log(`User ${userId}: Sharing script ${userAppsScriptId} with service account ${serviceAccountEmail} as 'reader'.`);
            try {
              await drive.permissions.create({
                fileId: userAppsScriptId,
                requestBody: {
                  role: 'reader',
                  type: 'user',
                  emailAddress: serviceAccountEmail,
                },
                supportsAllDrives: true, // Important if the user's Drive is part of a Shared Drive or if the template was
              });
              console.log(`User ${userId}: Successfully shared script ${userAppsScriptId} with ${serviceAccountEmail}.`);
            } catch (shareError) {
              // Log the error but don't let it block the rest of the onboarding for now.
              // The get-all-user-properties might fail later, but basic onboarding can proceed.
              console.warn(`User ${userId}: Failed to share script ${userAppsScriptId} with service account ${serviceAccountEmail}. This might affect fetching all properties later. Error:`, shareError.message);
            }
          } else {
            if (!serviceAccountEmail) {
              console.warn(`User ${userId}: GOOGLE_SERVICE_ACCOUNT_EMAIL is not set in .env. Cannot share copied script.`);
            }
          }
          // --- End of sharing ---
        } else {
          // Script copy failed after all retries or due to a non-retryable error
          console.error(`User ${userId}: USER failed Wrapper script copy attempt permanently after ${copyAttempt} attempts. Last Error:`, lastScriptCopyError?.message);
          // userAppsScriptId and scriptWebViewLink remain null/undefined
          // The response will indicate manual copy is required
        }

      } catch (initialSetupOrFatalCopyError) {
        // This catch is for errors like the initial template verification failing,
        // or if an error was explicitly re-thrown from within the retry logic (though we try to avoid that now for copy failures).
        console.error(`User ${userId}: A critical error occurred during script setup or a fatal copy error:`, initialSetupOrFatalCopyError);
        // For a truly fatal error before or during copy that isn't handled by the loop's fallback:
        // We might want to signal a more severe failure or ensure the response construction handles this.
        // For now, if templateScriptWebViewLinkForManualCopy is not set, the fallback won't be as useful.
        // The main error handling at the end of the 'handler' function will catch this and respond with 500.
        throw initialSetupOrFatalCopyError; // Rethrow to be caught by the outermost try-catch
      }
    } else {
      console.log(`User ${userId}: Wrapper script already exists: ${userAppsScriptId}`);
      // If script exists, we might still need to fetch its webViewLink if not already available
      // This part is handled later in the 'finalScriptWebViewLink' logic
    }

    // --- 4. Save IDs to Database --- 
    let dbUserAppsScriptId = userAppsScriptId; 
    if (!dbUserAppsScriptId && existingUser?.userAppsScriptId) {
        dbUserAppsScriptId = existingUser.userAppsScriptId;
    }

    let finalScriptWebViewLink = scriptWebViewLink; 
    if (!finalScriptWebViewLink && dbUserAppsScriptId) {
        try {
            const scriptFile = await drive.files.get({
                fileId: dbUserAppsScriptId,
                fields: 'webViewLink',
                supportsAllDrives: true,
            });
            finalScriptWebViewLink = scriptFile.data.webViewLink;
        } catch (fetchLinkError) {
            console.warn(`User ${userId}: Could not fetch webViewLink for existing script ${dbUserAppsScriptId}:`, fetchLinkError.message);
        }
    }
    
    let finalSpreadsheetUrl = spreadsheetUrl; 
    if (!finalSpreadsheetUrl && googleSheetId) {
        try {
            const sheetFile = await sheets.spreadsheets.get({
                spreadsheetId: googleSheetId,
                fields: 'spreadsheetUrl'
            });
            finalSpreadsheetUrl = sheetFile.data.spreadsheetUrl;
        } catch (fetchSheetUrlError) {
            console.warn(`User ${userId}: Could not fetch spreadsheetUrl for existing sheet ${googleSheetId}:`, fetchSheetUrlError.message);
        }
    }
    
    // Determine if manual script copy is required
    const manualScriptCopyRequired = !dbUserAppsScriptId; // If no script ID, manual copy is needed.

    if (driveFolderId || googleSheetId || dbUserAppsScriptId) { 
      console.log(`User ${userId}: Updating database with IDs - Sheet: ${googleSheetId}, Folder: ${driveFolderId}, Script: ${dbUserAppsScriptId || null}`);
      try {
        const dataToUpdate = {
          ...(googleSheetId && { googleSheetId }),
          ...(driveFolderId && { driveFolderId }),
        };
        if (dbUserAppsScriptId) { // Only add userAppsScriptId if it exists
          dataToUpdate.userAppsScriptId = dbUserAppsScriptId;
        } else if (existingUser && existingUser.userAppsScriptId && !dbUserAppsScriptId) {
          // If copy failed, but an old ID existed, we might want to clear it or keep it.
          // For now, if dbUserAppsScriptId is null (copy failed), we don't update/set it,
          // effectively clearing it if it was previously set and copy failed now.
          // Or, if we want to ensure it's cleared if copy fails:
          // dataToUpdate.userAppsScriptId = null; // Explicitly set to null
        }

        await prisma.user.update({
          where: { id: userId },
          data: dataToUpdate,
        });
        console.log(`User ${userId}: Database updated.`);
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

    // --- Success --- 
    console.log(`User ${userId}: Onboarding process (resource creation/linking) completed.`);
    return res.status(200).json({
      success: true,
      message: manualScriptCopyRequired 
                 ? 'Sheet and Folder created. Script copy failed. Please use the link to copy the script manually.' 
                 : 'Onboarding resources provisioned. Please follow sheet instructions to complete setup.',
      data: {
        googleSheetId,
        driveFolderId,
        userAppsScriptId: dbUserAppsScriptId, 
        spreadsheetUrl: finalSpreadsheetUrl,     
        scriptWebViewLink: finalScriptWebViewLink, 
        manualScriptCopyRequired: manualScriptCopyRequired,
        templateScriptWebViewLinkForManualCopy: manualScriptCopyRequired ? templateScriptWebViewLinkForManualCopy : null
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
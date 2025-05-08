import { getSession } from 'next-auth/react';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import prisma from '@/lib/prisma'; // Your prisma client instance
import dotenv from 'dotenv';

dotenv.config();

// --- Helper: Get Google API Client authenticated AS THE USER ---
// We need this to perform actions in *their* Drive/Sheets
function getUserGoogleApiClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  // TODO: Potentially handle token refresh if needed, though access token
  // from NextAuth session should be valid for the request duration.
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
  const accessToken = oauthAccount.access_token;

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

    // --- Authenticate as the User for Drive/Sheet operations --- 
    const userAuth = getUserGoogleApiClient(accessToken);
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
        console.log(`User ${userId}: Copying template wrapper script ${TEMPLATE_WRAPPER_SCRIPT_FILE_ID} using SERVICE ACCOUNT...`);
        
        try {
            // Get Service Account authenticated client specifically for this step
            const serviceAuthClient = await getServiceAccountGoogleApiClient();
            const serviceDrive = google.drive({ version: 'v3', auth: serviceAuthClient });

            // Define metadata for the new script copy
            // const scriptCopyMetadata = { 
            //      name: `KolayXport Wrapper Script - ${session.user.email || userId}`, // Unique name
            //      // parents: [driveFolderId] // Optionally place in the created folder
            // }; 

            // Perform the copy using the Service Account
            const copiedScriptFile = await serviceDrive.files.copy({ 
                fileId: TEMPLATE_WRAPPER_SCRIPT_FILE_ID,
                // requestBody: scriptCopyMetadata, // Temporarily remove to isolate issue
                fields: 'id' // Only need the ID of the new script file
            });
            userAppsScriptId = copiedScriptFile.data.id;

            if (!userAppsScriptId) throw new Error('Wrapper script copied (by SA) but ID was not returned.');
            console.log(`User ${userId}: Copied Wrapper Script ID via SA: ${userAppsScriptId}`);

            // Share the newly copied script (created by SA) with the user
            console.log(`User ${userId}: Sharing newly copied script ${userAppsScriptId} with user ${session.user.email}...`);
            await serviceDrive.permissions.create({
                fileId: userAppsScriptId,
                requestBody: { // Correct parameter for v3
                    role: 'writer', // Give user write access
                    type: 'user',
                    emailAddress: session.user.email
                }
            });
            console.log(`User ${userId}: Successfully shared script ${userAppsScriptId} with user ${session.user.email}.`);
            
            // IMPORTANT: Additional steps might be needed here:
            // 1. Update Script Project Manifest: If the copied script needs to know the ID
            //    of the specific Google Sheet it's associated with, you might need to use the
            //    Apps Script API (requires setup, service account auth, more scopes) to update
            //    the manifest file (appsscript.json) within the newly copied script project.
            //    Or, pass the sheetId as a parameter during execution.
            // 2. Deployment: The copied script is just a project file. To be executable via the 
            //    Apps Script Execution API, it needs to be DEPLOYED. Programmatic deployment is complex.
            //    Alternative: The user might need to manually open the script and deploy it once,
            //    or you use a central script architecture (which we decided against for UserProperties).
            //    For now, we are only storing the SCRIPT FILE ID. The API routes 
            //    (/api/gscript/*) will need to target THIS SCRIPT FILE ID for execution, 
            //    likely using the Apps Script API's `scripts.run` method which can target a 
            //    script ID directly (often runs the HEAD/latest saved version).

        } catch (scriptCopyErr) {
            console.error(`User ${userId}: SERVICE ACCOUNT failed Wrapper script copy attempt:`, scriptCopyErr);
            // Log raw error details
             let rawCopyErrorString = 'No raw copyErr object available or stringification failed.';
             try {
               rawCopyErrorString = JSON.stringify(scriptCopyErr, Object.getOwnPropertyNames(scriptCopyErr), 2);
             } catch (e) {
               rawCopyErrorString = `Error stringifying copyErr: ${e.message}. Raw copy error message: ${scriptCopyErr.message}`;
             }
            console.error(`User ${userId}: Raw SA scriptCopyErr object:`, rawCopyErrorString);

             if (scriptCopyErr.code === 404) {
                // If even the SA gets 404, the file ID is likely wrong or inaccessible to the project
                 return res.status(500).json({ 
                     error: `Template script (ID: ${TEMPLATE_WRAPPER_SCRIPT_FILE_ID}) not found, even by Service Account. Check ID and sharing with SA: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'SA email not readable'}.`
                 });
             } else if (scriptCopyErr.code === 403) {
                 // Potentially insufficient permissions or API not enabled for Drive or Apps Script?
                  return res.status(500).json({ 
                      error: 'Failed to copy script using Service Account. Check Drive/AppsScript API enablement and SA permissions.' 
                  });
             }
            // General error
            throw new Error(`Failed to copy template wrapper script using Service Account. ${scriptCopyErr.message || ''}`);
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

    // --- 5. Set FEDEX_FOLDER_ID in the new script's UserProperties --- 
    // Trigger this asynchronously or via a separate call from frontend after onboarding success
    // For simplicity here, let's log that it needs to happen.
    console.log(`User ${userId}: TODO - Trigger setting FEDEX_FOLDER_ID (${driveFolderId}) in script ${userAppsScriptId} via /api/gscript/set-user-property`);
    // Example (conceptual - needs frontend implementation):
    // fetch('/api/gscript/set-user-property', { 
    //     method: 'POST', 
    //     headers: { 'Content-Type': 'application/json', /* + Auth? */ }, 
    //     body: JSON.stringify({ propertyName: 'FEDEX_FOLDER_ID', value: driveFolderId, userScriptId: userAppsScriptId /* If API needs it explicitly */ }) 
    // });

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
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
    
    // --- 2. Copy Template Sheet (if needed) --- 
    if (!googleSheetId) {
      console.log(`User ${userId}: Attempting to GET template sheet ${TEMPLATE_SHEET_ID} for verification...`);
      
      // Log the service account email being used
      if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON) {
        const saCredentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON);
        console.log(`User ${userId}: Using service account: ${saCredentials.client_email}`);
      }
      
      try {
        // First try with user auth
        const fileMetadata = await drive.files.get({
          fileId: TEMPLATE_SHEET_ID,
          fields: 'id, name, ownedByMe, capabilities, trashed'
        });
        
        console.log(`User ${userId}: STEP 2B - drive.files.get SUCCEEDED for sheet. ID: ${fileMetadata.data.id}, Name: ${fileMetadata.data.name}, OwnedByMe: ${fileMetadata.data.ownedByMe}, Trashed: ${fileMetadata.data.trashed}, Capabilities: ${JSON.stringify(fileMetadata.data.capabilities)}`);

        if (fileMetadata.data.trashed) {
          console.error(`User ${userId}: Template sheet ${TEMPLATE_SHEET_ID} is in the trash.`);
          throw new Error(`The template Google Sheet (ID: ${TEMPLATE_SHEET_ID}) is in the trash. Please restore it.`);
        }

        if (!fileMetadata.data.capabilities?.canCopy) {
          console.error(`User ${userId}: Template sheet ${TEMPLATE_SHEET_ID} exists (not trashed) but cannot be copied by the authenticated user. Capabilities:`, fileMetadata.data.capabilities);
          
          // Try again with the service account to see if it has access
          console.log(`User ${userId}: Checking sheet access with service account...`);
          try {
            const serviceAuthClient = await getServiceAccountGoogleApiClient();
            const serviceDrive = google.drive({ version: 'v3', auth: serviceAuthClient });
            
            const serviceMetadata = await serviceDrive.files.get({
              fileId: TEMPLATE_SHEET_ID,
              fields: 'id, name, capabilities'
            });
            
            console.log(`User ${userId}: Service account CAN access the template sheet. ID: ${serviceMetadata.data.id}, Capabilities: ${JSON.stringify(serviceMetadata.data.capabilities)}`);
            
            if (serviceMetadata.data.capabilities?.canCopy) {
              console.log(`User ${userId}: Service account has copy permission. Using service account to copy the sheet.`);
              
              // Use service account to copy the sheet
              const sheetCopyResponse = await serviceDrive.files.copy({
                fileId: TEMPLATE_SHEET_ID,
                requestBody: {
                  name: `Senkronizasyon Verileri - ${session.user.name || 'User'}`,
                },
              });
              
              googleSheetId = sheetCopyResponse.data.id;
              console.log(`User ${userId}: Copied template sheet successfully with service account. New Sheet ID: ${googleSheetId}`);
              
              // Share the copied sheet with the user
              await serviceDrive.permissions.create({
                fileId: googleSheetId,
                requestBody: {
                  role: 'writer',
                  type: 'user',
                  emailAddress: session.user.email,
                },
              });
              
              console.log(`User ${userId}: Shared copied sheet with user email: ${session.user.email}`);
            } else {
              throw new Error(`The service account cannot copy the template sheet. Please check sharing settings.`);
            }
          } catch (serviceError) {
            console.error(`User ${userId}: Service account failed to access template sheet:`, serviceError);
            throw new Error(`The template sheet (ID: ${TEMPLATE_SHEET_ID}) cannot be accessed by either the user or the service account. Please check sharing settings.`);
          }
        } else {
          // Original user-authenticated copy logic
          const sheetCopyResponse = await drive.files.copy({
            fileId: TEMPLATE_SHEET_ID,
            requestBody: {
              name: `Senkronizasyon Verileri - ${session.user.name || 'User'}`,
            },
          });
          
          googleSheetId = sheetCopyResponse.data.id;
          console.log(`User ${userId}: Copied template sheet successfully with user auth. New Sheet ID: ${googleSheetId}`);
        }
      } catch (getErr) {
        console.error(`User ${userId}: STEP 2X - FAILED during drive.files.get or subsequent checks for template sheet ${TEMPLATE_SHEET_ID}.`);
        console.error(`User ${userId}: Raw getErr object:`, getErr);
        // Improved error detail formatting: include code, message, and API-level details if available
        let detailedMessage = "Failed to access or verify the template Google Sheet.";
        if (getErr.code && getErr.message) {
          detailedMessage += ` Google API Error: ${getErr.message} (Code: ${getErr.code})`;
        } else if (getErr.message) {
          detailedMessage += ` Error: ${getErr.message}`;
        }
        
        // This error will be caught by the outermost try...catch in your handler
        throw new Error(`GET_SHEET_ERROR: ${detailedMessage}`); 
      }
    } else {
      console.log(`User ${userId}: Sheet already exists: ${googleSheetId}`);
    }

    // --- 3. Copy Template Wrapper Script (if needed) --- 
    if (!userAppsScriptId) {
        console.log(`User ${userId}: Copying template wrapper script ${TEMPLATE_WRAPPER_SCRIPT_FILE_ID}...`);
        // Note: Copying Apps Script creates a new project file in the user's Drive.
        // Consider where this script should live (root or specific folder) and its name.
        const scriptCopyMetadata = { 
             name: `KolayXport Wrapper Script - ${session.user.email || userId}` // Unique name
             // Optionally add parents: [driveFolderId] to place it in the labels folder, or another folder.
        }; 
        try {
            const copiedScriptFile = await drive.files.copy({ 
                fileId: TEMPLATE_WRAPPER_SCRIPT_FILE_ID,
                resource: scriptCopyMetadata,
                fields: 'id' // Only need the ID of the new script file
            });
            userAppsScriptId = copiedScriptFile.data.id;

            if (!userAppsScriptId) throw new Error('Wrapper script copied but ID was not returned.');
            console.log(`User ${userId}: Copied Wrapper Script ID: ${userAppsScriptId}`);
            
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
            console.error(`User ${userId}: Wrapper script copy attempt failed:`, scriptCopyErr);
            // Add similar detailed logging as sheet copy if needed
             if (scriptCopyErr.code === 403) {
                 // Potentially insufficient permissions or API not enabled for Drive or Apps Script?
                  return res.status(500).json({ 
                      error: 'Failed to copy script. Check Drive/AppsScript API enablement and permissions.' 
                  });
             }
            throw new Error(`Failed to copy template wrapper script. ${scriptCopyErr.message || ''}`);
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
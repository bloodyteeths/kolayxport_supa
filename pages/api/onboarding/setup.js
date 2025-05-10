import { getSession } from 'next-auth/react';
import { google } from 'googleapis';
// Remove direct GoogleAuth import if service account auth is fully handled by the new module
// import { GoogleAuth } from 'google-auth-library';
import prisma from '@/lib/prisma'; // Your prisma client instance
import dotenv from 'dotenv';
// Import service account client getters
import { getScriptServiceClient as getSAScriptClient, getDriveServiceClient as getSADriveClient } from '@/lib/googleServiceAccountAuth';

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

  let googleSheetId, driveFolderId, userAppsScriptId, deploymentId;

  try {
    // --- Check if user already fully onboarded --- 
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        googleSheetId: true, 
        driveFolderId: true, 
        userAppsScriptId: true,
        googleScriptDeploymentId: true 
      } // Select all relevant IDs
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
              userAppsScriptId: existingUser.userAppsScriptId,
              googleScriptDeploymentId: existingUser.googleScriptDeploymentId
            }
      });
    }

    // Assign existing values if partially onboarded
    googleSheetId = existingUser?.googleSheetId;
    driveFolderId = existingUser?.driveFolderId;
    userAppsScriptId = existingUser?.userAppsScriptId;
    deploymentId = existingUser?.googleScriptDeploymentId;

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
      console.log(`User ${userId}: Preparing to copy template wrapper script using SERVICE ACCOUNT authentication...`);
      console.log(`User ${userId}: Template Script ID from env: ${TEMPLATE_WRAPPER_SCRIPT_FILE_ID}`);
      console.log(`User ${userId}: User email for script naming: ${session.user.email}`);
      
      try {
        // Use service account to verify template script details first
        try {
          const driveSA = await getSADriveClient();
          console.log(`User ${userId}: Verifying details for template script ID: ${TEMPLATE_WRAPPER_SCRIPT_FILE_ID} (using SA)`);
          const templateFileMeta = await driveSA.files.get({
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
          console.error(`User ${userId}: Failed to verify template script with SA:`, verifyErr);
          // Rethrow or handle as critical error, as copy will likely fail
          throw new Error(`Critical error verifying template script before copy: ${verifyErr.message}`);
        }

        // Create copy of template script using SERVICE ACCOUNT
        const driveSA = await getSADriveClient();
        console.log(`User ${userId}: Using SERVICE ACCOUNT to copy template script...`);
        
        const scriptCopyMetadata = { 
          name: `KolayXport Wrapper Script - ${session.user.name || session.user.email || userId}`, // Unique name
          mimeType: 'application/vnd.google-apps.script',
          parents: ['root'] // Add root as parent - service account will own it initially, then share it
        }; 

        console.log(`User ${userId}: Attempting to copy script with metadata:`, JSON.stringify(scriptCopyMetadata));

        // Perform the copy using SERVICE ACCOUNT auth
        const scriptCopy = await driveSA.files.copy({
          fileId: TEMPLATE_WRAPPER_SCRIPT_FILE_ID,
          requestBody: scriptCopyMetadata,
          fields: 'id, name, webViewLink',
          supportsAllDrives: true
        });
          
        userAppsScriptId = scriptCopy.data.id;
        console.log('Service-account copied script:', scriptCopy.data);
        console.log(`User ${userId}: Copied script successfully with SA. New Script ID: ${userAppsScriptId}, Name: ${scriptCopy.data.name}, Link: ${scriptCopy.data.webViewLink}`);
        
        // Save the script ID to the user record immediately so we don't lose it
        // even if sharing fails temporarily
        await prisma.user.update({
          where: { id: userId },
          data: {
            userAppsScriptId: userAppsScriptId,
          }
        });
        console.log(`User ${userId}: Successfully saved script ID ${userAppsScriptId} to user record.`);
        
        // Add a longer delay before sharing to ensure the file is fully processed by Google Drive
        console.log(`User ${userId}: Waiting 10 seconds for the script to be fully available in Google Drive...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // --- Share the SA-copied script with the User ---
        let scriptShared = false;
        if (userAppsScriptId) {
          console.log(`User ${userId}: Sharing script ${userAppsScriptId} with user ${session.user.email} as 'owner'. (SA Auth)`);
          
          // Verify script exists before attempting to share
          try {
            // First check if script exists with SA
            console.log(`User ${userId}: Verifying script ${userAppsScriptId} exists before sharing...`);
            const driveSA = await getSADriveClient();
            const fileCheck = await driveSA.files.get({
              fileId: userAppsScriptId,
              fields: 'id,name,owners',
              supportsAllDrives: true
            });
            console.log(`User ${userId}: Script exists. Current owner: ${fileCheck.data.owners?.[0]?.emailAddress || 'Unknown'}`);
            
            // Add retry logic for sharing
            const MAX_SHARE_RETRIES = 5;
            const SHARE_RETRY_DELAY_MS = 5000;
            let shareAttempt = 0;
            
            while (shareAttempt < MAX_SHARE_RETRIES && !scriptShared) {
              shareAttempt++;
              try {
                console.log(`User ${userId}: Share attempt ${shareAttempt}/${MAX_SHARE_RETRIES}...`);
                
                // First grant editor access (which is more likely to succeed) before attempting owner transfer
                console.log(`User ${userId}: First granting editor access before owner transfer...`);
                await driveSA.permissions.create({
                  fileId: userAppsScriptId,
                  requestBody: {
                    role: 'writer',
                    type: 'user',
                    emailAddress: session.user.email
                  },
                  sendNotificationEmail: false,
                  supportsAllDrives: true
                });
                
                console.log(`User ${userId}: Editor access granted, waiting 3 seconds before attempting ownership transfer...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Now try to transfer ownership
                try {
                  await driveSA.permissions.create({
                    fileId: userAppsScriptId,
                    requestBody: {
                      role: 'owner',
                      type: 'user',
                      emailAddress: session.user.email,
                      transferOwnership: true
                    },
                    sendNotificationEmail: false,
                    supportsAllDrives: true
                  });
                  console.log(`User ${userId}: Successfully transferred ownership to ${session.user.email}`);
                } catch (ownershipErr) {
                  console.log(`User ${userId}: Ownership transfer failed, but editor access was granted. Error: ${ownershipErr.message}`);
                  // Continue with editor access if ownership transfer fails
                }
                
                scriptShared = true;
                console.log(`User ${userId}: Successfully shared script ${userAppsScriptId} with user ${session.user.email}.`);
                
                // Now move the script to the user's folder
                if (driveFolderId && scriptShared) {
                  try {
                    console.log(`User ${userId}: Moving script ${userAppsScriptId} to user's folder ${driveFolderId}...`);
                    // Use the user's drive client to move the file after ownership transfer
                    await drive.files.update({
                      fileId: userAppsScriptId,
                      addParents: driveFolderId,
                      removeParents: 'root',
                      fields: 'id, parents'
                    });
                    console.log(`User ${userId}: Successfully moved script ${userAppsScriptId} to folder ${driveFolderId}.`);
                  } catch (movingErr) {
                    console.log(`User ${userId}: Error moving script to folder: ${movingErr.message}. Will continue with deployment.`);
                    // Continue with the process even if moving fails
                  }
                }
              } catch (shareErr) {
                const errDetails = shareErr.response?.data?.error?.errors || [];
                console.error(`User ${userId}: Share attempt ${shareAttempt} failed. Error: ${shareErr.message}. ${JSON.stringify(errDetails)}`);
                
                if (shareAttempt < MAX_SHARE_RETRIES) {
                  console.log(`User ${userId}: Waiting ${SHARE_RETRY_DELAY_MS}ms before retry...`);
                  await new Promise(resolve => setTimeout(resolve, SHARE_RETRY_DELAY_MS));
                }
              }
            }
          } catch (fileCheckErr) {
            console.error(`User ${userId}: Script verification failed before sharing. Error: ${fileCheckErr.message}`);
            console.error(`User ${userId}: Will continue but sharing may fail.`);
          }
          
          if (!scriptShared) {
            console.error(`User ${userId}: Failed to transfer script ownership to user after ${MAX_SHARE_RETRIES} attempts. Will continue with deployment using service account.`);
            // Don't throw an error - continue to the deployment step even if sharing fails
          }
        }
        
        // --- Share the newly copied script with the Service Account (to maintain access) ---
        const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        if (userAppsScriptId && serviceAccountEmail) {
          console.log(`User ${userId}: Sharing script ${userAppsScriptId} with service account ${serviceAccountEmail} as 'writer'. (User Auth)`);
          try {
            // Using the user-authenticated 'drive' client here is correct,
            // as the user owns the script and is granting permission.
            await drive.permissions.create({
              fileId: userAppsScriptId,
              requestBody: {
                role: 'writer',
                type: 'user',
                emailAddress: serviceAccountEmail,
              },
              supportsAllDrives: true, // Important if the user's Drive is part of a Shared Drive
            });
            console.log(`User ${userId}: Successfully shared script ${userAppsScriptId} with ${serviceAccountEmail} as 'writer'.`);
          } catch (shareError) {
            console.error(`User ${userId}: Failed to share script ${userAppsScriptId} with service account ${serviceAccountEmail}. Error:`, shareError.message, shareError.errors);
            // Decide if this is a critical failure for onboarding.
            // For now, log and continue, but script execution by SA will fail later.
            // Consider throwing an error if SA access is immediately required.
          }
        } else {
          if (!serviceAccountEmail) {
            console.warn(`User ${userId}: GOOGLE_SERVICE_ACCOUNT_EMAIL is not set. Cannot share script ${userAppsScriptId}. Service account operations will fail.`);
          }
          // userAppsScriptId missing here would be an earlier logic error
        }
        // --- End Script Sharing ---

        // --- 7. Create a deployment for this version ---
        // Move deployment creation outside the previous conditions to ensure it runs even if the script already exists
        let deploymentId = null;
        try {
          // First, test if user can access the script (could be existing script)
          let userCanAccessScript = false;
          try {
            console.log(`User ${userId}: Testing if user can access script ${userAppsScriptId}...`);
            await script.projects.get({ scriptId: userAppsScriptId });
            userCanAccessScript = true;
            console.log(`User ${userId}: User can access script ${userAppsScriptId}.`);
          } catch (accessErr) {
            console.log(`User ${userId}: User cannot access script, will use SA: ${accessErr.message}`);
            userCanAccessScript = false;
          }
          
          // Choose which client to use based on access test
          const scriptClient = userCanAccessScript ? script : scriptSA;
          const clientType = userCanAccessScript ? "user" : "service account";
          
          console.log(`User ${userId}: Creating new script version for script ${userAppsScriptId} using ${clientType} auth...`);
          const createVersionResponse = await scriptClient.projects.versions.create({
            scriptId: userAppsScriptId
          });
          
          const versionNumber = createVersionResponse.data.versionNumber;
          console.log(`User ${userId}: Created script version: ${versionNumber}`);
          
          console.log(`User ${userId}: Creating new deployment for script ${userAppsScriptId} version ${versionNumber} using ${clientType} auth...`);
          const deploymentResponse = await scriptClient.projects.deployments.create({
            scriptId: userAppsScriptId,
            requestBody: {
              versionNumber: versionNumber,
              manifestFileName: "appsscript",
              description: `API Deployment for ${session.user.name || session.user.email || userId}`
            }
          });
          
          deploymentId = deploymentResponse.data.deploymentId;
          console.log(`User ${userId}: Created deployment ID: ${deploymentId}`);
          
          // Save this deployment ID to the user record immediately
          await prisma.user.update({
            where: { id: userId },
            data: {
              googleScriptDeploymentId: deploymentId
            }
          });
          console.log(`User ${userId}: Successfully saved deployment ID ${deploymentId} to user record.`);
          
        } catch (deploymentErr) {
          console.error(`User ${userId}: Failed to create deployment for script ${userAppsScriptId}:`, deploymentErr);
          console.error(`User ${userId}: Raw deployment error:`, JSON.stringify(deploymentErr));
          // Log but continue - this is not a fatal error as user can try again or use reshare utility
        }

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
    if (driveFolderId || googleSheetId || userAppsScriptId || deploymentId) { // Only update if at least one new ID was generated
      console.log(`User ${userId}: Updating database with IDs - Sheet: ${googleSheetId}, Folder: ${driveFolderId}, Script: ${userAppsScriptId}, Deployment: ${deploymentId}`);
      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            ...(googleSheetId && { googleSheetId }), // Conditionally add if defined
            ...(driveFolderId && { driveFolderId }), // Conditionally add if defined
            ...(userAppsScriptId && { userAppsScriptId }), // Conditionally add if defined
            ...(deploymentId && { googleScriptDeploymentId: deploymentId }) // Save the new deployment ID
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

    // --- 5. Initial Script Execution (Set FEDEX_FOLDER_ID if needed) ---
    // This should run as the user since it often involves setting user-specific properties.
    // The script itself should be designed to handle this (e.g., using UserProperties service).
    if (userAppsScriptId && driveFolderId && deploymentId) { // Ensure script, folder, and deployment ID exist
      console.log(`User ${userId}: Attempting to set FEDEX_FOLDER_ID in script ${userAppsScriptId} using deployment ${deploymentId} (User Auth)`);
      const MAX_RETRIES = 6;
      const RETRY_DELAY_MS = 10000;
      let attempt = 0;
      let success = false;

      const script = google.script({ version: 'v1', auth: userAuth }); // User-authenticated client

      while (attempt < MAX_RETRIES && !success) {
        attempt++;
        console.log(`User ${userId}: Attempt ${attempt}/${MAX_RETRIES} to set FEDEX_FOLDER_ID.`);
        try {
          console.log(`User ${userId}: (Retry Attempt ${attempt}) Pre-flight check for script ${userAppsScriptId} (as user) before setting FEDEX_FOLDER_ID.`);
          const project = await script.projects.get({ scriptId: userAppsScriptId });
          console.log(`User ${userId}: (Retry Attempt ${attempt}) Pre-flight SUCCESS for script ${userAppsScriptId}. Title: ${project.data.title}.`);

          // Log current permissions as seen by the user before running the script
          try {
            console.log(`User ${userId}: (Retry Attempt ${attempt}) Listing permissions for script ${userAppsScriptId} (as user) before running saveToUserProperties.`);
            const permissionsList = await drive.permissions.list({ // drive is user-authenticated here
              fileId: userAppsScriptId,
              fields: 'permissions(id,emailAddress,role,type)',
              supportsAllDrives: true,
            });
            console.log(`User ${userId}: (Retry Attempt ${attempt}) Permissions for script ${userAppsScriptId}:`, JSON.stringify(permissionsList.data.permissions, null, 2));
          } catch (permError) {
            console.warn(`User ${userId}: (Retry Attempt ${attempt}) Failed to list permissions for script ${userAppsScriptId} (as user). Error:`, permError.message);
            // Continue with the run attempt despite this logging failure
          }

          const execResponse = await script.scripts.run({
            scriptId: userAppsScriptId, 
            resource: {
              function: 'saveToUserProperties',
              parameters: ['FEDEX_FOLDER_ID', driveFolderId],
              deploymentId: deploymentId 
            },
          });

          if (execResponse.data.error) {
            console.error(`User ${userId}: Apps Script error on attempt ${attempt} setting FEDEX_FOLDER_ID:`, JSON.stringify(execResponse.data.error, null, 2));
            const apiErrorStatus = execResponse.data.error.code;
            const appsScriptErrorDetails = execResponse.data.error.details && execResponse.data.error.details[0];

            if (apiErrorStatus === 404 && attempt < MAX_RETRIES -1) {
              console.log(`User ${userId}: Script ${userAppsScriptId} not found (404), will retry after ${RETRY_DELAY_MS}ms...`);
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            } else if (attempt >= MAX_RETRIES -1) {
              console.error(`User ${userId}: Final attempt failed for script ${userAppsScriptId} with error code ${apiErrorStatus}.`);
              throw new Error(`Apps Script execution failed after ${MAX_RETRIES} attempts: Code ${apiErrorStatus}, Message: ${appsScriptErrorDetails?.errorMessage || JSON.stringify(execResponse.data.error)}`);
            } else {
              // For other errors or if it's not the last attempt for 404
              console.warn(`User ${userId}: Apps Script execution error (not 404 or not final attempt), details:`, JSON.stringify(execResponse.data.error, null, 2));
              // Potentially retry for other transient errors too, or throw immediately
              // For now, let's assume only 404 is retried, others will throw via the outer catch if not caught here
               throw new Error(`Apps Script execution failed: Code ${apiErrorStatus}, Message: ${appsScriptErrorDetails?.errorMessage || JSON.stringify(execResponse.data.error)}`);
            }
          } else {
            console.log(`User ${userId}: FEDEX_FOLDER_ID set successfully in Apps Script on attempt ${attempt}.`);
            success = true;
            // No break needed, loop condition will handle it
          }
        } catch (runError) {
          console.error(`User ${userId}: Error during script.scripts.run on attempt ${attempt}/${MAX_RETRIES} for FEDEX_FOLDER_ID:`, runError.message, runError.response ? runError.response.data : runError.toString());
          if (runError.code === 404 && attempt < MAX_RETRIES -1) {
            console.log(`User ${userId}: Script ${userAppsScriptId} not found (404 on runError), will retry after ${RETRY_DELAY_MS}ms...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          } else {
            console.error(`User ${userId}: Final attempt failed or non-404 error for script ${userAppsScriptId} on attempt ${attempt}/${MAX_RETRIES}. Error:`, runError.message);
            const contextError = new Error(`SETUP_STEP5_SCRIPT_RUN_FAILED: Script ${userAppsScriptId}, Prop: FEDEX_FOLDER_ID. Attempts: ${attempt}/${MAX_RETRIES}. Google API Error: ${runError.message} (Code: ${runError.code})`);
            contextError.originalError = runError;
            console.log(`User ${userId}: Throwing contextError from loop: ${contextError.message}`);
            throw contextError; // Rethrow to be caught by the outer try-catch for this step
          }
        } // End of try-catch for a single attempt
      } // End of while loop

      if (!success) {
        console.error(`User ${userId}: FEDEX_FOLDER_ID could not be set in script ${userAppsScriptId} after all ${MAX_RETRIES} retries (loop completed without success).`);
        throw new Error(`SETUP_STEP5_PROP_SET_FAILED_POST_LOOP: Failed to set FEDEX_FOLDER_ID for script ${userAppsScriptId} after ${MAX_RETRIES} attempts.`);
      }
      console.log(`User ${userId}: Successfully set FEDEX_FOLDER_ID in Apps Script ${userAppsScriptId}`);
    } else {
      if (!deploymentId) {
        console.warn(`User ${userId}: Skipping FEDEX_FOLDER_ID setup because deploymentId is missing. Onboarding might be incomplete if script creation/deployment failed earlier.`);
      } else {
        console.log(`User ${userId}: Skipping FEDEX_FOLDER_ID setup because some prerequisite IDs are missing (userAppsScriptId: ${userAppsScriptId}, driveFolderId: ${driveFolderId})`);
      }
    }
    // --- End Initial Script Execution ---

    // --- Success --- 
    console.log(`User ${userId}: Onboarding process completed successfully.`);
    return res.status(200).json({
      success: true,
      message: 'Onboarding complete. Resources created and IDs saved.',
      data: {
        googleSheetId,
        driveFolderId,
        userAppsScriptId,
        googleScriptDeploymentId: deploymentId, // Include deployment ID in success response
        onboardingComplete: !!(driveFolderId && googleSheetId && userAppsScriptId && deploymentId)
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
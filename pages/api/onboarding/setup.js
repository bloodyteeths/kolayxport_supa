import { getSession } from 'next-auth/react';
import { google } from 'googleapis';
// Remove direct GoogleAuth import if service account auth is fully handled by the new module
// import { GoogleAuth } from 'google-auth-library';
import prisma from '@/lib/prisma'; // Your prisma client instance
import dotenv from 'dotenv';
// Import service account client getters and user impersonation clients
import { 
  getScriptServiceClient as getSAScriptClient, 
  getDriveServiceClient as getSADriveClient,
  getDriveClientForUser,
  getScriptClientForUser,
  getSheetsClientForUser
} from '@/lib/googleServiceAccountAuth';

dotenv.config();

// Check if Domain-Wide Delegation is enabled
const useDomainWideDelegation = process.env.DOMAIN_WIDE_DELEGATION === 'true';

// Add a helper function to handle Drive errors
function handleDriveError(error, userId, operation) {
  console.error(`User ${userId}: ${operation} failed:`, error);
  
  // Check for common Domain-Wide Delegation errors
  if (error.message && error.message.includes('unauthorized_client')) {
    console.error(`User ${userId}: DOMAIN-WIDE DELEGATION ERROR - This is likely an issue with service account permissions in Google Admin console.`);
    return {
      status: 401,
      error: 'Domain-Wide Delegation error: Service account is not authorized to access user data. Please ensure the service account is properly configured in Google Admin console with the correct scopes.',
      details: error.message
    };
  }
  
  // General API error handling
  if (error.code === 403) {
    return {
      status: 403,
      error: `Google API access denied: ${error.message}. Please check that the ${operation} API is enabled in your Google Cloud Project.`
    };
  }
  
  if (error.code === 404) {
    return {
      status: 404,
      error: `Resource not found during ${operation}. Please verify the template IDs are correct and accessible by your service account.`
    };
  }
  
  // Default error response
  return {
    status: 500,
    error: `Failed during ${operation}: ${error.message || 'Unknown error'}`
  };
}

// --- Helper: Get Google API Client authenticated AS THE USER (with auto-refresh) ---
// Only kept for backward compatibility - will be used as fallback if DWD is disabled
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
  const userEmail = session.user.email;
  
  if (!userEmail) {
    console.error(`Onboarding Error: No email found for user ${userId}.`);
    return res.status(400).json({ message: 'User email is required for onboarding.' });
  }
  
  console.log(`[ONBOARDING] Starting onboarding for user ${userId} (${userEmail})`);
  console.log(`[ONBOARDING] Domain-Wide Delegation is ${useDomainWideDelegation ? 'ENABLED' : 'DISABLED'}`);

  // Adding more detailed logging for Domain-Wide Delegation
  if (useDomainWideDelegation) {
    console.log(`[ONBOARDING] Domain-Wide Delegation is ENABLED - Service account will impersonate ${userEmail}`);
    console.log(`[ONBOARDING] Service account email: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'Not explicitly set (using from JSON)'}`);
  } else {
    console.log(`[ONBOARDING] Domain-Wide Delegation is DISABLED - Using user OAuth tokens`);
  }

  // Retrieve the stored OAuth access token from Prisma's Account table (only needed if DWD is disabled)
  let userOAuthCredentials;
  if (!useDomainWideDelegation) {
    const oauthAccount = await prisma.account.findFirst({
      where: { userId, provider: 'google' }
    });
    if (!oauthAccount?.access_token) {
      console.error(`Onboarding Error: No OAuth access token found for user ${userId}.`);
      return res.status(401).json({ message: 'Authentication required.' });
    }
    // Destructure access and refresh tokens for user authentication
    userOAuthCredentials = {
      access_token: oauthAccount.access_token,
      refresh_token: oauthAccount.refresh_token,
      expires_at: oauthAccount.expires_at
    };
  }

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

    // --- Get API Clients (either impersonated or fallback to old method) ---
    // If Domain-Wide Delegation is enabled, get clients that impersonate the user
    let drive, sheets, script;
    
    if (useDomainWideDelegation) {
      console.log(`[ONBOARDING] Using Domain-Wide Delegation to impersonate ${userEmail}`);
      drive = getDriveClientForUser(userEmail);
      sheets = getSheetsClientForUser(userEmail);
      script = getScriptClientForUser(userEmail);
    } else {
      console.log(`[ONBOARDING] Using OAuth fallback method for ${userEmail}`);
      // Initialize with user OAuth (traditional method)
      const userAuth = getUserGoogleApiClient(userOAuthCredentials);
      drive = google.drive({ version: 'v3', auth: userAuth });
      sheets = google.sheets({ version: 'v4', auth: userAuth });
      script = google.script({ version: 'v1', auth: userAuth });
    }

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
        
        // Save the folder ID immediately to ensure we don't lose it if later steps fail
        await prisma.user.update({
          where: { id: userId },
          data: { driveFolderId }
        });
        console.log(`User ${userId}: Saved Drive folder ID to database.`);
      } catch (driveErr) {
         console.error(`User ${userId}: Drive folder creation failed:`, driveErr);
         
         // Use the error handler
         const errorResponse = handleDriveError(driveErr, userId, 'Drive folder creation');
         return res.status(errorResponse.status).json({ error: errorResponse.error, details: errorResponse.details });
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
      console.log(`User ${userId}: Preparing to copy template wrapper script...`);
      console.log(`User ${userId}: Template Script ID from env: ${TEMPLATE_WRAPPER_SCRIPT_FILE_ID}`);
      console.log(`User ${userId}: User email for script naming: ${userEmail}`);
      
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
          throw new Error(`Critical error verifying template script before copy: ${verifyErr.message}`);
        }

        // Create copy of template script
        console.log(`User ${userId}: Copying template script...`);
        
        const scriptCopyMetadata = { 
          name: `KolayXport Wrapper Script - ${session.user.name || session.user.email || userId}`, // Unique name
          parents: [driveFolderId] // Add directly to user's folder
        }; 

        console.log(`User ${userId}: Attempting to copy script with metadata:`, JSON.stringify(scriptCopyMetadata));

        // Perform the copy
        const scriptCopy = await drive.files.copy({
          fileId: TEMPLATE_WRAPPER_SCRIPT_FILE_ID,
          requestBody: scriptCopyMetadata,
          fields: 'id, name, webViewLink',
          supportsAllDrives: true
        });
          
        userAppsScriptId = scriptCopy.data.id;
        console.log(`User ${userId}: Copied script data:`, scriptCopy.data);
        console.log(`User ${userId}: Copied script successfully. New Script ID: ${userAppsScriptId}, Name: ${scriptCopy.data.name}, Link: ${scriptCopy.data.webViewLink}`);
        
        // Save the script ID to the user record immediately so we don't lose it
        await prisma.user.update({
          where: { id: userId },
          data: {
            userAppsScriptId: userAppsScriptId,
          }
        });
        console.log(`User ${userId}: Successfully saved script ID ${userAppsScriptId} to user record.`);
        
        // With DWD, we no longer need the complex sharing logic - the user already owns the script!
        console.log(`User ${userId}: Script ${userAppsScriptId} is already owned by ${userEmail} through impersonation.`);
        
        // --- 7. Create a deployment for this version ---
        try {
          console.log(`User ${userId}: Creating new script version for script ${userAppsScriptId}...`);
          const createVersionResponse = await script.projects.versions.create({
            scriptId: userAppsScriptId
          });
          
          const versionNumber = createVersionResponse.data.versionNumber;
          console.log(`User ${userId}: Created script version: ${versionNumber}`);
          
          console.log(`User ${userId}: Creating new deployment for script ${userAppsScriptId} version ${versionNumber}...`);
          const deploymentResponse = await script.projects.deployments.create({
            scriptId: userAppsScriptId,
            requestBody: {
              versionNumber: versionNumber,
              manifestFileName: "appsscript",
              description: `API Deployment for ${session.user.name || session.user.email || userId}`
            }
          });
          
          deploymentId = deploymentResponse.data.deploymentId;
          console.log(`User ${userId}: Created deployment ID: ${deploymentId}`);
          
          // Save this deployment ID to the user record
          await prisma.user.update({
            where: { id: userId },
            data: {
              userAppsScriptId: userAppsScriptId,
              googleScriptDeploymentId: deploymentId
            }
          });
          console.log(`User ${userId}: Successfully saved script ID ${userAppsScriptId} and deployment ID ${deploymentId} to user record.`);
          
        } catch (deploymentErr) {
          console.error(`User ${userId}: Failed to create deployment for script ${userAppsScriptId}:`, deploymentErr);
          console.error(`User ${userId}: Raw deployment error:`, JSON.stringify(deploymentErr));
          // Log but continue - this is not a fatal error as user can try again or use reshare utility
        }

      } catch (scriptCopyErr) {
        console.error(`User ${userId}: Script copy attempt failed:`, scriptCopyErr);
        console.error(`User ${userId}: Detailed error from Google:`, JSON.stringify(scriptCopyErr.response?.data, null, 2));
        let rawErrorString = 'Error details not available or stringification failed.';
        try {
          rawErrorString = JSON.stringify(scriptCopyErr, Object.getOwnPropertyNames(scriptCopyErr), 2);
        } catch (e) {
          rawErrorString = `Error stringifying scriptCopyErr: ${e.message}. Raw error message: ${scriptCopyErr.message}`;
        }
        console.error(`User ${userId}: Raw scriptCopyErr object:`, rawErrorString);

        let errorMessage = 'Failed to copy the template script.';
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
    if (userAppsScriptId && driveFolderId && deploymentId) { // Ensure script, folder, and deployment ID exist
      console.log(`User ${userId}: Attempting to set FEDEX_FOLDER_ID in script ${userAppsScriptId} using deployment ${deploymentId}`);
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 5000;
      let attempt = 0;
      let success = false;

      while (attempt < MAX_RETRIES && !success) {
        attempt++;
        console.log(`User ${userId}: Attempt ${attempt}/${MAX_RETRIES} to set FEDEX_FOLDER_ID.`);
        try {
          console.log(`User ${userId}: (Attempt ${attempt}) Pre-flight check for script ${userAppsScriptId}.`);
          const project = await script.projects.get({ scriptId: userAppsScriptId });
          console.log(`User ${userId}: (Attempt ${attempt}) Pre-flight SUCCESS for script ${userAppsScriptId}. Title: ${project.data.title}.`);

          const execResponse = await script.scripts.run({
            scriptId: userAppsScriptId, 
            resource: {
              function: 'saveToUserProperties',
              parameters: ['FEDEX_FOLDER_ID', driveFolderId],
              deploymentId: deploymentId 
            }
          });

          if (execResponse.data.error) {
            console.error(`User ${userId}: Apps Script error on attempt ${attempt} setting FEDEX_FOLDER_ID:`, JSON.stringify(execResponse.data.error, null, 2));
            const apiErrorStatus = execResponse.data.error.code;
            const appsScriptErrorDetails = execResponse.data.error.details && execResponse.data.error.details[0];

            if (apiErrorStatus === 404 && attempt < MAX_RETRIES) {
              console.log(`User ${userId}: Script ${userAppsScriptId} not found (404), will retry after ${RETRY_DELAY_MS}ms...`);
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            } else {
              throw new Error(`Apps Script execution failed: Code ${apiErrorStatus}, Message: ${appsScriptErrorDetails?.errorMessage || JSON.stringify(execResponse.data.error)}`);
            }
          } else {
            console.log(`User ${userId}: FEDEX_FOLDER_ID set successfully in Apps Script on attempt ${attempt}.`);
            success = true;
          }
        } catch (runError) {
          console.error(`User ${userId}: Error during script execution on attempt ${attempt}/${MAX_RETRIES}:`, runError.message);
          if (runError.code === 404 && attempt < MAX_RETRIES) {
            console.log(`User ${userId}: Script ${userAppsScriptId} not found (404), will retry after ${RETRY_DELAY_MS}ms...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          } else {
            console.error(`User ${userId}: Final attempt failed or non-404 error on attempt ${attempt}/${MAX_RETRIES}`);
            // On the final attempt, or for non-404 errors, just log and continue
            // We don't want to fail the entire onboarding just because property setting failed
            if (attempt >= MAX_RETRIES) {
              console.warn(`User ${userId}: Property setting failed after all retries, but onboarding will continue.`);
              break;
            }
          }
        }
      }

      if (!success) {
        console.error(`User ${userId}: FEDEX_FOLDER_ID could not be set in script ${userAppsScriptId} after all ${MAX_RETRIES} retries.`);
        // We don't throw here - just log error and continue
        console.warn(`User ${userId}: Continuing onboarding despite property setting failure. User may need to set properties manually.`);
      } else {
        console.log(`User ${userId}: Successfully set FEDEX_FOLDER_ID in Apps Script ${userAppsScriptId}`);
      }
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
    console.error(`User ${userId}: Critical onboarding error in main try-catch:`, error.message);
    console.error(`User ${userId}: Full error object:`, error);
    
    // Use more descriptive error messages
    let errorMessage = `An error occurred during onboarding: ${error.message}`;
    
    if (error.message.includes('unauthorized_client')) {
      errorMessage = 'Domain-Wide Delegation error: Your service account does not have permission to impersonate users. Please check Google Admin console configuration.';
    }
    
    return res.status(500).json({
      error: errorMessage,
      userEmail: userEmail,
      domainWideDelegation: useDomainWideDelegation ? 'Enabled' : 'Disabled'
    });
  }
} 
import { getSession } from 'next-auth/react';
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

  const session = await getSession({ req });
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
  const TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID = process.env.TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID; // <-- RENAMED/NEW ENV VAR

  if (!TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID) {
    console.error('Onboarding Error: TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID not configured.');
    return res.status(500).json({ error: 'Server configuration error: Missing template sheet ID.' });
  }

  let googleSheetId, driveFolderId, spreadsheetUrl;
  // userAppsScriptId will be set by a separate callback from the script itself after user initialization.
  let userAppsScriptId = null; 

  try {
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleSheetId: true, driveFolderId: true, userAppsScriptId: true }
    });

    // If sheet, folder, AND script ID exist, onboarding is fully complete for this new flow.
    // Note: userAppsScriptId might be null if they completed old onboarding or haven't initialized script yet.
    if (existingUser?.googleSheetId && existingUser?.driveFolderId /* && existingUser?.userAppsScriptId -- this will be set later */) {
      console.log(`User ${userId} already has core resources (sheet, folder). Checking script ID.`);
      // We still return the data, frontend will handle if script init is needed
       spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${existingUser.googleSheetId}/edit`;
       return res.status(200).json({
          success: true,
          message: 'User already has core resources.',
          data: {
              googleSheetId: existingUser.googleSheetId,
              driveFolderId: existingUser.driveFolderId,
              userAppsScriptId: existingUser.userAppsScriptId, // Will be null if not yet initialized
              spreadsheetUrl: spreadsheetUrl,
              // No scriptWebViewLink here, script is in the sheet.
          }
      });
    }

    googleSheetId = existingUser?.googleSheetId;
    driveFolderId = existingUser?.driveFolderId;
    // userAppsScriptId is intentionally null or from DB if old flow partially completed.

    console.log(`Starting/Resuming onboarding for user ${userId}...`);

    const userAuth = getUserGoogleApiClient({ access_token, refresh_token, expires_at });
    const drive = google.drive({ version: 'v3', auth: userAuth });
    const scriptApi = google.script({ version: 'v1', auth: userAuth }); // Initialize Apps Script API

    if (!driveFolderId) {
      console.log(`User ${userId}: Creating Drive folder 'KolayXport Kullanıcı Dosyaları'...`);
      const folderMetadata = {
        name: `KolayXport Kullanıcı Dosyaları - ${session.user.name || userId}`, // Unique folder name
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
         if (driveErr.code === 403) {
           return res.status(500).json({ error: 'Google Drive API is disabled or permission denied.'});
         }
         throw new Error(`Failed to create Drive folder.`);
      }
    } else {
       console.log(`User ${userId}: Drive folder already exists: ${driveFolderId}`);
    }
    
    let newSheetJustCreated = false;
    if (!googleSheetId) {
      console.log(`User ${userId}: Copying template Google Sheet ID ${TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID}...`);
      const sheetCopyMetadata = {
        name: `KolayXport Veri Sayfası - ${session.user.name || userId}`,
        parents: [driveFolderId] // Place copy directly into the user's folder
      };

      let copiedSheetFile;
      const maxRetries = 3;
      let attempt = 0;
      let lastError = null;

      while (attempt < maxRetries) {
        try {
          copiedSheetFile = await drive.files.copy({
            fileId: TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID,
            requestBody: sheetCopyMetadata,
            fields: 'id, webViewLink, name', // webViewLink is the spreadsheet URL
            supportsAllDrives: true 
          });
          googleSheetId = copiedSheetFile.data.id;
          spreadsheetUrl = copiedSheetFile.data.webViewLink;
          if (!googleSheetId || !spreadsheetUrl) throw new Error('Sheet copied but ID or URL was not returned.');
          console.log(`User ${userId}: Copied template Sheet successfully. New Sheet ID: ${googleSheetId}, URL: ${spreadsheetUrl}`);
          lastError = null;
          break; 
        } catch (sheetCopyAttemptErr) {
          lastError = sheetCopyAttemptErr;
          attempt++;
          console.warn(`User ${userId}: Attempt ${attempt} to copy template sheet failed. Error Code: ${lastError.code}. Message: ${lastError.message}`);
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 500 + Math.random() * 200; // Exponential backoff
            console.log(`User ${userId}: Retrying sheet copy in ${delay.toFixed(0)}ms...`);
            await new Promise(res => setTimeout(res, delay));
          } else {
            console.error(`User ${userId}: USER failed template sheet copy attempt permanently after ${maxRetries} attempts. Last Error:`, lastError.message);
          }
        }
      }

      if (lastError) { // If all retries failed
        console.error(`User ${userId}: Critical error copying template sheet:`, lastError);
        // For sheet copy, a failure is more critical than script copy as it's the primary user document.
        // No simple fallback link here like with script copy.
        return res.status(500).json({ 
          error: 'Failed to copy the primary template sheet for your account.',
          details: lastError.message 
        });
      }
      newSheetJustCreated = true; // Flag that we just created this sheet
    } else {
      console.log(`User ${userId}: Sheet already exists: ${googleSheetId}`);
      // If sheet exists, ensure we have its URL
      if (!spreadsheetUrl) {
        try {
            const existingSheetFile = await drive.files.get({
                fileId: googleSheetId,
                fields: 'webViewLink',
                supportsAllDrives: true,
            });
            spreadsheetUrl = existingSheetFile.data.webViewLink;
        } catch (e) {
            console.error(`User ${userId}: Sheet ${googleSheetId} exists but failed to get its URL`, e);
            // Fallback, though ideally this shouldn't happen
            spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${googleSheetId}/edit`;
        }
      }
    }

    // --- New Script Handling using Apps Script API ---
    // This section runs if a sheet was just created OR if an existing sheet was found 
    // but we don't yet have a userAppsScriptId for it in our DB (as per existingUser check earlier).
    // However, the initial `if (existingUser?.googleSheetId && existingUser?.driveFolderId)` block
    // already returns if all resources seem to exist. If we reach here with an existing googleSheetId,
    // it implies we don't have a script ID yet, or we are in a fresh creation flow.

    // We will always attempt to create/update the script if newSheetJustCreated is true,
    // or if googleSheetId exists but existingUser.userAppsScriptId was null.
    // For simplicity, let's assume if we've passed the initial "all resources exist" check,
    // and we have a googleSheetId, we should ensure its script is set up.

    let scriptContent;
    try {
      console.log(`User ${userId}: Fetching script content from master template (script ID: ${TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID})...`);
      const contentResponse = await scriptApi.projects.getContent({
        scriptId: TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID,
      });
      scriptContent = contentResponse.data;
      if (!scriptContent || !scriptContent.files || scriptContent.files.length === 0) {
        throw new Error('Master template script content is empty or invalid.');
      }
      console.log(`User ${userId}: Successfully fetched script content from master template. Found ${scriptContent.files.length} files.`);
    } catch (error) {
      console.error(`User ${userId}: Failed to get script content from master template (ID: ${TEMPLATE_SHEET_WITH_BOUND_SCRIPT_ID}). Error:`, error.message, error.response?.data?.error);
      // Potentially clean up created sheet/folder if this fails?
      return res.status(500).json({
        error: 'Failed to retrieve master script content for setup.',
        details: error.message,
      });
    }

    try {
      // Check if user already has a script ID in DB; if so, try to update that.
      // Otherwise, create a new script project bound to the sheet.
      // This logic assumes that if existingUser.userAppsScriptId was present, the initial check would have returned.
      // So, if we are here, we are either creating a new script or userAppsScriptId was null.

      if (existingUser?.userAppsScriptId) {
         // This case should ideally be handled by the top-level check.
         // If somehow it's reached, it implies an existing script ID but we're re-running setup.
         // For safety, we could try to update it, but this flow assumes we create if not fully onboarded.
         // For now, we'll prioritize creation if `userAppsScriptId` from DB was null.
         // Let's assume `userAppsScriptId` will be fresh from creation or `null`.
         console.log(`User ${userId}: Found existing userAppsScriptId ${existingUser.userAppsScriptId} in DB, but proceeding to ensure script content or create new if it was null.`);
         // If existingUser.userAppsScriptId was not null, the first check should have exited.
         // So, if we are here and googleSheetId existed, existingUser.userAppsScriptId must have been null.
      }

      // Create a new script project bound to the newly copied sheet
      console.log(`User ${userId}: Creating new Apps Script project bound to sheet ID ${googleSheetId}...`);
      const createRequest = {
        title: `KolayXport Script - ${session.user.name || userId}`,
        parentId: googleSheetId, // Bind to the new sheet
      };
      const createResponse = await scriptApi.projects.create(createRequest);
      userAppsScriptId = createResponse.data.scriptId; // This is the ID of the NEW script project

      if (!userAppsScriptId) {
        throw new Error('Failed to create a new script project for the user.');
      }
      console.log(`User ${userId}: Created new bound script project with ID: ${userAppsScriptId}`);

      // Update the new script project with the content from the template
      console.log(`User ${userId}: Updating content of new script project ${userAppsScriptId}...`);
      await scriptApi.projects.updateContent({
        scriptId: userAppsScriptId,
        // files: scriptContent.files, // This is the correct structure { files: [...] }
        requestBody: { // requestBody is the correct way to pass parameters for updateContent
          files: scriptContent.files,
        }
      });
      console.log(`User ${userId}: Successfully updated content for script project ${userAppsScriptId}.`);

    } catch (error) {
      console.error(`User ${userId}: Failed to create or update user's script project. Error:`, error.message, error.response?.data?.error);
      // Potentially clean up created sheet/folder/script if this fails?
      return res.status(500).json({
        error: 'Failed to set up Apps Script for your account.',
        details: error.message,
      });
    }

    // --- Share the new folder with the Service Account (optional, if service account needs access) ---
    // This might be useful if a service account needs to access these files later,
    // but for user-driven script execution via UserProperties, it's not strictly necessary for the script itself.
    // Consider if this is still needed for your architecture. If so, ensure scopes are correct.
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
    if (serviceAccountEmail && driveFolderId) {
        try {
            console.log(`User ${userId}: Sharing folder ${driveFolderId} with service account ${serviceAccountEmail}...`);
            const serviceAccountAuthClient = await getServiceAccountAuth();
            const driveSA = google.drive({ version: 'v3', auth: serviceAccountAuthClient });
            
            await driveSA.permissions.create({
                fileId: driveFolderId, // Share the folder
                requestBody: {
                    type: 'user',
                    role: 'writer', // or 'reader' if sufficient
                    emailAddress: serviceAccountEmail,
                },
                supportsAllDrives: true,
            });
            console.log(`User ${userId}: Folder ${driveFolderId} shared with ${serviceAccountEmail}.`);
        } catch (shareError) {
            console.warn(`User ${userId}: Failed to share folder ${driveFolderId} with service account ${serviceAccountEmail}. Error: ${shareError.message}. This might be fine if service account access to folder is not critical.`);
        }
    }


    // --- Update Prisma Database ---
    console.log(`User ${userId}: Updating database with IDs - Sheet: ${googleSheetId}, Folder: ${driveFolderId}, Script: ${userAppsScriptId}`);
    await prisma.user.update({
      where: { id: userId },
      data: {
        googleSheetId: googleSheetId,
        driveFolderId: driveFolderId,
        userAppsScriptId: userAppsScriptId, // This will be null
      },
    });
    console.log(`User ${userId}: Database updated.`);

    console.log(`User ${userId}: Onboarding process (resource creation/linking) completed.`);
    return res.status(200).json({
      success: true,
      message: 'Onboarding resources created/verified. User needs to initialize script from the sheet.',
      data: {
        googleSheetId,
        driveFolderId,
        userAppsScriptId, // Now contains the new script ID
        spreadsheetUrl,
        // No scriptWebViewLink here as script is part of the sheet
        // manualScriptCopyRequired is no longer relevant from this API.
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
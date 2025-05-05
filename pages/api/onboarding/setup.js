import { getSession } from 'next-auth/react';
import { google } from 'googleapis';
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

// --- REMOVED: Service Account Helper - Not needed for onboarding in this architecture ---
// async function getServiceAccountGoogleApiClient() { ... }

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

  // Read master template sheet ID from environment
  const TEMPLATE_SHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!TEMPLATE_SHEET_ID) {
    console.error('Onboarding Error: GOOGLE_SHEETS_SPREADSHEET_ID not configured.');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let googleSheetId, driveFolderId;

  try {
    // --- Check if user already fully onboarded --- 
    // Select only the fields needed for onboarding completion check
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleSheetId: true, driveFolderId: true }
    });

    // If both IDs exist, onboarding is complete
    if (existingUser?.googleSheetId && existingUser?.driveFolderId) {
      console.log(`User ${userId} already onboarded.`);
      return res.status(200).json({ 
          success: true, 
          message: 'User already onboarded.', 
          data: { googleSheetId: existingUser.googleSheetId, driveFolderId: existingUser.driveFolderId } 
      });
    }

    // Assign existing values if partially onboarded
    googleSheetId = existingUser?.googleSheetId;
    driveFolderId = existingUser?.driveFolderId;

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
      console.log(`User ${userId}: Copying template sheet ${TEMPLATE_SHEET_ID}...`);
      const copyMetadata = { 
          name: `MyBabySync Orders - ${session.user.email || userId}`, // Use user email in name
          // Optional: Place the copy in the folder created above?
          // parents: [driveFolderId] 
      };
      try {
        const copiedFile = await drive.files.copy({ 
            fileId: TEMPLATE_SHEET_ID,
            resource: copyMetadata,
            fields: 'id' // Only need the ID of the new sheet
        });
        googleSheetId = copiedFile.data.id;

        if (!googleSheetId) throw new Error('Sheet copied but ID was not returned.');
        console.log(`User ${userId}: Copied Sheet ID: ${googleSheetId}`);

        // Rename the first sheet (gid=0) to "Kargov2"
        console.log(`User ${userId}: Renaming first sheet in ${googleSheetId} to 'Kargov2'...`);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: googleSheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: 0, // Target the first sheet (gid=0)
                    title: "Kargov2",
                  },
                  fields: "title",
                },
              },
            ],
          },
        });
        console.log(`User ${userId}: Renamed first sheet to 'Kargov2'.`);
        
      } catch (copyErr) {
         console.error(`User ${userId}: Sheet copy/rename failed:`, copyErr);
         // Consider checking error type, e.g., if template sheet not found/accessible
         throw new Error(`Failed to copy or rename template sheet.`); // Keep error generic
      }
    } else {
       console.log(`User ${userId}: Sheet already exists: ${googleSheetId}`);
    }

    // --- REMOVED: Get Script ID Logic --- 
    // No longer needed as we use a central script

    // --- 4. Update User Record in Database --- 
    // Ensure both IDs were successfully obtained/retrieved before updating
    if (!googleSheetId || !driveFolderId) {
        throw new Error('Missing Sheet ID or Folder ID after onboarding steps.');
    }
    
    console.log(`User ${userId}: Updating user record in DB with SheetID and FolderID...`);
    await prisma.user.update({
        where: { id: userId },
        data: {
            googleSheetId, // Save the sheet ID
            driveFolderId  // Save the folder ID
        }
    });
    console.log(`User ${userId}: User record updated successfully.`);

    // --- REMOVED: Set FEDEX_FOLDER_ID in Script Properties --- 
    // Not needed, folder ID stored in DB now

    // --- Onboarding Complete --- 
    console.log(`User ${userId}: Onboarding process completed successfully.`);
    res.status(200).json({ 
      success: true, 
      message: 'Setup completed successfully!', 
      data: { googleSheetId, driveFolderId } // Return the obtained IDs
    });

  } catch (error) {
    // Log the detailed error on the server
    console.error(`Onboarding failed for user ${userId}:`, error.message, error.stack);
    // Return a generic error message to the client
    res.status(500).json({ error: `Setup failed: ${error.message}` });
  }
} 
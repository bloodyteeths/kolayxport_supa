// import { getSession } from 'next-auth/react'; // REMOVED
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'; // REMOVED
// import { cookies } from 'next/headers'; // REMOVED
import { createPagesRouteHandlerClient } from '@/lib/supabase/server'; // ADDED
import { PrismaClient } from '@prisma/client';
// Removed googleapis import as Drive folder creation is now simplified

const prisma = new PrismaClient();

// Simplified: Define constants for template sheet and script project
const TEMPLATE_SHEET_URL_FORMAT = "https://docs.google.com/spreadsheets/d/{YOUR_TEMPLATE_SHEET_ID}/copy";
const TEMPLATE_APPS_SCRIPT_PROJECT_ID = "{YOUR_TEMPLATE_APPS_SCRIPT_PROJECT_ID}"; // Keep this if you guide users to copy a script project

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  // const supabase = createRouteHandlerClient({ cookies }); // REMOVED
  const supabase = createPagesRouteHandlerClient({ req, res }); // ADDED

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Supabase session error in onboarding/setup:', sessionError);
      return res.status(401).json({ message: 'Supabase session error', error: sessionError.message });
    }
    if (!session) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const userId = session.user.id;

    // 1. Check if user already has setup info in Prisma (idempotency)
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleSheetId: true, userAppsScriptId: true, driveFolderId: true }
    });

    if (existingUser?.googleSheetId && existingUser?.userAppsScriptId) {
        // If setup is already complete, perhaps return existing info or a specific message
        return res.status(200).json({
            message: "Onboarding setup already completed.",
            googleSheetCopyUrl: TEMPLATE_SHEET_URL_FORMAT, // Still provide the copy URL if they need a new one
            appsScriptProjectId: TEMPLATE_APPS_SCRIPT_PROJECT_ID, // Guide for script setup
            driveFolderId: existingUser.driveFolderId, // If it was created
            existingGoogleSheetId: existingUser.googleSheetId,
            existingUserAppsScriptId: existingUser.userAppsScriptId,
        });
    }

    // For this simplified version, we are not creating a Drive folder via API.
    // We will instruct the user to create one and copy the sheet into it.
    // The driveFolderId can be saved later via settings if needed.

    // Provide the URL for the user to copy the template Google Sheet
    // Replace {YOUR_TEMPLATE_SHEET_ID} with your actual template sheet ID
    const googleSheetCopyUrl = TEMPLATE_SHEET_URL_FORMAT;
    if (googleSheetCopyUrl.includes("{YOUR_TEMPLATE_SHEET_ID}")) {
        console.error("TEMPLATE_SHEET_URL_FORMAT is not configured with an actual Sheet ID.");
        return res.status(500).json({ message: "Server configuration error: Template Sheet ID missing." });
    }

    // The user will manually copy the sheet and the associated Apps Script.
    // They will then need to provide the new sheet ID and new script ID back to our app.
    // This will be handled by pages/app/settings.js and /api/setScriptProps.js
    // or a dedicated onboarding step in the UI.

    // For now, this endpoint primarily provides the means to start the manual copy process.
    // No Prisma updates are made here for sheetId/scriptId until the user provides them back.

    return res.status(200).json({
      message: "Please copy the Google Sheet template and set up your Apps Script.",
      googleSheetCopyUrl: googleSheetCopyUrl,
      appsScriptProjectId: TEMPLATE_APPS_SCRIPT_PROJECT_ID, // Guide them to find and copy this script project
      instructions: [
        `1. Click the link to copy the Google Sheet: ${googleSheetCopyUrl}`,
        `2. Open the copied sheet, go to Extensions > Apps Script.`,
        `3. A new Apps Script project will be bound to your sheet. (Or guide them to copy content from your template script project: ${TEMPLATE_APPS_SCRIPT_PROJECT_ID})`,
        `4. In the Apps Script editor, go to Deploy > New deployment. Select Type: Web app.`, 
        `5. Configure: Execute as "Me", Who has access: "Anyone". Click Deploy.`, 
        `6. Copy the Deployment ID (from the deployment dialog) and the Sheet ID (from the sheet URL).`, 
        `7. Save these IDs in your KolayXport settings page.`
      ]
    });

  } catch (error) {
    console.error('Error in onboarding setup:', error.message);
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
} 
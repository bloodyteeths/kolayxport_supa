// pages/api/gscript/set-user-property.js
// Purpose: Receives property name/value, authenticates user, retrieves their 
// specific script ID from DB.
// MODIFIED: Cannot use scripts.run effectively due to GCP project restrictions.

import { unstable_getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { google } from 'googleapis'; // Used for type definitions
import prisma from '@/lib/prisma';

// Helper function (currently not used as scripts.run is bypassed)
// function getUserGoogleApiClient({ access_token, refresh_token, expires_at }) {
//   const auth = new google.auth.OAuth2(
//     process.env.GOOGLE_CLIENT_ID,
//     process.env.GOOGLE_CLIENT_SECRET
//   );
//   auth.setCredentials({
//     access_token,
//     refresh_token,
//     expiry_date: expires_at * 1000
//   });
//   auth.requestOptions = { quotaProjectId: process.env.GCP_PROJECT_ID };
//   return auth;
// }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await unstable_getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  const userId = session.user.id;

  // We would need these if making a Google API call
  // let oauthAccount;
  // try {
  //   oauthAccount = await prisma.account.findFirst({
  //     where: { userId, provider: 'google' },
  //   });
  //   if (!oauthAccount?.access_token) {
  //     console.error(`User ${userId}: OAuth access token not found in DB for set-user-property.`);
  //     return res.status(401).json({ message: 'User OAuth token not found. Please re-authenticate.' });
  //   }
  // } catch (dbError) {
  //   console.error(`User ${userId}: Database error fetching OAuth token:`, dbError);
  //   return res.status(500).json({ message: 'Server error retrieving authentication details.' });
  // }
  // const { access_token, refresh_token, expires_at } = oauthAccount;

  const { propertyName, value } = req.body;
  if (!propertyName) {
    return res.status(400).json({ message: 'propertyName is required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userAppsScriptId: true },
    });

    const userScriptId = user?.userAppsScriptId;
    if (!userScriptId) {
      console.error(`User ${userId} tried to set property '${propertyName}' but userAppsScriptId not found in DB.`);
      return res.status(400).json({ message: 'User onboarding incomplete or script ID missing.' });
    }
    
    console.warn(`User ${userId}: Temporarily bypassing Google Apps Script API call for set-user-property ('${propertyName}') due to GCP project restrictions with scripts.run. Property not actually set in Apps Script.`);

    // Bypassing actual script execution
    return res.status(200).json({ 
      message: `Property '${propertyName}' was acknowledged by the server but not set in Apps Script due to current limitations. Please manage properties via the Google Sheet.`, 
      simulatedData: { propertyName, value } // Indicate what would have been set
    });

    // --- Code that would use scripts.run (currently problematic) ---
    // const userAuthClient = getUserGoogleApiClient({ access_token, refresh_token, expires_at });
    // const script = google.script({ version: 'v1', auth: userAuthClient });

    // console.log(`User ${userId}: Pre-flight check - script.projects.get for scriptId: ${userScriptId} (as user)`);
    // try {
    //   const project = await script.projects.get({ scriptId: userScriptId });
    //   console.log(`User ${userId}: Pre-flight check SUCCESS for scriptId: ${userScriptId}. Project title: ${project.data.title}`);
    // } catch (projectGetError) {
    //   console.error(`User ${userId}: Pre-flight check FAILED for scriptId: ${userScriptId} (as user). Error:`, projectGetError.message);
    //   if (projectGetError.code === 404) {
    //     return res.status(404).json({ message: `Your script project was not found (ID: ${userScriptId}). It might have been deleted.`, details: projectGetError.message });
    //   } else if (projectGetError.code === 403) {
    //     return res.status(403).json({ message: `You lack permission to access your script project (ID: ${userScriptId}), or required OAuth scopes are missing.`, details: projectGetError.message });
    //   }
    //   return res.status(500).json({ message: 'Error verifying your script project accessibility.', details: projectGetError.message });
    // }

    // console.log(`User ${userId}: Executing Apps Script function: saveToUserProperties for '${propertyName}' in user script: ${userScriptId} (as user)`);
    // const scriptRequest = {
    //   scriptId: userScriptId,
    //   devMode: true,
    //   resource: {
    //     function: 'saveToUserProperties',
    //     parameters: [propertyName, value],
    //   },
    // };

    // const response = await script.scripts.run(scriptRequest);

    // if (response.data.error) {
    //   console.error(`User ${userId}: Apps Script Execution Error (saveToUserProperties as user):`, JSON.stringify(response.data.error, null, 2));
    //   const scriptErrorMessage = response.data.error.details && response.data.error.details[0] ? 
    //                              response.data.error.details[0].errorMessage :
    //                              'Apps Script execution failed while saving property.';
    //   return res.status(500).json({ message: scriptErrorMessage, details: response.data.error.details });
    // }

    // const scriptResult = response.data.response?.result;
    // console.log(`User ${userId}: Apps Script Execution Result (saveToUserProperties as user):`, scriptResult);

    // if (scriptResult && scriptResult.success === false) {
    //   return res.status(400).json({ message: scriptResult.message || `Failed to save property '${propertyName}' in Apps Script.`, scriptResponse: scriptResult });
    // }

    // return res.status(200).json({ 
    //   message: `Property '${propertyName}' saved successfully.`, 
    //   scriptResponse: scriptResult 
    // });
    // --- End of problematic scripts.run code ---

  } catch (error) {
    // This catch block is now less likely to be hit by Google API errors from scripts.run
    console.error(`User ${userId}: Error in API route /api/gscript/set-user-property for '${propertyName}':`, error.message);
    return res.status(500).json({ 
        message: 'Internal server error.', 
        details: error.message 
    });
  }
}

// async function getUserScriptDeploymentId(userId) {
//   // TODO: Implement logic to fetch the user-specific Apps Script deployment ID
//   // from your database (e.g., Prisma) based on the userId.
//   // This is essential if each user has their own script where UserProperties are stored.
//   // Example:
//   // const user = await prisma.user.findUnique({ where: { id: userId } });
//   // return user?.appsScriptDeploymentId; // Assuming you store it like this
//   return process.env.NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID; // Placeholder, needs to be user-specific
// } 
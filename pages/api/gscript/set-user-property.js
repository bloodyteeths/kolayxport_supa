// pages/api/gscript/set-user-property.js
// Purpose: Receives property name/value, authenticates user, retrieves their 
// specific script ID from DB, and calls Apps Script to save UserProperties
// using the USER'S OAuth token.

import { unstable_getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { google } from 'googleapis';
import prisma from '@/lib/prisma'; // Import Prisma client

// Helper function to get Google API client authenticated AS THE USER (with auto-refresh)
// Accepts access_token, refresh_token, and expiry to auto-refresh tokens
function getUserGoogleApiClient({ access_token, refresh_token, expires_at }) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({
    access_token,
    refresh_token,
    expiry_date: expires_at * 1000
  });
  return auth;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await unstable_getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) { // Ensure user ID is present
    return res.status(401).json({ message: 'Not authenticated' });
  }
  const userId = session.user.id;

  // Retrieve the stored OAuth tokens from Prisma's Account table
  let oauthAccount;
  try {
    oauthAccount = await prisma.account.findFirst({
      where: { userId, provider: 'google' },
    });
    if (!oauthAccount?.access_token) {
      console.error(`User ${userId}: OAuth access token not found in DB for set-user-property.`);
      return res.status(401).json({ message: 'User OAuth token not found. Please re-authenticate.' });
    }
  } catch (dbError) {
    console.error(`User ${userId}: Database error fetching OAuth token:`, dbError);
    return res.status(500).json({ message: 'Server error retrieving authentication details.' });
  }
  // Destructure the tokens for user authentication
  const { access_token, refresh_token, expires_at } = oauthAccount;

  const { propertyName, value } = req.body;
  if (!propertyName) {
    return res.status(400).json({ message: 'propertyName is required' });
  }

  try {
    // 0. Fetch user's specific Apps Script ID from DB
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userAppsScriptId: true },
    });

    const userScriptId = user?.userAppsScriptId;
    if (!userScriptId) {
      console.error(`User ${userId} tried to set property but userAppsScriptId not found in DB.`);
      return res.status(400).json({ message: 'User onboarding incomplete or script ID missing.' });
    }
    
    // 1. Authenticate with Google using THE USER'S OAuth tokens (with refresh)
    const userAuthClient = getUserGoogleApiClient({ access_token, refresh_token, expires_at });
    const script = google.script({ version: 'v1', auth: userAuthClient }); // Use user-authenticated client

    // 2. Prepare and Call Google Apps Script Execution API using the USER'S script ID
    console.log(`User ${userId}: Executing Apps Script function: saveToUserProperties for '${propertyName}' in user script: ${userScriptId} (as user)`);
    const scriptRequest = {
      scriptId: userScriptId,
      resource: {
        function: 'saveToUserProperties',
        parameters: [propertyName, value],
        // devMode: false, // Typically false for user-specific scripts unless specific versioning is used
      },
    };

    const response = await script.scripts.run(scriptRequest);

    // 3. Handle Apps Script Response
    if (response.data.error) {
      console.error(`User ${userId}: Apps Script Execution Error (saveToUserProperties as user):`, JSON.stringify(response.data.error, null, 2));
      const scriptErrorMessage = response.data.error.details && response.data.error.details[0] ? 
                                 response.data.error.details[0].errorMessage :
                                 'Apps Script execution failed while saving property.';
      return res.status(500).json({ message: scriptErrorMessage, details: response.data.error.details });
    }

    const scriptResult = response.data.response?.result;
    console.log(`User ${userId}: Apps Script Execution Result (saveToUserProperties as user):`, scriptResult);

    if (scriptResult && scriptResult.success === false) {
      return res.status(400).json({ message: scriptResult.message || `Failed to save property '${propertyName}' in Apps Script.`, scriptResponse: scriptResult });
    }

    return res.status(200).json({ 
      message: `Property '${propertyName}' saved successfully.`, 
      scriptResponse: scriptResult 
    });

  } catch (error) {
    console.error(`User ${userId}: Error in API route /api/gscript/set-user-property:`, error);
    
    // Check for specific auth errors from Google API calls (e.g., token expired)
    if (error.code && (error.code === 401 || error.code === 403)) {
         console.error(`User ${userId}: Google API Auth Error (${error.code}):`, error.errors);
         return res.status(error.code).json({ message: `Google API Authentication Error: ${error.message}. You may need to re-authenticate.` , details: error.errors });
    }
    if (error.response?.data?.error?.message) { // Error from Google API library itself
        return res.status(error.response.status || 500).json({ message: error.response.data.error.message });
    }
    return res.status(500).json({ message: error.message || 'Internal server error communicating with Apps Script.' });
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
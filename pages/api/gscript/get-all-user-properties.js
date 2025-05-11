// pages/api/gscript/get-all-user-properties.js
// Purpose: Authenticates user, retrieves their specific script ID from DB,
// and calls Apps Script to retrieve all UserProperties for that user using USER'S OAuth.

import { getSession } from 'next-auth/react'; // Standard getSession for API routes
// import { GoogleAuth } from 'google-auth-library'; // No longer needed for service account
import { google } from 'googleapis';
import prisma from '@/lib/prisma'; // Import Prisma client

// Helper function to get Google API client authenticated AS THE USER (with auto-refresh)
function getUserGoogleApiClient({ access_token, refresh_token, expires_at }) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({
    access_token,
    refresh_token,
    expiry_date: expires_at ? new Date(expires_at * 1000).getTime() : undefined
  });
  auth.requestOptions = { quotaProjectId: process.env.GCP_PROJECT_ID };
  return auth;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getSession({ req });
  if (!session || !session.user?.id) {
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
      console.error(`User ${userId}: OAuth access token not found in DB for get-all-user-properties.`);
      return res.status(401).json({ message: 'User OAuth token not found. Please re-authenticate.' });
    }
  } catch (dbError) {
    console.error(`User ${userId}: Database error fetching OAuth token for get-all-user-properties:`, dbError);
    return res.status(500).json({ message: 'Server error retrieving authentication details.' });
  }
  const { access_token, refresh_token, expires_at } = oauthAccount;

  try {
    // 0. Fetch user's specific Apps Script ID from DB
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userAppsScriptId: true }, // Ensure this field name matches your Prisma schema
    });

    const userScriptId = user?.userAppsScriptId; 
    if (!userScriptId) {
      console.warn(`User ${userId} tried to get properties but userAppsScriptId not found in DB. Returning empty object.`);
      return res.status(200).json({}); 
    }

    // 1. Authenticate with Google using THE USER'S OAuth tokens
    const userAuthClient = getUserGoogleApiClient({ access_token, refresh_token, expires_at });
    const script = google.script({ version: 'v1', auth: userAuthClient });

    // --- Pre-flight check: Verify script project accessibility using USER auth ---
    try {
      console.log(`User ${userId}: Pre-flight check - script.projects.get for scriptId: ${userScriptId} (as user)`);
      const project = await script.projects.get({ scriptId: userScriptId });
      console.log(`User ${userId}: Pre-flight check SUCCESS for scriptId: ${userScriptId}. Project title: ${project.data.title}`);
    } catch (projectGetError) {
      console.error(`User ${userId}: Pre-flight check FAILED for scriptId: ${userScriptId} (as user). Error:`, projectGetError.message);
      // Handle specific errors (403 for permission, 404 for not found)
      if (projectGetError.code === 404) {
        return res.status(404).json({ message: `Your script project (ID: ${userScriptId}) was not found. It might have been deleted.`, details: projectGetError.message });
      } else if (projectGetError.code === 403) {
        return res.status(403).json({ message: `You lack permission to access your script project (ID: ${userScriptId}), or required OAuth scopes are missing for your account.`, details: projectGetError.message });
      }
      return res.status(500).json({ message: 'Error verifying your script project accessibility.', details: projectGetError.message });
    }
    // --- End Pre-flight check ---

    // 2. Prepare and Call Google Apps Script Execution API using the USER'S script ID
    console.log(`User ${userId}: Executing Apps Script function: getAllUserProperties in user script: ${userScriptId} (as user)`);
    const scriptRequest = {
      scriptId: userScriptId,
      devMode: true, // Run the latest saved code
      resource: {
        function: 'getAllUserProperties',
      },
    };

    const response = await script.scripts.run(scriptRequest);

    // 3. Handle Apps Script Response
    if (response.data.error) {
      console.error(`User ${userId}: Apps Script Execution Error (getAllUserProperties as user):`, JSON.stringify(response.data.error, null, 2));
      const scriptErrorMessage = response.data.error.details && response.data.error.details[0] ? 
                                 response.data.error.details[0].errorMessage :
                                 'Apps Script execution failed while fetching properties.';
      return res.status(500).json({ message: scriptErrorMessage, details: response.data.error.details });
    }

    const userProperties = response.data.response?.result;
    
    if (userProperties && userProperties.error) {
        console.error(`User ${userId}: Apps Script function (getAllUserProperties as user) returned an error:`, userProperties.error);
        return res.status(500).json({ message: userProperties.error });
    }

    if (typeof userProperties !== 'object' || userProperties === null) {
      console.warn(`User ${userId}: Apps Script (getAllUserProperties as user) did not return a valid properties object. Returning empty object.`);
      return res.status(200).json({});
    }
    
    console.log(`User ${userId}: Apps Script Execution Result (getAllUserProperties as user):`, userProperties);
    return res.status(200).json(userProperties);

  } catch (error) {
    console.error(`User ${userId}: Error in API route /api/gscript/get-all-user-properties:`, error);
    
    if (error.code && (error.code === 401 || error.code === 403)) {
         console.error(`User ${userId}: Google API Auth Error (${error.code}) for get-all-user-properties:`, error.errors);
         return res.status(error.code).json({ message: `Google API Authentication Error: ${error.message}. You may need to re-authenticate.` , details: error.errors });
    }
    if (error.response?.data?.error?.message) {
        return res.status(error.response.status || 500).json({ message: error.response.data.error.message });
    }
    return res.status(500).json({ message: error.message || 'Internal server error fetching properties from Apps Script.' });
  }
} 
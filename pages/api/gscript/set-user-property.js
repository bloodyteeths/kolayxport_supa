// pages/api/gscript/set-user-property.js
// Purpose: Receives property name/value, authenticates user, retrieves their 
// specific script ID from DB, and calls Apps Script to save UserProperties.

import { unstable_getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { google } from 'googleapis';
import prisma from '@/lib/prisma'; // Import Prisma client
import { 
  getScriptClientForUser, 
  getDriveClientForUser 
} from '@/lib/googleServiceAccountAuth';

// Check if Domain-Wide Delegation is enabled
const useDomainWideDelegation = process.env.DOMAIN_WIDE_DELEGATION === 'true';

// Helper function to get Google API client authenticated AS THE USER (with auto-refresh)
// Only used if Domain-Wide Delegation is disabled
function getUserGoogleApiClient({ access_token, refresh_token, expires_at }) {
  // Create OAuth2 client with client ID/secret so it can auto-refresh tokens
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
  const userEmail = session.user.email;

  if (!userEmail && useDomainWideDelegation) {
    console.error(`User ${userId}: User email is required for Domain-Wide Delegation but is missing from session.`);
    return res.status(400).json({ message: 'User email is required for authentication.' });
  }

  console.log(`[SET_PROP] Starting property update for user ${userId} (${userEmail || 'email unknown'})`);
  console.log(`[SET_PROP] Domain-Wide Delegation is ${useDomainWideDelegation ? 'ENABLED' : 'DISABLED'}`);

  // Retrieve the stored OAuth tokens from Prisma's Account table (only if not using DWD)
  let userOAuthCredentials;
  if (!useDomainWideDelegation) {
    try {
      const oauthAccount = await prisma.account.findFirst({
        where: { userId, provider: 'google' },
      });
      if (!oauthAccount?.access_token) {
        console.error(`User ${userId}: OAuth access token not found in DB for set-user-property.`);
        return res.status(401).json({ message: 'User OAuth token not found. Please re-authenticate.' });
      }
      // Destructure the tokens for user authentication
      userOAuthCredentials = {
        access_token: oauthAccount.access_token,
        refresh_token: oauthAccount.refresh_token,
        expires_at: oauthAccount.expires_at
      };
    } catch (dbError) {
      console.error(`User ${userId}: Database error fetching OAuth token:`, dbError);
      return res.status(500).json({ message: 'Server error retrieving authentication details.' });
    }
  }

  const { propertyName, value } = req.body;
  if (!propertyName) {
    return res.status(400).json({ message: 'propertyName is required' });
  }

  try {
    // 0. Fetch user's specific Apps Script ID and Deployment ID from DB
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userAppsScriptId: true, googleScriptDeploymentId: true }, // Fetch deploymentId
    });

    const userScriptId = user?.userAppsScriptId;
    const userScriptDeploymentId = user?.googleScriptDeploymentId; // Get deploymentId

    if (!userScriptId) {
      console.error(`User ${userId} tried to set property but userAppsScriptId not found in DB.`);
      return res.status(400).json({ message: 'User onboarding incomplete or script ID missing.' });
    }
    if (!userScriptDeploymentId) {
      console.error(`User ${userId} has scriptId ${userScriptId} but googleScriptDeploymentId not found in DB. Script execution may fail.`);
      return res.status(400).json({ message: 'User script deployment ID missing. Please ensure onboarding created a deployment.' });
    }
    
    // Get script and drive clients - either impersonated or OAuth
    let script, drive;
    
    if (useDomainWideDelegation && userEmail) {
      console.log(`[SET_PROP] Using Domain-Wide Delegation to impersonate ${userEmail}`);
      // Get clients that impersonate the user
      script = getScriptClientForUser(userEmail);
      drive = getDriveClientForUser(userEmail);
    } else {
      console.log(`[SET_PROP] Using user OAuth (fallback method)`);
      // Initialize with user OAuth (traditional method)
      const userAuthClient = getUserGoogleApiClient(userOAuthCredentials);
      script = google.script({ version: 'v1', auth: userAuthClient });
      drive = google.drive({ version: 'v3', auth: userAuthClient });
    }

    // --- Pre-flight check: Verify script project accessibility ---
    try {
      console.log(`User ${userId}: Pre-flight check - script.projects.get for scriptId: ${userScriptId}`);
      const project = await script.projects.get({ scriptId: userScriptId });
      console.log(`User ${userId}: Pre-flight check SUCCESS for scriptId: ${userScriptId}. Project title: ${project.data.title}`);
      
      // Log permissions for the file
      console.log(`User ${userId}: Fetching permissions for script ${userScriptId} to verify access.`);
      const permissionsResponse = await drive.permissions.list({
        fileId: userScriptId,
        fields: 'permissions(id,emailAddress,role,type)',
        supportsAllDrives: true,
      });
      console.log(`User ${userId}: Permissions list for script ${userScriptId}:`, JSON.stringify(permissionsResponse.data.permissions, null, 2));
      
      // If using service account via DWD, we shouldn't need explicit permissions checks
      if (!useDomainWideDelegation) {
        const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const saPermission = permissionsResponse.data.permissions?.find(p => p.emailAddress === serviceAccountEmail);
        if (saPermission) {
          console.log(`User ${userId}: Service Account ${serviceAccountEmail} has role '${saPermission.role}' on script ${userScriptId}.`);
        } else {
          console.warn(`User ${userId}: Service Account ${serviceAccountEmail} has NO explicit permissions on script ${userScriptId}.`);
        }
      }
    } catch (projectGetError) {
      console.error(`User ${userId}: Pre-flight check FAILED for scriptId: ${userScriptId}. Error:`, projectGetError.message);
      
      if (projectGetError.code === 404) {
        return res.status(404).json({ message: `Script project was not found (ID: ${userScriptId}).`, details: projectGetError.message });
      } else if (projectGetError.code === 403) {
        return res.status(403).json({ 
          message: useDomainWideDelegation 
            ? `Unable to access script project as user ${userEmail} (ID: ${userScriptId}).` 
            : `You lack permission to access your script project (ID: ${userScriptId}).`, 
          details: projectGetError.message 
        });
      }
      return res.status(500).json({ message: 'Error verifying script project accessibility.', details: projectGetError.message });
    }
    // --- End Pre-flight check ---

    // 2. Call Google Apps Script Execution API
    console.log(`User ${userId}: Executing Apps Script function: saveToUserProperties for '${propertyName}' in script: ${userScriptId} using deploymentId ${userScriptDeploymentId}`);
    const scriptRequest = {
      scriptId: userScriptId,
      resource: {
        function: 'saveToUserProperties',
        parameters: [propertyName, value],
        deploymentId: userScriptDeploymentId
      },
    };

    const response = await script.scripts.run(scriptRequest);

    // 3. Handle Apps Script Response
    if (response.data.error) {
      console.error(`User ${userId}: Apps Script Execution Error (saveToUserProperties):`, JSON.stringify(response.data.error, null, 2));
      const scriptErrorMessage = response.data.error.details && response.data.error.details[0] ? 
                                 response.data.error.details[0].errorMessage :
                                 'Apps Script execution failed while saving property.';
      return res.status(500).json({ message: scriptErrorMessage, details: response.data.error.details });
    }

    const scriptResult = response.data.response?.result;
    console.log(`User ${userId}: Apps Script Execution Result (saveToUserProperties):`, scriptResult);

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
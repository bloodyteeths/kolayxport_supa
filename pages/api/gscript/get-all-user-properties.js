// pages/api/gscript/get-all-user-properties.js
// Purpose: Authenticates user, retrieves their specific script ID from DB,
// and calls Apps Script to retrieve all UserProperties for that user.

import { getSession } from 'next-auth/react';
// Remove GoogleAuth and google imports as they are handled by the service module
// import { GoogleAuth } from 'google-auth-library';
// import { google } from 'googleapis';
import prisma from '@/lib/prisma'; // Import Prisma client
import { getScriptServiceClient, getDriveServiceClient as getSADriveClient } from '@/lib/googleServiceAccountAuth'; // Import SA Drive client

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getSession({ req });
  if (!session || !session.user?.id) { // Ensure user ID is present
    return res.status(401).json({ message: 'Not authenticated' });
  }
  const userId = session.user.id;

  try {
    // 0. Fetch user's specific Apps Script ID and Deployment ID from DB
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userAppsScriptId: true, googleScriptDeploymentId: true }, // Fetch deploymentId
    });

    const userScriptId = user?.userAppsScriptId;
    const userScriptDeploymentId = user?.googleScriptDeploymentId; // Get deploymentId

    if (!userScriptId) {
      console.error(`User ${userId} tried to get properties but userAppsScriptId not found in DB.`);
      // If onboarding isn't complete, returning empty might be okay for the settings page
      // Or return an error if it's unexpected.
      return res.status(200).json({}); // Return empty object, frontend will show empty fields
      // return res.status(400).json({ message: 'User onboarding incomplete or script ID missing.' });
    }
    if (!userScriptDeploymentId) {
      console.error(`User ${userId} has scriptId ${userScriptId} but googleScriptDeploymentId not found in DB. Script execution may fail or use devMode if not updated.`);
      // Depending on strictness, you might return an error here or attempt devMode as a fallback (though we are moving away from devMode)
      // For now, we'll let it proceed and it will likely fail at scripts.run if deploymentId is strictly required by an updated script.
      // Or, if the script is not yet updated to require a deploymentId, devMode might work, but that's not the goal.
      return res.status(400).json({ message: 'User script deployment ID missing. Please ensure onboarding created a deployment.' });
    }

    // 1. Authenticate with Google using Service Account Credentials
    // The GOOGLE_SERVICE_ACCOUNT_JSON parsing and GoogleAuth setup is now handled by the imported module.
    // The check for process.env.GOOGLE_SERVICE_ACCOUNT_JSON is done within the module.
    /*
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON) { // This env var is now GOOGLE_SERVICE_ACCOUNT_JSON
        console.error('Critical: GOOGLE_SERVICE_ACCOUNT_JSON is not set.'); // Adjusted message
        return res.status(500).json({ message: 'Server configuration error: Auth credentials missing.' });
    }
    // const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON); // Now GOOGLE_SERVICE_ACCOUNT_JSON
    
    // const auth = new GoogleAuth({
    //   credentials,
    //   scopes: [
    //     'https://www.googleapis.com/auth/script.scriptapp',
    //     'https://www.googleapis.com/auth/script.projects',
    //     'https://www.googleapis.com/auth/script.deployments',
    //     'https://www.googleapis.com/auth/script.metrics'
    //   ],
    //   clientOptions: { quotaProjectId: process.env.GCP_PROJECT_ID }
    // });

    // const client = await auth.getClient();
    // const script = google.script({ version: 'v1', auth: client });
    */

    const script = await getScriptServiceClient();
    const driveSA = await getSADriveClient(); // Get Service Account Drive client

    // --- Pre-flight check: Verify script project accessibility AND service account permissions ---
    try {
      console.log(`User ${userId}: Pre-flight check - script.projects.get for scriptId: ${userScriptId} (using service account)`);
      const project = await script.projects.get({ scriptId: userScriptId });
      console.log(`User ${userId}: Pre-flight check SUCCESS for scriptId: ${userScriptId}. Project title: ${project.data.title}`);

      // Log permissions for the service account
      console.log(`User ${userId}: Fetching permissions for script ${userScriptId} (SA) to verify 'writer' access.`);
      const permissionsResponse = await driveSA.permissions.list({
        fileId: userScriptId,
        fields: 'permissions(id,emailAddress,role,type)',
        supportsAllDrives: true,
      });
      const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      const saPermission = permissionsResponse.data.permissions?.find(p => p.emailAddress === serviceAccountEmail);
      if (saPermission) {
        console.log(`User ${userId}: Service Account ${serviceAccountEmail} has role '${saPermission.role}' on script ${userScriptId}.`);
        if (saPermission.role !== 'writer' && saPermission.role !== 'owner') {
          console.warn(`User ${userId}: Service Account ${serviceAccountEmail} has role '${saPermission.role}' but needs 'writer' or 'owner' for script ${userScriptId}. Execution might fail.`);
          // Consider returning a 403 here if writer is strictly necessary
        }
      } else {
        console.warn(`User ${userId}: Service Account ${serviceAccountEmail} has NO explicit permissions on script ${userScriptId}. Execution will likely fail.`);
        // Consider returning a 403 here
      }
      // console.log(`User ${userId}: Full permissions list for script ${userScriptId}:`, JSON.stringify(permissionsResponse.data.permissions, null, 2));

    } catch (projectGetError) {
      console.error(`User ${userId}: Pre-flight check FAILED for scriptId: ${userScriptId}. Error:`, projectGetError.message);
      if (projectGetError.code === 404) {
        return res.status(404).json({ message: `Script project not found (ID: ${userScriptId}). Ensure it exists and is shared with the service account.`, details: projectGetError.message });
      } else if (projectGetError.code === 403) {
        return res.status(403).json({ message: `Service account lacks permission to access script project (ID: ${userScriptId}). Check IAM and script sharing.`, details: projectGetError.message });
      }
      return res.status(500).json({ message: 'Error verifying script project accessibility.', details: projectGetError.message });
    }
    // --- End Pre-flight check ---

    // 2. Prepare and Call Google Apps Script Execution API using the USER'S script ID
    console.log(`Executing Apps Script function: getAllUserProperties in user script: ${userScriptId} using deploymentId: ${userScriptDeploymentId}`);
    const scriptRequest = {
      scriptId: userScriptId, // scriptId is still needed here
      resource: {
        function: 'getAllUserProperties',
        // devMode: true // REMOVED: Use deploymentId instead
        deploymentId: userScriptDeploymentId // ADDED: Use the user-specific deployment ID
      },
    };

    const response = await script.scripts.run(scriptRequest);

    // 3. Handle Apps Script Response
    if (response.data.error) {
      console.error('Apps Script Execution Error (getAllUserProperties):', JSON.stringify(response.data.error, null, 2));
      
      // Add more detailed error diagnosis for common issues
      const errorCode = response.data.error.code;
      const errorDetails = response.data.error.details && response.data.error.details[0];
      const errorMessage = errorDetails?.errorMessage || 'Unknown script execution error';
      
      if (errorCode === 403) {
        console.error(`PERMISSION ERROR: Service account ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '[EMAIL NOT SET]'} lacks permission to execute script ${userScriptId}. Check if script is shared with service account as a 'writer' or 'editor'.`);
        return res.status(403).json({ 
          message: 'Permission denied executing script. The service account needs "writer" or "editor" access, not just "reader" access.',
          details: errorMessage,
          scriptId: userScriptId,
          serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '[EMAIL NOT SET]'
        });
      } else if (errorCode === 404) {
        console.error(`NOT FOUND ERROR: Script ${userScriptId} not found or not accessible by service account.`);
        return res.status(404).json({ 
          message: 'Script not found or not accessible. Verify the script exists and is shared with the service account.',
          details: errorMessage,
          scriptId: userScriptId
        });
      }
      
      const scriptErrorMessage = errorDetails ? errorMessage : 'Apps Script execution failed while fetching properties.';
      return res.status(500).json({ message: scriptErrorMessage, details: response.data.error.details, code: errorCode });
    }

    const userProperties = response.data.response?.result;
    
    // The getAllUserProperties Apps Script function should return an object.
    // If it returns an error structure (e.g., { error: "message" }), handle it.
    if (userProperties && userProperties.error) {
        console.error('Apps Script function (getAllUserProperties) returned an error:', userProperties.error);
        return res.status(500).json({ message: userProperties.error });
    }

    if (typeof userProperties !== 'object' || userProperties === null) {
      console.warn('Apps Script did not return a valid properties object for getAllUserProperties. Returning empty object.');
      return res.status(200).json({}); // Return empty object if no properties or unexpected type
    }
    
    console.log('Apps Script Execution Result (getAllUserProperties):', userProperties);
    return res.status(200).json(userProperties);

  } catch (error) {
    console.error('Error calling Apps Script or with API route logic (get-all-user-properties):', error);
    if (error.response?.data?.error?.message) {
        return res.status(error.response.status || 500).json({ message: error.response.data.error.message });
    }
    return res.status(500).json({ message: error.message || 'Internal server error fetching properties from Apps Script.' });
  }
} 
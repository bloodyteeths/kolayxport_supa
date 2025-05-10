// pages/api/gscript/get-all-user-properties.js
// Purpose: Authenticates user, retrieves their specific script ID from DB,
// and calls Apps Script to retrieve all UserProperties for that user.

import { getSession } from 'next-auth/react';
// Remove GoogleAuth and google imports as they are handled by the service module
// import { GoogleAuth } from 'google-auth-library';
// import { google } from 'googleapis';
import prisma from '@/lib/prisma'; // Import Prisma client
import { getScriptServiceClient } from '@/lib/googleServiceAccountAuth'; // Import the new service client getter

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
    // 0. Fetch user's specific Apps Script ID from DB
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userAppsScriptId: true },
    });

    const userScriptId = user?.userAppsScriptId;
    if (!userScriptId) {
      console.error(`User ${userId} tried to get properties but userAppsScriptId not found in DB.`);
      // If onboarding isn't complete, returning empty might be okay for the settings page
      // Or return an error if it's unexpected.
      return res.status(200).json({}); // Return empty object, frontend will show empty fields
      // return res.status(400).json({ message: 'User onboarding incomplete or script ID missing.' });
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

    const script = await getScriptServiceClient(); // Use the new service client

    // --- Pre-flight check: Verify script project accessibility ---
    try {
      console.log(`User ${userId}: Pre-flight check - script.projects.get for scriptId: ${userScriptId} (using service account)`);
      const project = await script.projects.get({ scriptId: userScriptId });
      console.log(`User ${userId}: Pre-flight check SUCCESS for scriptId: ${userScriptId}. Project title: ${project.data.title}`);
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
    console.log(`Executing Apps Script function: getAllUserProperties in user script: ${userScriptId}`);
    const scriptRequest = {
      scriptId: userScriptId,
      resource: {
        function: 'getAllUserProperties',
        devMode: true // Execute latest saved code
      },
    };

    const response = await script.scripts.run(scriptRequest);

    // 3. Handle Apps Script Response
    if (response.data.error) {
      console.error('Apps Script Execution Error (getAllUserProperties):', JSON.stringify(response.data.error, null, 2));
      const scriptErrorMessage = response.data.error.details && response.data.error.details[0] ? 
                                 response.data.error.details[0].errorMessage :
                                 'Apps Script execution failed while fetching properties.';
      return res.status(500).json({ message: scriptErrorMessage, details: response.data.error.details });
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
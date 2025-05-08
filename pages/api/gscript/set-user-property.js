// pages/api/gscript/set-user-property.js
// Purpose: Receives property name/value, authenticates user, retrieves their 
// specific script ID from DB, and calls Apps Script to save UserProperties.

import { getSession } from 'next-auth/react';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import prisma from '@/lib/prisma'; // Import Prisma client

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getSession({ req });
  if (!session || !session.user?.id) { // Ensure user ID is present
    return res.status(401).json({ message: 'Not authenticated' });
  }
  const userId = session.user.id;

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
    
    // 1. Authenticate with Google using Service Account Credentials
    // Ensure GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON is set in your .env.local and Vercel
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON) {
        console.error('Critical: GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON is not set.');
        return res.status(500).json({ message: 'Server configuration error: Auth credentials missing.' });
    }
    
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON);
    
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/script.projects', 'https://www.googleapis.com/auth/script.deployments', 'https://www.googleapis.com/auth/script.metrics', 'https://www.googleapis.com/auth/drive.metadata.readonly', 'https://www.googleapis.com/auth/script.external_request'], // Add 'https://www.googleapis.com/auth/script.external_request' if your script makes external calls, or other scopes it needs.
                                                                                                                                                                                // For just running a script that sets UserProperties, fewer scopes might be needed.
                                                                                                                                                                                // The key is that the service account must be authorized for these scopes AND the Apps Script API.
    });

    const client = await auth.getClient();
    const script = google.script({ version: 'v1', auth: client });

    // 2. Prepare and Call Google Apps Script Execution API using the USER'S script ID
    console.log(`Executing Apps Script function: saveToUserProperties for '${propertyName}' in user script: ${userScriptId}`);
    const scriptRequest = {
      scriptId: userScriptId, // Use the ID fetched from the database
      resource: {
        function: 'saveToUserProperties',
        parameters: [propertyName, value],
        // devMode: true // Consider if you need to run HEAD vs deployed version for user scripts
                       // Typically false or omitted if no separate deployment per user is managed.
                       // Using the script ID directly often runs the latest saved code (HEAD).
      },
    };

    const response = await script.scripts.run(scriptRequest);

    // 3. Handle Apps Script Response
    if (response.data.error) {
      console.error('Apps Script Execution Error (saveToUserProperties):', JSON.stringify(response.data.error, null, 2));
      const scriptErrorMessage = response.data.error.details && response.data.error.details[0] ? 
                                 response.data.error.details[0].errorMessage :
                                 'Apps Script execution failed while saving property.';
      return res.status(500).json({ message: scriptErrorMessage, details: response.data.error.details });
    }

    const scriptResult = response.data.response?.result;
    console.log('Apps Script Execution Result (saveToUserProperties):', scriptResult);

    if (scriptResult && scriptResult.success === false) {
      // If the Apps Script function itself returns a structured error
      return res.status(400).json({ message: scriptResult.error || `Failed to save property '${propertyName}' in Apps Script.`, scriptResponse: scriptResult });
    }

    return res.status(200).json({ 
      message: `Property '${propertyName}' saved successfully.`, 
      scriptResponse: scriptResult 
    });

  } catch (error) {
    console.error('Error calling Apps Script or with API route logic (set-user-property):', error);
    // Check for specific auth errors from GoogleAuth or API calls
    if (error.response?.data?.error?.message) {
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
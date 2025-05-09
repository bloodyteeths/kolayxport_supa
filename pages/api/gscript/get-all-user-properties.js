// pages/api/gscript/get-all-user-properties.js
// Purpose: Authenticates user, retrieves their specific script ID from DB,
// and calls Apps Script to retrieve all UserProperties for that user.

import { getSession } from 'next-auth/react';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import prisma from '@/lib/prisma'; // Import Prisma client

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
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON) {
        console.error('Critical: GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON is not set.');
        return res.status(500).json({ message: 'Server configuration error: Auth credentials missing.' });
    }
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON);
    
    const auth = new GoogleAuth({
      credentials,
      // Scopes should be appropriate for what the script execution needs.
      // If just reading properties via a script that doesn't make other API calls,
      // fewer scopes might be needed than for setting properties or more complex scripts.
      scopes: ['https://www.googleapis.com/auth/script.projects', 'https://www.googleapis.com/auth/script.deployments', 'https://www.googleapis.com/auth/script.metrics'], 
    });

    const client = await auth.getClient();
    const script = google.script({ version: 'v1', auth: client });

    // 2. Prepare and Call Google Apps Script Execution API using the USER'S script ID
    console.log(`Executing Apps Script function: getAllUserProperties in user script: ${userScriptId}`);
    const scriptRequest = {
      // Use the locked-down API executable deployment
      scriptId: 'AKfycby4D7mkv-F3ZVJ1-MJcFbx23wy8q-B7TEkkNc6p68S4-We50VZlfUStrBktzoPAaBblJA',
      resource: {
        function: 'getAllUserProperties',
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
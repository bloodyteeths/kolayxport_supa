// pages/api/gscript/get-all-user-properties.js
// Purpose: Authenticates user, retrieves their specific script ID from DB.
// MODIFIED: Cannot use scripts.run effectively due to GCP project restrictions.

// import { getSession } from 'next-auth/react'; // REMOVED
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'; // ADDED
import { cookies } from 'next/headers'; // ADDED
import { google } from 'googleapis'; // Used for type definitions if not for auth client construction
import prisma from '@/lib/prisma';

// Helper function to get Google API client authenticated AS THE USER (with auto-refresh)
// This function itself is fine, but its use with script.run for user-copied scripts is problematic.
// function getUserGoogleApiClient({ access_token, refresh_token, expires_at }) {
//   const auth = new google.auth.OAuth2(
//     process.env.GOOGLE_CLIENT_ID,
//     process.env.GOOGLE_CLIENT_SECRET
//   );
//   auth.setCredentials({
//     access_token,
//     refresh_token,
//     expiry_date: expires_at ? new Date(expires_at * 1000).getTime() : undefined
//   });
//   auth.requestOptions = { quotaProjectId: process.env.GCP_PROJECT_ID }; 
//   return auth;
// }

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // const session = await getSession({ req }); // REMOVED
  const supabase = createRouteHandlerClient({ cookies }); // ADDED
  const { data: { session }, error: sessionError } = await supabase.auth.getSession(); // ADDED

  if (sessionError) { // ADDED
    console.error('Supabase getSession error in gscript/get-all-user-properties:', sessionError); // ADDED
    return res.status(500).json({ error: 'Authentication error' }); // ADDED
  } // ADDED

  if (!session || !session.user || !session.user.id) {
    return res.status(401).json({ error: 'User not authenticated' });
  }
  // We would need these if we were making a Google API call, but we're not in this modified version.
  // if (!session.accessToken || !session.refreshToken || !session.tokenExpiresAt) {
  //   console.error(`User ${session.user.id}: Missing token information in session for get-all-user-properties.`);
  //   return res.status(401).json({ error: 'Incomplete authentication details for Google API access.' });
  // }

  const userId = session.user.id;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userAppsScriptId: true },
    });

    if (!user || !user.userAppsScriptId) {
      console.log(`User ${userId}: No Apps Script ID found in DB for get-all-user-properties. Onboarding might be incomplete.`);
      // Return empty if no script ID, as the dashboard might expect this structure
      return res.status(200).json({ properties: {} }); 
    }

    const scriptId = user.userAppsScriptId;
    console.log(`User ${userId}: /api/gscript/get-all-user-properties called. Script ID: ${scriptId}.`);
    console.warn(`User ${userId}: Bypassing Google Apps Script API call for getAllUserProperties due to GCP project restrictions with scripts.run. Returning empty properties.`);
    
    // Temporarily return empty properties.
    // The actual properties need to be managed/retrieved via the Apps Script itself
    // or pushed from the Apps Script to a backend cache.
    return res.status(200).json({ properties: {} });

    // --- Code that would use scripts.run (currently problematic) ---
    // const userAuth = getUserGoogleApiClient({ 
    //   access_token: session.accessToken, 
    //   refresh_token: session.refreshToken,
    //   expires_at: session.tokenExpiresAt 
    // });
    // const scriptApi = google.script({ version: 'v1', auth: userAuth });

    // console.log(`User ${userId}: Pre-flight check - script.projects.get for scriptId: ${scriptId} (as user)`);
    // try {
    //   const scriptProject = await scriptApi.projects.get({ scriptId });
    //   console.log(`User ${userId}: Pre-flight check SUCCESS for scriptId: ${scriptId}. Project title: ${scriptProject.data.title}`);
    // } catch (err) {
    //   console.error(`User ${userId}: Pre-flight check FAILED for scriptId ${scriptId}:`, err.response?.data || err.message);
    //   const errorMessage = err.response?.data?.error?.message || err.message || 'Failed pre-flight check for script.';
    //   const errorDetails = err.response?.data?.error?.errors || [];
    //   return res.status(err.code || 500).json({ 
    //     error: `Could not verify access to your script project: ${errorMessage}`,
    //     details: errorDetails 
    //   });
    // }
    
    // console.log(`User ${userId}: Executing Apps Script function: getAllUserProperties in user script: ${scriptId} (as user)`);
    // const scriptResponse = await scriptApi.scripts.run({
    //   scriptId: scriptId,
    //   resource: {
    //     function: 'getAllUserProperties',
    //     devMode: true, 
    //   },
    // });

    // if (scriptResponse.data.error) {
    //   console.error(`User ${userId}: Apps Script execution error for getAllUserProperties:`, scriptResponse.data.error);
    //   const scriptError = scriptResponse.data.error.details && scriptResponse.data.error.details[0];
    //   return res.status(500).json({ 
    //     error: `Error executing script function: ${scriptError ? scriptError.errorMessage : 'Unknown script error'}`,
    //     details: scriptResponse.data.error 
    //   });
    // }

    // const properties = scriptResponse.data.response?.result || {};
    // console.log(`User ${userId}: Successfully retrieved properties:`, properties);
    // return res.status(200).json({ properties });
    // --- End of problematic scripts.run code ---

  } catch (error) {
    // This catch block is now less likely to be hit by Google API errors from scripts.run
    console.error(`User ${userId}: Error in /api/gscript/get-all-user-properties:`, error.message);
    return res.status(500).json({ 
      error: 'An internal server error occurred.', 
      details: error.message 
    });
  }
}

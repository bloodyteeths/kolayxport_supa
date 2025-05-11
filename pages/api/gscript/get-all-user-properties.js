// pages/api/gscript/get-all-user-properties.js
// Purpose: Authenticates user, retrieves their specific script ID from DB.
// MODIFIED: Cannot use scripts.run effectively due to GCP project restrictions.

// import { getSession } from 'next-auth/react'; // REMOVED
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'; // REMOVED
// import { cookies } from 'next/headers'; // REMOVED
import { createPagesRouteHandlerClient } from '@/lib/supabase/server'; // ADDED
import { google } from 'googleapis'; // Used for type definitions if not for auth client construction
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  // const session = await getSession({ req }); // REMOVED
  const supabase = createPagesRouteHandlerClient({ req, res }); // ADDED

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Supabase session error in get-all-user-properties:', sessionError);
      return res.status(401).json({ message: 'Supabase session error', error: sessionError.message });
    }
    if (!session) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const userId = session.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      // Select the fields that are relevant for the Apps Script or client
      select: {
        id: true,
        email: true,
        name: true,
        userAppsScriptId: true,
        googleSheetId: true,
        driveFolderId: true,
        veeqoApiKey: true, // Be cautious about exposing API keys directly
        shippoApiKey: true, // Consider if these are truly needed by the client/script via this endpoint
        fedexApiKey: true,
        trendyolApiKey: true,
        trendyolApiSecret: true,
        trendyolSupplierId: true,
        hepsiburadaApiKey: true,
        hepsiburadaMerchantId: true,
        // Add any other relevant fields from your User model
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    
    // Mask sensitive keys before sending to client, if necessary.
    // For now, returning them as-is, but this is a security consideration.
    // Example: user.veeqoApiKey = user.veeqoApiKey ? '********' : null;

    return res.status(200).json(user);

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
    console.error('Error in get-all-user-properties:', error.message);
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
}

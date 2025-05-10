import { google } from 'googleapis';
import dotenv from 'dotenv';
import { getSession } from 'next-auth/react';
import prisma from '@/lib/prisma';

dotenv.config();

// --- Helper Functions (Copied from syncOrders.js / setScriptProps.js) ---
async function getAppsScriptAPI() {
  const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  } = process.env;
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error('Missing Google Service Account credentials.');
  }
  const auth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/script.projects']
  );
  auth.projectId = process.env.GCP_PROJECT_ID;
  await auth.authorize();
  return google.script({ version: 'v1', auth });
}

// --- End Helper Functions ---

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Get the central deployment ID from environment variables
  const deploymentId = process.env.NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID;
  if (!deploymentId) {
      console.error('/api/generateLabel Error: Missing NEXT_PUBLIC_APPS_SCRIPT_DEPLOYMENT_ID environment variable.');
      return res.status(500).json({ error: 'Server configuration error.'});
  }

  // --- Extract Order Data from Request Body ---
  const orderData = req.body;

  // Basic validation on incoming orderData
  // TODO: Improve validation based on actual required fields for label generation
  if (!orderData || typeof orderData !== 'object') {
      return res.status(400).json({ error: 'Invalid request body.' });
  }
  // Example: Check for a few essential fields from the frontend
  const requiredFrontendFields = ['orderKey', 'recipientName', 'weight', 'recipientStreet', 'recipientCity', 'recipientPostal', 'recipientCountry'];
  const missingFrontendFields = requiredFrontendFields.filter(field => !(field in orderData));
  if (missingFrontendFields.length > 0) {
       return res.status(400).json({ error: `Missing required order data in request: ${missingFrontendFields.join(', ')}.` });
  }

  let session;
  try {
    // Authenticate user via NextAuth
    session = await getSession({ req });
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = session.user.id;

    // Fetch user-specific Drive folder ID and FedEx keys from DB
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      // Select all necessary fields for the fedexKeys object and the driveFolderId
      select: { 
          driveFolderId: true, 
          fedexAccountNumber: true, 
          fedexMeterNumber: true, // Include if needed by core library
          fedexApiKey: true, 
          fedexSecretKey: true 
      },
    });

    // Check if user has completed onboarding and saved necessary keys
    if (!userRecord?.driveFolderId) {
      return res.status(400).json({ error: 'User setup incomplete: Drive Folder ID missing.' });
    }
    if (!userRecord.fedexApiKey || !userRecord.fedexSecretKey || !userRecord.fedexAccountNumber) {
      return res.status(400).json({ error: 'FedEx API credentials missing in settings.' });
    }

    // Prepare the fedexKeys object for Apps Script
    const fedexKeys = { 
        FEDEX_ACCOUNT_NUMBER: userRecord.fedexAccountNumber, 
        FEDEX_METER_NUMBER: userRecord.fedexMeterNumber, // Pass if available and needed
        FEDEX_API_KEY: userRecord.fedexApiKey, 
        FEDEX_SECRET_KEY: userRecord.fedexSecretKey 
    };
    const driveFolderId = userRecord.driveFolderId;

    const scriptAPI = await getAppsScriptAPI();

    console.log(`Executing Apps Script function 'generateLabelForOrder' via Deployment ID: ${deploymentId} for user ${userId}`);
    // Avoid logging sensitive keys or full orderData unless necessary for debugging
    // console.log(`Passing fedexKeys (keys only): ${Object.keys(fedexKeys)}, driveFolderId: ${driveFolderId}, orderData keys: ${Object.keys(orderData)}`);

    const scriptResponse = await scriptAPI.scripts.run({
      scriptId: deploymentId, // Use the central DEPLOYMENT ID here
      resource: {
        function: 'generateLabelForOrder', // Function name in Wrapper Script
        // Pass parameters in the order expected by the Apps Script function:
        // function generateLabelForOrder(fedexKeys, driveFolderId, orderData)
        parameters: [fedexKeys, driveFolderId, orderData], 
      },
    });

    console.log('Apps Script execution response (generateLabel):', JSON.stringify(scriptResponse.data, null, 2));

    if (scriptResponse.data.error) {
      // Handle script execution errors (e.g., script threw an error, API error)
      console.error('Apps Script Error (generateLabel):', scriptResponse.data.error);
      const scriptError = scriptResponse.data.error.details?.[0]?.error?.message || scriptResponse.data.error.message || 'Unknown script error';
      return res.status(500).json({ error: `Script Execution Failed: ${scriptError}` });
    }

    // Handle potential errors or success messages returned by the generateLabelForOrder function itself
    const result = scriptResponse.data.response?.result;
    if (!result) {
       // This might happen if the script ended unexpectedly without returning
       console.error('Apps Script Function (generateLabel) returned no result.');
       return res.status(500).json({ error: 'Label generation script returned no result.' });
    }
    
    if (result.success) {
        console.log('Label generation successful:', result.message);
        return res.status(200).json({ 
            success: true, 
            message: result.message,
            trackingNumber: result.trackingNumber,
            labelUrl: result.labelUrl 
        });
    } else {
        // Handle errors returned explicitly by the script function
        console.error('Apps Script Function Returned Error (generateLabel):', result.message);
        return res.status(400).json({ error: `Label Generation Failed: ${result.message}` }); // Use 400 or 500 depending on error type
    }

  } catch (err) {
    // Handle errors in the API route itself (auth, network, db lookup, etc.)
    console.error('API Route /api/generateLabel Error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
} 
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const dotenv = require('dotenv');

dotenv.config(); // Ensure .env variables are loaded if running locally

const serviceAccountJsonString = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const gcpProjectId = process.env.GCP_PROJECT_ID;

if (!serviceAccountJsonString) {
  console.error('CRITICAL ERROR: GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set or empty.');
  // Depending on the application's error handling strategy,
  // you might throw an error here to prevent the app from starting/running with a misconfiguration.
  // For now, we'll log an error and auth will likely fail later.
}

let serviceAccount;
if (serviceAccountJsonString) {
  try {
    serviceAccount = JSON.parse(serviceAccountJsonString);
  } catch (e) {
    console.error('CRITICAL ERROR: Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON. Ensure it is a valid JSON string.', e);
    // Throw an error or handle as appropriate for your application
  }
} else {
  // serviceAccount remains undefined, auth attempts will fail
}

if (!gcpProjectId) {
    console.warn('WARNING: GCP_PROJECT_ID environment variable is not set. API calls may be attributed to a default project or fail quota checks.');
}

// Initialize GoogleAuth if serviceAccount was successfully parsed
let auth;
if (serviceAccount) {
  auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: [
      'https://www.googleapis.com/auth/drive', // General Drive access
      'https://www.googleapis.com/auth/spreadsheets', // General Sheets access
      'https://www.googleapis.com/auth/script.projects', // Manage Apps Script projects
      'https://www.googleapis.com/auth/script.deployments', // Manage Apps Script deployments
      'https://www.googleapis.com/auth/script.metrics',    // Access Apps Script metrics
      // Add 'https://www.googleapis.com/auth/script.execute' if service account needs to run scripts directly
    ],
    ...(gcpProjectId && { clientOptions: { quotaProjectId: gcpProjectId } })
  });
} else {
  console.error("CRITICAL ERROR: Service account authentication cannot be initialized because GOOGLE_SERVICE_ACCOUNT_JSON was not loaded or parsed correctly.");
  // Create a dummy auth object or handle this case to prevent crashes if getClient is called.
  // For simplicity here, calls to getXServiceClient will fail if auth is not set.
}

/**
 * Gets an authenticated Google Apps Script API client using service account credentials.
 * @returns {Promise<import('googleapis').script_v1.Script>}
 */
async function getScriptServiceClient() {
  if (!auth) {
    throw new Error('Service account authentication is not initialized.');
  }
  const client = await auth.getClient(); // This is an OAuth2 client
  return google.script({ version: 'v1', auth: client });
}

/**
 * Gets an authenticated Google Drive API client using service account credentials.
 * @returns {Promise<import('googleapis').drive_v3.Drive>}
 */
async function getDriveServiceClient() {
  if (!auth) {
    throw new Error('Service account authentication is not initialized.');
  }
  const client = await auth.getClient();
  return google.drive({ version: 'v3', auth: client });
}

/**
 * Gets an authenticated Google Sheets API client using service account credentials.
 * @returns {Promise<import('googleapis').sheets_v4.Sheets>}
 */
async function getSheetsServiceClient() {
  if (!auth) {
    throw new Error('Service account authentication is not initialized.');
  }
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

module.exports = {
  getScriptServiceClient,
  getDriveServiceClient,
  getSheetsServiceClient,
  // You could also export the raw 'auth' object if needed, but it's generally better to export client getters.
  // serviceAccountAuth: auth
}; 
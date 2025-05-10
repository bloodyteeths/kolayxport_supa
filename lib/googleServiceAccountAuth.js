const { GoogleAuth, JWT } = require('google-auth-library');
const { google } = require('googleapis');
const dotenv = require('dotenv');

dotenv.config(); // Ensure .env variables are loaded if running locally

const serviceAccountJsonString = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const gcpProjectId = process.env.GCP_PROJECT_ID;
const useDomainWideDelegation = process.env.DOMAIN_WIDE_DELEGATION === 'true';

// Log which mode we're operating in
console.log(`[AUTH_CONFIG] Domain-Wide Delegation: ${useDomainWideDelegation ? 'ENABLED' : 'DISABLED'}`);

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

// All the scopes our service account needs to support user operations
const ALL_SCOPES = [
  'https://www.googleapis.com/auth/drive', // General Drive access
  'https://www.googleapis.com/auth/spreadsheets', // General Sheets access
  'https://www.googleapis.com/auth/script.projects', // Manage Apps Script projects
  'https://www.googleapis.com/auth/script.deployments', // Manage Apps Script deployments
  'https://www.googleapis.com/auth/script.metrics',    // Access Apps Script metrics
  'https://www.googleapis.com/auth/script.storage',    // Access script storage (Properties)
  'https://www.googleapis.com/auth/script.scriptapp',  // General script operations
  'https://www.googleapis.com/auth/script.external_request', // Allow scripts to make external requests
  'https://www.googleapis.com/auth/script.container.ui' // UI container operations
];

// Initialize GoogleAuth if serviceAccount was successfully parsed
let auth;
if (serviceAccount) {
  auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ALL_SCOPES,
    ...(gcpProjectId && { clientOptions: { quotaProjectId: gcpProjectId } })
  });
} else {
  console.error("CRITICAL ERROR: Service account authentication cannot be initialized because GOOGLE_SERVICE_ACCOUNT_JSON was not loaded or parsed correctly.");
  // Create a dummy auth object or handle this case to prevent crashes if getClient is called.
  // For simplicity here, calls to getXServiceClient will fail if auth is not set.
}

/**
 * Creates a JWT client that impersonates a user via Domain-Wide Delegation.
 * @param {string} userEmail - The email of the user to impersonate.
 * @returns {JWT} - A JWT client configured to impersonate the user.
 */
function createImpersonatedJWT(userEmail) {
  if (!serviceAccount) {
    throw new Error('Service account credentials not available for impersonation.');
  }
  
  if (!userEmail) {
    throw new Error('User email is required for impersonation with Domain-Wide Delegation.');
  }

  // Create a JWT client that impersonates the user
  const jwtClient = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ALL_SCOPES,
    subject: userEmail,
    ...(gcpProjectId && { clientOptions: { quotaProjectId: gcpProjectId } })
  });
  
  return jwtClient;
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
 * Gets a Google Apps Script API client that impersonates a specific user.
 * @param {string} userEmail - The email of the user to impersonate.
 * @returns {import('googleapis').script_v1.Script} - Script client authenticated as the user.
 */
function getScriptClientForUser(userEmail) {
  if (!useDomainWideDelegation) {
    console.log(`[AUTH_INFO] Domain-Wide Delegation disabled. Falling back to service account for ${userEmail}`);
    return getScriptServiceClient();
  }
  
  console.log(`[AUTH_INFO] Creating Script client impersonating user: ${userEmail}`);
  const jwtClient = createImpersonatedJWT(userEmail);
  return google.script({ version: 'v1', auth: jwtClient });
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
 * Gets a Google Drive API client that impersonates a specific user.
 * @param {string} userEmail - The email of the user to impersonate.
 * @returns {import('googleapis').drive_v3.Drive} - Drive client authenticated as the user.
 */
function getDriveClientForUser(userEmail) {
  if (!useDomainWideDelegation) {
    console.log(`[AUTH_INFO] Domain-Wide Delegation disabled. Falling back to service account for ${userEmail}`);
    return getDriveServiceClient();
  }
  
  console.log(`[AUTH_INFO] Creating Drive client impersonating user: ${userEmail}`);
  const jwtClient = createImpersonatedJWT(userEmail);
  return google.drive({ version: 'v3', auth: jwtClient });
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

/**
 * Gets a Google Sheets API client that impersonates a specific user.
 * @param {string} userEmail - The email of the user to impersonate.
 * @returns {import('googleapis').sheets_v4.Sheets} - Sheets client authenticated as the user.
 */
function getSheetsClientForUser(userEmail) {
  if (!useDomainWideDelegation) {
    console.log(`[AUTH_INFO] Domain-Wide Delegation disabled. Falling back to service account for ${userEmail}`);
    return getSheetsServiceClient();
  }
  
  console.log(`[AUTH_INFO] Creating Sheets client impersonating user: ${userEmail}`);
  const jwtClient = createImpersonatedJWT(userEmail);
  return google.sheets({ version: 'v4', auth: jwtClient });
}

module.exports = {
  getScriptServiceClient,
  getDriveServiceClient,
  getSheetsServiceClient,
  getScriptClientForUser,
  getDriveClientForUser,
  getSheetsClientForUser,
  // You could also export the raw 'auth' object if needed, but it's generally better to export client getters.
  // serviceAccountAuth: auth
}; 
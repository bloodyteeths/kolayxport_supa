import { google } from 'googleapis';

/**
 * Initialize Google Sheets client
 * @param {object} credentials
 * @param {string} credentials.clientEmail
 * @param {string} credentials.privateKey
 */
function getSheetsClient({ clientEmail, privateKey }) {
  if (!clientEmail || !privateKey) {
    throw new Error('Missing Google Sheets credentials');
  }
  const auth = new google.auth.JWT(
    clientEmail,
    null,
    privateKey.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth });
}

/**
 * Read values from a sheet range
 */
export async function getSheetValues({ clientEmail, privateKey, spreadsheetId, range }) {
  const sheets = getSheetsClient({ clientEmail, privateKey });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

/**
 * Append values to a sheet
 */
export async function appendSheetValues({ clientEmail, privateKey, spreadsheetId, range, values }) {
  const sheets = getSheetsClient({ clientEmail, privateKey });
  const resp = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    resource: { values },
  });
  return resp.data;
} 
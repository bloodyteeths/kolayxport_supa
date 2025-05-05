/**
 * @NotOnlyCurrentDoc If using SpreadsheetApp, DriveApp etc. in this wrapper.
 */

// IMPORTANT: Add the Core Logic Library dependency in Project Settings -> Dependencies
// Use the Identifier provided there (e.g., 'MyBabySyncCoreLogicLibrary') to call functions.
// Replace 'MyBabySyncCoreLogicLibrary' below if your identifier is different.
const CoreLibraryIdentifier = 'MyBabySyncCoreLogicLibrary'; // <-- CHANGE IF NEEDED

/**
 * Main sync function called by the Next.js backend via Apps Script API.
 * Receives user's Sheet ID and API keys, calls the Core Logic Library to get new orders,
 * and appends the processed rows to the user's specified sheet.
 *
 * @param {string} spreadsheetId The ID of the user's Google Sheet.
 * @param {object} userApiKeys An object containing the user's API keys (e.g., VEEQO_API_KEY).
 * @returns {object} { success: boolean, appendedRows?: number, error?: string }
 */
function syncOrdersToSheet(spreadsheetId, userApiKeys) {
  const IMG_SIZE = 120;
  const SHEET_NAME = 'Kargov2'; // Keep sheet name consistent or pass as param if needed

  if (!spreadsheetId || !userApiKeys) {
    return { error: 'Missing required parameters: spreadsheetId or userApiKeys.' };
  }

  let ss, sh;
  try {
    ss = SpreadsheetApp.openById(spreadsheetId);
    sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) throw new Error(`Sheet "${SHEET_NAME}" not found in spreadsheet ID ${spreadsheetId}`);
  } catch (e) {
    console.error(`Error opening sheet ${spreadsheetId}: ${e.message}`);
    return { error: `Failed to open target sheet: ${e.message}` };
  }

  console.log(`Wrapper: syncOrdersToSheet called for sheet ${spreadsheetId}.`);

  // --- 1. Get Existing Keys From Sheet ---
  const lastRow = sh.getLastRow();
  const existingKeys = new Set();
  if (lastRow >= 2) {
    try {
      const keys = sh.getRange(2, 9, lastRow - 1, 1).getValues().flat(); // Assuming Key is still column I (9)
      keys.forEach(k => {
        if (k && String(k).trim() !== '') existingKeys.add(String(k).trim());
      });
      console.log(`Wrapper: Found ${existingKeys.size} existing keys in sheet ${spreadsheetId}.`);
    } catch (e) {
      console.error(`Error reading existing keys from sheet ${spreadsheetId}: ${e.message}`);
      // Decide if this is critical - maybe proceed without existing keys?
      // return { error: `Failed to read existing keys: ${e.message}` };
    }
  }

  // --- 2. Call Core Library Function ---
  let libraryResult;
  try {
    console.log(`Wrapper: Calling ${CoreLibraryIdentifier}.fetchAndProcessOrders_ for sheet ${spreadsheetId}...`);
    // Check if the library identifier exists before calling
    if (typeof this[CoreLibraryIdentifier] === 'undefined') {
       throw new Error(`Core Logic Library with identifier "${CoreLibraryIdentifier}" not found or accessible. Ensure it's added in Dependencies.`);
    }
    // Pass necessary data to the library function
    // Ensure the library function fetchAndProcessOrders_ is updated to accept these parameters
    // Persist passed API keys into Script Properties for the Core Logic Library
    PropertiesService.getScriptProperties().setProperties(userApiKeys);
    libraryResult = this[CoreLibraryIdentifier].fetchAndProcessOrders_(userApiKeys, IMG_SIZE, existingKeys);
    console.log(`Wrapper: Library call returned for sheet ${spreadsheetId}:`, JSON.stringify(libraryResult));
  } catch (e) {
     console.error(`Wrapper: Error calling Core Library fetch for sheet ${spreadsheetId}: ${e.message}`, e.stack);
     return { error: `Failed to execute core sync logic: ${e.message}` };
  }

  // --- 3. Process Library Result & Append ---
  if (!libraryResult || !libraryResult.success) {
    return { error: `Core sync logic failed: ${libraryResult?.error || 'Unknown library error'}` };
  }

  const newRows = libraryResult.processedRows || [];
  let appendedRowCount = 0;

  if (newRows.length > 0) {
    // Library should provide rows ready for insertion (e.g., with IMAGE formula)
    // Assuming library returns rows matching columns A:I for the Kargov2 sheet
    const outputData = newRows.map(r => r.slice(0, 9)); // Extract A:I columns
    const appendStart = sh.getLastRow() + 1;
    try {
      console.log(`Wrapper: Appending ${outputData.length} new rows from library to sheet ${spreadsheetId}...`);
      sh.getRange(appendStart, 1, outputData.length, outputData[0].length).setValues(outputData);
      sh.setRowHeights(appendStart, outputData.length, IMG_SIZE); // Consider making IMG_SIZE dynamic if needed
      appendedRowCount = outputData.length;
      console.log(`Wrapper: Appended ${appendedRowCount} new rows to sheet ${spreadsheetId} starting at row ${appendStart}.`);
    } catch (appendError) {
      console.error(`Wrapper: Error appending rows to sheet ${spreadsheetId}: ${appendError.message}`, appendError.stack);
      return { error: `Failed to append rows to sheet: ${appendError.message}` };
    }
  } else {
    console.log(`Wrapper: Core library returned no new rows to append for sheet ${spreadsheetId}.`);
  }

  console.log(`Wrapper: Sync finished for sheet ${spreadsheetId}.`);
  return { success: true, appendedRows: appendedRowCount };
}


/**
 * Generates a FedEx label by calling the Core Logic Library.
 * Receives necessary keys, folder ID, and order data from Next.js.
 *
 * @param {object} fedexKeys An object containing user's FedEx keys (ACCOUNT_NUMBER, METER_NUMBER, API_KEY, SECRET_KEY).
 * @param {string} driveFolderId The ID of the user's Google Drive folder for saving labels.
 * @param {object} orderData Details needed for the label (passed from Next.js).
 * @returns {object} Result from the Core Logic Library's generateFedexLabel_ function.
 */
function generateLabelForOrder(fedexKeys, driveFolderId, orderData) {
  console.log('Wrapper: generateLabelForOrder called.');

  // --- 1. Validate Input Parameters ---
  if (!fedexKeys || !fedexKeys.FEDEX_ACCOUNT_NUMBER || !fedexKeys.FEDEX_API_KEY || !driveFolderId || !orderData) {
     return { success: false, message: "Missing required parameters: fedexKeys, driveFolderId, or orderData." };
  }

  // --- 2. Call Core Library Function ---
  try {
    console.log(`Wrapper: Calling ${CoreLibraryIdentifier}.generateFedexLabel_...`);
     // Check if the library identifier exists before calling
    if (typeof this[CoreLibraryIdentifier] === 'undefined') {
       throw new Error(`Core Logic Library with identifier "${CoreLibraryIdentifier}" not found or accessible. Ensure it's added in Dependencies.`);
    }
    // Pass keys, folder ID, and order data to the library
    // Ensure the library function generateFedexLabel_ is updated to accept these parameters
    const libraryResult = this[CoreLibraryIdentifier].generateFedexLabel_(fedexKeys, driveFolderId, orderData);
    console.log('Wrapper: Library label generation returned:', JSON.stringify(libraryResult));
    return libraryResult; // Return the result directly from the library
  } catch (e) {
    console.error(`Wrapper: Error calling Core Library label generation: ${e.message}`, e.stack);
    return { success: false, message: `Failed to execute core label logic: ${e.message}` };
  }
}


/**
 * Fetches order data directly from the specified user's sheet.
 *
 * @param {string} spreadsheetId The ID of the user's Google Sheet.
 * @returns {object} { success: boolean, data?: object[], error?: string }
 */
function getOrdersFromSheet(spreadsheetId) {
   const SHEET_NAME = 'Kargov2'; // Keep sheet name consistent

   if (!spreadsheetId) {
     return { error: 'Missing required parameter: spreadsheetId.' };
   }

   let ss, sh;
   try {
     ss = SpreadsheetApp.openById(spreadsheetId);
     sh = ss.getSheetByName(SHEET_NAME);
     if (!sh) {
       console.error(`getOrdersFromSheet: Sheet "${SHEET_NAME}" not found in sheet ${spreadsheetId}.`);
       return { error: `Sheet "${SHEET_NAME}" not found.` };
     }
   } catch (e) {
      console.error(`Error opening sheet ${spreadsheetId}: ${e.message}`);
      return { error: `Failed to open target sheet: ${e.message}` };
   }

   try {
     const lastRow = sh.getLastRow();
     const lastCol = sh.getLastColumn(); // Consider fixing the number of columns (e.g., 9 for A:I) if needed
     if (lastRow < 2) {
       console.log(`getOrdersFromSheet: Sheet ${spreadsheetId} is empty or has only header.`);
       return { success: true, data: [] };
     }
     // Fetching A:I (9 columns) - adjust if the expected data range is different
     const range = sh.getRange(2, 1, lastRow - 1, 9);
     const values = range.getValues();
     const displayValues = range.getDisplayValues();
     const formulas = range.getFormulasR1C1(); // Fetch formulas (e.g., for IMAGE)

     // Combine, preferring formula (like IMAGE) over display value, then raw value
     const combinedData = values.map((row, rowIndex) => {
       return row.map((cell, colIndex) => {
         return formulas[rowIndex][colIndex] || displayValues[rowIndex][colIndex] || cell; // Prioritize formula, then display, then raw
       });
     });

     console.log(`getOrdersFromSheet: Fetched ${combinedData.length} rows from sheet ${spreadsheetId}.`);
     return { success: true, data: combinedData };
   } catch (e) {
     console.error(`getOrdersFromSheet: Error fetching data from sheet ${spreadsheetId}: ${e.message}`, e.stack);
     return { error: `Failed to fetch sheet data: ${e.message}` };
   }
}

// --- REMOVED onInstall trigger ---
// Not needed for this architecture 
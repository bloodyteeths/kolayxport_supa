import { getSession } from 'next-auth/react';
import prisma from '@/lib/prisma';
import dotenv from 'dotenv';

dotenv.config();

const SCRIPT_CALLBACK_SECRET = process.env.APPS_SCRIPT_CALLBACK_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { userId, scriptId, sheetId, secret } = req.body;

    // 1. Authenticate the callback from Apps Script
    if (!SCRIPT_CALLBACK_SECRET) {
      console.error('[register-script-id] Error: APPS_SCRIPT_CALLBACK_SECRET is not set in .env.local');
      return res.status(500).json({ success: false, message: 'Server configuration error.' });
    }
    if (secret !== SCRIPT_CALLBACK_SECRET) {
      console.warn(`[register-script-id] Unauthorized attempt to register script. User: ${userId || 'N/A'}, Provided Secret: ${secret ? '******' : 'N/A'}`);
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    // 2. Validate incoming data
    if (!userId || !scriptId || !sheetId) {
      console.error(`[register-script-id] Missing parameters. UserID: ${userId}, ScriptID: ${scriptId}, SheetID: ${sheetId}`);
      return res.status(400).json({ success: false, message: 'Missing required parameters: userId, scriptId, or sheetId.' });
    }

    // 3. Verify user exists and update their record
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      console.error(`[register-script-id] User not found: ${userId}`);
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Optional: Verify that the sheetId provided matches the one we have for the user, if it exists
    if (user.googleSheetId && user.googleSheetId !== sheetId) {
      console.warn(`[register-script-id] Sheet ID mismatch for user ${userId}. DB: ${user.googleSheetId}, Provided: ${sheetId}. Updating to provided sheetId.`);
      // Decide on policy: error out, or update. For now, we'll log and update.
    }
    
    console.log(`[register-script-id] Registering script for user ${userId}. ScriptID: ${scriptId}, SheetID: ${sheetId}`);

    await prisma.user.update({
      where: { id: userId },
      data: {
        userAppsScriptId: scriptId,
        googleSheetId: sheetId, // Ensure this is also up-to-date
      },
    });

    console.log(`[register-script-id] Successfully registered script ${scriptId} and sheet ${sheetId} for user ${userId}.`);
    return res.status(200).json({ success: true, message: 'Script ID registered successfully.' });

  } catch (error) {
    console.error(`[register-script-id] Error: ${error.message}`, error.stack);
    return res.status(500).json({ success: false, message: 'Internal server error.', details: error.message });
  }
} 
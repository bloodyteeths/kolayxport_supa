import { getSession } from 'next-auth/react';
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
  // In development, skip NextAuth session check and use userId from request body
  const { userId, ...body } = req.body;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: missing userId' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid or empty request body. Expected key-value pairs.' });
  }

  try {
    // Map incoming API keys to user record fields
    const updateData = {};
    if ('VEEQO_API_KEY' in body) updateData.veeqoApiKey = body.VEEQO_API_KEY;
    if ('SHIPPO_TOKEN' in body) updateData.shippoToken = body.SHIPPO_TOKEN;
    if ('FEDEX_API_KEY' in body) updateData.fedexApiKey = body.FEDEX_API_KEY;
    if ('FEDEX_API_SECRET' in body) updateData.fedexSecretKey = body.FEDEX_API_SECRET;
    if ('FEDEX_ACCOUNT_NUMBER' in body) updateData.fedexAccountNumber = body.FEDEX_ACCOUNT_NUMBER;
    if ('FEDEX_METER_NUMBER' in body) updateData.fedexMeterNumber = body.FEDEX_METER_NUMBER;
    if ('FEDEX_FOLDER_ID' in body) updateData.driveFolderId = body.FEDEX_FOLDER_ID;

    // Persist settings to the database
    await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return res.status(200).json({ success: true, message: 'Settings saved successfully.' });
  } catch (err) {
    console.error('API Route /api/setScriptProps Error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
} 
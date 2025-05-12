// import { getSession } from 'next-auth/react'; // REMOVED
import { getSupabaseServerClient } from '../../lib/supabase'; // Correct import
// import { cookies } from 'next/headers'; // REMOVED - not directly used with createPagesServerClient
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // const supabase = createRouteHandlerClient({ cookies }); // OLD
  const supabase = getSupabaseServerClient(req, res); // Use the new helper
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError) {
    console.error('Supabase getUser error in setScriptProps:', authError);
    // Consistent error status for auth issues
    return res.status(401).json({ error: 'Authentication error', details: authError.message }); 
  }

  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: User not authenticated' });
  }
  const userId = user.id;
  
  const body = req.body;
  
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    return res.status(400).json({ error: 'Invalid or empty request body. Expected key-value pairs.' });
  }

  try {
    const updateData = {};
    if ('VEEQO_API_KEY' in body) updateData.veeqoApiKey = body.VEEQO_API_KEY;
    if ('SHIPPO_TOKEN' in body) updateData.shippoToken = body.SHIPPO_TOKEN;
    if ('FEDEX_API_KEY' in body) updateData.fedexApiKey = body.FEDEX_API_KEY;
    // Ensure this matches your Prisma schema. Assuming it was changed to fedexApiSecret previously.
    if ('FEDEX_API_SECRET' in body) updateData.fedexApiSecret = body.FEDEX_API_SECRET; 
    if ('FEDEX_ACCOUNT_NUMBER' in body) updateData.fedexAccountNumber = body.FEDEX_ACCOUNT_NUMBER;
    if ('FEDEX_METER_NUMBER' in body) updateData.fedexMeterNumber = body.FEDEX_METER_NUMBER;
    // if ('FEDEX_FOLDER_ID' in body) updateData.driveFolderId = body.FEDEX_FOLDER_ID; // This was likely for GDrive, remove
    if ('TRENDYOL_SUPPLIER_ID' in body) updateData.trendyolSupplierId = body.TRENDYOL_SUPPLIER_ID;
    if ('TRENDYOL_API_KEY' in body) updateData.trendyolApiKey = body.TRENDYOL_API_KEY;
    if ('TRENDYOL_API_SECRET' in body) updateData.trendyolApiSecret = body.TRENDYOL_API_SECRET;
    if ('HEPSIBURADA_MERCHANT_ID' in body) updateData.hepsiburadaMerchantId = body.HEPSIBURADA_MERCHANT_ID;
    if ('HEPSIBURADA_API_KEY' in body) updateData.hepsiburadaApiKey = body.HEPSIBURADA_API_KEY;

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No valid properties provided to update.' });
    }

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
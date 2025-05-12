import { getSupabaseServerClient } from '@/lib/supabase';
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const supabase = getSupabaseServerClient(req, res);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error('[setScriptProps] Supabase auth error:', authError);
      return res.status(401).json({ error: 'Authentication error', details: authError.message });
    }

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = user.id;
    const body = req.body;

    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const updateData = {};

    // Map the incoming keys to database column names
    if ('VEEQO_API_KEY' in body) updateData.veeqoApiKey = body.VEEQO_API_KEY;
    if ('SHIPPO_TOKEN' in body) updateData.shippoToken = body.SHIPPO_TOKEN;
    if ('FEDEX_API_KEY' in body) updateData.fedexApiKey = body.FEDEX_API_KEY;
    if ('FEDEX_API_SECRET' in body) updateData.fedexApiSecret = body.FEDEX_API_SECRET;
    if ('FEDEX_ACCOUNT_NUMBER' in body) updateData.fedexAccountNumber = body.FEDEX_ACCOUNT_NUMBER;
    if ('FEDEX_METER_NUMBER' in body) updateData.fedexMeterNumber = body.FEDEX_METER_NUMBER;
    if ('TRENDYOL_SUPPLIER_ID' in body) updateData.trendyolSupplierId = body.TRENDYOL_SUPPLIER_ID;
    if ('TRENDYOL_API_KEY' in body) updateData.trendyolApiKey = body.TRENDYOL_API_KEY;
    if ('TRENDYOL_API_SECRET' in body) updateData.trendyolApiSecret = body.TRENDYOL_API_SECRET;
    if ('HEPSIBURADA_MERCHANT_ID' in body) updateData.hepsiburadaMerchantId = body.HEPSIBURADA_MERCHANT_ID;
    if ('HEPSIBURADA_API_KEY' in body) updateData.hepsiburadaApiKey = body.HEPSIBURADA_API_KEY;
    if ('SHIPPER_TIN_NUMBER' in body) updateData.SHIPPER_TIN_NUMBER = body.SHIPPER_TIN_NUMBER;
    if ('SHIPPER_CITY' in body) updateData.SHIPPER_CITY = body.SHIPPER_CITY;
    if ('SHIPPER_COUNTRY_CODE' in body) updateData.SHIPPER_COUNTRY_CODE = body.SHIPPER_COUNTRY_CODE;
    if ('SHIPPER_NAME' in body) updateData.SHIPPER_NAME = body.SHIPPER_NAME;
    if ('SHIPPER_PERSON_NAME' in body) updateData.SHIPPER_PERSON_NAME = body.SHIPPER_PERSON_NAME;
    if ('SHIPPER_PHONE_NUMBER' in body) updateData.SHIPPER_PHONE_NUMBER = body.SHIPPER_PHONE_NUMBER;
    if ('SHIPPER_POSTAL_CODE' in body) updateData.SHIPPER_POSTAL_CODE = body.SHIPPER_POSTAL_CODE;
    if ('SHIPPER_STATE_CODE' in body) updateData.SHIPPER_STATE_CODE = body.SHIPPER_STATE_CODE;
    if ('SHIPPER_STREET1' in body) updateData.SHIPPER_STREET1 = body.SHIPPER_STREET1;
    if ('SHIPPER_STREET2' in body) updateData.SHIPPER_STREET2 = body.SHIPPER_STREET2;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid properties to update' });
    }

    const updatedUser = await prisma.user.upsert({
      where: { id: userId },
      update: updateData,
      create: {
        id: userId,
        ...updateData
      }
    });

    return res.status(200).json({ message: 'Settings updated successfully', data: updatedUser });
  } catch (error) {
    console.error('[SetScriptProps API] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    // No explicit disconnect needed.
  }
} 
// import { getSession } from 'next-auth/react'; // REMOVED
import { PrismaClient } from '@prisma/client';
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'; // REMOVED
// import { cookies } from 'next/headers'; // REMOVED - not used directly here for Pages Router
import { createPagesRouteHandlerClient } from '@/lib/supabase/server'; // ADDED

const prisma = new PrismaClient();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  // const supabase = createRouteHandlerClient({ cookies }); // REMOVED
  const supabase = createPagesRouteHandlerClient({ req, res }); // ADDED

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Supabase session error:', sessionError);
      return res.status(401).json({ message: 'Supabase session error', error: sessionError.message });
    }

    if (!session) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const userId = session.user.id; // Get userId from Supabase session
    const { appsScriptId, driveFolderId, googleSheetId, veeqoApiKey, shippoApiKey, fedexApiKey, trendyolApiKey, trendyolApiSecret, trendyolSupplierId, hepsiburadaApiKey, hepsiburadaMerchantId } = req.body;

    // Validate that at least one property is being updated
    const providedProps = { appsScriptId, driveFolderId, googleSheetId, veeqoApiKey, shippoApiKey, fedexApiKey, trendyolApiKey, trendyolApiSecret, trendyolSupplierId, hepsiburadaApiKey, hepsiburadaMerchantId };
    if (Object.values(providedProps).every(value => value === undefined)) {
        return res.status(400).json({ message: 'No properties provided for update.' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(appsScriptId && { userAppsScriptId: appsScriptId }),
        ...(driveFolderId && { driveFolderId: driveFolderId }),
        ...(googleSheetId && { googleSheetId: googleSheetId }),
        ...(veeqoApiKey && { veeqoApiKey: veeqoApiKey }),
        ...(shippoApiKey && { shippoApiKey: shippoApiKey }),
        ...(fedexApiKey && { fedexApiKey: fedexApiKey }),
        ...(trendyolApiKey && { trendyolApiKey: trendyolApiKey }),
        ...(trendyolApiSecret && { trendyolApiSecret: trendyolApiSecret }),
        ...(trendyolSupplierId && { trendyolSupplierId: trendyolSupplierId }),
        ...(hepsiburadaApiKey && { hepsiburadaApiKey: hepsiburadaApiKey }),
        ...(hepsiburadaMerchantId && { hepsiburadaMerchantId: hepsiburadaMerchantId }),
        updatedAt: new Date(),
      },
    });

    // Update Supabase user_metadata as well, if these fields are relevant there
    // Be cautious about what you store in user_metadata, it's client-accessible.
    // For API keys, Prisma is the secure source of truth.
    // For IDs like googleSheetId, googleScriptId, it might be useful for client-side logic.
    const metadataToUpdate = {};
    if (googleSheetId) metadataToUpdate.googleSheetId = googleSheetId;
    if (appsScriptId) metadataToUpdate.googleScriptId = appsScriptId;
    if (driveFolderId) metadataToUpdate.driveFolderId = driveFolderId;

    if (Object.keys(metadataToUpdate).length > 0) {
        const { data: updatedUser, error: updateUserError } = await supabase.auth.updateUser({
            data: metadataToUpdate
        });
        if (updateUserError) {
            console.error('Error updating Supabase user metadata:', updateUserError);
            // Non-critical error, proceed with success response for Prisma update
        }
    }

    return res.status(200).json({ message: 'User properties updated successfully', user });
  } catch (error) {
    console.error('Error in setScriptProps:', error);
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
} 
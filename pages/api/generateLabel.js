import { google } from 'googleapis';
import dotenv from 'dotenv';
import prisma from '@/lib/prisma';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

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

// Mock function, replace with actual Shippo/Veeqo API calls
// This is a simplified mock. The actual implementation will involve:
// 1. Fetching carrier configurations for the user (e.g., Shippo token, Veeqo API key) from the DB.
// 2. Calling the relevant carrier's API to generate a label.
// 3. Storing the label PDF (e.g., in Supabase Storage) and tracking info in the DB (LabelJob table).
// 4. Returning the label URL or tracking info to the client.
async function generateShippingLabel(labelData, userCarrierConfig) {
  console.log("Mock generateShippingLabel called with data:", labelData, "and config:", userCarrierConfig);
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Simulate success response
  return {
    success: true,
    trackingNumber: `MOCKTRACK${Date.now()}`,
    labelUrl: `https://example.com/mocklabel-${Date.now()}.pdf`, // This would be a real URL to the stored label
    message: "Mock label generated successfully."
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const supabase = createRouteHandlerClient({ cookies });
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    console.error('Supabase getSession error in generateLabel:', sessionError);
    return res.status(500).json({ error: 'Authentication error' });
  }

  if (!session?.user?.id) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const userId = session.user.id;
  const { orderId, items, carrier, shippingDetails } = req.body;

  if (!orderId || !items || !carrier || !shippingDetails) {
    return res.status(400).json({ message: 'Missing required label generation data.' });
  }

  try {
    // TODO: Fetch user's carrier configurations (e.g., API keys for Shippo/Veeqo for the selected carrier)
    // For now, we'll pass a placeholder or assume mock doesn't need it.
    const userCarrierConfig = { carrierApiKey: "USER_SPECIFIC_API_KEY_FOR_" + carrier };

    // Create a LabelJob entry (optional, but good for tracking)
    const labelJob = await prisma.labelJob.create({
      data: {
        order: { connect: { id: orderId } }, // Assuming orderId is the DB id of the Order
        // If you have individual OrderItem IDs for which labels are being made, you might link them differently
        // For now, linking to Order. This depends on your exact schema and requirements.
        // If linking to OrderItem, you'd pass orderItemId and connect to OrderItem.
        carrier: carrier,
        status: 'PENDING',
        // userId: userId, // If LabelJob has a direct relation to User
      },
    });

    const labelData = { 
      orderId, 
      items,       // [{ orderItemId (db id), sku, quantity, name, weight, dimensions, etc.}]
      carrier, 
      shippingDetails // { fromAddress, toAddress, packageDetails, serviceLevel, etc. }
    };
    
    const result = await generateShippingLabel(labelData, userCarrierConfig);

    if (result.success) {
      await prisma.labelJob.update({
        where: { id: labelJob.id },
        data: {
          status: 'GENERATED',
          pdfUrl: result.labelUrl,
          trackingNumber: result.trackingNumber, // Add trackingNumber to your LabelJob schema if not present
          // errorMessage: null, // Clear any previous error
        },
      });
      return res.status(200).json(result);
    } else {
      await prisma.labelJob.update({
        where: { id: labelJob.id },
        data: {
          status: 'FAILED',
          errorMessage: result.message,
        },
      });
      return res.status(400).json({ message: result.message || 'Failed to generate label' });
    }
  } catch (error) {
    console.error('Error in /api/generateLabel:', error);
    // If a labelJob was created, you might want to mark it as FAILED here too
    // await prisma.labelJob.updateMany({ where: { orderId: orderId, status: 'PENDING' }, data: { status: 'FAILED', errorMessage: error.message }});
    return res.status(500).json({ message: 'Internal server error generating label.' });
  }
} 
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getSupabaseServerClient } from '../../../../lib/supabase';
import { logger } from '../../../../lib/logger';

interface VeeqoAllocation {
  id: number;
  line_items?: Array<{
    id: number;
    quantity: number;
    [key: string]: any;
  }>;
  [key: string]: any;
}

interface VeeqoShipmentRequest {
  shipment: {
    tracking_number_attributes: { tracking_number: string };
    carrier_id: number;
    notify_customer?: boolean;
    update_remote_order?: boolean;
  };
  allocation_id: number;
  order_id: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = getSupabaseServerClient(req, res);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { orderId } = req.query;
  const { trackingNumber, carrierId = 3, notifyCustomer = true, updateRemoteOrder = true } = req.body;

  if (!orderId || !trackingNumber) {
    return res.status(400).json({ error: 'Order ID and tracking number are required' });
  }

  try {
    // Get the order from our database
    const order = await prisma.order.findFirst({
      where: { 
        id: orderId as string, 
        userId: user.id 
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Determine source from marketplace for logging purposes only
    const source = (() => {
      const marketplace = (order.marketplace || '').toLowerCase();
      if (marketplace.includes('etsy')) return 'shippo';
      if (marketplace.includes('trendyol')) return 'trendyol';
      return 'veeqo';
    })();

    // Get user's API credentials
    const userSettings = await prisma.credential.findUnique({ 
      where: { userId: user.id } 
    });

    if (!userSettings?.veeqoApiKey) {
      return res.status(400).json({ 
        error: 'Veeqo API key not found. Please configure your integration settings.' 
      });
    }

    // Always submit tracking through Veeqo API regardless of original marketplace
    // This ensures consistent tracking management through our primary integration
    await submitVeeqoTracking(
      userSettings.veeqoApiKey,
      order.marketplaceKey,
      trackingNumber,
      carrierId,
      notifyCustomer,
      updateRemoteOrder
    );

    // Create TrackingSubmission record
    await prisma.trackingSubmission.create({
      data: {
        orderId: orderId as string,
        trackingNumber: trackingNumber,
        carrierId: carrierId,
        carrierName: getCarrierName(carrierId),
        notifyCustomer: notifyCustomer,
        updateRemoteOrder: updateRemoteOrder,
        submittedBy: user.id,
        status: 'submitted'
      }
    });

    // Update our local database with tracking info
    await prisma.order.update({
      where: { id: orderId as string },
      data: {
        trackingNumber: trackingNumber,
        status: 'shipped',
      },
    });

    logger.info('Tracking number submitted successfully', {
      orderId,
      trackingNumber,
      source: source,
      userId: user.id
    });

    return res.status(200).json({ 
      success: true, 
      message: 'Tracking number submitted successfully' 
    });

  } catch (error: any) {
    logger.error('Failed to submit tracking number', error, {
      orderId,
      userId: user.id
    });
    return res.status(500).json({ 
      error: 'Failed to submit tracking number', 
      details: error.message 
    });
  }
}

function getCarrierName(carrierId: number): string {
  const carrierMap: { [key: number]: string } = {
    3: 'DHL',
    4: 'FedEx',
    5: 'UPS',
    6: 'USPS',
    1: 'TNT',
    2: 'DPD',
    // Add more carrier mappings as needed
  };
  return carrierMap[carrierId] || `Carrier ${carrierId}`;
}

async function submitVeeqoTracking(
  apiKey: string,
  veeqoOrderId: string,
  trackingNumber: string,
  carrierId: number,
  notifyCustomer: boolean,
  updateRemoteOrder: boolean
): Promise<void> {
  // Step 1: Get order details and check for existing allocations
  const orderResponse = await fetch(`https://api.veeqo.com/orders/${veeqoOrderId}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'x-api-key': apiKey
    }
  });

  if (!orderResponse.ok) {
    throw new Error(`Failed to fetch Veeqo order: ${orderResponse.status} ${await orderResponse.text()}`);
  }

  const orderData = await orderResponse.json();
  let allocationId: number;

  // Step 2: Check if order has allocations, create one if needed
  if (!orderData.allocations || orderData.allocations.length === 0) {
    // Create allocation
    const allocationResponse = await fetch(`https://api.veeqo.com/orders/${veeqoOrderId}/allocations`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({}) // Empty body for "ship everything" allocation
    });

    if (!allocationResponse.ok) {
      throw new Error(`Failed to create Veeqo allocation: ${allocationResponse.status} ${await allocationResponse.text()}`);
    }

    const allocation = await allocationResponse.json();
    allocationId = allocation.id;
  } else {
    // Use existing allocation
    allocationId = orderData.allocations[0].id;
  }

  // Step 3: Create shipment with tracking number
  const shipmentRequest: VeeqoShipmentRequest = {
    shipment: {
      tracking_number_attributes: { tracking_number: trackingNumber },
      carrier_id: carrierId,
      notify_customer: notifyCustomer,
      update_remote_order: updateRemoteOrder
    },
    allocation_id: allocationId,
    order_id: veeqoOrderId
  };

  const shipmentResponse = await fetch('https://api.veeqo.com/shipments', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify(shipmentRequest)
  });

  if (!shipmentResponse.ok) {
    const errorText = await shipmentResponse.text();
    throw new Error(`Failed to create Veeqo shipment: ${shipmentResponse.status} ${errorText}`);
  }

  logger.info('Veeqo tracking submitted successfully', {
    veeqoOrderId,
    allocationId,
    trackingNumber,
    carrierId
  });
}
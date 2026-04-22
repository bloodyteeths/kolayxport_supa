import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '../../../../lib/logger';
import { EtsyClient, EtsyTrackingData, EtsyCredentials } from '../../../../lib/integrations/etsyClient';
import { createWixClient } from '../../../../lib/integrations/wixClient';

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

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { orderId } = req.query;
  const { trackingNumber: rawTrackingNumber, carrierId = 3, notifyCustomer = true, updateRemoteOrder = true } = req.body;

  if (!orderId || !rawTrackingNumber) {
    return res.status(400).json({ error: 'Order ID and tracking number are required' });
  }

  // Trim whitespace and validate tracking number format
  const trackingNumber = String(rawTrackingNumber).trim();
  const trackingNumberRegex = /^[A-Za-z0-9]{8,40}$/;
  if (!trackingNumberRegex.test(trackingNumber)) {
    return res.status(400).json({
      error: 'Invalid tracking number format. Tracking number must be 8-40 alphanumeric characters.',
    });
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

    // Determine source from marketplace
    const marketplace = (order.marketplace || '').toLowerCase();
    const source = (() => {
      if (marketplace.includes('etsy')) return 'etsy';
      if (marketplace.includes('trendyol')) return 'trendyol';
      if (marketplace.includes('wix')) return 'wix';
      return 'veeqo';
    })();

    // Get user's API credentials
    const userSettings = await prisma.credential.findUnique({ 
      where: { userId: user.id } 
    });

    // Route to appropriate tracking submission based on marketplace
    if (source === 'etsy') {
      // Etsy restricts tracking/address endpoints to approved "full access" apps only.
      // Save tracking locally so the Chrome extension can push it to Etsy.
      await prisma.trackingSubmission.create({
        data: {
          orderId: orderId as string,
          trackingNumber: trackingNumber,
          carrierId: carrierId,
          carrierName: getCarrierName(carrierId),
          notifyCustomer: notifyCustomer,
          updateRemoteOrder: updateRemoteOrder,
          submittedBy: user.id,
          status: 'pending',
          etsySubmitStatus: 'pending',
        }
      });

      await prisma.order.update({
        where: { id: orderId as string },
        data: { trackingNumber: trackingNumber },
      });

      logger.info('Etsy tracking saved locally (pending Chrome extension push)', {
        orderId,
        trackingNumber,
        userId: user.id,
      });

      return res.status(200).json({
        success: true,
        message: 'Tracking saved. Use Chrome extension to push to Etsy.',
        etsyPending: true,
      });
    } else if (source === 'wix') {
      // Submit fulfillment directly to Wix
      await submitWixFulfillment(userSettings, order, trackingNumber, carrierId, user.id);
    } else {
      // Submit through Veeqo for other marketplaces
      if (!userSettings?.veeqoApiKey) {
        return res.status(400).json({
          error: 'Veeqo API key not found. Please configure your integration settings.'
        });
      }

      await submitVeeqoTracking(
        userSettings.veeqoApiKey,
        order.marketplaceKey,
        trackingNumber,
        carrierId,
        notifyCustomer,
        updateRemoteOrder
      );
    }

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
    console.error('[submit-tracking] ERROR:', error?.message || error, { orderId });
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
    1: 'Royal Mail',
    2: 'FedEx',
    3: 'Other',
    4: 'DPD',
    5: 'UPS',
    7: 'USPS',
    9: 'DHL',
    10: 'MNG Kargo (DHL eCommerce)',
    12: 'Yurtiçi Kargo',
    13: 'Aras Kargo',
    14: 'Sürat Kargo',
    15: 'Trendyol Express',
  };
  return carrierMap[carrierId] || `Carrier ${carrierId}`;
}

// Map carrier ID to Wix shipping provider name
// Wix predefined: "fedex", "ups", "usps", "dhl", "canada-post" (auto-generates tracking links)
// All others are custom providers (need manual trackingLink)
function getWixShippingProvider(carrierId: number): { provider: string; trackingLink?: string; trackingNumber?: string } {
  const predefined: { [key: number]: string } = {
    2: 'fedex',
    5: 'ups',
    7: 'usps',
    9: 'dhl',
  };
  if (predefined[carrierId]) {
    return { provider: predefined[carrierId] };
  }
  // Custom carriers — return display name
  const customNames: { [key: number]: string } = {
    1: 'Royal Mail',
    3: 'Other',
    4: 'DPD',
    10: 'MNG Kargo',
    12: 'Yurtiçi Kargo',
    13: 'Aras Kargo',
    14: 'Sürat Kargo',
    15: 'Trendyol Express',
  };
  return { provider: customNames[carrierId] || 'Other' };
}

function buildTrackingLink(carrierId: number, trackingNumber: string): string | undefined {
  const linkTemplates: { [key: number]: string } = {
    10: `https://www.mngkargo.com.tr/gonderi-takip?gonderino=${trackingNumber}`,
    12: `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${trackingNumber}`,
    13: `https://www.araskargo.com.tr/tanimlar/gonderi_takip.aspx?code=${trackingNumber}`,
    14: `https://www.suratkargo.com.tr/gonderi-takip?code=${trackingNumber}`,
  };
  return linkTemplates[carrierId];
}

async function submitWixFulfillment(
  userSettings: any,
  order: any,
  trackingNumber: string,
  carrierId: number,
  userId: string,
): Promise<void> {
  // Try WixSite first, fall back to Credential
  const wixSite = await prisma.wixSite.findFirst({
    where: { userId, isActive: true },
  });

  const credential = wixSite
    ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: (wixSite as any).instanceId || userSettings?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
    : userSettings;

  if (!credential?.wixInstanceId || !credential?.wixSiteId) {
    throw new Error('Wix credentials not found. Please configure your Wix integration settings.');
  }

  const onTokenRefresh = async (creds: { accessToken: string; tokenExpiresAt: Date; instanceId: string; siteId: string }) => {
    if (wixSite) {
      await prisma.wixSite.update({
        where: { id: wixSite.id },
        data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt },
      });
    } else {
      await prisma.credential.update({
        where: { userId },
        data: { wixAccessToken: creds.accessToken, wixTokenExpiresAt: creds.tokenExpiresAt },
      });
    }
  };

  const wixClient = createWixClient(credential, onTokenRefresh);

  // Get Wix order ID from marketplaceKey
  const wixOrderId = order.marketplaceKey;
  if (!wixOrderId) {
    throw new Error('Cannot determine Wix order ID');
  }

  // Build tracking info
  const { provider } = getWixShippingProvider(carrierId);
  const trackingLink = buildTrackingLink(carrierId, trackingNumber);

  // Get line items from the Wix order to fulfill all items
  // Wix Stores v2 fulfillment uses 1-based index, not lineItemId
  let lineItems: { index: number; quantity: number }[] | undefined;
  try {
    const wixOrder = await wixClient.getOrder(wixOrderId);
    if (wixOrder?.lineItems?.length) {
      lineItems = wixOrder.lineItems.map((item: any, i: number) => ({
        index: i + 1,
        quantity: item.quantity || 1,
      }));
    }
  } catch (err) {
    logger.warn('Could not fetch Wix order line items, creating fulfillment without line items', { wixOrderId, error: (err as Error).message });
  }

  const fulfillment: any = {
    trackingInfo: {
      shippingProvider: provider,
      trackingNumber,
      ...(trackingLink ? { trackingLink } : {}),
    },
  };
  if (lineItems?.length) {
    fulfillment.lineItems = lineItems;
  }

  await wixClient.createFulfillment(wixOrderId, fulfillment);

  logger.info('Wix fulfillment created successfully', {
    wixOrderId,
    trackingNumber,
    provider,
    carrierId,
    userId,
  });
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

async function submitEtsyTracking(
  userSettings: any,
  order: any,
  trackingNumber: string,
  carrierId: number,
  userId: string
): Promise<void> {
  // Find the correct Etsy shop for this order
  let targetShop: any = null;
  
  // First, try to find shop based on order's rawData
  const orderRawData = order.rawData as any;
  const orderShopId = orderRawData?.shop_id?.toString() || orderRawData?.shop?.shop_id?.toString();
  
  logger.info('Analyzing order for shop matching', {
    orderId: order.id,
    marketplace: order.marketplace,
    marketplaceKey: order.marketplaceKey,
    orderShopId,
    rawDataKeys: orderRawData ? Object.keys(orderRawData) : [],
    hasShopId: !!orderRawData?.shop_id,
    hasNestedShop: !!orderRawData?.shop?.shop_id,
    // Check for other possible shop ID fields
    shopApp: orderRawData?.shop_app,
    objectOwner: orderRawData?.object_owner,
    channel: orderRawData?.channel,
    possibleShopFields: {
      shop_app: orderRawData?.shop_app,
      object_owner: orderRawData?.object_owner,
      channel: orderRawData?.channel,
      contact_id: orderRawData?.contact_id
    }
  });

  // Extract Etsy receipt ID from order data first (needed for shop testing)
  let etsyReceiptId: string;
  try {
    // Try to get receipt ID from rawData first
    const rawData = order.rawData as any;
    if (rawData && rawData.receipt_id) {
      etsyReceiptId = String(rawData.receipt_id);
    } else if (rawData && rawData.id) {
      etsyReceiptId = String(rawData.id);
    } else {
      // Fallback: try to parse marketplaceKey if it looks like a number
      const marketplaceKey = order.marketplaceKey;
      if (/^\d+$/.test(marketplaceKey)) {
        etsyReceiptId = marketplaceKey;
      } else {
        throw new Error(`Cannot determine Etsy receipt ID from order data. MarketplaceKey: ${marketplaceKey}`);
      }
    }

    logger.info('Extracted Etsy receipt ID', {
      orderId: order.id,
      etsyReceiptId,
      marketplaceKey: order.marketplaceKey,
      hasRawData: !!order.rawData
    });

  } catch (error) {
    logger.error('Failed to extract Etsy receipt ID', error, {
      orderId: order.id,
      marketplaceKey: order.marketplaceKey,
      rawData: order.rawData
    });
    throw new Error(`Invalid Etsy receipt ID format. Expected numeric ID, got: ${order.marketplaceKey}`);
  }
  
  if (orderShopId) {
    // Look for shop in new EtsyShop model first
    targetShop = await prisma.etsyShop.findFirst({
      where: {
        userId,
        shopId: orderShopId,
        isActive: true
      }
    });
    
    // If not found and matches legacy shop, use legacy credentials
    if (!targetShop && userSettings?.etsyShopId === orderShopId && userSettings?.etsyAccessToken) {
      targetShop = {
        shopId: userSettings.etsyShopId,
        shopName: `Shop ${userSettings.etsyShopId}`,
        accessToken: userSettings.etsyAccessToken,
        refreshToken: userSettings.etsyRefreshToken,
        tokenExpiresAt: userSettings.etsyTokenExpiresAt,
        isLegacy: true
      };
    }
  }

  // For Veeqo-aggregated Etsy orders, check if this receipt belongs to any connected shop
  if (!targetShop && order.marketplace?.toLowerCase().includes('etsy')) {
    logger.info('Order has no shop_id in rawData, checking all connected Etsy shops for receipt access');
    
    // Get all connected Etsy shops
    const allEtsyShops = await prisma.etsyShop.findMany({
      where: { userId, isActive: true }
    });
    
    // Also include legacy shop if exists
    const allShops = [...allEtsyShops];
    if (userSettings?.etsyAccessToken && userSettings?.etsyShopId) {
      const legacyExists = allEtsyShops.some(shop => shop.shopId === userSettings.etsyShopId);
      if (!legacyExists) {
        allShops.push({
          shopId: userSettings.etsyShopId,
          shopName: `Shop ${userSettings.etsyShopId}`,
          accessToken: userSettings.etsyAccessToken,
          refreshToken: userSettings.etsyRefreshToken,
          tokenExpiresAt: userSettings.etsyTokenExpiresAt,
          isLegacy: true
        } as any);
      }
    }

    logger.info('Testing receipt access across all connected shops', {
      receiptId: etsyReceiptId,
      totalShops: allShops.length,
      shopIds: allShops.map(s => s.shopId)
    });

    // Smart matching: Test only a limited number of shops to avoid rate limiting
    const channelEmail = orderRawData?.channel?.email;
    const channelName = orderRawData?.channel?.name;
    
    // Limit testing to max 3 shops to avoid suspicious activity
    const shopsToTest = allShops.slice(0, 3);
    logger.info('Limiting shop testing to avoid rate limits', {
      totalShops: allShops.length,
      testing: shopsToTest.length,
      testingShopIds: shopsToTest.map(s => s.shopId)
    });
    
    for (const shop of shopsToTest) {
      try {
        // Get shop details from Etsy API
        const shopDetailsUrl = `https://openapi.etsy.com/v3/application/shops/${shop.shopId}`;
        const shopDetailsResponse = await fetch(shopDetailsUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${shop.accessToken}`,
            'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`
          }
        });

        if (shopDetailsResponse.ok) {
          const shopDetails = await shopDetailsResponse.json() as any;
          
          logger.info('Fetched shop details for matching', {
            shopId: shop.shopId,
            shopName: shopDetails.shop_name,
            etsyUrl: shopDetails.url,
            channelEmail,
            channelName
          });

          // Try to match by shop name similarity or other criteria
          const shopName = shopDetails.shop_name?.toLowerCase() || '';
          const veeqoChannelName = (channelName || '').toLowerCase();
          
          // Try to match by shop name similarity (remove hardcoded values)
          const nameMatches = veeqoChannelName.includes(shopName.slice(0, 5)) || shopName.includes(veeqoChannelName.slice(0, 5));
          
          if (nameMatches) {
            targetShop = shop;
            logger.info('Matched shop using smart matching', {
              shopId: shop.shopId,
              shopName: shopDetails.shop_name,
              matchReason: 'name similarity',
              channelName
            });
            break;
          }
        } else {
          logger.info('Cannot fetch shop details, testing receipt access instead', {
            shopId: shop.shopId,
            status: shopDetailsResponse.status
          });
        }
        
        // Always test receipt access for each shop (regardless of shop details success)
        if (!targetShop) {
          const testUrl = `https://openapi.etsy.com/v3/application/shops/${shop.shopId}/receipts/${etsyReceiptId}`;
          const testResponse = await fetch(testUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${shop.accessToken}`,
              'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`
            }
          });

          logger.info('Receipt access test result', {
            shopId: shop.shopId,
            receiptId: etsyReceiptId,
            status: testResponse.status,
            canAccess: testResponse.ok
          });

          if (testResponse.ok) {
            targetShop = shop;
            logger.info('Found correct shop via receipt access test', {
              shopId: shop.shopId,
              shopName: shop.shopName,
              receiptId: etsyReceiptId
            });
            break;
          }
        }
      } catch (testError) {
        logger.warn('Error in shop matching', {
          shopId: shop.shopId,
          error: testError instanceof Error ? testError.message : String(testError)
        });
      }
      
      // Add small delay between shop tests to be respectful to Etsy API
      if (!targetShop && shopsToTest.indexOf(shop) < shopsToTest.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
      }
    }
  }

  // If no specific shop found from order data, use legacy credentials as fallback
  if (!targetShop && userSettings?.etsyAccessToken) {
    targetShop = {
      shopId: userSettings.etsyShopId,
      shopName: `Shop ${userSettings.etsyShopId}`,
      accessToken: userSettings.etsyAccessToken,
      refreshToken: userSettings.etsyRefreshToken,
      tokenExpiresAt: userSettings.etsyTokenExpiresAt,
      isLegacy: true
    };
  }

  if (!targetShop || !targetShop.accessToken) {
    throw new Error('No suitable Etsy shop found for this order. Please connect an Etsy shop first.');
  }

  logger.info('Found target Etsy shop for order', {
    orderId: order.id,
    orderShopId,
    targetShopId: targetShop.shopId,
    targetShopName: targetShop.shopName,
    isLegacy: targetShop.isLegacy || false
  });

  const etsyCredentials: EtsyCredentials = {
    accessToken: targetShop.accessToken,
    refreshToken: targetShop.refreshToken || undefined,
    shopId: targetShop.shopId,
    tokenExpiresAt: targetShop.tokenExpiresAt || undefined
  };

  // Create token refresh callback to update database
  const onTokenRefresh = async (newCredentials: EtsyCredentials) => {
    if (targetShop.isLegacy) {
      // Update legacy credential
      await prisma.credential.update({
        where: { userId },
        data: {
          etsyAccessToken: newCredentials.accessToken,
          etsyRefreshToken: newCredentials.refreshToken,
          etsyTokenExpiresAt: newCredentials.tokenExpiresAt
        }
      });
    } else {
      // Update EtsyShop model
      await prisma.etsyShop.update({
        where: {
          userId_shopId: {
            userId,
            shopId: targetShop.shopId
          }
        },
        data: {
          accessToken: newCredentials.accessToken,
          refreshToken: newCredentials.refreshToken,
          tokenExpiresAt: newCredentials.tokenExpiresAt
        }
      });
    }

    logger.info('Updated Etsy credentials after token refresh', {
      userId,
      shopId: newCredentials.shopId,
      isLegacy: targetShop.isLegacy || false
    });
  };

  // Initialize Etsy client
  const etsyClient = new EtsyClient(etsyCredentials, onTokenRefresh);

  // Try validation to trigger any necessary token refresh
  logger.info('Etsy client initialized, attempting validation to check/refresh token', {
    shopId: userSettings.etsyShopId,
    hasAccessToken: !!etsyCredentials.accessToken,
    tokenExpiresAt: etsyCredentials.tokenExpiresAt
  });

  try {
    const isValid = await etsyClient.validateCredentials();
    logger.info('Etsy credentials validation result', {
      isValid,
      shopId: userSettings.etsyShopId
    });

    // If validation failed, force a token refresh if we have a refresh token
    if (!isValid && userSettings.etsyRefreshToken) {
      logger.info('Validation failed, forcing token refresh', {
        shopId: userSettings.etsyShopId
      });
      
      try {
        // Force refresh by calling a method that triggers it
        await (etsyClient as any).refreshAccessToken();
        logger.info('Forced token refresh completed');
        
        // Try validation again
        const isValidAfterRefresh = await etsyClient.validateCredentials();
        logger.info('Validation after forced refresh', {
          isValid: isValidAfterRefresh
        });
      } catch (refreshError) {
        logger.error('Forced token refresh failed', refreshError);
      }
    }
  } catch (error) {
    logger.warn('Etsy credentials validation failed, proceeding anyway', {
      shopId: userSettings.etsyShopId,
      error: error instanceof Error ? error.message : String(error)
    });
    // Continue anyway - the tracking submission might still work
  }

  // Map carrier ID to carrier name
  const carrierName = getCarrierName(carrierId);
  
  // Submit tracking to Etsy using the correct shop
  const trackingData: EtsyTrackingData = {
    shopId: targetShop.shopId,
    receiptId: etsyReceiptId,
    trackingNumber,
    carrier: carrierName
  };

  // First, let's try to get the receipt details to debug access issues
  try {
    const receiptUrl = `https://openapi.etsy.com/v3/application/shops/${targetShop.shopId}/receipts/${etsyReceiptId}`;
    const receiptCheckResponse = await fetch(receiptUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${etsyCredentials.accessToken}`,
        'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`
      }
    });

    logger.info('Receipt access check', {
      receiptId: etsyReceiptId,
      status: receiptCheckResponse.status,
      statusText: receiptCheckResponse.statusText
    });

    if (receiptCheckResponse.ok) {
      const receiptData = await receiptCheckResponse.json();
      logger.info('Receipt details available', {
        receiptId: etsyReceiptId,
        buyerUserId: receiptData.buyer_user_id,
        wasShipped: receiptData.was_shipped,
        receiptType: receiptData.receipt_type
      });
    } else {
      const errorBody = await receiptCheckResponse.text();
      logger.error('Cannot access receipt', new Error(`Status: ${receiptCheckResponse.status}, Body: ${errorBody}`), {
        receiptId: etsyReceiptId,
        status: receiptCheckResponse.status
      });
    }
  } catch (receiptError) {
    logger.error('Receipt check failed', receiptError);
  }

  // Now try the tracking submission
  const result = await etsyClient.submitTracking(trackingData);

  logger.info('Etsy tracking submitted successfully', {
    receiptId: order.marketplaceKey,
    trackingNumber,
    carrier: carrierName,
    receiptShippingId: result.receipt_shipping_id
  });
}
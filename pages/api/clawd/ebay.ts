import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { getSupabaseServerClient } from '../../../lib/supabase';
import {
  refreshUserToken,
  getApplicationToken,
} from '../../../lib/integrations/ebayClient';

// eBay REST API base URL
const EBAY_API_BASE = 'https://api.ebay.com';

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

async function refreshEbayToken(userId: string, refreshToken: string): Promise<string> {
  const data = await refreshUserToken(refreshToken);

  // Update the token in database
  await prisma.credential.update({
    where: { userId },
    data: {
      ebayAccessToken: data.access_token,
      ebayRefreshToken: data.refresh_token || refreshToken,
      ebayTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  });

  return data.access_token;
}

async function getEbayAccessToken(userId: string): Promise<string> {
  const credential = await prisma.credential.findUnique({
    where: { userId },
    select: {
      ebayAccessToken: true,
      ebayRefreshToken: true,
      ebayTokenExpiresAt: true,
    },
  });

  if (!credential || !credential.ebayAccessToken) {
    throw new Error('eBay not connected. Please connect your eBay account in settings.');
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const now = new Date();
  const expiresAt = credential.ebayTokenExpiresAt;

  if (!expiresAt || expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    if (!credential.ebayRefreshToken) {
      throw new Error('eBay refresh token not available. Please reconnect your eBay account.');
    }
    return await refreshEbayToken(userId, credential.ebayRefreshToken);
  }

  return credential.ebayAccessToken;
}

// ---------------------------------------------------------------------------
// API caller
// ---------------------------------------------------------------------------

async function callEbayAPI(endpoint: string, accessToken: string, options: RequestInit = {}, marketplaceId?: string) {
  const url = endpoint.startsWith('http') ? endpoint : `${EBAY_API_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Accept-Language': 'en-US',
    'Content-Language': 'en-US',
  };
  if (marketplaceId) {
    headers['X-EBAY-C-MARKETPLACE-ID'] = marketplaceId;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`eBay API error: ${response.status} - ${errorText}`);
    logger.error('eBay API error', error, {
      endpoint,
      status: response.status,
    });
    throw error;
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return { success: true };
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch the first inventory location key for the user (needed for publishing). */
async function getDefaultMerchantLocationKey(
  accessToken: string,
  marketplaceId?: string
): Promise<string | null> {
  try {
    const data = await callEbayAPI(
      '/sell/inventory/v1/location?limit=1',
      accessToken,
      {},
      marketplaceId
    );
    return data.locations?.[0]?.merchantLocationKey || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const config = {
  maxDuration: 60, // Allow up to 60s for legacy listing fetches
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // 1. Authenticate --- accept API key OR session auth
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const envApiKey = process.env.CLAWD_API_KEY;
  let authenticated = false;
  let sessionUserId: string | null = null;

  // Try API key auth first
  if (envApiKey && apiKey === envApiKey) {
    authenticated = true;
  }

  // Fall back to session auth
  if (!authenticated) {
    try {
      const supabase = getSupabaseServerClient(req, res);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        authenticated = true;
        sessionUserId = user.id;
      }
    } catch {
      // Session auth failed, continue
    }
  }

  if (!authenticated) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication' });
  }

  // Get userId from query param or session (support both user_id and userId)
  const userId = (req.query.userId as string) || (req.query.user_id as string) || sessionUserId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Marketplace ID (default EBAY_US, configurable via query)
  const marketplaceId = (req.query.marketplace_id as string) || 'EBAY_US';

  // Support both offerId and offer_id param names
  const queryOfferId = (req.query.offerId as string) || (req.query.offer_id as string);

  try {
    let { action } = req.query;

    // Action aliases — map component action names to handler names
    const actionAliases: Record<string, string> = {
      'publish_offer': 'publish',
      'withdraw_offer': 'withdraw',
    };
    if (typeof action === 'string' && actionAliases[action]) {
      action = actionAliases[action];
    }

    // =====================================================================
    // Actions that use application token (no user auth needed)
    // =====================================================================

    // GET ?action=category_tree&category_tree_id=0
    if (req.method === 'GET' && action === 'category_tree') {
      const categoryTreeId = (req.query.category_tree_id as string) || '0';
      const appToken = await getApplicationToken();

      const data = await callEbayAPI(
        `/commerce/taxonomy/v1/category_tree/${categoryTreeId}`,
        appToken
      );

      return res.status(200).json(data);
    }

    // GET ?action=category_suggestions&q=shoes&category_tree_id=0
    if (req.method === 'GET' && action === 'category_suggestions') {
      const q = req.query.q as string;
      if (!q) {
        return res.status(400).json({ error: 'q (query) is required' });
      }
      const categoryTreeId = (req.query.category_tree_id as string) || '0';
      const appToken = await getApplicationToken();

      const data = await callEbayAPI(
        `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_category_suggestions?q=${encodeURIComponent(q)}`,
        appToken
      );

      return res.status(200).json(data);
    }

    // GET ?action=item_aspects&category_id=XXX&category_tree_id=0
    if (req.method === 'GET' && action === 'item_aspects') {
      const categoryId = req.query.category_id as string;
      if (!categoryId) {
        return res.status(400).json({ error: 'category_id is required' });
      }
      const categoryTreeId = (req.query.category_tree_id as string) || '0';
      const appToken = await getApplicationToken();

      try {
        const data = await callEbayAPI(
          `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_item_aspects_for_category?category_id=${categoryId}`,
          appToken
        );
        return res.status(200).json(data);
      } catch (err: any) {
        // Non-leaf category — return empty aspects instead of crashing
        if (err.message?.includes('62009')) {
          return res.status(200).json({
            categoryId,
            aspects: [],
            error: 'Category is not a leaf category. Please select a more specific subcategory.',
          });
        }
        throw err;
      }
    }

    // =====================================================================
    // Actions that require user access token
    // =====================================================================
    const accessToken = await getEbayAccessToken(userId);

    // -----------------------------------------------------------------
    // LISTING MANAGEMENT
    // -----------------------------------------------------------------

    // GET ?action=listings — Get all offers enriched with inventory item data
    if (req.method === 'GET' && action === 'listings') {
      const limit = parseInt((req.query.limit as string) || '200');
      const offset = parseInt((req.query.offset as string) || '0');

      // Step 1: Fetch offers
      let offersData: any;
      try {
        offersData = await callEbayAPI(
          `/sell/inventory/v1/offer?limit=${limit}&offset=${offset}`,
          accessToken,
          {},
          marketplaceId
        );
      } catch (err: any) {
        // No offers found via bulk endpoint — fall through to inventory fallback
        if (err.message?.includes('25707') || err.message?.includes('25710') || err.message?.includes('25713')) {
          offersData = { offers: [] };
        } else {
          logger.warn('Unexpected error fetching offers', { error: err.message?.substring(0, 300), userId });
          throw err;
        }
      }

      const offers = offersData.offers || [];
      if (offers.length === 0) {
        // Fallback: build listing data from inventory items when offers list is empty
        let invItems: any[] = [];
        try {
          const invData = await callEbayAPI(
            `/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`,
            accessToken,
            {},
            marketplaceId
          );
          invItems = invData.inventoryItems || [];
        } catch {
          // No inventory items either
        }

        if (invItems.length === 0) {
          return res.status(200).json({ total: 0, size: 0, offset, offers: [] });
        }

        // Build offer-like objects from inventory items, fetching offers per SKU
        const enrichedFromInv = await Promise.all(
          invItems.map(async (item: any) => {
            const product = item.product || {};
            const images = product.imageUrls || [];
            let offerData: any = null;

            try {
              const offersForSku = await callEbayAPI(
                `/sell/inventory/v1/offer?sku=${encodeURIComponent(item.sku)}&limit=10`,
                accessToken,
                {},
                marketplaceId
              );
              offerData = offersForSku.offers?.[0];
            } catch {
              // No offer for this SKU — show as draft
            }

            return {
              sku: item.sku,
              offerId: offerData?.offerId || null,
              listingId: offerData?.listing?.listingId || null,
              title: product.title || item.sku,
              description: product.description || '',
              price: offerData?.pricingSummary?.price || { value: '0', currency: 'USD' },
              quantity: item.availability?.shipToLocationAvailability?.quantity ?? 0,
              status: offerData?.status || 'DRAFT',
              condition: item.condition || 'NEW',
              categoryId: offerData?.categoryId || '',
              imageUrl: images[0] || null,
              imageCount: images.length,
              aspects: product.aspects || {},
              format: offerData?.format || 'FIXED_PRICE',
              marketplaceId: offerData?.marketplaceId || marketplaceId,
              listingUrl: offerData?.listing?.listingId
                ? `https://www.ebay.com/itm/${offerData.listing.listingId}`
                : null,
            };
          })
        );

        return res.status(200).json({
          total: enrichedFromInv.length,
          size: enrichedFromInv.length,
          offset,
          offers: enrichedFromInv,
        });
      }

      // Step 2: Fetch inventory items in parallel to enrich offers
      const skus = [...new Set(offers.map((o: any) => o.sku))];
      const inventoryMap: Record<string, any> = {};

      await Promise.all(
        skus.map(async (sku: string) => {
          try {
            const item = await callEbayAPI(
              `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
              accessToken,
              {},
              marketplaceId
            );
            inventoryMap[sku] = item;
          } catch {
            // SKU may have special chars or not exist — skip gracefully
          }
        })
      );

      // Step 3: Merge and normalize for frontend
      const enrichedOffers = offers.map((offer: any) => {
        const inv = inventoryMap[offer.sku] || {};
        const product = inv.product || {};
        const images = product.imageUrls || [];

        return {
          sku: offer.sku,
          offerId: offer.offerId,
          listingId: offer.listing?.listingId || null,
          title: product.title || offer.sku,
          description: product.description || offer.listingDescription || '',
          price: offer.pricingSummary?.price || { value: '0', currency: 'USD' },
          quantity: inv.availability?.shipToLocationAvailability?.quantity ?? offer.availableQuantity ?? 0,
          status: offer.status || 'UNPUBLISHED',
          condition: inv.condition || 'NEW',
          categoryId: offer.categoryId || '',
          imageUrl: images[0] || null,
          imageCount: images.length,
          aspects: product.aspects || {},
          format: offer.format || 'FIXED_PRICE',
          marketplaceId: offer.marketplaceId || marketplaceId,
          listingUrl: offer.listing?.listingId
            ? `https://www.ebay.com/itm/${offer.listing.listingId}`
            : null,
        };
      });

      return res.status(200).json({
        total: offersData.total || 0,
        size: enrichedOffers.length,
        offset: offersData.offset || offset,
        offers: enrichedOffers,
      });
    }

    // GET ?action=inventory_items — Get all inventory items
    if (req.method === 'GET' && action === 'inventory_items') {
      const limit = parseInt((req.query.limit as string) || '200');
      const offset = parseInt((req.query.offset as string) || '0');

      const data = await callEbayAPI(
        `/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`,
        accessToken,
        {},
        marketplaceId
      );

      return res.status(200).json({
        total: data.total || 0,
        size: data.size || 0,
        offset: data.offset || offset,
        inventoryItems: data.inventoryItems || [],
      });
    }

    // GET ?action=get_inventory_items — Alias for inventory_items
    if (req.method === 'GET' && action === 'get_inventory_items') {
      const limit = parseInt((req.query.limit as string) || '200');
      const offset = parseInt((req.query.offset as string) || '0');

      const data = await callEbayAPI(
        `/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`,
        accessToken,
        {},
        marketplaceId
      );

      return res.status(200).json({
        total: data.total || 0,
        size: data.size || 0,
        offset: data.offset || offset,
        inventoryItems: data.inventoryItems || [],
      });
    }

    // GET ?action=listing&sku=XXX — Get single inventory item + its offers
    // Falls back to Browse API for legacy listings that don't exist in Inventory API
    if (req.method === 'GET' && action === 'listing') {
      const sku = req.query.sku as string;
      if (!sku) {
        return res.status(400).json({ error: 'sku is required' });
      }

      const encodedSku = encodeURIComponent(sku);

      try {
        // Try Inventory API first
        const [inventoryItem, offersData] = await Promise.all([
          callEbayAPI(`/sell/inventory/v1/inventory_item/${encodedSku}`, accessToken, {}, marketplaceId),
          callEbayAPI(`/sell/inventory/v1/offer?sku=${encodedSku}`, accessToken, {}, marketplaceId).catch(() => ({ offers: [] })),
        ]);

        // Flatten inventoryItem fields to top level for consistent editor shape
        return res.status(200).json({
          sku,
          isLegacy: false,
          product: inventoryItem.product,
          condition: inventoryItem.condition,
          conditionDescription: inventoryItem.conditionDescription,
          availability: inventoryItem.availability,
          packageWeightAndSize: inventoryItem.packageWeightAndSize,
          offers: offersData.offers || [],
        });
      } catch (inventoryErr: any) {
        // If Inventory API returns 404, try Browse API with SKU as legacy item ID
        if (!inventoryErr.message?.includes('404')) {
          throw inventoryErr;
        }

        logger.info('Inventory item not found, falling back to Browse API', { sku });

        try {
          const appToken = await getApplicationToken();
          const browseItem = await callEbayAPI(
            `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${sku}`,
            appToken
          );

          // Map Browse API response to EbayListingData shape
          const aspects: Record<string, string[]> = {};
          for (const a of browseItem.localizedAspects || []) {
            if (a.name && a.value) {
              if (!aspects[a.name]) aspects[a.name] = [];
              aspects[a.name].push(a.value);
            }
          }

          const imageUrls: string[] = [];
          if (browseItem.image?.imageUrl) imageUrls.push(browseItem.image.imageUrl);
          for (const img of browseItem.additionalImages || []) {
            if (img.imageUrl) imageUrls.push(img.imageUrl);
          }

          return res.status(200).json({
            sku,
            isLegacy: true,
            legacyItemId: browseItem.legacyItemId || sku,
            itemWebUrl: browseItem.itemWebUrl,
            product: {
              title: browseItem.title || '',
              description: browseItem.description || browseItem.shortDescription || '',
              aspects,
              imageUrls,
            },
            condition: browseItem.condition || browseItem.conditionId || '',
            conditionDescription: browseItem.conditionDescription || '',
            availability: {
              shipToLocationAvailability: {
                quantity: (browseItem.estimatedAvailabilities?.[0]?.estimatedAvailableQuantity) ?? 0,
              },
            },
            offers: [{
              offerId: null,
              status: browseItem.itemWebUrl ? 'ACTIVE' : 'ENDED',
              pricingSummary: {
                price: browseItem.price || { value: '0', currency: 'USD' },
              },
              listingPolicies: {},
              categoryId: browseItem.categoryId || '',
            }],
          });
        } catch (browseErr: any) {
          logger.error('Browse API fallback also failed', browseErr, { sku });
          return res.status(404).json({
            error: 'Listing not found in Inventory or Browse API',
            details: browseErr.message,
          });
        }
      }
    }

    // POST ?action=create_listing — Create inventory item + offer (optionally publish)
    if (req.method === 'POST' && action === 'create_listing') {
      const {
        sku,
        // Inventory item fields
        title,
        description,
        aspects,
        imageUrls,
        upc,
        ean,
        condition = 'NEW',
        conditionDescription,
        quantity = 1,
        // Offer fields
        format = 'FIXED_PRICE',
        price,
        currency = 'USD',
        categoryId,
        paymentPolicyId,
        returnPolicyId,
        fulfillmentPolicyId,
        merchantLocationKey,
        // Auto-publish
        publish = false,
      } = req.body;

      if (!sku) {
        return res.status(400).json({ error: 'sku is required' });
      }
      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }
      if (price === undefined || price === null) {
        return res.status(400).json({ error: 'price is required' });
      }

      logger.info('Creating eBay listing', {
        userId,
        sku,
        title: title.substring(0, 50),
        publish,
      });

      // Step 1: Create/update inventory item
      const inventoryItemPayload: Record<string, any> = {
        product: {
          title,
        },
        condition,
        availability: {
          shipToLocationAvailability: {
            quantity: parseInt(quantity),
          },
        },
      };

      if (description) inventoryItemPayload.product.description = description;
      if (aspects) inventoryItemPayload.product.aspects = aspects;
      if (imageUrls && imageUrls.length > 0) inventoryItemPayload.product.imageUrls = imageUrls;
      if (upc) inventoryItemPayload.product.upc = [upc];
      if (ean) inventoryItemPayload.product.ean = [ean];
      if (conditionDescription) inventoryItemPayload.conditionDescription = conditionDescription;

      const encodedSku = encodeURIComponent(sku);
      await callEbayAPI(
        `/sell/inventory/v1/inventory_item/${encodedSku}`,
        accessToken,
        {
          method: 'PUT',
          body: JSON.stringify(inventoryItemPayload),
        },
        marketplaceId
      );

      logger.info('eBay inventory item created', { sku });

      // Step 2: Create offer
      const offerPayload: Record<string, any> = {
        sku,
        marketplaceId: marketplaceId,
        format,
        pricingSummary: {
          price: {
            value: String(price),
            currency,
          },
        },
      };

      // Listing policies are required for publishing
      const listingPolicies: Record<string, string> = {};
      if (paymentPolicyId) listingPolicies.paymentPolicyId = paymentPolicyId;
      if (returnPolicyId) listingPolicies.returnPolicyId = returnPolicyId;
      if (fulfillmentPolicyId) listingPolicies.fulfillmentPolicyId = fulfillmentPolicyId;
      if (Object.keys(listingPolicies).length > 0) {
        offerPayload.listingPolicies = listingPolicies;
      }

      if (categoryId) offerPayload.categoryId = categoryId;

      // Auto-fetch merchant location if not provided (required for publishing)
      const locationKey = merchantLocationKey || await getDefaultMerchantLocationKey(accessToken, marketplaceId);
      if (locationKey) offerPayload.merchantLocationKey = locationKey;

      const offerResult = await callEbayAPI(
        '/sell/inventory/v1/offer',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify(offerPayload),
        },
        marketplaceId
      );

      const offerId = offerResult.offerId;
      logger.info('eBay offer created', { sku, offerId });

      // Step 3: Optionally publish
      let listingId = null;
      let publishError: string | null = null;
      let missingAspects: string[] = [];

      if (publish && offerId) {
        // Small delay to let eBay process the offer before publishing
        await new Promise(r => setTimeout(r, 2000));

        try {
          const publishResult = await callEbayAPI(
            `/sell/inventory/v1/offer/${offerId}/publish`,
            accessToken,
            { method: 'POST' },
            marketplaceId
          );
          listingId = publishResult.listingId;
          logger.info('eBay listing published', { sku, offerId, listingId });
        } catch (pubErr: any) {
          const errMsg = pubErr.message || '';
          logger.error('Failed to auto-publish eBay listing', pubErr instanceof Error ? pubErr : new Error(String(pubErr)), {
            sku,
            offerId,
          });

          // Extract missing required aspects
          const aspectRegex = /The item specific (\w[\w\s]*?) is missing/g;
          let match;
          while ((match = aspectRegex.exec(errMsg)) !== null) {
            missingAspects.push(match[1].trim());
          }

          publishError = missingAspects.length > 0
            ? `Şu zorunlu özellikler eksik: ${missingAspects.join(', ')}`
            : errMsg.includes('Item.Country')
              ? 'Konum bilgisi (ülke) eksik'
              : errMsg.substring(0, 300);
        }
      }

      return res.status(201).json({
        success: true,
        sku,
        offerId,
        listingId,
        published: !!listingId,
        publishError: publishError || undefined,
        missingAspects: missingAspects.length > 0 ? missingAspects : undefined,
        message: listingId
          ? 'Listing created and published.'
          : publishError
            ? `Listing created but publish failed: ${publishError}`
            : 'Listing created. Use the publish action to make it live.',
      });
    }

    // PUT ?action=update_listing&sku=XXX — Update inventory item
    if ((req.method === 'PUT' || req.method === 'PATCH') && action === 'update_listing') {
      const sku = req.query.sku as string;
      if (!sku) {
        return res.status(400).json({ error: 'sku is required' });
      }

      const {
        title,
        description,
        aspects,
        imageUrls,
        upc,
        ean,
        condition,
        conditionDescription,
        quantity,
      } = req.body;

      // First get the existing item to merge
      const encodedSku = encodeURIComponent(sku);
      let existingItem: Record<string, any> = {};
      try {
        existingItem = await callEbayAPI(
          `/sell/inventory/v1/inventory_item/${encodedSku}`,
          accessToken,
          {},
          marketplaceId
        );
      } catch {
        // Item doesn't exist yet, will create fresh
      }

      // Build update payload, merging with existing
      const product = { ...(existingItem.product || {}) };
      if (title !== undefined) product.title = title;
      if (description !== undefined) product.description = description;
      if (aspects !== undefined) product.aspects = aspects;
      if (imageUrls !== undefined) product.imageUrls = imageUrls;
      if (upc !== undefined) product.upc = [upc];
      if (ean !== undefined) product.ean = [ean];

      const updatePayload: Record<string, any> = {
        product,
        condition: condition || existingItem.condition || 'NEW',
        availability: existingItem.availability || {
          shipToLocationAvailability: { quantity: 1 },
        },
      };

      if (quantity !== undefined) {
        updatePayload.availability = {
          shipToLocationAvailability: { quantity: parseInt(quantity) },
        };
      }
      if (conditionDescription !== undefined) {
        updatePayload.conditionDescription = conditionDescription;
      }

      logger.info('Updating eBay inventory item', { sku, userId });

      await callEbayAPI(
        `/sell/inventory/v1/inventory_item/${encodedSku}`,
        accessToken,
        {
          method: 'PUT',
          body: JSON.stringify(updatePayload),
        },
        marketplaceId
      );

      return res.status(200).json({
        success: true,
        sku,
        message: 'Inventory item updated.',
      });
    }

    // PUT ?action=update_offer&offerId=XXX — Update offer (pricing, policies)
    if ((req.method === 'PUT' || req.method === 'PATCH') && action === 'update_offer') {
      const offerId = queryOfferId;
      if (!offerId) {
        return res.status(400).json({ error: 'offerId is required' });
      }

      const {
        price,
        currency = 'USD',
        categoryId,
        paymentPolicyId,
        returnPolicyId,
        fulfillmentPolicyId,
        merchantLocationKey,
        format,
      } = req.body;

      // Fetch existing offer to merge
      const existingOffer = await callEbayAPI(
        `/sell/inventory/v1/offer/${offerId}`,
        accessToken,
        {},
        marketplaceId
      );

      const updatePayload: Record<string, any> = {
        ...existingOffer,
      };

      // Remove read-only fields
      delete updatePayload.offerId;
      delete updatePayload.status;
      delete updatePayload.listing;

      if (price !== undefined) {
        updatePayload.pricingSummary = {
          ...updatePayload.pricingSummary,
          price: {
            value: String(price),
            currency: currency || updatePayload.pricingSummary?.price?.currency || 'USD',
          },
        };
      }

      if (categoryId !== undefined) updatePayload.categoryId = categoryId;
      if (format !== undefined) updatePayload.format = format;
      if (merchantLocationKey !== undefined) updatePayload.merchantLocationKey = merchantLocationKey;

      // Update listing policies
      if (paymentPolicyId || returnPolicyId || fulfillmentPolicyId) {
        updatePayload.listingPolicies = updatePayload.listingPolicies || {};
        if (paymentPolicyId) updatePayload.listingPolicies.paymentPolicyId = paymentPolicyId;
        if (returnPolicyId) updatePayload.listingPolicies.returnPolicyId = returnPolicyId;
        if (fulfillmentPolicyId) updatePayload.listingPolicies.fulfillmentPolicyId = fulfillmentPolicyId;
      }

      logger.info('Updating eBay offer', { offerId, userId });

      const result = await callEbayAPI(
        `/sell/inventory/v1/offer/${offerId}`,
        accessToken,
        {
          method: 'PUT',
          body: JSON.stringify(updatePayload),
        },
        marketplaceId
      );

      return res.status(200).json({
        success: true,
        offerId,
        result,
        message: 'Offer updated.',
      });
    }

    // DELETE ?action=delete_listing&sku=XXX — Delete inventory item
    if (req.method === 'DELETE' && action === 'delete_listing') {
      const sku = req.query.sku as string;
      if (!sku) {
        return res.status(400).json({ error: 'sku is required' });
      }

      const encodedSku = encodeURIComponent(sku);

      logger.info('Deleting eBay inventory item', { sku, userId });

      await callEbayAPI(
        `/sell/inventory/v1/inventory_item/${encodedSku}`,
        accessToken,
        { method: 'DELETE' },
        marketplaceId
      );

      return res.status(200).json({
        success: true,
        sku,
        message: 'Inventory item deleted.',
      });
    }

    // POST ?action=publish&offerId=XXX — Publish an offer
    if (req.method === 'POST' && (action === 'publish' || action === 'publish_offer')) {
      const offerId = queryOfferId || (req.body?.offerId as string);
      if (!offerId) {
        return res.status(400).json({ error: 'offerId is required' });
      }

      logger.info('Publishing eBay offer', { offerId, userId });

      try {
        const result = await callEbayAPI(
          `/sell/inventory/v1/offer/${offerId}/publish`,
          accessToken,
          { method: 'POST' },
          marketplaceId
        );

        return res.status(200).json({
          success: true,
          offerId,
          listingId: result.listingId,
          message: 'Offer published.',
        });
      } catch (err: any) {
        // Parse eBay error to extract missing required aspects for user-friendly message
        const errMsg = err.message || '';
        const missingAspects: string[] = [];

        // Extract aspect names from eBay error messages like "The item specific Color is missing"
        const aspectRegex = /The item specific (\w[\w\s]*?) is missing/g;
        let match;
        while ((match = aspectRegex.exec(errMsg)) !== null) {
          missingAspects.push(match[1].trim());
        }

        if (missingAspects.length > 0) {
          return res.status(400).json({
            error: `Yayınlamak için şu zorunlu özellikler eksik: ${missingAspects.join(', ')}`,
            missingAspects,
            rawError: errMsg.substring(0, 500),
          });
        }

        // Check for location/country error
        if (errMsg.includes('Item.Country')) {
          return res.status(400).json({
            error: 'Yayınlamak için konum bilgisi (ülke) gereklidir. eBay Seller Hub\'dan adres ayarlayın.',
            rawError: errMsg.substring(0, 500),
          });
        }

        throw err;
      }
    }

    // POST ?action=withdraw&offerId=XXX — Withdraw/end a listing
    if (req.method === 'POST' && (action === 'withdraw' || action === 'withdraw_offer')) {
      const offerId = queryOfferId || (req.body?.offerId as string);
      if (!offerId) {
        return res.status(400).json({ error: 'offerId is required' });
      }

      logger.info('Withdrawing eBay offer', { offerId, userId });

      const result = await callEbayAPI(
        `/sell/inventory/v1/offer/${offerId}/withdraw`,
        accessToken,
        { method: 'POST' },
        marketplaceId
      );

      return res.status(200).json({
        success: true,
        offerId,
        listingId: result.listingId,
        message: 'Listing withdrawn.',
      });
    }

    // POST ?action=end_listing&offerId=XXX — End a listing (alias for withdraw)
    if (req.method === 'POST' && action === 'end_listing') {
      const offerId = queryOfferId || (req.body?.offerId as string);
      if (!offerId) {
        return res.status(400).json({ error: 'offerId is required' });
      }

      logger.info('Ending eBay listing', { offerId, userId });

      const result = await callEbayAPI(
        `/sell/inventory/v1/offer/${offerId}/withdraw`,
        accessToken,
        { method: 'POST' },
        marketplaceId
      );

      return res.status(200).json({
        success: true,
        offerId,
        listingId: result.listingId,
        message: 'Listing ended.',
      });
    }

    // -----------------------------------------------------------------
    // COMPONENT-SPECIFIC ACTIONS (inventory items + offers as separate calls)
    // -----------------------------------------------------------------

    // PUT ?action=create_inventory_item&sku=XXX — Create/update inventory item only
    if (req.method === 'PUT' && action === 'create_inventory_item') {
      const sku = req.query.sku as string;
      if (!sku) return res.status(400).json({ error: 'sku is required' });

      await callEbayAPI(
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
        accessToken,
        { method: 'PUT', body: JSON.stringify(req.body) },
        marketplaceId
      );

      return res.status(200).json({ success: true, sku });
    }

    // PUT ?action=update_inventory_item&sku=XXX — Update inventory item only
    if ((req.method === 'PUT' || req.method === 'PATCH') && action === 'update_inventory_item') {
      const sku = req.query.sku as string;
      if (!sku) return res.status(400).json({ error: 'sku is required' });

      // Merge with existing item
      const encodedSku = encodeURIComponent(sku);
      let existingItem: any = {};
      try {
        existingItem = await callEbayAPI(
          `/sell/inventory/v1/inventory_item/${encodedSku}`,
          accessToken, {}, marketplaceId
        );
      } catch { /* item doesn't exist, will create */ }

      const merged = { ...existingItem, ...req.body };
      // Remove read-only fields
      delete merged.sku;
      delete merged.groupIds;
      delete merged.inventoryItemGroupKeys;

      await callEbayAPI(
        `/sell/inventory/v1/inventory_item/${encodedSku}`,
        accessToken,
        { method: 'PUT', body: JSON.stringify(merged) },
        marketplaceId
      );

      return res.status(200).json({ success: true, sku });
    }

    // POST ?action=create_offer — Create offer only (body contains offer payload)
    if (req.method === 'POST' && action === 'create_offer') {
      const offerBody = { ...req.body };

      // Auto-inject merchantLocationKey if not provided
      if (!offerBody.merchantLocationKey) {
        const locationKey = await getDefaultMerchantLocationKey(accessToken, marketplaceId);
        if (locationKey) offerBody.merchantLocationKey = locationKey;
      }

      const result = await callEbayAPI(
        '/sell/inventory/v1/offer',
        accessToken,
        { method: 'POST', body: JSON.stringify(offerBody) },
        marketplaceId
      );

      return res.status(201).json({
        success: true,
        offerId: result.offerId,
      });
    }

    // DELETE ?action=delete_inventory_item&sku=XXX — Delete inventory item
    if (req.method === 'DELETE' && action === 'delete_inventory_item') {
      const sku = req.query.sku as string;
      if (!sku) return res.status(400).json({ error: 'sku is required' });

      await callEbayAPI(
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
        accessToken,
        { method: 'DELETE' },
        marketplaceId
      );

      return res.status(200).json({ success: true, sku });
    }

    // GET ?action=get_inventory_item_group&sku=XXX — Get inventory item group
    if (req.method === 'GET' && action === 'get_inventory_item_group') {
      const sku = req.query.sku as string;
      if (!sku) return res.status(400).json({ error: 'sku is required' });

      try {
        const data = await callEbayAPI(
          `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(sku)}`,
          accessToken, {}, marketplaceId
        );
        return res.status(200).json(data);
      } catch {
        return res.status(200).json({ variantSKUs: [] });
      }
    }

    // PUT ?action=create_inventory_item_group&sku=XXX — Create/update inventory item group
    if (req.method === 'PUT' && action === 'create_inventory_item_group') {
      const sku = req.query.sku as string;
      if (!sku) return res.status(400).json({ error: 'sku (group key) is required' });

      const data = await callEbayAPI(
        `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(sku)}`,
        accessToken,
        { method: 'PUT', body: JSON.stringify(req.body) },
        marketplaceId
      );

      return res.status(200).json(data);
    }

    // -----------------------------------------------------------------
    // INVENTORY LOCATIONS
    // -----------------------------------------------------------------

    // GET ?action=locations — Get merchant locations
    if (req.method === 'GET' && action === 'locations') {
      try {
        const data = await callEbayAPI(
          '/sell/inventory/v1/location?limit=100',
          accessToken,
          {},
          marketplaceId
        );
        return res.status(200).json({
          total: data.total || 0,
          locations: data.locations || [],
        });
      } catch {
        return res.status(200).json({ total: 0, locations: [] });
      }
    }

    // -----------------------------------------------------------------
    // ACCOUNT POLICIES
    // -----------------------------------------------------------------

    // GET ?action=fulfillment_policies — Shipping policies
    if (req.method === 'GET' && action === 'fulfillment_policies') {
      const data = await callEbayAPI(
        `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplaceId}`,
        accessToken,
        {},
        marketplaceId
      );

      // Normalize policy IDs to common `policyId` field for frontend consistency
      const policies = (data.fulfillmentPolicies || []).map((p: any) => ({
        ...p,
        policyId: p.fulfillmentPolicyId || p.policyId,
      }));
      return res.status(200).json({
        total: data.total || 0,
        fulfillmentPolicies: policies,
      });
    }

    // GET ?action=return_policies — Return policies
    if (req.method === 'GET' && action === 'return_policies') {
      const data = await callEbayAPI(
        `/sell/account/v1/return_policy?marketplace_id=${marketplaceId}`,
        accessToken,
        {},
        marketplaceId
      );

      const policies = (data.returnPolicies || []).map((p: any) => ({
        ...p,
        policyId: p.returnPolicyId || p.policyId,
      }));
      return res.status(200).json({
        total: data.total || 0,
        returnPolicies: policies,
      });
    }

    // GET ?action=payment_policies — Payment policies
    if (req.method === 'GET' && action === 'payment_policies') {
      const data = await callEbayAPI(
        `/sell/account/v1/payment_policy?marketplace_id=${marketplaceId}`,
        accessToken,
        {},
        marketplaceId
      );

      const policies = (data.paymentPolicies || []).map((p: any) => ({
        ...p,
        policyId: p.paymentPolicyId || p.policyId,
      }));
      return res.status(200).json({
        total: data.total || 0,
        paymentPolicies: policies,
      });
    }

    // -----------------------------------------------------------------
    // BULK OPERATIONS
    // -----------------------------------------------------------------

    // POST ?action=bulk_update_price — Bulk price/quantity update
    if (req.method === 'POST' && action === 'bulk_update_price') {
      const { requests } = req.body;

      if (!requests || !Array.isArray(requests) || requests.length === 0) {
        return res.status(400).json({ error: 'requests array is required' });
      }

      logger.info('Bulk updating eBay prices/quantities', {
        userId,
        count: requests.length,
      });

      const payload = {
        requests: requests.map((r: any) => {
          const entry: Record<string, any> = {
            sku: r.sku,
          };

          if (r.quantity !== undefined) {
            entry.shipToLocationAvailability = {
              quantity: parseInt(r.quantity),
            };
          }

          if (r.offers) {
            entry.offers = r.offers.map((o: any) => {
              const offer: Record<string, any> = {
                offerId: o.offerId,
              };
              if (o.availableQuantity !== undefined) {
                offer.availableQuantity = parseInt(o.availableQuantity);
              }
              if (o.price) {
                offer.price = {
                  value: String(o.price.value),
                  currency: o.price.currency || 'USD',
                };
              }
              return offer;
            });
          }

          return entry;
        }),
      };

      // Bulk API may return 400 with per-item results — handle gracefully
      let result: any;
      try {
        result = await callEbayAPI(
          '/sell/inventory/v1/bulk_update_price_quantity',
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify(payload),
          },
          marketplaceId
        );
      } catch (err: any) {
        // eBay returns 400 but body has per-item results — try to parse
        const errMsg = err.message || '';
        const jsonMatch = errMsg.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            result = JSON.parse(jsonMatch[0]);
          } catch {
            throw err;
          }
        } else {
          throw err;
        }
      }

      const responses = result?.responses || [];
      const failedCount = responses.filter((r: any) => r.statusCode >= 400).length;

      return res.status(200).json({
        success: failedCount === 0,
        responses,
        message: failedCount > 0
          ? `Bulk update: ${responses.length - failedCount} succeeded, ${failedCount} failed.`
          : `Bulk update completed for ${requests.length} item(s).`,
      });
    }

    // -----------------------------------------------------------------
    // ORDERS (for future use)
    // -----------------------------------------------------------------

    // GET ?action=orders — Get orders
    if (req.method === 'GET' && action === 'orders') {
      const limit = parseInt((req.query.limit as string) || '50');
      const offset = parseInt((req.query.offset as string) || '0');
      const filter = req.query.filter as string;

      let url = `/sell/fulfillment/v1/order?limit=${limit}&offset=${offset}`;
      if (filter) {
        url += `&filter=${encodeURIComponent(filter)}`;
      }

      const data = await callEbayAPI(url, accessToken);

      return res.status(200).json({
        total: data.total || 0,
        offset: data.offset || offset,
        limit: data.limit || limit,
        orders: data.orders || [],
      });
    }

    // GET ?action=order&orderId=XXX — Get single order
    if (req.method === 'GET' && action === 'order') {
      const orderId = req.query.orderId as string;
      if (!orderId) {
        return res.status(400).json({ error: 'orderId is required' });
      }

      const data = await callEbayAPI(
        `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`,
        accessToken
      );

      return res.status(200).json(data);
    }

    // =================================================================
    // BROWSE API — Market Research (uses application token, no user auth)
    // =================================================================

    // GET ?action=search_market&q=KEYWORD&limit=50&filter=...
    // Search active eBay listings for pricing & SEO research
    if (req.method === 'GET' && action === 'search_market') {
      const q = req.query.q as string;
      if (!q) {
        return res.status(400).json({ error: 'q (search query) is required' });
      }

      const appToken = await getApplicationToken();
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const sort = (req.query.sort as string) || 'BEST_MATCH';
      const filter = req.query.filter as string || '';
      const categoryId = req.query.category_id as string || '';
      const marketplace = (req.query.marketplace_id as string) || 'EBAY_US';

      let url = `/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&fieldgroups=MATCHING_ITEMS,ASPECT_REFINEMENTS`;

      if (sort !== 'BEST_MATCH') url += `&sort=${sort}`;
      if (filter) url += `&filter=${encodeURIComponent(filter)}`;
      if (categoryId) url += `&category_ids=${categoryId}`;

      const response = await fetch(`${EBAY_API_BASE}${url}`, {
        headers: {
          'Authorization': `Bearer ${appToken}`,
          'X-EBAY-C-MARKETPLACE-ID': marketplace,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error('eBay Browse API error', undefined, { status: response.status, body: errText });
        return res.status(response.status).json({ error: `Browse API error: ${response.status}`, details: errText });
      }

      const data = await response.json();
      const items = data.itemSummaries || [];

      // Compute price statistics
      const prices = items
        .map((item: any) => parseFloat(item.price?.value || '0'))
        .filter((p: number) => p > 0)
        .sort((a: number, b: number) => a - b);

      const priceStats = prices.length > 0 ? {
        min: prices[0],
        max: prices[prices.length - 1],
        avg: Math.round((prices.reduce((a: number, b: number) => a + b, 0) / prices.length) * 100) / 100,
        median: prices.length % 2 === 0
          ? Math.round(((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2) * 100) / 100
          : prices[Math.floor(prices.length / 2)],
        count: prices.length,
      } : null;

      // Extract keyword frequency from titles
      const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'are', 'was', 'were', 'has', 'have',
        'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
        'not', 'no', 'new', 'set', '&', '-', '/', '|', '+', 'x']);

      const wordFreq: Record<string, number> = {};
      items.forEach((item: any) => {
        const words = (item.title || '').toLowerCase().split(/[\s,;:!?()[\]{}]+/).filter(Boolean);
        words.forEach((word: string) => {
          if (word.length > 2 && !stopWords.has(word) && !/^\d+$/.test(word)) {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
          }
        });
      });

      const topKeywords = Object.entries(wordFreq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 30)
        .map(([keyword, count]) => ({ keyword, count, percentage: Math.round((count / items.length) * 100) }));

      return res.status(200).json({
        total: data.total || 0,
        offset: data.offset || offset,
        limit: data.limit || limit,
        items: items.map((item: any) => ({
          itemId: item.itemId,
          title: item.title,
          price: item.price,
          condition: item.condition,
          conditionId: item.conditionId,
          image: item.image,
          itemWebUrl: item.itemWebUrl,
          seller: item.seller,
          categories: item.categories,
          buyingOptions: item.buyingOptions,
          shippingOptions: item.shippingOptions,
          itemLocation: item.itemLocation,
          marketingPrice: item.marketingPrice,
          topRatedBuyingExperience: item.topRatedBuyingExperience,
          itemCreationDate: item.itemCreationDate,
          leafCategoryIds: item.leafCategoryIds,
          legacyItemId: item.legacyItemId,
        })),
        priceStats,
        topKeywords,
        aspectDistributions: data.refinement?.aspectDistributions || [],
      });
    }

    // GET ?action=analyze_seo&q=KEYWORD&my_title=...&my_aspects=...
    // Compare user's listing against market for SEO optimization
    if (req.method === 'GET' && action === 'analyze_seo') {
      const q = req.query.q as string;
      const myTitle = req.query.my_title as string || '';

      if (!q) {
        return res.status(400).json({ error: 'q (search query) is required' });
      }

      const appToken = await getApplicationToken();
      const marketplace = (req.query.marketplace_id as string) || 'EBAY_US';
      const categoryId = req.query.category_id as string || '';

      let url = `/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=200&fieldgroups=MATCHING_ITEMS,ASPECT_REFINEMENTS`;
      if (categoryId) url += `&category_ids=${categoryId}`;

      const response = await fetch(`${EBAY_API_BASE}${url}`, {
        headers: {
          'Authorization': `Bearer ${appToken}`,
          'X-EBAY-C-MARKETPLACE-ID': marketplace,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: `Browse API error: ${response.status}`, details: errText });
      }

      const data = await response.json();
      const items = data.itemSummaries || [];

      // Word frequency from competitor titles
      const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'are', 'was', 'were', 'has', 'have',
        'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
        'not', 'no', 'new', 'set', '&', '-', '/', '|', '+', 'x']);

      const wordFreq: Record<string, number> = {};
      items.forEach((item: any) => {
        const words = (item.title || '').toLowerCase().split(/[\s,;:!?()[\]{}]+/).filter(Boolean);
        const seen = new Set<string>(); // count once per title
        words.forEach((word: string) => {
          if (word.length > 2 && !stopWords.has(word) && !/^\d+$/.test(word) && !seen.has(word)) {
            seen.add(word);
            wordFreq[word] = (wordFreq[word] || 0) + 1;
          }
        });
      });

      const topKeywords = Object.entries(wordFreq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 50)
        .map(([keyword, count]) => ({ keyword, count, percentage: Math.round((count / items.length) * 100) }));

      // Analyze user's title against top keywords
      const myTitleWords = new Set(myTitle.toLowerCase().split(/[\s,;:!?()[\]{}]+/).filter(Boolean));
      const keywordCoverage = topKeywords.map(kw => ({
        ...kw,
        inMyTitle: myTitleWords.has(kw.keyword),
      }));

      const coveredCount = keywordCoverage.filter(k => k.inMyTitle).length;
      const seoScore = topKeywords.length > 0
        ? Math.round((coveredCount / Math.min(topKeywords.length, 20)) * 100)
        : 0;

      // Average title length, image count from competitors
      const avgTitleLength = items.length > 0
        ? Math.round(items.reduce((sum: number, i: any) => sum + (i.title || '').length, 0) / items.length)
        : 0;

      // Price stats
      const prices = items
        .map((item: any) => parseFloat(item.price?.value || '0'))
        .filter((p: number) => p > 0)
        .sort((a: number, b: number) => a - b);

      const priceStats = prices.length > 0 ? {
        min: prices[0],
        max: prices[prices.length - 1],
        avg: Math.round((prices.reduce((a: number, b: number) => a + b, 0) / prices.length) * 100) / 100,
        median: prices.length % 2 === 0
          ? Math.round(((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2) * 100) / 100
          : prices[Math.floor(prices.length / 2)],
      } : null;

      // Most common aspects from results
      const aspectAnalysis = (data.refinement?.aspectDistributions || []).map((aspect: any) => ({
        name: aspect.localizedAspectName,
        topValues: (aspect.aspectValueDistributions || [])
          .slice(0, 10)
          .map((v: any) => ({ value: v.localizedAspectValue, count: v.matchCount })),
      }));

      return res.status(200).json({
        totalCompetitors: data.total || 0,
        seoScore,
        keywordCoverage,
        priceStats,
        avgTitleLength,
        myTitleLength: myTitle.length,
        aspectAnalysis,
        recommendations: [
          ...(myTitle.length < avgTitleLength - 10
            ? [`Başlığınız rakiplere göre kısa (${myTitle.length} vs ortalama ${avgTitleLength} karakter). Daha uzun başlık kullanmayı deneyin.`]
            : []),
          ...(coveredCount < 5
            ? [`Rakiplerin en popüler anahtar kelimelerinin sadece ${coveredCount} tanesini kullanıyorsunuz. Eksik kelimeleri eklemeyi deneyin.`]
            : []),
          ...(topKeywords.length > 0
            ? [`En popüler anahtar kelimeler: ${topKeywords.slice(0, 5).map(k => k.keyword).join(', ')}`]
            : []),
        ],
      });
    }

    // GET ?action=my_legacy_listings — Get user's own legacy listings via Analytics + Browse API
    if (req.method === 'GET' && action === 'my_legacy_listings') {
      const appToken = await getApplicationToken();
      const marketplace = (req.query.marketplace_id as string) || 'EBAY_US';

      // Step 1: Get listing IDs from Analytics API (last 90 days)
      const yesterday = new Date(Date.now() - 86400000);
      const ninetyAgo = new Date(Date.now() - 90 * 86400000);
      const endDate = yesterday.toISOString().split('T')[0].replace(/-/g, '');
      const startDate = ninetyAgo.toISOString().split('T')[0].replace(/-/g, '');

      let listingIds: string[] = [];
      try {
        const analyticsData = await callEbayAPI(
          `/sell/analytics/v1/traffic_report?dimension=LISTING&metric=LISTING_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL,CLICK_THROUGH_RATE&filter=date_range:[${startDate}..${endDate}]`,
          accessToken,
          {},
          marketplace
        );
        if (analyticsData.records) {
          listingIds = analyticsData.records.map((r: any) => r.dimensionValues?.[0]?.value).filter(Boolean);
        }
      } catch (err) {
        logger.warn('Analytics API failed, falling back to orders', { error: String(err) });
      }

      // Step 2: Get listing IDs from orders (catches items not in analytics)
      try {
        const ordersData = await callEbayAPI(
          `/sell/fulfillment/v1/order?limit=200`,
          accessToken
        );
        const orderIds = new Set<string>();
        for (const order of ordersData.orders || []) {
          for (const li of order.lineItems || []) {
            if (li.legacyItemId) orderIds.add(li.legacyItemId);
          }
        }
        for (const id of orderIds) {
          if (!listingIds.includes(id)) listingIds.push(id);
        }
      } catch {
        // Orders failed, use analytics only
      }

      // Step 3: Search by seller name via Browse API to find ALL active listings
      // This catches listings not in analytics or orders
      try {
        // Get seller username from any existing item
        let sellerUsername = '';
        if (listingIds.length > 0) {
          try {
            const sampleItem = await callEbayAPI(
              `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${listingIds[0]}`,
              appToken
            );
            sellerUsername = sampleItem.seller?.username || '';
          } catch { /* skip */ }
        }

        if (sellerUsername) {
          // Search all items from this seller (up to 200)
          const sellerSearch = await fetch(`${EBAY_API_BASE}/buy/browse/v1/item_summary/search?limit=200&filter=sellers:{${encodeURIComponent(sellerUsername)}}&fieldgroups=MATCHING_ITEMS`, {
            headers: {
              'Authorization': `Bearer ${appToken}`,
              'X-EBAY-C-MARKETPLACE-ID': marketplace,
              'Content-Type': 'application/json',
            },
          });
          if (sellerSearch.ok) {
            const sellerData = await sellerSearch.json();
            for (const item of sellerData.itemSummaries || []) {
              const legacyId = item.legacyItemId;
              if (legacyId && !listingIds.includes(legacyId)) {
                listingIds.push(legacyId);
              }
            }
            logger.info('Found seller listings via Browse API', {
              seller: sellerUsername,
              browseCount: sellerData.itemSummaries?.length || 0,
              totalIds: listingIds.length,
            });
          }
        }
      } catch (err) {
        logger.info('Seller search fallback failed', { error: String(err) });
      }

      if (listingIds.length === 0) {
        return res.status(200).json({ total: 0, listings: [] });
      }

      // Step 3: Get full details via Browse API — ALL in parallel for speed
      // Vercel has a 10s timeout, so we must be fast
      const results = await Promise.allSettled(
        listingIds.map(async (legacyId) => {
          try {
            const item = await callEbayAPI(
              `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${legacyId}`,
              appToken
            );
            return {
              legacyItemId: legacyId,
              itemId: item.itemId,
              title: item.title,
              shortDescription: item.shortDescription,
              price: item.price,
              condition: item.condition,
              conditionId: item.conditionId,
              conditionDescription: item.conditionDescription,
              categoryPath: item.categoryPath,
              categoryId: item.categoryId,
              categoryIdPath: item.categoryIdPath,
              image: item.image,
              additionalImages: item.additionalImages || [],
              brand: item.brand,
              itemCreationDate: item.itemCreationDate,
              seller: item.seller,
              estimatedSoldQuantity: item.estimatedAvailabilities?.[0]?.estimatedSoldQuantity || 0,
              estimatedRemainingQuantity: item.estimatedAvailabilities?.[0]?.estimatedRemainingQuantity || 0,
              shippingOptions: item.shippingOptions,
              returnTerms: item.returnTerms,
              localizedAspects: item.localizedAspects,
              itemWebUrl: item.itemWebUrl,
              description: item.description,
              buyingOptions: item.buyingOptions,
              listingMarketplaceId: item.listingMarketplaceId,
              topRatedBuyingExperience: item.topRatedBuyingExperience,
              gtin: item.gtin,
              mpn: item.mpn,
              epid: item.epid,
            };
          } catch (err) {
            // Some items may be variation groups — skip gracefully
            logger.info('Failed to fetch legacy item', { legacyId, error: String(err) });
            return null;
          }
        })
      );

      const listings = results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
        .map(r => r.value);

      return res.status(200).json({
        total: listings.length,
        totalAnalytics: listingIds.length,
        listings,
      });
    }

    // GET ?action=get_item_details&legacy_item_id=XXX — Get full details for any legacy item
    if (req.method === 'GET' && action === 'get_item_details') {
      const legacyItemId = req.query.legacy_item_id as string;
      if (!legacyItemId) {
        return res.status(400).json({ error: 'legacy_item_id is required' });
      }

      const appToken = await getApplicationToken();
      const item = await callEbayAPI(
        `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${legacyItemId}`,
        appToken
      );

      return res.status(200).json(item);
    }

    // GET ?action=search_seller&seller=USERNAME&q=OPTIONAL_QUERY
    if (req.method === 'GET' && action === 'search_seller') {
      const sellerName = req.query.seller as string;
      if (!sellerName) {
        return res.status(400).json({ error: 'seller username is required' });
      }

      const appToken = await getApplicationToken();
      const q = (req.query.q as string) || '';
      const limit = parseInt(req.query.limit as string) || 50;
      const marketplace = (req.query.marketplace_id as string) || 'EBAY_US';

      // Browse API filter by seller
      // q is required by eBay Browse API; when not provided, use seller name as search term
      let url = `/buy/browse/v1/item_summary/search?limit=${limit}&fieldgroups=MATCHING_ITEMS,ASPECT_REFINEMENTS&filter=sellers:{${encodeURIComponent(sellerName)}}&q=${encodeURIComponent(q || sellerName)}`;

      const response = await fetch(`${EBAY_API_BASE}${url}`, {
        headers: {
          'Authorization': `Bearer ${appToken}`,
          'X-EBAY-C-MARKETPLACE-ID': marketplace,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: `Browse API error: ${response.status}`, details: errText });
      }

      const data = await response.json();
      const items = data.itemSummaries || [];

      // Get sold quantity for top items (first 10) in parallel
      const enrichedItems = await Promise.all(
        items.slice(0, 20).map(async (item: any) => {
          let soldQuantity = 0;
          try {
            if (item.legacyItemId) {
              const detail = await callEbayAPI(
                `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${item.legacyItemId}`,
                appToken
              );
              soldQuantity = detail.estimatedAvailabilities?.[0]?.estimatedSoldQuantity || 0;
            }
          } catch { /* skip */ }
          return {
            ...item,
            estimatedSoldQuantity: soldQuantity,
          };
        })
      );

      // Append remaining items without enrichment
      const remaining = items.slice(20).map((item: any) => ({ ...item, estimatedSoldQuantity: 0 }));

      return res.status(200).json({
        total: data.total || 0,
        seller: sellerName,
        items: [...enrichedItems, ...remaining],
        aspectDistributions: data.refinement?.aspectDistributions || [],
      });
    }

    // GET ?action=category_bestsellers&category_id=XXX — Find bestselling items in a category
    if (req.method === 'GET' && action === 'category_bestsellers') {
      const categoryId = req.query.category_id as string;
      if (!categoryId) {
        return res.status(400).json({ error: 'category_id is required' });
      }

      const appToken = await getApplicationToken();
      const limit = parseInt(req.query.limit as string) || 50;
      const marketplace = (req.query.marketplace_id as string) || 'EBAY_US';
      const condition = req.query.condition as string || '';

      let filter = '';
      if (condition) filter = `conditionIds:{${condition}}`;

      let url = `/buy/browse/v1/item_summary/search?category_ids=${categoryId}&limit=${limit}&fieldgroups=MATCHING_ITEMS,ASPECT_REFINEMENTS`;
      if (filter) url += `&filter=${encodeURIComponent(filter)}`;

      const response = await fetch(`${EBAY_API_BASE}${url}`, {
        headers: {
          'Authorization': `Bearer ${appToken}`,
          'X-EBAY-C-MARKETPLACE-ID': marketplace,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: `Browse API error: ${response.status}`, details: errText });
      }

      const data = await response.json();
      const items = data.itemSummaries || [];

      // Get sold quantities for top items to rank by sales
      const enrichedItems = await Promise.all(
        items.slice(0, 20).map(async (item: any) => {
          let soldQuantity = 0;
          try {
            if (item.legacyItemId) {
              const detail = await callEbayAPI(
                `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${item.legacyItemId}`,
                appToken
              );
              soldQuantity = detail.estimatedAvailabilities?.[0]?.estimatedSoldQuantity || 0;
            }
          } catch { /* skip */ }
          return {
            itemId: item.itemId,
            title: item.title,
            price: item.price,
            condition: item.condition,
            image: item.image,
            itemWebUrl: item.itemWebUrl,
            seller: item.seller,
            categories: item.categories,
            buyingOptions: item.buyingOptions,
            shippingOptions: item.shippingOptions,
            topRatedBuyingExperience: item.topRatedBuyingExperience,
            legacyItemId: item.legacyItemId,
            estimatedSoldQuantity: soldQuantity,
          };
        })
      );

      // Sort by sold quantity descending
      enrichedItems.sort((a: any, b: any) => b.estimatedSoldQuantity - a.estimatedSoldQuantity);

      // Append remaining items
      const remaining = items.slice(20).map((item: any) => ({
        itemId: item.itemId,
        title: item.title,
        price: item.price,
        condition: item.condition,
        image: item.image,
        itemWebUrl: item.itemWebUrl,
        seller: item.seller,
        categories: item.categories,
        buyingOptions: item.buyingOptions,
        shippingOptions: item.shippingOptions,
        topRatedBuyingExperience: item.topRatedBuyingExperience,
        legacyItemId: item.legacyItemId,
        estimatedSoldQuantity: 0,
      }));

      // Price stats
      const prices = items
        .map((item: any) => parseFloat(item.price?.value || '0'))
        .filter((p: number) => p > 0)
        .sort((a: number, b: number) => a - b);

      const priceStats = prices.length > 0 ? {
        min: prices[0],
        max: prices[prices.length - 1],
        avg: Math.round((prices.reduce((a: number, b: number) => a + b, 0) / prices.length) * 100) / 100,
        median: prices.length % 2 === 0
          ? Math.round(((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2) * 100) / 100
          : prices[Math.floor(prices.length / 2)],
      } : null;

      return res.status(200).json({
        total: data.total || 0,
        categoryId,
        items: [...enrichedItems, ...remaining],
        priceStats,
        aspectDistributions: data.refinement?.aspectDistributions || [],
      });
    }

    // GET ?action=top_categories — Get top-level eBay categories for browsing
    if (req.method === 'GET' && action === 'top_categories') {
      const appToken = await getApplicationToken();
      const categoryTreeId = (req.query.category_tree_id as string) || '0';

      const data = await callEbayAPI(
        `/commerce/taxonomy/v1/category_tree/${categoryTreeId}`,
        appToken
      );

      // Return flattened top-level categories (1 level deep)
      const rootCategory = data.rootCategoryNode;
      const categories = (rootCategory?.childCategoryTreeNodes || []).map((node: any) => ({
        categoryId: node.category?.categoryId,
        categoryName: node.category?.categoryName,
        childCount: node.childCategoryTreeNodes?.length || 0,
        children: (node.childCategoryTreeNodes || []).slice(0, 20).map((child: any) => ({
          categoryId: child.category?.categoryId,
          categoryName: child.category?.categoryName,
          childCount: child.childCategoryTreeNodes?.length || 0,
        })),
      }));

      return res.status(200).json({
        categoryTreeId: data.categoryTreeId,
        categoryTreeVersion: data.categoryTreeVersion,
        categories,
      });
    }

    // GET ?action=analytics — Get user's own listing analytics/traffic
    if (req.method === 'GET' && action === 'analytics') {
      const marketplace = (req.query.marketplace_id as string) || 'EBAY_US';
      const days = parseInt(req.query.days as string) || 30;

      const yesterday = new Date(Date.now() - 86400000);
      const startDay = new Date(Date.now() - days * 86400000);
      const endDate = yesterday.toISOString().split('T')[0].replace(/-/g, '');
      const startDate = startDay.toISOString().split('T')[0].replace(/-/g, '');

      const data = await callEbayAPI(
        `/sell/analytics/v1/traffic_report?dimension=LISTING&metric=LISTING_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL,CLICK_THROUGH_RATE&filter=date_range:[${startDate}..${endDate}]`,
        accessToken,
        {},
        marketplace
      );

      // Parse records into a readable format
      const records = (data.records || []).map((record: any) => {
        const listingId = record.dimensionValues?.[0]?.value;
        const metrics: Record<string, any> = {};
        (record.metricValues || []).forEach((mv: any, idx: number) => {
          const key = data.header?.metrics?.[idx]?.key;
          if (key) metrics[key] = mv.value;
        });
        return { listingId, ...metrics };
      });

      return res.status(200).json({
        total: records.length,
        dateRange: { start: startDate, end: endDate },
        records,
      });
    }

    // GET ?action=store_categories — Get seller's eBay Store custom categories
    if (req.method === 'GET' && action === 'store_categories') {
      try {
        // eBay Sell Inventory API: get offers to extract unique store category names
        // OR use the older Trading API GetStore call — but Inventory API is simpler
        const offersData = await callEbayAPI(
          `/sell/inventory/v1/offer?limit=200`,
          accessToken,
          {},
          marketplaceId
        );

        const storeCategories = new Set<string>();
        for (const offer of offersData.offers || []) {
          for (const cat of offer.storeCategoryNames || []) {
            if (cat) storeCategories.add(cat);
          }
        }

        return res.status(200).json({
          categories: Array.from(storeCategories).sort(),
        });
      } catch (err: any) {
        // Store categories are optional — seller might not have an eBay Store
        return res.status(200).json({ categories: [] });
      }
    }

    // -----------------------------------------------------------------
    // No matching action
    // -----------------------------------------------------------------
    return res.status(400).json({
      error: `Unknown action: ${action || 'none'}`,
      available_actions: [
        // Listings
        'listings',
        'inventory_items',
        'get_inventory_items',
        'listing',
        'create_listing',
        'update_listing',
        'update_offer',
        'delete_listing',
        'publish',
        'withdraw',
        'end_listing',
        // Taxonomy
        'category_tree',
        'category_suggestions',
        'item_aspects',
        // Policies
        'fulfillment_policies',
        'return_policies',
        'payment_policies',
        // Bulk
        'bulk_update_price',
        // Store
        'store_categories',
        // Research
        'search_market',
        'analyze_seo',
        // Browse & Research
        'my_legacy_listings',
        'get_item_details',
        'search_seller',
        'category_bestsellers',
        'top_categories',
        'analytics',
        // Orders
        'orders',
        'order',
      ],
    });

  } catch (error) {
    logger.error('eBay API handler error',
      error instanceof Error ? error : new Error(String(error)), {
        userId,
        action: req.query.action,
        method: req.method,
      });

    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not connected') || message.includes('refresh token') ? 403 : 500;

    return res.status(status).json({
      error: message,
    });
  }
}

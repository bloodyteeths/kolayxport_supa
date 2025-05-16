import { formatISO } from 'date-fns'; // For formatting dates if needed by API or DB

// Helper to safely access nested properties
const get = (obj, path, defaultValue = null) => {
  const keys = Array.isArray(path) ? path : path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return defaultValue;
    }
    current = current[key];
  }
  return current === undefined ? defaultValue : current;
};


export async function fetchVeeqoOrders_adapted(userId, veeqoApiKey, prisma) {
  let newOrders = 0;
  let updatedOrders = 0;
  let encounteredError = null;

  try {
    console.log(`[Veeqo Adapter] User ${userId}: Fetching Veeqo orders...`);
    const veeqoApiUrl = 'https://api.veeqo.com/orders?page=1&per_page=250&sort_direction=desc&status=awaiting_fulfillment'; // Fetching only awaiting_fulfillment for now
    const response = await fetch(veeqoApiUrl, {
      headers: {
        'accept': 'application/json',
        'x-api-key': veeqoApiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Veeqo Adapter] User ${userId}: Veeqo API Error ${response.status}: ${errorText}`);
      throw new Error(`Veeqo API request failed: ${response.status} - ${errorText}`);
    }

    const veeqoOrders = await response.json();
    console.log(`[Veeqo Adapter] User ${userId}: Processing ${veeqoOrders.length} Veeqo orders.`);

    for (const vOrder of veeqoOrders) {
      const marketplaceOrderId = String(get(vOrder, 'id') || get(vOrder, 'number'));
      if (!marketplaceOrderId) {
        console.warn('[Veeqo Adapter] Skipping order with no ID/number:', vOrder);
        continue;
      }

      const channelName = get(vOrder, 'channel.name', 'Veeqo');
      const marketplaceName = channelName.charAt(0).toUpperCase() + channelName.slice(1);
      const orderMarketplaceCreatedAt = vOrder.created_at ? new Date(vOrder.created_at) : new Date();
      
      // Safely construct customer name with fallbacks
      const customerFirstName = get(vOrder, 'deliver_to.first_name') || get(vOrder, 'customer.first_name') || '';
      const customerLastName = get(vOrder, 'deliver_to.last_name') || get(vOrder, 'customer.last_name') || '';
      const customerFullName = [customerFirstName, customerLastName].filter(Boolean).join(' ').trim() || 'Unknown Customer';

      let shipBy = get(vOrder, 'ship_by_date') || get(vOrder, 'estimated_ship_by') || get(vOrder, 'required_by_date');
      if (shipBy) shipBy = new Date(shipBy);

      const orderStatus = get(vOrder, 'status.name', 'unknown').toUpperCase().replace(/ /g, '_');

      // Safely construct shipping address with fallbacks
      const shippingAddress = {
        name: [get(vOrder, 'deliver_to.first_name'), get(vOrder, 'deliver_to.last_name')].filter(Boolean).join(' ').trim() || 'Unknown Customer',
        company: get(vOrder, 'deliver_to.company') || null,
        street1: get(vOrder, 'deliver_to.address1') || '',
        street2: get(vOrder, 'deliver_to.address2') || null,
        city: get(vOrder, 'deliver_to.city') || '',
        state: get(vOrder, 'deliver_to.state') || '',
        zip: get(vOrder, 'deliver_to.zip') || '',
        country: get(vOrder, 'deliver_to.country') || '',
        phone: get(vOrder, 'deliver_to.phone') || null
      };

      const orderDataToUpsert = {
        userId,
        marketplace: marketplaceName,
        marketplaceKey: marketplaceOrderId,
        marketplaceCreatedAt: orderMarketplaceCreatedAt,
        customerName: customerFullName,
        status: orderStatus,
        shipByDate: shipBy,
        currency: get(vOrder, 'currency_code') || 'USD',
        totalPrice: parseFloat(get(vOrder, 'total_including_tax', 0)),
        shippingAddress: shippingAddress,
      };

      const orderNoteText = typeof get(vOrder, 'notes') === 'string' ? get(vOrder, 'notes', '').trim() : '';

      const lineItemsData = [];
      if (Array.isArray(vOrder.line_items)) {
        for (const vItem of vOrder.line_items) {
          const lineMarketplaceId = String(get(vItem, 'id') || '');
          const lineSku = get(vItem, 'sku') || 'UNKNOWN';
          const lineProductName = get(vItem, 'title') || get(vItem, 'sellable.name') || get(vItem, 'product.title') || 'Unknown Product';
          const lineVariantInfo = get(vItem, 'sellable.variant_options_string') || null;
          const lineQuantity = parseInt(get(vItem, 'quantity', 0), 10);
          const lineUnitPrice = parseFloat(get(vItem, 'price_before_discount_including_tax', 0));

          const lineImageUrl = get(vItem, 'image_url') || get(vItem, 'sellable.image_url') || get(vItem, 'sellable.images.0.url') || null;
          
          const lineOpt = typeof get(vItem, 'additional_options') === 'string' ? get(vItem, 'additional_options', '').trim() : '';
          const combinedNotes = [lineOpt, orderNoteText].filter(Boolean).join(' | ') || null;

          lineItemsData.push({
            marketplaceLineId: lineMarketplaceId,
            sku: lineSku,
            productName: lineProductName,
            variantInfo: lineVariantInfo,
            quantity: lineQuantity,
            unitPrice: lineUnitPrice,
            totalPrice: lineQuantity * lineUnitPrice,
            imageUrl: lineImageUrl,
            notes: combinedNotes,
          });
        }
      }

      // Upsert logic
      const existingOrder = await prisma.order.findUnique({
        where: {
          userId_marketplace_marketplaceKey: {
            userId,
            marketplace: marketplaceName,
            marketplaceKey: marketplaceOrderId,
          },
        },
      });

      if (existingOrder) {
        // Update existing order
        await prisma.order.update({
          where: { id: existingOrder.id },
          data: {
            ...orderDataToUpsert, // Update all fields from Veeqo
            updatedAt: new Date(), // Explicitly set updatedAt
            items: {
              // For simplicity, delete existing items and recreate them.
              // More complex logic could update items based on marketplaceLineId.
              deleteMany: {},
              create: lineItemsData,
            },
          },
        });
        updatedOrders++;
      } else {
        // Create new order
        await prisma.order.create({
          data: {
            ...orderDataToUpsert,
            items: {
              create: lineItemsData,
            },
          },
        });
        newOrders++;
      }
    }
    console.log(`[Veeqo Adapter] User ${userId}: Sync complete. New: ${newOrders}, Updated: ${updatedOrders}`);

  } catch (error) {
    console.error(`[Veeqo Adapter] User ${userId}: Critical error during Veeqo sync:`, error);
    encounteredError = error.message;
  }
  return { newOrders, updatedOrders, error: encounteredError };
} 
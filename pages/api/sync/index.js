import { getSupabaseServerClient } from '@/lib/supabase';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// This would be imported from actual adapter files
const fetchVeeqoOrders = async (config) => {
  // Example implementation - would need actual API integration
  console.log('Fetching from Veeqo with config:', config);
  
  // Mock response for demonstration
  return [
    {
      id: 'v-' + Date.now(),
      marketplace: 'veeqo',
      marketplaceKey: 'ord-' + Math.floor(Math.random() * 10000),
      customerName: 'John Doe',
      status: 'pending',
      shipByDate: new Date(Date.now() + 86400000), // tomorrow
      items: [
        {
          sku: 'PROD-123',
          quantity: 1,
          notes: 'Handle with care'
        }
      ]
    }
  ];
};

const fetchTrendyolOrders = async (config) => {
  // Example implementation - would need actual API integration  
  console.log('Fetching from Trendyol with config:', config);
  
  // Mock response for demonstration
  return [
    {
      id: 't-' + Date.now(),
      marketplace: 'trendyol',
      marketplaceKey: 'ord-' + Math.floor(Math.random() * 10000),
      customerName: 'Jane Smith',
      status: 'pending',
      shipByDate: new Date(Date.now() + 86400000), // tomorrow
      items: [
        {
          sku: 'PROD-456',
          quantity: 2,
          notes: null
        }
      ]
    }
  ];
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Authenticate with Supabase
    const supabase = getSupabaseServerClient(req, res);
    const { data: { user } , error: authError } = await supabase.auth.getUser();

    if (authError) {
      console.error('Supabase auth error in sync/index:', authError);
      return res.status(401).json({ error: 'Authentication error', details: authError.message });
    }
    
    // Get all marketplace configs for the user
    const marketplaceConfigs = await prisma.marketplaceConfig.findMany({
      where: { userId: user.id }
    });
    
    if (!marketplaceConfigs || marketplaceConfigs.length === 0) {
      return res.status(400).json({ error: 'No marketplace configurations found' });
    }
    
    // Fetch orders from each marketplace
    const newOrders = [];
    
    for (const config of marketplaceConfigs) {
      let orders = [];
      
      if (config.name === 'veeqo') {
        orders = await fetchVeeqoOrders(config.config);
      } else if (config.name === 'trendyol') {
        orders = await fetchTrendyolOrders(config.config);
      }
      
      if (orders.length > 0) {
        newOrders.push(...orders);
      }
    }
    
    // Upsert orders and items into database
    const results = [];
    
    for (const orderData of newOrders) {
      // Extract items before creating the order
      const { items, ...orderDetails } = orderData;
      
      // Create or update the order
      const order = await prisma.order.upsert({
        where: {
          id: orderData.id
        },
        update: {
          ...orderDetails,
          userId: user.id
        },
        create: {
          ...orderDetails,
          userId: user.id
        }
      });
      
      // Create or update the items
      if (items && items.length > 0) {
        for (const itemData of items) {
          await prisma.orderItem.upsert({
            where: {
              id: `${order.id}-${itemData.sku}`
            },
            update: {
              ...itemData,
              orderId: order.id
            },
            create: {
              ...itemData,
              orderId: order.id
            }
          });
        }
      }
      
      results.push(order);
    }
    
    return res.status(200).json({ 
      success: true, 
      message: `Synced ${results.length} orders` 
    });
    
  } catch (error) {
    console.error('Error syncing orders:', error);
    return res.status(500).json({ error: 'Failed to sync orders' });
  }
} 
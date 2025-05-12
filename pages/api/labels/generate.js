import { getSupabaseServerClient } from '@/lib/supabase';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// This would be implemented with actual carrier API integrations
const generateShippoLabel = async (item, config) => {
  console.log('Generating Shippo label for item:', item.id);
  console.log('Using Shippo config:', config);
  
  // Mock implementation
  await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate API call
  
  const success = Math.random() > 0.2; // 80% success rate for demonstration
  
  if (success) {
    return {
      success: true,
      pdfUrl: `https://example.com/labels/${item.id}.pdf`,
      trackingNumber: 'SHPO' + Math.floor(Math.random() * 1000000)
    };
  } else {
    throw new Error('Failed to generate Shippo label');
  }
};

// More carrier implementations would go here
const generateVeeqoLabel = async (item, config) => {
  console.log('Generating Veeqo label for item:', item.id);
  console.log('Using Veeqo config:', config);
  
  // Mock implementation
  await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
  
  const success = Math.random() > 0.2; // 80% success rate for demonstration
  
  if (success) {
    return {
      success: true,
      pdfUrl: `https://example.com/labels/veeqo-${item.id}.pdf`,
      trackingNumber: 'VEEQO' + Math.floor(Math.random() * 1000000)
    };
  } else {
    throw new Error('Failed to generate Veeqo label');
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { itemIds } = req.body;
  
  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing itemIds' });
  }
  
  try {
    // Authenticate with Supabase
    const supabase = getSupabaseServerClient(req, res);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error('Supabase auth error in labels/generate:', authError);
      return res.status(401).json({ error: 'Authentication error', details: authError.message });
    }
    
    // Get user's marketplace configs
    const marketplaceConfigs = await prisma.marketplaceConfig.findMany({
      where: { userId: user.id }
    });
    
    const configMap = marketplaceConfigs.reduce((map, config) => {
      map[config.name] = config.config;
      return map;
    }, {});
    
    // Get items and their order data
    const items = await prisma.orderItem.findMany({
      where: {
        id: { in: itemIds },
        order: { userId: user.id } // Ensure user can only access their own items
      },
      include: {
        order: true
      }
    });
    
    if (items.length === 0) {
      return res.status(404).json({ error: 'No matching items found' });
    }
    
    // Process each item
    const results = {
      success: [],
      errors: []
    };
    
    for (const item of items) {
      try {
        // Create a pending label job
        const labelJob = await prisma.labelJob.create({
          data: {
            itemId: item.id,
            carrier: 'pending', // Will update after determining carrier
            status: 'pending'
          }
        });
        
        // Determine which carrier to use based on marketplace or other logic
        // For this example, we'll use Shippo for Trendyol orders and Veeqo's built-in for Veeqo orders
        let labelResult;
        let carrier;
        
        if (item.order.marketplace === 'trendyol' && configMap.shippo) {
          carrier = 'shippo';
          labelResult = await generateShippoLabel(item, configMap.shippo);
        } else if (item.order.marketplace === 'veeqo' && configMap.veeqo) {
          carrier = 'veeqo';
          labelResult = await generateVeeqoLabel(item, configMap.veeqo);
        } else {
          throw new Error(`No suitable carrier found for ${item.order.marketplace} order`);
        }
        
        // Update the label job with success info
        await prisma.labelJob.update({
          where: { id: labelJob.id },
          data: {
            carrier,
            status: 'completed',
            pdfUrl: labelResult.pdfUrl,
            // Store additional data in a notes field if needed
            notes: JSON.stringify({ trackingNumber: labelResult.trackingNumber })
          }
        });
        
        results.success.push({
          itemId: item.id,
          orderId: item.orderId,
          pdfUrl: labelResult.pdfUrl,
          carrier
        });
        
      } catch (error) {
        console.error(`Error generating label for item ${item.id}:`, error);
        
        // If a label job was created, update it with the error
        const existingJob = await prisma.labelJob.findFirst({
          where: {
            itemId: item.id,
            status: 'pending'
          },
          orderBy: {
            createdAt: 'desc'
          }
        });
        
        if (existingJob) {
          await prisma.labelJob.update({
            where: { id: existingJob.id },
            data: {
              status: 'failed',
              errorMessage: error.message
            }
          });
        }
        
        results.errors.push({
          itemId: item.id,
          orderId: item.orderId,
          error: error.message
        });
      }
    }
    
    return res.status(200).json(results);
    
  } catch (error) {
    console.error('Error generating labels:', error);
    return res.status(500).json({ error: 'Failed to generate labels' });
  }
} 
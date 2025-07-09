import { getSupabaseServerClient } from '../../../lib/supabase';
const prisma = require('../../../lib/prisma').default;
import { startSync, updateSyncProgress, completeSync } from '../../../lib/sync-status';
import { logger } from '../../../lib/logger';
import { createClient } from '@supabase/supabase-js';

// This would be imported from actual adapter files
const fetchVeeqoProducts = async (config) => {
  // Example implementation - would need actual API integration
  console.log('Fetching products from Veeqo with config:', config);
  
  // Mock response for demonstration
  return [
    {
      marketplaceId: 'v-prod-' + Date.now(),
      sku: 'VEEQO-' + Math.floor(Math.random() * 10000),
      name: 'Veeqo Product ' + Math.floor(Math.random() * 100),
      description: 'This is a product synchronized from Veeqo',
      price: Math.floor(Math.random() * 10000) / 100,
      imageUrl: 'https://via.placeholder.com/150',
      stock: Math.floor(Math.random() * 20)
    }
  ];
};

const fetchTrendyolProducts = async (config) => {
  // Example implementation - would need actual API integration  
  console.log('Fetching products from Trendyol with config:', config);
  
  // Mock response for demonstration
  return [
    {
      marketplaceId: 't-prod-' + Date.now(),
      sku: 'TREND-' + Math.floor(Math.random() * 10000),
      name: 'Trendyol Product ' + Math.floor(Math.random() * 100),
      description: 'This is a product synchronized from Trendyol',
      price: Math.floor(Math.random() * 10000) / 100,
      imageUrl: 'https://via.placeholder.com/150',
      stock: Math.floor(Math.random() * 20)
    }
  ];
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { marketplaceType } = req.body;
  
  if (!marketplaceType) {
    return res.status(400).json({ error: 'Marketplace type is required' });
  }
  
  try {
    let user, authError;
    const supabase = getSupabaseServerClient(req, res);
    const result = await supabase.auth.getUser();
    user = result.data.user;
    authError = result.error;
    if (authError || !user) {
      // Try Authorization header fallback
      const authHeaderRaw = req.headers['authorization'] || req.headers['Authorization'];
      let authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
      const token = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (token) {
        const supabaseDirect = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
        const { data, error } = await supabaseDirect.auth.getUser(token);
        user = data.user;
        authError = error;
      }
    }
    if (authError || !user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Prevent overlapping syncs
    const inProgress = await prisma.syncOperation.findFirst({
      where: {
        userId: user.id,
        type: 'product',
        status: 'in_progress',
      },
    });
    if (inProgress) {
      return res.status(429).json({ error: 'Sync already in progress for this user.' });
    }
    
    // Get marketplace config
    const marketplaceConfig = await prisma.marketplaceConfig.findFirst({
      where: { 
        userId: user.id,
        name: marketplaceType
      }
    });
    
    if (!marketplaceConfig) {
      return res.status(400).json({ error: `No ${marketplaceType} configuration found for user` });
    }
    
    // Fetch products from marketplace
    let products = [];
    
    if (marketplaceType.toLowerCase() === 'veeqo') {
      products = await fetchVeeqoProducts(marketplaceConfig.config);
    } else if (marketplaceType.toLowerCase() === 'trendyol') {
      products = await fetchTrendyolProducts(marketplaceConfig.config);
    } else {
      return res.status(400).json({ error: 'Unsupported marketplace type' });
    }
    
    if (!products || products.length === 0) {
      return res.status(200).json({ message: 'No products found to import from ' + marketplaceType });
    }
    
    let syncId = null;
    let processedProducts = 0;
    let created = 0;
    let updated = 0;
    let failedProducts = 0;
    let errors = [];
    let totalProducts = 0;
    totalProducts = products.length;
    syncId = await startSync(user.id, 'product');
    await updateSyncProgress(syncId, {
      totalOrders: totalProducts,
      processedOrders: 0,
      successfulOrders: 0,
      failedOrders: 0,
      errors: [],
    });
    logger.info('Product sync started', { userId: user.id, syncId, source: marketplaceType, totalProducts });
    for (const productData of products) {
      processedProducts++;
      try {
        // Check if we already have this marketplace product mapped
        const existingMapping = await prisma.marketplaceProduct.findFirst({
          where: {
            marketplace: marketplaceType,
            marketplaceId: productData.marketplaceId
          },
          include: {
            product: true
          }
        });
        
        let product;
        
        if (existingMapping) {
          // Update existing product
          product = await prisma.product.update({
            where: { id: existingMapping.productId },
            data: {
              name: productData.name,
              description: productData.description,
              price: productData.price,
              imageUrl: productData.imageUrl,
              // Other fields as needed
            }
          });
          
          updated++;
        } else {
          // Check if we have a product with this SKU already
          const existingProduct = await prisma.product.findFirst({
            where: {
              userId: user.id,
              sku: productData.sku
            }
          });
          
          if (existingProduct) {
            // Create mapping for existing product
            await prisma.marketplaceProduct.create({
              data: {
                marketplace: marketplaceType,
                marketplaceId: productData.marketplaceId,
                productId: existingProduct.id,
                marketplaceData: { raw: productData }
              }
            });
            
            product = existingProduct;
            updated++;
          } else {
            // Create new product and mapping
            product = await prisma.product.create({
              data: {
                userId: user.id,
                sku: productData.sku,
                name: productData.name,
                description: productData.description || null,
                price: productData.price,
                imageUrl: productData.imageUrl || null,
                active: true,
                marketplaceProducts: {
                  create: {
                    marketplace: marketplaceType,
                    marketplaceId: productData.marketplaceId,
                    marketplaceData: { raw: productData }
                  }
                }
              }
            });
            
            // Create default inventory if stock info is provided
            if (productData.stock !== undefined) {
              await prisma.inventory.create({
                data: {
                  productId: product.id,
                  quantity: productData.stock,
                  location: 'default'
                }
              });
            }
            
            created++;
          }
        }
        
        await updateSyncProgress(syncId, {
          processedOrders: processedProducts,
          successfulOrders: created + updated,
          failedOrders: failedProducts,
        });
      } catch (error) {
        failedProducts++;
        errors.push({ orderId: productData.sku ?? productData.marketplaceId ?? 'Unknown', error: error.message });
        logger.error('Product upsert failed', error, {
          userId: user.id,
          operation: 'product-upsert',
          sku: productData.sku,
          marketplace: marketplaceType,
          marketplaceId: productData.marketplaceId,
        });
        await updateSyncProgress(syncId, {
          processedOrders: processedProducts,
          successfulOrders: created + updated,
          failedOrders: failedProducts,
          errors,
        });
        continue;
      }
    }
    const success = failedProducts === 0;
    await completeSync(syncId, success, {
      processedOrders: processedProducts,
      successfulOrders: created + updated,
      failedOrders: failedProducts,
      errors,
    });
    logger.info('Product sync completed', { userId: user.id, syncId, created, updated, failedProducts, totalProducts });
    return res.status(200).json({ created, updated, total: totalProducts });
  } catch (error) {
    logger.error('Product sync failed', error, { userId: user?.id, syncId, operation: 'product-sync', source: marketplaceType });
    await completeSync(syncId, false, {
      processedOrders: processedProducts,
      successfulOrders: created + updated,
      failedOrders: failedProducts + 1,
      errors: [...errors, { orderId: 'sync', error: error.message }],
    });
    return res.status(500).json({ error: error.message });
  }
} 
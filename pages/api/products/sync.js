import { getSupabaseServerClient } from '../../../lib/supabase';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
    const supabase = getSupabaseServerClient(req, res);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error('Supabase auth error in products/sync:', authError);
      return res.status(401).json({ error: 'Authentication error', details: authError.message });
    }
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
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
    
    // Process each product
    const results = {
      created: 0,
      updated: 0,
      errors: 0,
      products: []
    };
    
    for (const productData of products) {
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
          
          results.updated++;
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
            results.updated++;
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
            
            results.created++;
          }
        }
        
        results.products.push({
          id: product.id,
          sku: product.sku,
          name: product.name
        });
        
      } catch (error) {
        console.error(`Error processing product ${productData.sku} from ${marketplaceType}:`, error);
        results.errors++;
      }
    }
    
    return res.status(200).json({
      success: true,
      message: `Product sync for ${marketplaceType} completed. New: ${results.created}, Updated: ${results.updated}, Errors: ${results.errors}`,
      results
    });
    
  } catch (error) {
    console.error(`Error syncing products for ${marketplaceType}:`, error);
    if (error.code) {
        console.error(`Prisma error in products/sync: ${error.code} - ${error.message}`);
    }
    return res.status(500).json({ error: 'Failed to sync products', details: error.message });
  }
} 
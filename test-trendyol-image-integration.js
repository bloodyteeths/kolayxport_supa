#!/usr/bin/env node

// Test script to verify Trendyol image integration functionality
const { getProductImages } = require('./lib/integrations/trendyolClient');
const { mapTrendyolOrdersWithImages } = require('./lib/mappers/trendyol');

async function testImageIntegration() {
  console.log('Testing Trendyol image integration...\n');

  // Test credentials (replace with real ones for testing)
  const credentials = {
    supplierId: '312549',
    apiKey: 'your-api-key',
    apiSecret: 'your-api-secret'
  };

  // Test barcodes from your previous test
  const testBarcodes = [
    '8683851300684',
    '8683851300646', 
    '8683851347207'
  ];

  try {
    console.log('1. Testing getProductImages function...');
    console.log('Barcodes to test:', testBarcodes);
    
    const productImages = await getProductImages(testBarcodes, credentials);
    console.log('Product images result:', productImages);
    console.log(`Found images for ${Object.keys(productImages).length} products\n`);

    // Test with a mock order
    console.log('2. Testing mapTrendyolOrdersWithImages function...');
    const mockOrder = {
      id: '12345',
      orderNumber: 'TR-TEST-001',
      customerFirstName: 'Test',
      customerLastName: 'Customer', 
      totalPrice: 100,
      status: 'Created',
      orderDate: Date.now(),
      lines: [
        {
          id: '1',
          productName: 'Test Product 1',
          barcode: '8683851300684',
          price: 50,
          quantity: 1
        },
        {
          id: '2', 
          productName: 'Test Product 2',
          barcode: '8683851300646',
          price: 50,
          quantity: 1
        }
      ],
      shipmentAddress: {
        fullName: 'Test Customer',
        address1: 'Test Address',
        city: 'Test City',
        countryCode: 'TR'
      }
    };

    const mappedOrders = await mapTrendyolOrdersWithImages([mockOrder], credentials);
    console.log('Mapped orders:', JSON.stringify(mappedOrders, null, 2));
    
    const orderWithImages = mappedOrders[0];
    const itemsWithImages = orderWithImages.line_items.filter(item => item.image && item.image.length > 0);
    console.log(`\nSuccess! ${itemsWithImages.length} out of ${orderWithImages.line_items.length} items have images`);
    
    itemsWithImages.forEach((item, index) => {
      console.log(`Item ${index + 1}: ${item.title} - Image: ${item.image}`);
    });

  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  testImageIntegration();
}

module.exports = { testImageIntegration };
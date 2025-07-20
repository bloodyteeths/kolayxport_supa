#!/usr/bin/env node

// Test script to verify the Trendyol mapper fix with actual order payload
const { toOrder, mapTrendyolOrdersWithImages } = require('./lib/mappers/trendyol');

// Sample Trendyol order from the user's payload
const sampleOrder = {
  "id": 3065174454,
  "isCod": false,
  "lines": [
    {
      "id": 4379091727,
      "sku": "8683851325298",
      "price": 161.72,
      "amount": 161.72,
      "barcode": "8683851325298",
      "discount": 0,
      "quantity": 2,
      "merchantId": 312549,
      "tyDiscount": 0,
      "merchantSku": "8683851325298",
      "productCode": 1075788851,
      "productName": "2 Adet Su Sıvı Geçirmez Yastık Alezi Pamuklu Fermuarlı Terletmeyen Yastık Koruyucu Kılıf 5070, one size",
      "productSize": "Tek Ebat",
      "currencyCode": "TRY",
      "productColor": "beyaz",
      "productOrigin": "TR",
      "vatBaseAmount": 10,
      "discountDetails": [
        {
          "lineItemPrice": 161.72,
          "lineItemDiscount": 0,
          "lineItemTyDiscount": 0
        },
        {
          "lineItemPrice": 161.72,
          "lineItemDiscount": 0,
          "lineItemTyDiscount": 0
        }
      ],
      "salesCampaignId": 61,
      "productCategoryId": 3412,
      "fastDeliveryOptions": [],
      "orderLineItemStatusName": "Shipped"
    }
  ],
  "orderNumber": "10348486732",
  "customerFirstName": "Hülya",
  "customerLastName": "Kahramanoğlu",
  "totalPrice": 323.44,
  "currencyCode": "TRY",
  "orderDate": 1752348183488,
  "shipmentAddress": {
    "id": 7255324132,
    "city": "Antalya",
    "phone": null,
    "company": "",
    "address1": "Avni Tolunay Cad. No:51 Yakup Çavuş Sitesi B Blok K:1 D:2",
    "address2": "",
    "cityCode": 7,
    "countyId": 0,
    "district": "Muratpaşa",
    "fullName": "Hülya Kahramanoğlu",
    "lastName": "Kahramanoğlu",
    "firstName": "Hülya",
    "stateName": "",
    "countyName": "",
    "districtId": 1048,
    "postalCode": "07000",
    "countryCode": "TR",
    "fullAddress": "Avni Tolunay Cad. No:51 Yakup Çavuş Sitesi B Blok K:1 D:2     Muratpaşa Antalya",
    "addressLines": {
      "addressLine1": "",
      "addressLine2": ""
    },
    "neighborhood": "Yeşilbahçe Mah",
    "shortAddress": "",
    "neighborhoodId": 8947
  },
  "customerEmail": "pf+aye8yj2r@trendyolmail.com",
  "status": "Shipped"
};

// Test credentials (replace with real ones for actual testing)
const credentials = {
  supplierId: '312549',
  apiKey: process.env.TRENDYOL_API_KEY || 'your-api-key',
  apiSecret: process.env.TRENDYOL_API_SECRET || 'your-api-secret'
};

async function testMapperFix() {
  console.log('=== Testing Trendyol Mapper Fix ===\n');
  
  // Test 1: Basic mapping without images
  console.log('1. Testing basic mapping (without image fetching)...');
  const basicMapped = toOrder(sampleOrder);
  console.log('Basic mapped order:', {
    id: basicMapped.id,
    orderNumber: basicMapped.orderNumber,
    customerName: basicMapped.customerName,
    itemCount: basicMapped.line_items.length,
    firstItem: basicMapped.line_items[0] ? {
      title: basicMapped.line_items[0].title,
      sku: basicMapped.line_items[0].sku,
      image: basicMapped.line_items[0].image || 'NO IMAGE'
    } : null
  });
  
  // Test 2: Enhanced mapping with image fetching
  console.log('\n2. Testing enhanced mapping with image fetching...');
  console.log('Note: This requires valid Trendyol API credentials');
  
  try {
    const ordersWithImages = await mapTrendyolOrdersWithImages([sampleOrder], credentials);
    const enhancedOrder = ordersWithImages[0];
    
    console.log('Enhanced mapped order:', {
      id: enhancedOrder.id,
      orderNumber: enhancedOrder.orderNumber,
      customerName: enhancedOrder.customerName,
      itemCount: enhancedOrder.line_items.length,
      firstItem: enhancedOrder.line_items[0] ? {
        title: enhancedOrder.line_items[0].title,
        sku: enhancedOrder.line_items[0].sku,
        image: enhancedOrder.line_items[0].image || 'NO IMAGE'
      } : null
    });
    
    // Check if images were successfully fetched
    const itemsWithImages = enhancedOrder.line_items.filter(item => item.image && item.image.length > 0);
    console.log(`\nResult: ${itemsWithImages.length} out of ${enhancedOrder.line_items.length} items have images`);
    
    if (itemsWithImages.length > 0) {
      console.log('\n✅ SUCCESS: Images are being fetched correctly!');
      itemsWithImages.forEach((item, index) => {
        console.log(`  Item ${index + 1}: ${item.title}`);
        console.log(`    Image URL: ${item.image}`);
      });
    } else {
      console.log('\n❌ ISSUE: No images were fetched. Check the following:');
      console.log('  1. Are the API credentials correct?');
      console.log('  2. Do the products exist in Trendyol with these barcodes?');
      console.log('  3. Check console logs above for any API errors');
    }
    
  } catch (error) {
    console.error('\n❌ Error during enhanced mapping:', error.message);
    console.log('Make sure you have valid Trendyol API credentials set');
  }
}

// Run the test
testMapperFix();
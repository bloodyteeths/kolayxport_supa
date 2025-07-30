#!/usr/bin/env node

/**
 * Test script for Etsy Chrome Extension Address API
 * Tests the simplified address enrichment endpoint
 */

const fetch = require('node-fetch');

const API_URL = 'http://localhost:3000/api/integrations/etsy/addresses';

// Sample data from extension logs (v5.3 simplified format - only addresses and notes)
const testPayload = {
  orders: [
    {
      orderNumber: "4173818429",
      etsyStoreId: "98765432",
      etsyStoreName: "Adam's Art Store",
      shippingAddress: {
        name: "Adam Greco",
        line1: "",
        line2: "",
        city: "Rye Brook",
        state: "NY",
        postalCode: "",
        country: "US"
      },
      notes: ""
    },
    {
      orderNumber: "4173818430", 
      etsyStoreId: "12345678",
      etsyStoreName: "Sarah's Handmade Shop",
      shippingAddress: {
        name: "Sarah Johnson",
        line1: "123 Main St",
        line2: "Apt 4B",
        city: "New York",
        state: "NY", 
        postalCode: "10001",
        country: "US"
      },
      notes: "Please leave at door | Blue house with white trim"
    }
  ],
  source: 'chrome-extension-v5.3-addresses',
  timestamp: new Date().toISOString()
};

async function testEtsyAPI() {
  console.log('🧪 Testing Etsy Chrome Extension API...\n');
  
  try {
    console.log('📤 Sending request to:', API_URL);
    console.log('📦 Payload:');
    console.log(JSON.stringify(testPayload, null, 2));
    console.log('\n' + '='.repeat(50) + '\n');
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Version': '5.3.0'
      },
      body: JSON.stringify(testPayload)
    });
    
    console.log('📥 Response Status:', response.status, response.statusText);
    console.log('📋 Response Headers:');
    for (const [key, value] of response.headers.entries()) {
      console.log(`  ${key}: ${value}`);
    }
    
    const responseText = await response.text();
    console.log('\n📄 Response Body:');
    console.log(responseText);
    
    // Try to parse as JSON
    try {
      const responseJson = JSON.parse(responseText);
      console.log('\n✅ Parsed JSON Response:');
      console.log(JSON.stringify(responseJson, null, 2));
      
      if (response.ok) {
        console.log('\n🎉 API Test PASSED! No database errors detected.');
        console.log('Extension data format is compatible with server API.');
      } else {
        console.log('\n❌ API Test FAILED!');
        console.log('Error:', responseJson.error || 'Unknown error');
        if (responseJson.message) {
          console.log('Message:', responseJson.message);
        }
      }
    } catch (parseError) {
      console.log('\n⚠️  Response is not valid JSON:');
      console.log('Parse error:', parseError.message);
    }
    
  } catch (error) {
    console.log('\n💥 Request failed:');
    console.log('Error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Make sure the development server is running:');
      console.log('   npm run dev');
    }
  }
}

// Additional test for authentication failure
async function testUnauthenticatedRequest() {
  console.log('\n' + '='.repeat(50));
  console.log('🔒 Testing unauthenticated request (should fail)...\n');
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });
    
    const responseText = await response.text();
    console.log('📥 Response Status:', response.status);
    console.log('📄 Response:', responseText);
    
    if (response.status === 401) {
      console.log('✅ Unauthenticated request correctly rejected');
    } else {
      console.log('⚠️  Expected 401 Unauthorized, got:', response.status);
    }
    
  } catch (error) {
    console.log('Error:', error.message);
  }
}

// Run tests
async function runTests() {
  await testEtsyAPI();
  await testUnauthenticatedRequest();
  
  console.log('\n' + '='.repeat(50));
  console.log('🏁 Test script completed');
  console.log('\nNext steps:');
  console.log('1. If API test passed, the extension should work correctly');
  console.log('2. If API test failed, check the error messages above');
  console.log('3. Install the updated extension: kolayxport-etsy-extension-v5.3-fixed.zip');
}

runTests();
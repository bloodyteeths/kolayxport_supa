const fetch = require('node-fetch');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testTrendyolImages() {
  try {
    const cred = await prisma.credential.findFirst({
      where: {
        trendyolApiKey: { not: null },
        trendyolApiSecret: { not: null },
        trendyolSupplierId: { not: null }
      }
    });

    if (!cred) {
      console.error('No credential found with Trendyol credentials');
      return;
    }

    console.log('Found credential for user:', cred.userId);
    console.log('Supplier ID:', cred.trendyolSupplierId);

    // Test with the barcode from the debug output
    const testBarcode = '8683851366772';
    
    console.log(`Testing product image fetch for barcode: ${testBarcode}`);
    
    const auth = 'Basic ' + Buffer.from(`${cred.trendyolApiKey}:${cred.trendyolApiSecret}`).toString('base64');
    const url = `https://apigw.trendyol.com/integration/product/sellers/${cred.trendyolSupplierId}/products?barcode=${testBarcode}`;

    console.log('Fetching from URL:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': auth,
        'User-Agent': 'KolayXport-TrendyolIntegration/1.0'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    console.log('Product API response:', JSON.stringify(data, null, 2));
    
    if (data.content && data.content.length > 0) {
      const product = data.content[0];
      console.log('\n=== PRODUCT DETAILS ===');
      console.log('Barcode:', product.barcode);
      console.log('Images:', product.images);
      console.log('First image URL:', product.images?.[0]?.url || 'NOT FOUND');
    } else {
      console.log('No products found for this barcode');
    }

    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

testTrendyolImages(); 
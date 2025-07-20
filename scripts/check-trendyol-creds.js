const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTrendyolCredentials() {
  try {
    const userId = 'f0cb1c43-f30d-4f31-9a96-a9940ebada2d'; // User ID from logs
    
    // Check credentials in database
    const credentials = await prisma.credential.findUnique({
      where: { userId }
    });
    
    console.log('User credentials found:', !!credentials);
    
    if (credentials) {
      console.log('Credential details:', {
        hasVeeqoApiKey: !!credentials.veeqoApiKey,
        hasShippoToken: !!credentials.shippoToken,
        hasTrendyolApiKey: !!credentials.trendyolApiKey,
        hasTrendyolApiSecret: !!credentials.trendyolApiSecret,
        hasTrendyolSupplierId: !!credentials.trendyolSupplierId,
        trendyolApiKey: credentials.trendyolApiKey ? `${credentials.trendyolApiKey.substring(0, 10)}...` : null,
        trendyolSupplierId: credentials.trendyolSupplierId
      });
    }
    
    // Check environment variables
    console.log('Environment variables:', {
      MARKETPLACE_TRENDYOL: process.env.MARKETPLACE_TRENDYOL,
      ALLOW_TRENDYOL_USERS: process.env.ALLOW_TRENDYOL_USERS
    });
    
    // Test isTrendyolEnabled function
    const { isTrendyolEnabled } = require('../lib/config');
    console.log('isTrendyolEnabled(userId):', isTrendyolEnabled(userId));
    console.log('isTrendyolEnabled(undefined):', isTrendyolEnabled());
    
  } catch (error) {
    console.error('Error checking credentials:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTrendyolCredentials();
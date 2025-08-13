#!/usr/bin/env tsx

/**
 * Test Etsy OAuth configuration and credentials with token refresh
 * Usage: tsx scripts/test-etsy-oauth.ts
 */

import { EtsyClient } from '../lib/integrations/etsyClient';
import prisma from '../lib/prisma';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function testEtsyOAuth() {
  console.log('🧪 Testing Etsy OAuth Configuration with Token Refresh...\n');

  try {
    // 1. Check environment variables
    const apiKey = process.env.ETSY_API_KEY;
    const clientSecret = process.env.ETSY_CLIENT_SECRET;
    
    console.log('🔑 Environment Variables:');
    console.log(`   ETSY_API_KEY: ${apiKey ? '✅ Set' : '❌ Missing'}`);
    console.log(`   ETSY_CLIENT_SECRET: ${clientSecret ? '✅ Set' : '❌ Missing'}`);
    console.log();

    if (!apiKey || !clientSecret) {
      console.error('❌ Missing required environment variables. Please add to .env.local:');
      console.error('   ETSY_API_KEY=your-api-key');  
      console.error('   ETSY_CLIENT_SECRET=your-client-secret');
      return;
    }

    // 2. Check OAuth endpoints accessibility
    console.log('🌐 Testing OAuth Endpoints...');
    
    const authUrl = `https://www.etsy.com/oauth/connect?response_type=code&redirect_uri=${encodeURIComponent('http://localhost:3000/api/integrations/etsy/callback')}&scope=transactions_r%20transactions_w&client_id=${apiKey}&state=test&code_challenge=test&code_challenge_method=S256`;
    
    console.log('✅ OAuth authorization URL constructed:');
    console.log(`   ${authUrl.substring(0, 100)}...`);
    console.log();

    // 3. Find users with Etsy credentials
    const usersWithEtsy = await prisma.credential.findMany({
      where: {
        etsyAccessToken: { not: null }
      },
      select: {
        userId: true,
        etsyShopId: true,
        etsyTokenExpiresAt: true,
        user: {
          select: {
            email: true,
            name: true
          }
        }
      }
    });

    console.log(`👥 Users with Etsy credentials: ${usersWithEtsy.length}`);
    
    if (usersWithEtsy.length === 0) {
      console.log('ℹ️  No users have connected Etsy yet.');
      console.log('   To test the integration:');
      console.log('   1. Start the development server: npm run dev');
      console.log('   2. Go to /ayarlar page');
      console.log('   3. Click "🔗 Etsy Shop Bağla" button');
      console.log('   4. Complete OAuth flow');
      console.log('   5. Run this test again');
      return;
    }

    // 4. Test credentials validation for each user
    for (const credential of usersWithEtsy) {
      console.log(`\n🔍 Testing credentials for ${credential.user?.name || credential.user?.email}:`);
      console.log(`   Shop ID: ${credential.etsyShopId}`);
      console.log(`   Token expires: ${credential.etsyTokenExpiresAt ? new Date(credential.etsyTokenExpiresAt).toLocaleString('tr-TR') : 'Unknown'}`);

      if (!credential.etsyShopId) {
        console.log('   ⚠️  Missing shop ID');
        continue;
      }

      const fullCredential = await prisma.credential.findFirst({
        where: { userId: credential.userId },
        select: {
          etsyAccessToken: true,
          etsyRefreshToken: true,
          etsyShopId: true,
          etsyTokenExpiresAt: true
        }
      });

      if (!fullCredential?.etsyAccessToken) {
        console.log('   ❌ Missing access token');
        continue;
      }

      // Check if token is expired or will expire soon
      const now = new Date();
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
      const tokenExpired = fullCredential.etsyTokenExpiresAt ? fullCredential.etsyTokenExpiresAt <= now : false;
      const tokenExpiringSoon = fullCredential.etsyTokenExpiresAt ? fullCredential.etsyTokenExpiresAt <= fiveMinutesFromNow : false;

      console.log(`   🕒 Token status: ${tokenExpired ? '❌ Expired' : tokenExpiringSoon ? '⚠️ Expires soon' : '✅ Valid'}`);
      
      if (fullCredential.etsyRefreshToken) {
        console.log('   🔄 Refresh token available');
      } else {
        console.log('   ⚠️  No refresh token - re-authentication needed if expired');
      }

      try {
        // Create token refresh callback for testing
        const onTokenRefresh = async (newCredentials: any) => {
          console.log('   🔄 Token refresh callback triggered!');
          console.log(`   📝 Updating database with new token (expires: ${newCredentials.tokenExpiresAt?.toLocaleString('tr-TR')})`);
          
          await prisma.credential.update({
            where: { userId: credential.userId },
            data: {
              etsyAccessToken: newCredentials.accessToken,
              etsyRefreshToken: newCredentials.refreshToken,
              etsyTokenExpiresAt: newCredentials.tokenExpiresAt
            }
          });
        };

        const etsyClient = new EtsyClient({
          accessToken: fullCredential.etsyAccessToken,
          refreshToken: fullCredential.etsyRefreshToken || undefined,
          shopId: fullCredential.etsyShopId!,
          tokenExpiresAt: fullCredential.etsyTokenExpiresAt || undefined
        }, onTokenRefresh);

        const isValid = await etsyClient.validateCredentials();
        console.log(`   ${isValid ? '✅ Valid credentials (after any necessary refresh)' : '❌ Invalid credentials'}`);
        
        if (isValid) {
          console.log('   💡 Ready for tracking submissions');
        } else {
          console.log('   🔄 May need re-authentication');
        }

      } catch (error: any) {
        console.log(`   ❌ Validation failed: ${error.message}`);
        
        if (error.message.includes('refresh_token')) {
          console.log('   💡 Refresh token may be expired - user needs to re-authenticate');
        }
      }
    }

    console.log('\n✅ Etsy OAuth with token refresh test completed');
    console.log('\n📋 Token expiration facts:');
    console.log('   • Access tokens expire after 1 hour (3600 seconds)');
    console.log('   • Refresh tokens last for 90 days');
    console.log('   • Auto-refresh happens 5 minutes before expiration');
    console.log('   • 401 responses trigger immediate refresh attempt');
    console.log('\n📋 Next steps:');
    console.log('   - Use test-etsy-tracking.ts to test actual tracking submission');
    console.log('   - Check /ayarlar page for Etsy connection status');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testEtsyOAuth()
  .then(() => {
    console.log('\n🏁 Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
  });
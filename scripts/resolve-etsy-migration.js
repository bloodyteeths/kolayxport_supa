#!/usr/bin/env node

/**
 * Script to resolve the Etsy migration conflict
 * This marks the migration as applied without running it since columns already exist
 */

const { PrismaClient } = require('@prisma/client');

async function resolveEtsyMigration() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 Checking if Etsy columns exist...');
    
    // Try to query the Etsy columns to see if they exist
    const result = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Credential' 
      AND column_name IN ('etsyAccessToken', 'etsyRefreshToken', 'etsyShopId', 'etsyTokenExpiresAt')
      ORDER BY column_name;
    `;
    
    console.log('📊 Found Etsy columns:', result);
    
    if (result.length === 4) {
      console.log('✅ All Etsy columns already exist in database');
      
      // Mark the migration as applied without running it
      await prisma.$executeRaw`
        INSERT INTO "_prisma_migrations" (id, checksum, migration_name, logs, rolled_back_at, started_at, applied_steps_count, finished_at)
        VALUES (
          '20250813000000_add_etsy_oauth_credentials',
          'migration_checksum_placeholder',
          '20250813000000_add_etsy_oauth_credentials',
          '',
          NULL,
          NOW(),
          1,
          NOW()
        )
        ON CONFLICT (id) DO NOTHING;
      `;
      
      console.log('✅ Migration marked as resolved');
    } else {
      console.log('❌ Not all Etsy columns exist. Manual intervention needed.');
      console.log('   Expected 4 columns, found:', result.length);
    }
    
  } catch (error) {
    console.error('❌ Error resolving migration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resolveEtsyMigration();
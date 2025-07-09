
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import prisma from '../lib/prisma';

dotenv.config();

// Debug logging for environment variables
console.log('Environment Variables:');
console.log('TEST_USER_EMAIL:', process.env.TEST_USER_EMAIL);
console.log('NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Present' : 'Missing');

const TEST_USER_ID = '16347b7d-ed21-444c-bed3-db433871140c';
const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test@example.com';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'testpassword123';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface SyncOperation {
  id: string;
  type: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  metrics: any;
}

interface SyncLog {
  level: string;
  message: string;
  error?: string;
  details?: any;
}

interface SyncResult {
  added?: number;
  updated?: number;
  total?: number;
  imported?: number;
  error?: string;
  syncOperationId?: string;
}

async function authenticate() {
  console.log('Authenticating...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (error) {
    throw new Error(`Authentication failed: ${error.message}`);
  }

  console.log('Authentication successful');
  return data.session?.access_token;
}

async function testSyncEndpoint(endpoint: string, body: any, token: string): Promise<SyncResult | null> {
  console.log(`\nTesting ${endpoint}...`);
  try {
    const response = await fetch(`http://localhost:3000${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Cookie': `sb-access-token=${token}; sb-refresh-token=${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`Error response from ${endpoint}:`, errorData);
      return { error: errorData.error || 'Request failed' };
    }

    const data = await response.json();
    console.log('Response:', data);
    return data;
  } catch (error) {
    console.error(`Error testing ${endpoint}:`, error);
    return null;
  }
}

async function verifySyncOperation(syncId: string) {
  const syncOp = await prisma.$queryRaw<SyncOperation[]>`
    SELECT * FROM "SyncOperation"
    WHERE id = ${syncId}
  `;

  if (!syncOp || !syncOp[0]) {
    console.error('Sync operation not found');
    return;
  }

  const sync = syncOp[0];
  console.log('\nSync Operation Details:');
  console.log('ID:', sync.id);
  console.log('Type:', sync.type);
  console.log('Status:', sync.status);
  console.log('Created At:', sync.createdAt);
  console.log('Updated At:', sync.updatedAt);
  console.log('Metrics:', JSON.stringify(sync.metrics, null, 2));

  // Get related logs
  const logs = await prisma.$queryRaw<SyncLog[]>`
    SELECT * FROM "SyncLog"
    WHERE "userId" = ${TEST_USER_ID}
    AND operation = ${sync.type}
    ORDER BY timestamp DESC
    LIMIT 5
  `;

  console.log('\nRecent Sync Logs:');
  logs.forEach((log: SyncLog) => {
    console.log(`[${log.level}] ${log.message}`);
    if (log.error) console.log('Error:', log.error);
    if (log.details) console.log('Details:', JSON.stringify(log.details, null, 2));
  });
}

async function main() {
  try {
    // Authenticate first
    const token = await authenticate();
    if (!token) {
      throw new Error('Failed to get authentication token');
    }

    // Test recent orders sync
    const recentSync = await testSyncEndpoint('/api/orders/sync-recent', {
      marketplace: 'shippo',
    }, token);
    if (recentSync?.error) {
      console.error('Recent orders sync failed:', recentSync.error);
    } else {
      console.log('Recent orders sync completed:', recentSync);
      if (recentSync?.syncOperationId) {
        await verifySyncOperation(recentSync.syncOperationId);
      }
    }

    // Test label sync
    const labelSync = await testSyncEndpoint('/api/orders/label-shippo-sync', {}, token);
    if (labelSync?.error) {
      console.error('Label sync failed:', labelSync.error);
    } else {
      console.log('Label sync completed:', labelSync);
      if (labelSync?.syncOperationId) {
        await verifySyncOperation(labelSync.syncOperationId);
      }
    }

    // Test product sync
    const productSync = await testSyncEndpoint('/api/products/sync', {
      marketplaceType: 'shippo',
    }, token);
    if (productSync?.error) {
      console.error('Product sync failed:', productSync.error);
    } else {
      console.log('Product sync completed:', productSync);
      if (productSync?.syncOperationId) {
        await verifySyncOperation(productSync.syncOperationId);
      }
    }

    // Get latest sync operations
    const latestSyncs = await prisma.$queryRaw<SyncOperation[]>`
      SELECT * FROM "SyncOperation"
      WHERE "userId" = ${TEST_USER_ID}
      ORDER BY "createdAt" DESC
      LIMIT 3
    `;

    console.log('\nLatest Sync Operations:');
    for (const sync of latestSyncs) {
      await verifySyncOperation(sync.id);
    }
  } catch (error) {
    console.error('Test script failed:', error);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect()); 
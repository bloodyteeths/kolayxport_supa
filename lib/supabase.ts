import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Support both NEXT_PUBLIC_ prefixed and unprefixed env vars
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;

let adminInstance: SupabaseClient | null = null;

/**
 * Service-role Supabase client for server-only logic (e.g., Storage uploads).
 * Auth is handled by NextAuth — this client is only for Supabase Storage or
 * other non-auth Supabase features.
 */
export const supabaseAdmin = () => {
  if (typeof window !== 'undefined') {
    throw new Error('supabaseAdmin should not be called on the client-side.');
  }

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    const errorMessage = 'Missing SUPABASE_SERVICE_ROLE_KEY for admin client.';
    console.error(`CRITICAL: ${errorMessage}`);
    throw new Error(errorMessage);
  }

  if (!URL) {
    throw new Error('Missing SUPABASE_URL for admin client.');
  }

  if (!adminInstance) {
    adminInstance = createClient(URL, SERVICE_KEY);
  }
  return adminInstance;
};

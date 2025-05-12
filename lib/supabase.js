import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Client-side accessible keys check (must be available for any import)
if (!URL || !ANON) {
  const errorMessage = 'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.';
  if (process.env.NODE_ENV === 'development') {
    throw new Error(`${errorMessage} Check .env.local`);
  } else {
    console.error(`CRITICAL: ${errorMessage}`);
    // Throwing here will stop client-side execution if public keys are missing.
    throw new Error(`Critical public Supabase environment variables are missing.`); 
  }
}

// Client-side (browser) Supabase client
export const supabase = createBrowserClient(URL, ANON);

let adminInstance = null;

// 1) service-role client for server-only logic (lazy initialization)
export const supabaseAdmin = () => {
  if (typeof window !== 'undefined') {
    // This function should not be called on the client.
    // If it is, it's a programming error.
    throw new Error('supabaseAdmin should not be called on the client-side.');
  }

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    const errorMessage = 'Missing SUPABASE_SERVICE_ROLE_KEY for admin client.';
    console.error(`CRITICAL: ${errorMessage}`);
    throw new Error(errorMessage);
  }

  if (!adminInstance) {
    // URL is confirmed to exist by the module-level check
    adminInstance = createClient(URL, SERVICE_KEY);
  }
  return adminInstance;
};

// 2) pages-router helper for req/res session routes
export function getSupabaseServerClient(req, res) {
  if (typeof window !== 'undefined') {
    // This function should not be called on the client.
    // If it is, it's a programming error.
    throw new Error('getSupabaseServerClient should not be called on the client-side.');
  }
  // URL and ANON are confirmed to exist by the module-level check
  return createPagesServerClient({ supabaseUrl: URL, supabaseKey: ANON, req, res })
} 
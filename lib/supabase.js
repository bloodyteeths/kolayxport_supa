import { createClient } from '@supabase/supabase-js';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  // Throw an error during development if keys are missing
  if (process.env.NODE_ENV === 'development') {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY. Check .env.local');
  } else {
    // Log error in production but don't necessarily throw to avoid breaking server start
    console.error('CRITICAL: Missing Supabase environment variables for client.');
    // In a real production scenario, you might have more sophisticated error handling here,
    // potentially preventing the app from starting or alerting administrators.
    // For now, throwing an error here will make it obvious during deployment if keys are missing.
    throw new Error('Critical Supabase environment variables are missing.'); 
  }
}

// 1) service-role client for server-only logic
export const supabaseAdmin = createClient(URL, SERVICE);

// 2) pages-router helper for req/res session routes
export function getSupabaseServerClient(req, res) {
  return createPagesServerClient({ supabaseUrl: URL, supabaseKey: ANON, req, res });
} 
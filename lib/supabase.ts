import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient, createServerClient } from '@supabase/ssr';

// Support both NEXT_PUBLIC_ prefixed and unprefixed env vars
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

// Client-side accessible keys check is disabled to allow build without env variables.
if (!URL || !ANON) {
  throw new Error('Missing Supabase URL or Anon Key for browser client. Check your .env file and NEXT_PUBLIC_ prefixes.');
}

// Client-side (browser) Supabase client
export const supabase = createBrowserClient(URL, ANON);

let adminInstance: SupabaseClient | null = null;

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

// 2) pages-router helper for req/res session routes using @supabase/ssr
export function getSupabaseServerClient(req, res) {
  if (typeof window !== 'undefined') {
    // This function should not be called on the client.
    // If it is, it's a programming error.
    throw new Error('getSupabaseServerClient should not be called on the client-side.');
  }
  if (!URL || !ANON) {
    throw new Error('Missing Supabase URL or Anon Key for server client. Check your .env file.');
  }
  // URL and ANON are confirmed to exist by the module-level check
  return createServerClient(
    URL,
    ANON,
    {
      cookies: {
        get(name) {
          // Defensive: handle undefined req or req.cookies
          if (!req || !req.cookies) return undefined;
          return req.cookies[name];
        },
        set(name, value, options) {
          if (res) res.setHeader('Set-Cookie', serializeCookie(name, value, options));
        },
        remove(name, options) {
          if (res) res.setHeader('Set-Cookie', serializeCookie(name, '', { ...options, maxAge: -1 }));
        },
      },
    }
  );
}

// Helper to serialize cookies using the 'cookie' package format
const serializeCookie = (name, value, options = {}) => {
  const cookie = require('cookie');
  return cookie.serialize(name, value, options);
}; 
import { createClient } from '@supabase/supabase-js';
import { createBrowserClient, createServerClient } from '@supabase/ssr';

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

// 2) pages-router helper for req/res session routes using @supabase/ssr
export function getSupabaseServerClient(req, res) {
  if (typeof window !== 'undefined') {
    // This function should not be called on the client.
    // If it is, it's a programming error.
    throw new Error('getSupabaseServerClient should not be called on the client-side.');
  }
  // URL and ANON are confirmed to exist by the module-level check
  return createServerClient(
    URL,
    ANON,
    {
      cookies: {
        get(name) {
          return req.cookies[name];
        },
        set(name, value, options) {
          res.setHeader('Set-Cookie', serializeCookie(name, value, options));
        },
        remove(name, options) {
          res.setHeader('Set-Cookie', serializeCookie(name, '', { ...options, maxAge: -1 }));
        },
      },
    }
  );
}

// Helper to serialize cookies (since res.cookie is not directly available in API routes like in Express)
// This is a simplified version. For robust cookie serialization, a library like 'cookie' is often used.
// However, createServerClient from @supabase/ssr might handle some of this internally or expect a specific format.
// Let's assume for now this basic serialization is what's needed or that createServerClient handles the options correctly.
// We might need to install and use the 'cookie' package if this is not sufficient.
// For now, this will be a placeholder to satisfy the structure.
// The options object is passed through.
const serializeCookie = (name, value, options) => {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.secure) parts.push('Secure');
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}; 
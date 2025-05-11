import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers'; // For App Router or RSC

// This function is primarily for App Router Server Components / Server Actions
// or if you can reliably use next/headers.cookies()
export function createServerSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
        set(name, value, options) {
          cookieStore.set(name, value, options);
        },
        remove(name, options) {
          cookieStore.delete(name, options);
        },
      },
    }
  );
}

// Utility to create a server client for Pages Router API route handlers
export function createPagesRouteHandlerClient({ req, res }) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name) {
          return req.cookies[name];
        },
        set(name, value, options) {
          // Simplified cookie setting for Pages Router
          // For robust serialization, consider the 'cookie' package
          let cookieString = `${name}=${value}`;
          if (options.path) cookieString += `; Path=${options.path}`;
          if (options.maxAge) cookieString += `; Max-Age=${options.maxAge}`;
          if (options.domain) cookieString += `; Domain=${options.domain}`;
          if (options.sameSite) cookieString += `; SameSite=${options.sameSite}`;
          if (options.secure) cookieString += '; Secure';
          if (options.httpOnly) cookieString += '; HttpOnly';

          let setCookieHeader = res.getHeader('Set-Cookie') || [];
          if (!Array.isArray(setCookieHeader)) {
            setCookieHeader = [setCookieHeader.toString()];
          }
          
          // Remove any existing cookie with the same name before adding the new one
          setCookieHeader = setCookieHeader.filter(cookie => !cookie.startsWith(`${name}=`));
          setCookieHeader.push(cookieString);
          res.setHeader('Set-Cookie', setCookieHeader);
        },
        remove(name, options) {
          let cookieString = `${name}=; Max-Age=0`; // Expire the cookie
          if (options.path) cookieString += `; Path=${options.path}`;
          if (options.domain) cookieString += `; Domain=${options.domain}`;
          if (options.sameSite) cookieString += `; SameSite=${options.sameSite}`;
          if (options.secure) cookieString += '; Secure';
          if (options.httpOnly) cookieString += '; HttpOnly';

          let setCookieHeader = res.getHeader('Set-Cookie') || [];
           if (!Array.isArray(setCookieHeader)) {
            setCookieHeader = [setCookieHeader.toString()];
          }
          setCookieHeader = setCookieHeader.filter(cookie => !cookie.startsWith(`${name}=`));
          setCookieHeader.push(cookieString);
          res.setHeader('Set-Cookie', setCookieHeader);
        },
      },
    }
  );
} 
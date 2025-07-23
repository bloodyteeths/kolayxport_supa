import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    checks: {
      envVars: {
        hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasSupabaseAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        hasSupabaseService: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        hasDirectUrl: !!process.env.DIRECT_URL,
      },
      headers: {
        hasCookieHeader: !!req.headers.cookie,
        cookieLength: req.headers.cookie?.length || 0,
        userAgent: req.headers['user-agent']?.slice(0, 50),
      },
      cookies: {},
      auth: {
        authenticated: false,
        error: null,
        userId: null,
      },
      database: {
        connected: false,
        error: null,
      },
    },
  };

  // Check cookies
  try {
    if (req.headers.cookie) {
      const cookies = req.headers.cookie.split(';').map(c => c.trim());
      diagnostics.checks.cookies = {
        count: cookies.length,
        hasSupabaseCookie: cookies.some(c => c.includes('sb-')),
        hasAuthCookie: cookies.some(c => c.includes('auth')),
        cookieNames: cookies.map(c => c.split('=')[0]).filter(name => 
          name.includes('sb-') || name.includes('auth')
        ),
      };
    }
  } catch (error: any) {
    diagnostics.checks.cookies = { error: error.message };
  }

  // Check Supabase auth
  try {
    const supabase = getSupabaseServerClient(req, res);
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (user) {
      diagnostics.checks.auth = {
        authenticated: true,
        error: null,
        userId: user.id,
      };
    } else {
      diagnostics.checks.auth = {
        authenticated: false,
        error: error?.message || 'No user found',
        userId: null,
      };
    }
  } catch (error: any) {
    diagnostics.checks.auth = {
      authenticated: false,
      error: error.message,
      userId: null,
    };
  }

  // Check database connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    diagnostics.checks.database = {
      connected: true,
      error: null,
    };
  } catch (error: any) {
    diagnostics.checks.database = {
      connected: false,
      error: error.message,
    };
  }

  res.status(200).json(diagnostics);
}
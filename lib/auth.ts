import { getServerSession } from 'next-auth';
import { decode } from 'next-auth/jwt';
import { NextApiRequest, NextApiResponse } from 'next';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '@/lib/prisma';

// PrismaAdapter is only needed for OAuth (Google) to auto-create User + Account records.
// We wrap it to prevent it from interfering with CredentialsProvider sign-in,
// which is a known NextAuth issue when combining adapter + credentials + JWT strategy.
const prismaAdapter = PrismaAdapter(prisma);

export const authOptions = {
  adapter: prismaAdapter,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const normalizedEmail = credentials.email.toLowerCase().trim();

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });
        if (!user || !user.password) return null;

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt' as const,
  },
  pages: {
    signIn: '/login',
  },
  events: {
    async createUser({ user }: any) {
      // Auto-provision 30-day trial for new users (Google OAuth)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionPlan: 'trial',
          subscriptionStatus: 'trialing',
          trialExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          orderSyncCount: 0,
          labelCount: 0,
        },
      });
    },
  },
  callbacks: {
    async signIn({ user, account }: any) {
      // For credentials provider, skip adapter session/account creation
      // The adapter should only handle OAuth account linking
      if (account?.provider === 'credentials') {
        return !!user;
      }
      return true;
    },
    async jwt({ token, user }: any) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (token?.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};

/**
 * Get the authenticated user from NextAuth session or Bearer token.
 * Supports: cookie-based session (browser) and Authorization: Bearer (extension/API).
 * Returns { id, email, name } or null if not authenticated.
 */
export async function getAuthUser(req: NextApiRequest, res: NextApiResponse) {
  // 1. Try cookie-based NextAuth session (normal browser requests)
  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.id) {
    return { id: session.user.id, email: session.user.email, name: session.user.name };
  }

  // 2. Try Authorization: Bearer token (Chrome extension / API clients)
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  // Also check X-Extension-Auth header
  const extToken = (req.headers['x-extension-auth'] as string) || null;
  const token = bearerToken || extToken;

  if (token && token !== 'session-detected') {
    try {
      // Decode NextAuth JWT (encrypted with NEXTAUTH_SECRET)
      const decoded = await decode({
        token,
        secret: process.env.NEXTAUTH_SECRET!,
      });
      if (decoded?.sub) {
        return { id: decoded.sub, email: decoded.email as string, name: decoded.name as string };
      }
    } catch {
      // Token is not a valid NextAuth JWT — ignore
    }
  }

  return null;
}

/**
 * Constant-time compare two strings. Returns false on length mismatch.
 */
function safeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

const CUID_RE = /^c[a-z0-9]{20,}$/i;

/**
 * Extract the internal API key strictly from HTTP headers.
 *   - Authorization: Bearer <key>
 *   - X-Internal-Api-Key: <key>
 *
 * The legacy X-Api-Key header is also accepted during the migration; query/body keys
 * are explicitly rejected because they leak through proxy/CDN logs and browser history.
 */
function readInternalApiKeyFromHeaders(req: NextApiRequest): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const internal = req.headers['x-internal-api-key'];
  if (typeof internal === 'string' && internal.trim()) return internal.trim();
  const legacy = req.headers['x-api-key'];
  if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
  return null;
}

/**
 * Authenticate via session OR internal API key (header-only).
 *
 * Used by internal API routes that must support both browser and script access.
 *
 * Hardening notes:
 *   - The API key is accepted only from request headers (Authorization: Bearer,
 *     X-Internal-Api-Key, or legacy X-Api-Key). Query string and request body are
 *     explicitly rejected because they leak through CDN/proxy logs and browser history.
 *   - The comparison uses crypto.timingSafeEqual to avoid leaking the key one byte at a time.
 *   - The acting user id must be supplied via the X-User-Id header and must look like a CUID.
 *   - Responses authenticated this way are marked Cache-Control: no-store, private.
 *   - Both CLAWD_API_KEY (legacy) and KOLAYXPORT_INTERNAL_API_KEY (new name) are accepted so
 *     the env var can be renamed without coordinated changes across ~30 callers.
 */
export async function getAuthUserOrApiKey(req: NextApiRequest, res: NextApiResponse) {
  const presented = readInternalApiKeyFromHeaders(req);

  if (presented) {
    const candidates = [
      process.env.KOLAYXPORT_INTERNAL_API_KEY,
      process.env.CLAWD_API_KEY,
    ].filter((k): k is string => typeof k === 'string' && k.length > 0);

    let matched = false;
    for (const candidate of candidates) {
      if (safeEqualStr(presented, candidate)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      const headerUserId = req.headers['x-user-id'];
      const userId = typeof headerUserId === 'string' ? headerUserId.trim() : '';
      if (!userId || !CUID_RE.test(userId)) {
        // Don't write a response here — let the caller emit its standard 401.
        // The mark headers are still useful so any cache/proxy treats the response as private.
        res.setHeader('Cache-Control', 'no-store, private');
        res.setHeader('Vary', 'Authorization');
        return null;
      }
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('Vary', 'Authorization');
      return { id: userId, email: null, name: null };
    }
  }

  return getAuthUser(req, res);
}

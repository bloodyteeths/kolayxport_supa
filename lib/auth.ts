import { getServerSession } from 'next-auth';
import { decode, encode } from 'next-auth/jwt';
import { NextApiRequest, NextApiResponse } from 'next';
import GoogleProvider from 'next-auth/providers/google';
import AppleProvider from 'next-auth/providers/apple';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { credentialsAuthorize } from '@/lib/auth/credentials';
import { newTrialExpiry } from '@/lib/billing/planLimits';
import { appleClientSecret, appleConfigured } from '@/lib/auth/appleSecret';

// PrismaAdapter is only needed for OAuth (Google) to auto-create User + Account records.
// We wrap it to prevent it from interfering with CredentialsProvider sign-in,
// which is a known NextAuth issue when combining adapter + credentials + JWT strategy.
const baseAdapter = PrismaAdapter(prisma);
// User.id has no DB default (our signup generates a uuid), so the stock adapter's createUser failed with
// "Argument `id` is missing" and every first Google/Apple sign-in bounced back to /login.
// The provider has verified the email, so it counts as verified here.
const prismaAdapter = {
  ...baseAdapter,
  createUser: ({ id: _ignored, ...data }: any) =>
    prisma.user.create({
      data: { ...data, id: crypto.randomUUID(), emailVerified: data.emailVerified ?? new Date() },
    }),
};

/** Claim that marks a JWT as an extension Bearer token. */
const EXTENSION_TOKEN_CLAIM = 'kx_ext';

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
        // Logic extracted into lib/auth/credentials.ts for testability.
        // Throws `EMAIL_NOT_VERIFIED` when the password is correct but the email
        // has not been verified yet — login UI watches for that exact code.
        return credentialsAuthorize(credentials?.email, credentials?.password);
      },
    }),
    // Sign in with Apple (App Store guideline 4.8). Only when its keys are set (lib/auth/appleSecret.ts).
    ...(appleConfigured()
      ? [AppleProvider({ clientId: process.env.APPLE_SERVICES_ID!, clientSecret: appleClientSecret() })]
      : []),
  ],
  // Apple answers with a cross-site form POST (response_mode=form_post), which drops SameSite=Lax cookies, so the
  // short-lived OAuth check cookies are SameSite=None (Secure). Session/CSRF cookies keep NextAuth's defaults.
  cookies: process.env.NODE_ENV === 'production'
    ? Object.fromEntries((['pkceCodeVerifier', 'state', 'nonce'] as const).map((k) => [k, {
        name: `__Secure-next-auth.${k === 'pkceCodeVerifier' ? 'pkce.code_verifier' : k}`,
        options: { httpOnly: true, sameSite: 'none' as const, path: '/', secure: true, maxAge: 900 },
      }]))
    : undefined,
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt' as const,
  },
  pages: {
    signIn: '/login',
  },
  events: {
    async createUser({ user }: any) {
      // Auto-provision the trial for new users (Google OAuth)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionPlan: 'trial',
          subscriptionStatus: 'trialing',
          trialExpiresAt: newTrialExpiry(),
          usageResetAt: newTrialExpiry(),
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
      // Extension tokens are short-lived Bearer credentials. Never let one be
      // replayed as a session cookie: NextAuth would re-issue it as a rolling
      // 30-day session and bypass its expiry/revocation checks.
      if (token?.[EXTENSION_TOKEN_CLAIM]) {
        return {};
      }
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
export async function getAuthUser(
  req: NextApiRequest,
  res: NextApiResponse,
  opts: { allowBearer?: boolean } = {},
) {
  // 1. Try cookie-based NextAuth session (normal browser requests)
  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.id) {
    return { id: session.user.id, email: session.user.email, name: session.user.name };
  }

  if (opts.allowBearer === false) return null;

  // 2. Try Authorization: Bearer token (Chrome extension).
  //    Only tokens minted by createExtensionToken() are accepted here, and the
  //    user is re-checked against the DB on every request (deleted users and
  //    password changes revoke outstanding extension tokens).
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  // Also check X-Extension-Auth header
  const extToken = (req.headers['x-extension-auth'] as string) || null;
  const token = bearerToken || extToken;

  if (token && token !== 'session-detected') {
    try {
      // Decode NextAuth JWT (encrypted with NEXTAUTH_SECRET). decode() rejects
      // tokens past their `exp`.
      const decoded = await decode({
        token,
        secret: process.env.NEXTAUTH_SECRET!,
      });
      if (decoded?.sub && decoded[EXTENSION_TOKEN_CLAIM]) {
        const dbUser = await prisma.user.findUnique({
          where: { id: decoded.sub },
          select: { id: true, email: true, name: true, password: true },
        });
        if (!dbUser) return null;
        if (decoded.kx_fp !== extensionTokenFingerprint(dbUser.id, dbUser.password)) return null;
        return { id: dbUser.id, email: dbUser.email, name: dbUser.name };
      }
    } catch {
      // Token is not a valid NextAuth JWT — ignore
    }
  }

  return null;
}

/**
 * Extension Bearer token lifetime. The extension caches tokens client-side for
 * up to 7 days (AUTH_TOKEN_MAX_AGE_MS in background-simple.js) and re-fetches a
 * fresh one every time a kolayxport.com tab becomes visible, so 7 days matches
 * its cache window without breaking it, while being far shorter than the
 * previous 30-day full-session token.
 */
export const EXTENSION_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Fingerprint bound into extension tokens. Changes when the user's password
 * hash changes, which revokes every outstanding extension token for that user.
 */
function extensionTokenFingerprint(userId: string, passwordHash: string | null | undefined): string {
  return crypto
    .createHmac('sha256', process.env.NEXTAUTH_SECRET || '')
    .update(`kx-ext-v1:${userId}:${passwordHash || ''}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Mint a short-lived Bearer token for the Chrome extension. Not usable as a
 * session cookie (see jwt callback) and only accepted by getAuthUser's Bearer path.
 */
export async function createExtensionToken(userId: string): Promise<string | null> {
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, password: true },
  });
  if (!dbUser) return null;
  return encode({
    token: {
      sub: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      [EXTENSION_TOKEN_CLAIM]: 1,
      kx_fp: extensionTokenFingerprint(dbUser.id, dbUser.password),
    },
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: EXTENSION_TOKEN_MAX_AGE_SECONDS,
  });
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

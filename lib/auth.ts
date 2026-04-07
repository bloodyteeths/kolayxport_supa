import { getServerSession } from 'next-auth';
import { decode } from 'next-auth/jwt';
import { NextApiRequest, NextApiResponse } from 'next';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

// PrismaAdapter is only needed for OAuth (Google) to auto-create User + Account records.
// We wrap it to prevent it from interfering with CredentialsProvider sign-in,
// which is a known NextAuth issue when combining adapter + credentials + JWT strategy.
const prismaAdapter = PrismaAdapter(prisma);

export const authOptions = {
  debug: true,
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
        console.log('[auth] authorize called with email:', credentials?.email);
        if (!credentials?.email || !credentials?.password) {
          console.log('[auth] missing credentials');
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user || !user.password) {
          console.log('[auth] user not found or no password for:', credentials.email);
          return null;
        }

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) {
          console.log('[auth] invalid password for:', credentials.email);
          return null;
        }

        console.log('[auth] login success for:', user.id, user.email);
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

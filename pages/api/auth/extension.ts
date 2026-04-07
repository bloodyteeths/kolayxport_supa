import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { encode } from 'next-auth/jwt';

/**
 * Chrome Extension Authentication Endpoint
 * Validates NextAuth session and returns a token the extension can use for API calls.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS for extension
  const origin = req.headers.origin;
  if (origin && origin.startsWith('chrome-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUser(req, res);

    if (!user) {
      return res.status(200).json({
        authenticated: false,
        error: 'Not authenticated',
        message: 'Please log in to Kolayxport first'
      });
    }

    // Generate a JWT token the extension can use as Bearer token
    const token = await encode({
      token: { sub: user.id, email: user.email, name: user.name },
      secret: process.env.NEXTAUTH_SECRET!,
    });

    return res.status(200).json({
      authenticated: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email
      },
      message: 'Authentication successful'
    });

  } catch (error) {
    console.error('Extension auth endpoint error:', error);
    return res.status(500).json({
      authenticated: false,
      error: 'Internal server error',
      message: 'Failed to validate authentication'
    });
  }
}

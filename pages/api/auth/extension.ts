import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';

/**
 * Chrome Extension Authentication Endpoint
 * Provides authentication status for Chrome extension
 * Validates the NextAuth session server-side and returns user info
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUser(req, res);

    if (!user) {
      return res.status(401).json({
        authenticated: false,
        error: 'Not authenticated',
        message: 'Please log in to Kolayxport first'
      });
    }

    // Return authentication status with user info
    return res.status(200).json({
      authenticated: true,
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
import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';

/**
 * Chrome Extension Authentication Endpoint
 * Provides authentication status and temporary token for Chrome extension
 * Since httpOnly cookies cannot be accessed by extensions, this endpoint
 * validates the session server-side and returns a temporary auth token
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user from server-side session
    const supabase = getSupabaseServerClient(req, res);
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return res.status(401).json({ 
        authenticated: false, 
        error: 'Not authenticated',
        message: 'Please log in to Kolayxport first'
      });
    }

    // Generate a temporary session token for the extension
    // This token will be used by the extension to authenticate API calls
    const { data: session } = await supabase.auth.getSession();
    
    if (!session?.session?.access_token) {
      return res.status(401).json({ 
        authenticated: false, 
        error: 'No valid session',
        message: 'Session expired, please refresh and try again'
      });
    }

    // Return authentication status with temporary token
    return res.status(200).json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name || user.email
      },
      // Provide the access token for extension use
      token: session.session.access_token,
      expires_at: session.session.expires_at,
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
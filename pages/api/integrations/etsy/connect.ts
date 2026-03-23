import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '@/lib/supabase';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate user
  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Generate PKCE code verifier and challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Store code verifier in session (you'll need this for token exchange)
    // For now, we'll pass it in state (in production, use session storage)
    const state = Buffer.from(JSON.stringify({
      userId: user.id,
      codeVerifier
    })).toString('base64url');

    // Build Etsy OAuth URL
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.ETSY_API_KEY!,
      redirect_uri: process.env.ETSY_REDIRECT_URI!,
      scope: 'transactions_r transactions_w shops_r shops_w address_r email_r listings_r listings_w listings_d profile_r',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const authUrl = `https://www.etsy.com/oauth/connect?${authParams}`;

    logger.info('Initiating Etsy OAuth flow', {
      userId: user.id,
      redirectUri: process.env.ETSY_REDIRECT_URI
    });

    // Redirect to Etsy OAuth
    res.redirect(authUrl);

  } catch (error) {
    logger.error('Failed to initiate Etsy OAuth', 
      error instanceof Error ? error : new Error(String(error)), {
        userId: user.id
      });

    return res.status(500).json({ 
      error: 'Failed to initiate Etsy connection' 
    });
  }
}
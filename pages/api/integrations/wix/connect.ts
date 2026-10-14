import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { signOAuthState } from '@/lib/auth/oauthState';

/** How long an install link stays claimable after it was issued (checked in callback). */
const STATE_TTL_MS = 60 * 60 * 1000;

/**
 * Returns the Wix app install URL. The frontend opens this in a new tab.
 *
 * Uses Wix's external install flow: after install, Wix redirects the user's
 * browser to `postInstallationUrl` (GET /api/integrations/wix/callback) with
 * `instanceId` + `signedInstance`, preserving our own query params. We put an
 * HMAC-signed `state` bound to the current user there, so the callback can only
 * attach the site to the user who started the install — never to "whoever
 * polls first".
 *
 * The frontend then polls POST /api/integrations/wix/callback with `since`
 * until the GET callback has stored the connection.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const appId = process.env.WIX_APP_ID;
  if (!appId) return res.status(500).json({ error: 'Wix app not configured' });

  const now = Date.now();
  const state = signOAuthState({ userId: user.id, exp: now + STATE_TTL_MS });

  const base = process.env.NEXTAUTH_URL || 'https://kolayxport.com';
  const callbackUrl = new URL('/api/integrations/wix/callback', base);
  callbackUrl.searchParams.set('state', state);

  // URLSearchParams percent-encodes postInstallationUrl, as Wix requires.
  const params = new URLSearchParams({ appId, postInstallationUrl: callbackUrl.toString() });
  // Unlisted Wix apps must also pass their share-install-link id.
  if (process.env.WIX_SHARE_URL_ID) params.set('shareUrlId', process.env.WIX_SHARE_URL_ID);
  const installUrl = `https://www.wix.com/app-installer?${params.toString()}`;

  // `since` is server time, so the poller isn't affected by client clock skew.
  return res.status(200).json({ installUrl, since: new Date(now).toISOString() });
}

import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';

/**
 * Returns the Wix app install URL. The frontend opens this in a new tab.
 * After install, the Wix Dashboard Page extension sends instanceId to our webhook.
 * The frontend polls /api/integrations/wix/status until connected.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const appId = process.env.WIX_APP_ID;
  if (!appId) return res.status(500).json({ error: 'Wix app not configured' });

  const installUrl = `https://www.wix.com/installer/install?appId=${appId}`;

  return res.status(200).json({ installUrl, userId: user.id });
}

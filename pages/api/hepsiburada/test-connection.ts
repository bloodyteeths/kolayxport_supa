/**
 * POST /api/hepsiburada/test-connection — live check of the user's saved Hepsiburada credentials.
 *
 * Reads one listing row. 200 `{ ok: true }`, or 200 `{ ok: false, reason }`:
 *   pending     — HB answered 401/403 within 2 h of saving: a new integrator authorization takes up to 2 h to activate
 *   credentials — HB answered 401/403: wrong Mağaza ID / servis anahtarı, or our integrator is not added in the panel
 *   integrator  — our integrator name is not configured on this server
 *   failed      — anything else (network, 5xx)
 * A pass also clears a parked "reconnect" state.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { isAuthFailure, recordAuthFailure, recordAuthSuccess } from '@/lib/integrations/authFailures';
import { hbErrorMessage } from '@/lib/hepsiburada/client';
import { inAuthorizationGrace, loadHepsiburadaClient } from '@/lib/hepsiburada/server';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const loaded = await loadHepsiburadaClient(user.id);
  if (!loaded.ok) {
    if (loaded.reason === 'disabled') return res.status(403).json({ ok: false, reason: 'failed' });
    if (loaded.reason === 'not_configured') return res.status(200).json({ ok: false, reason: 'integrator' });
    return res.status(200).json({ ok: false, reason: 'credentials' });
  }

  try {
    const page = await loaded.client.listListings({ offset: 0, limit: 1 });
    await recordAuthSuccess(user.id, 'hepsiburada', loaded.merchantId);
    return res.status(200).json({ ok: true, totalListings: (page as any)?.totalCount ?? null });
  } catch (err) {
    logger.warn('[HEPSIBURADA] test-connection failed', { userId: user.id, error: hbErrorMessage(err) });
    if (isAuthFailure(err)) {
      // Fresh authorization: don't count it toward "reconnect"; tell the seller to wait.
      if (await inAuthorizationGrace(user.id)) return res.status(200).json({ ok: false, reason: 'pending', error: hbErrorMessage(err) });
      await recordAuthFailure(user.id, 'hepsiburada', loaded.merchantId, err);
      return res.status(200).json({ ok: false, reason: 'credentials', error: hbErrorMessage(err) });
    }
    return res.status(200).json({ ok: false, reason: 'failed', error: hbErrorMessage(err) });
  }
}

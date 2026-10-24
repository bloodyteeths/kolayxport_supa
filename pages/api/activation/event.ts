// POST /api/activation/event { event, provider? } — browser-side activation events (lib/activation/events.ts).
// Session user only; only the client events are accepted; provider is whitelisted. Always answers 204 for a
// valid body (tracking never shows errors to the seller).
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { CLIENT_ACTIVATION_EVENTS, isActivationEvent, isActivationProvider, recordActivation } from '@/lib/activation/events';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).end();
  let body: Record<string, unknown> = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  } catch {
    return res.status(400).end();
  }
  if (!isActivationEvent(body.event) || !CLIENT_ACTIVATION_EVENTS.includes(body.event)) return res.status(400).end();
  const provider = isActivationProvider(body.provider) ? body.provider : null;
  if (body.event === 'connect_click' && !provider) return res.status(400).end();
  const job = typeof body.job === 'string' ? body.job : null;
  const count = typeof body.count === 'number' ? body.count : null;
  recordActivation(user.id, body.event, provider, { job, count });
  return res.status(204).end();
}

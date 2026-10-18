/**
 * Server helpers shared by the Hepsiburada API routes, jobs and adapters: load a user's client (flag + creds +
 * reconnect gate) and map HB errors to HTTP responses.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { isHepsiburadaEnabled } from '@/lib/config';
import { createHepsiburadaClient, hbErrorMessage, hbIntegratorName, isHbError, type HepsiburadaClient } from './client';

export const HB_CREDENTIAL_SELECT = { hepsiburadaMerchantId: true, hepsiburadaApiKey: true } as const;

export type HbClientResult =
  | { ok: true; client: HepsiburadaClient; merchantId: string }
  | { ok: false; reason: 'disabled' | 'not_connected' | 'not_configured' };

/** The user's HB client, or why there is none. Does not check the reconnect gate (callers that loop do). */
export async function loadHepsiburadaClient(userId: string): Promise<HbClientResult> {
  if (!isHepsiburadaEnabled(userId)) return { ok: false, reason: 'disabled' };
  if (!hbIntegratorName()) return { ok: false, reason: 'not_configured' };
  const credential = await prisma.credential.findUnique({ where: { userId }, select: HB_CREDENTIAL_SELECT });
  const client = createHepsiburadaClient(credential);
  if (!client) return { ok: false, reason: 'not_connected' };
  return { ok: true, client, merchantId: client.merchantId };
}

/** Route helper: auth + client, or it has already answered the request. */
export async function requireHepsiburada(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ userId: string; client: HepsiburadaClient; merchantId: string } | null> {
  const user = await getAuthUser(req, res);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const loaded = await loadHepsiburadaClient(user.id);
  if (!loaded.ok) {
    const status = loaded.reason === 'disabled' ? 403 : 400;
    res.status(status).json({ error: `Hepsiburada ${loaded.reason}`, code: `hepsiburada_${loaded.reason}` });
    return null;
  }
  return { userId: user.id, client: loaded.client, merchantId: loaded.merchantId };
}

/** HB error → JSON response, keeping HB's status where it is a client error. */
export function sendHbError(res: NextApiResponse, err: unknown) {
  if (isHbError(err)) {
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    return res.status(status).json({ error: hbErrorMessage(err), hbStatus: err.status, details: err.body });
  }
  return res.status(500).json({ error: hbErrorMessage(err) });
}

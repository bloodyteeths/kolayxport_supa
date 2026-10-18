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
  // Upload limits (lib/hepsiburada/uploads.ts): tell the client to retry later rather than report a failure.
  if ((err as any)?.name === 'HbUploadLimitError') {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: (err as Error).message, code: (err as any).code });
  }
  if (isHbError(err)) {
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    return res.status(status).json({ error: hbErrorMessage(err), hbStatus: err.status, details: err.body });
  }
  return res.status(500).json({ error: hbErrorMessage(err) });
}

/**
 * HB activates a new integrator authorization (panel → Entegratör bilgileri) within about 2 hours, so a 401 in that
 * window is expected, not bad credentials (developer portal FAQ 1/5). Measured from the last credential save.
 */
export const HB_AUTHORIZATION_GRACE_MS = 2 * 60 * 60 * 1000;

export async function inAuthorizationGrace(userId: string, now = Date.now()): Promise<boolean> {
  const row = await prisma.credential.findUnique({ where: { userId }, select: { updatedAt: true } });
  return !!row?.updatedAt && now - row.updatedAt.getTime() < HB_AUTHORIZATION_GRACE_MS;
}

import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from 'lib/prisma';
import { getSupabaseServerClient } from 'lib/supabase';
import { createClient } from '@supabase/supabase-js';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Dual-mode Supabase auth
  let user, authError;
  const supabase = getSupabaseServerClient(req, res);
  const result = await supabase.auth.getUser();
  user = result.data.user;
  authError = result.error;
  if (authError || !user) {
    // Try Authorization header fallback
    const authHeaderRaw = req.headers['authorization'] || req.headers['Authorization'];
    let authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
    const token = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
      const supabaseDirect = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      const { data, error } = await supabaseDirect.auth.getUser(token);
      user = data.user;
      authError = error;
    }
  }
  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const userId = user.id;

  // Pagination params
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const cursor = req.query.cursor as string | undefined; // ISO string

  // Query SyncOperation
  const where: any = { userId };
  if (cursor) {
    where.createdAt = { lt: new Date(cursor) };
  }
  const syncs = await prisma.syncOperation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Format response
  const resultSyncs = syncs.map(sync => {
    const metrics = sync.metrics || {};
    return {
      id: sync.id,
      type: sync.type,
      status: sync.status,
      startedAt: metrics.startTime || sync.createdAt,
      endedAt: metrics.endTime || sync.updatedAt,
      processedOrders: metrics.processedOrders ?? 0,
      successfulOrders: metrics.successfulOrders ?? 0,
      failedOrders: metrics.failedOrders ?? 0,
      errors: metrics.errors ?? [],
    };
  });

  res.status(200).json({
    syncs: resultSyncs,
    nextCursor: resultSyncs.length === limit ? resultSyncs[resultSyncs.length - 1].startedAt : null,
  });
} 
import crypto from 'crypto';
import type { NextApiRequest } from 'next';
import prisma from '@/lib/prisma';
import { redact } from '@/lib/logger';

/**
 * Hash the client IP so the audit log carries a correlator without a raw address.
 * Uses NEXTAUTH_SECRET as a pepper; we don't add a new secret for this.
 */
function hashIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  const ip =
    typeof xff === 'string'
      ? xff.split(',')[0].trim()
      : Array.isArray(xff)
        ? xff[0]
        : (req.socket?.remoteAddress ?? null);
  if (!ip) return null;
  const pepper = process.env.NEXTAUTH_SECRET || 'kolayxport-pepper';
  return crypto.createHash('sha256').update(`${pepper}:${ip}`).digest('hex').slice(0, 32);
}

function userAgent(req: NextApiRequest): string | null {
  const ua = req.headers['user-agent'];
  if (!ua || typeof ua !== 'string') return null;
  return ua.slice(0, 256);
}

export interface AdminAuditInput {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, any>;
}

/**
 * Append an immutable row to AdminAuditLog. Failures are logged but never raised so
 * an audit-write hiccup never blocks a legitimate admin action.
 */
export async function recordAdminAction(
  req: NextApiRequest,
  adminUserId: string,
  input: AdminAuditInput,
): Promise<void> {
  try {
    const safeMetadata = input.metadata ? (redact(input.metadata) as Record<string, any>) : null;
    await (prisma as any).adminAuditLog.create({
      data: {
        adminUserId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: safeMetadata,
        ipHash: hashIp(req),
        userAgent: userAgent(req),
      },
    });
  } catch (err) {
    // Last-resort fallback so the operator can still see something happened.
    // Never throws — the calling handler continues regardless.
    try {
      const { logger } = await import('@/lib/logger');
      logger.event('security', 'warn', 'AdminAuditLog write failed', {
        adminUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
      });
    } catch {
      // swallow — nothing else to do
    }
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { logExtensionEvent, logSecurityEvent } from '@/lib/admin/events';

/**
 * Extension selector-failure telemetry.
 *
 * Hardening:
 *   - Auth required (cookie session or Bearer JWT, same surface as the rest of the app).
 *   - `Access-Control-Allow-Origin: *` removed; origin must be either the official
 *     KolayXport extension (when OFFICIAL_EXTENSION_ID is configured), one of the
 *     official KolayXport hosts, or a localhost in dev.
 *   - Request body is size-capped via Next.js bodyParser config.
 *   - All payload fields flow through the central logger redactor (lib/logger.ts).
 *   - DOM snapshots are dropped unless an explicit `debugMode: true` flag is present,
 *     and even then they are still routed through the redactor.
 */
interface SelectorFailure {
  page: 'search' | 'listing' | 'shop';
  selector: string;
  url: string;
  timestamp: number;
  extensionVersion: string;
  domSnapshot?: string;
}

interface TelemetryBody {
  failures: SelectorFailure[];
  debugMode?: boolean;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '32kb',
    },
  },
};

const ALLOWED_PROD_HOSTS = new Set([
  'https://kolayxport.com',
  'https://www.kolayxport.com',
]);

function isAllowedOrigin(origin: string | undefined): { ok: boolean; reason?: string } {
  if (!origin) return { ok: true };
  if (ALLOWED_PROD_HOSTS.has(origin)) return { ok: true };
  if (origin.startsWith('chrome-extension://')) {
    const officialId = process.env.OFFICIAL_EXTENSION_ID;
    if (!officialId) return { ok: false, reason: 'OFFICIAL_EXTENSION_ID not configured' };
    const expected = `chrome-extension://${officialId}`;
    if (origin === expected || origin === `${expected}/`) return { ok: true };
    return { ok: false, reason: 'unknown extension id' };
  }
  if (
    process.env.NODE_ENV !== 'production' &&
    (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))
  ) {
    return { ok: true };
  }
  return { ok: false, reason: 'origin not allowed' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const origin = req.headers.origin;
  const allow = isAllowedOrigin(origin);

  if (!allow.ok) {
    logSecurityEvent('warn', {
      message: 'Extension telemetry: origin rejected',
      operation: 'telemetry.origin_rejected',
      details: { origin, reason: allow.reason },
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Reflect origin for valid chrome-extension and prod hosts.
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getAuthUser(req, res);
  if (!user) {
    logSecurityEvent('warn', {
      message: 'Extension telemetry: unauthenticated POST',
      operation: 'telemetry.unauthenticated',
      details: { origin },
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { failures, debugMode } = (req.body || {}) as Partial<TelemetryBody>;

    if (!Array.isArray(failures) || failures.length === 0) {
      return res.status(400).json({ error: 'No failures provided' });
    }

    const capped = failures.slice(0, 50);

    // Strip the heavy/sensitive DOM snapshot unless the caller explicitly enables debug mode.
    // Even with debug mode, the field still flows through the logger redactor downstream.
    const sanitized = capped.map(f => ({
      page: f.page,
      selector: f.selector,
      url: typeof f.url === 'string' ? f.url.substring(0, 200) : undefined,
      timestamp: f.timestamp,
      extensionVersion: f.extensionVersion,
      ...(debugMode && typeof f.domSnapshot === 'string'
        ? { domSnapshot: f.domSnapshot.substring(0, 2048) }
        : {}),
    }));

    for (const f of sanitized) {
      logger.warn(`Extension selector failure: ${f.page} — ${f.selector}`, {
        userId: user.id,
        page: f.page,
        selector: f.selector,
        url: f.url,
        extensionVersion: f.extensionVersion,
        domSnapshot: (f as any).domSnapshot,
      });
    }

    const summary = sanitized.reduce((acc, f) => {
      const key = `${f.page}:${f.selector}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    logger.info(`Selector failure batch: ${sanitized.length} failures`, {
      userId: user.id,
      total: sanitized.length,
      summary,
    });
    logExtensionEvent('info', {
      message: `Selector failure batch: ${sanitized.length} failures`,
      operation: 'telemetry.accepted',
      userId: user.id,
      details: { total: sanitized.length, summary },
    });

    return res.status(200).json({ received: sanitized.length });
  } catch (error) {
    logger.error(
      'Telemetry endpoint error',
      error instanceof Error ? error : new Error(String(error)),
    );
    return res.status(500).json({ error: 'Internal error' });
  }
}

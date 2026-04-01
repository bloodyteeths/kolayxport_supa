import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '@/lib/logger';

interface SelectorFailure {
  page: 'search' | 'listing' | 'shop';
  selector: string;
  url: string;
  timestamp: number;
  extensionVersion: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const userId = (req.headers['x-user-id'] as string) || 'anonymous';
    const { failures } = req.body as { failures: SelectorFailure[] };

    if (!Array.isArray(failures) || failures.length === 0) {
      return res.status(400).json({ error: 'No failures provided' });
    }

    const capped = failures.slice(0, 50);

    for (const f of capped) {
      logger.warn(`Extension selector failure: ${f.page} — ${f.selector}`, {
        userId, page: f.page, selector: f.selector,
        url: f.url?.substring(0, 200), extensionVersion: f.extensionVersion,
      });
    }

    const summary = capped.reduce((acc, f) => {
      const key = `${f.page}:${f.selector}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    logger.info(`Selector failure batch: ${capped.length} failures`, { userId, total: capped.length, summary });

    return res.status(200).json({ received: capped.length });
  } catch (error) {
    logger.error('Telemetry endpoint error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Internal error' });
  }
}

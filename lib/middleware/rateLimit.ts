import type { NextApiRequest, NextApiResponse } from 'next';

const rateMap = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateMap) {
    if (val.resetAt < now) rateMap.delete(key);
  }
}, 60_000);

export function rateLimit(windowMs: number, maxRequests: number) {
  return function checkRate(req: NextApiRequest, res: NextApiResponse): boolean {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    const key = `${ip}:${req.url}`;
    const now = Date.now();
    const entry = rateMap.get(key);

    if (!entry || entry.resetAt < now) {
      rateMap.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return false;
    }
    return true;
  };
}

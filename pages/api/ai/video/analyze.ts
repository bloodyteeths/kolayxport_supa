// POST /api/ai/video/analyze { refs: string[], title?, locale? } → { photos: [{ ref, view, fullBody, person, quality }], start, end,
//   product: { kind, category }, shots: [{ label, hint, action, showsBack }], scenes: [{ label, prompt }] }
// The Video Studio picks the anchor frames itself: which photo is the full-body front (start) and back (end), which
// are close-ups (references only), whether a model wears the product. Cached per photo set. Session user only.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { loadSource } from '@/lib/ai/videoSources';
import { analyzePhotos, type PhotoAnalysis } from '@/lib/ai/videoProduct';
import type { VideoMedia } from '@/lib/ai/video';

const cache = new Map<string, { at: number; value: PhotoAnalysis & { refs: string[] } }>();
const TTL = 60 * 60 * 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ code: 'methodNotAllowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  const asked: string[] = Array.isArray(req.body?.refs) ? req.body.refs.map(String).filter(Boolean).slice(0, 12) : [];
  if (!asked.length) return res.status(400).json({ code: 'refsRequired' });
  const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 200) : '';
  const locale = req.body?.locale === 'en' ? 'en' : 'tr';
  const key = `${user.id}|${locale}|${title}|${asked.join('|')}`;
  const hit = cache.get(key);
  try {
    let value = hit && Date.now() - hit.at < TTL ? hit.value : null;
    if (!value) {
      const loaded = await Promise.all(asked.map((r) => loadSource(user.id, r)));
      const refs = asked.filter((_, i) => loaded[i]);
      const media = loaded.filter((x): x is VideoMedia => Boolean(x));
      if (!media.length) return res.status(422).json({ code: 'photosUnreadable' });
      value = { ...(await analyzePhotos(user.id, media, { title, locale })), refs };
      cache.set(key, { at: Date.now(), value });
      if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    }
    return res.status(200).json({
      photos: value.photos.map((p, i) => ({ ref: value!.refs[i], ...p })),
      start: value.start === null ? null : value.refs[value.start],
      end: value.end === null ? null : value.refs[value.end],
      product: value.product,
      shots: value.shots,
      scenes: value.scenes,
    });
  } catch (err: any) {
    logger.warn('Video studio photo analysis failed', { userId: user.id, error: err?.message });
    return res.status(502).json({ code: 'analyzeFailed' });
  }
}

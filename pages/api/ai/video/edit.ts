// POST /api/ai/video/edit  { id, square?, portrait45?, mute?, trimStart?, trimEnd? } → a new version (mode 'edit')
// ffmpeg on the VPS: crop to 1:1 / 4:5, remove the sound, trim. The original stays untouched. Owner only.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { editVideo } from '@/lib/ai/video';
import { viewJob } from './index';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ code: 'methodNotAllowed' }); }
  const src = await prisma.aiVideoJob.findFirst({ where: { id: String(req.body?.id || ''), userId: user.id, status: 'done' } });
  if (!src?.filePath) return res.status(404).json({ code: 'notFound' });
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);
  const edit = { square: req.body?.square === true, portrait45: req.body?.portrait45 === true, mute: req.body?.mute === true, trimStart: num(req.body?.trimStart), trimEnd: num(req.body?.trimEnd) };
  if (!edit.square && !edit.portrait45 && !edit.mute && !edit.trimStart && !edit.trimEnd) return res.status(400).json({ code: 'nothingToEdit' });
  try {
    const { id: _id, createdAt: _c, updatedAt: _u, ...base } = src;
    const job = await prisma.aiVideoJob.create({
      data: {
        ...base, direction: src.direction ?? undefined, qa: (src.qa as any) ?? undefined, published: undefined, credits: 0, parentId: src.id, status: 'running', mode: 'edit', operation: null, favorite: false,
        instruction: [edit.square && 'square', edit.portrait45 && '4:5', edit.mute && 'muted', (edit.trimStart || edit.trimEnd) && `trim ${edit.trimStart ?? 0}-${edit.trimEnd ?? ''}s`].filter(Boolean).join(', '),
        aspectRatio: edit.square ? '1:1' : edit.portrait45 ? '4:5' : src.aspectRatio,
      },
    });
    const filePath = await editVideo(user.id, src.filePath, job.id, edit);
    const done = await prisma.aiVideoJob.update({ where: { id: job.id }, data: { status: 'done', filePath, groupId: job.id } });
    return res.status(200).json({ job: viewJob(done) });
  } catch (err: any) {
    logger.error('AI video edit failed', err, { userId: user.id });
    return res.status(502).json({ code: 'editFailed' });
  }
}

// pages/api/messages/saved-replies.ts — messages §6.4 (group G3). Server-side saved replies, so a reply
// saved on the desktop shows up on the phone. Never writes to a marketplace.
//
// Guard (BUILD_PLAN §0.3): the `SavedReply` table is backend request BR-4. Until the migration is deployed
// and the Prisma client regenerated, every method answers `503 { code: 'notReady' }` and the client hook
// falls back to the legacy browser list (read-only).
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  SAVED_REPLY_LIMIT,
  buildImportRows,
  sortSavedReplies,
  titleKey,
  validateSavedReplyInput,
  validateSavedReplyPatch,
  type SavedReply,
  type SavedReplyErrorBody,
  type SavedReplyPlatform,
} from '@/lib/messages/savedReplies';

/** The subset of the generated `prisma.savedReply` delegate this route uses (BR-4 shape, messages §6.4). */
interface SavedReplyRow {
  id: string;
  userId: string;
  title: string;
  body: string;
  platform: string | null;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}
interface SavedReplyDelegate {
  findMany(args: { where: { userId: string }; orderBy?: unknown }): Promise<SavedReplyRow[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<SavedReplyRow | null>;
  count(args: { where: { userId: string } }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<SavedReplyRow>;
  createMany(args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<SavedReplyRow>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

/** Returns the delegate, or null while the generated client has no `savedReply` model (pre-BR-4). */
export function savedReplyDelegate(client: unknown = prisma): SavedReplyDelegate | null {
  const d = (client as { savedReply?: SavedReplyDelegate } | null)?.savedReply;
  return d && typeof d.findMany === 'function' ? d : null;
}

function prismaCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** P2021 table missing / P2022 column missing → the migration is not deployed yet. */
function isNotReady(err: unknown): boolean {
  const c = prismaCode(err);
  return c === 'P2021' || c === 'P2022';
}

export function toSavedReply(row: SavedReplyRow): SavedReply {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    platform: row.platform === 'wix' || row.platform === 'trendyol' || row.platform === 'hepsiburada' ? (row.platform as SavedReplyPlatform) : null,
    usageCount: row.usageCount ?? 0,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function fail(res: NextApiResponse, status: number, body: SavedReplyErrorBody) {
  return res.status(status).json(body);
}

function queryString(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : '';
}

async function hasTitle(db: SavedReplyDelegate, userId: string, title: string, exceptId?: string): Promise<boolean> {
  const rows = await db.findMany({ where: { userId } });
  const key = titleKey(title);
  return rows.some((r) => r.id !== exceptId && titleKey(r.title) === key);
}

async function listReplies(db: SavedReplyDelegate, userId: string): Promise<SavedReply[]> {
  const rows = await db.findMany({ where: { userId }, orderBy: [{ usageCount: 'desc' }, { title: 'asc' }] });
  // Sorted again with the Turkish collation so "Ş"/"İ" titles land where a seller expects them.
  return sortSavedReplies(rows.map(toSavedReply));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return fail(res, 401, { code: 'unauthorized' });
  const userId = String(user.id);

  const db = savedReplyDelegate();
  if (!db) return fail(res, 503, { code: 'notReady' });

  const action = queryString(req.query.action);
  const id = queryString(req.query.id);
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

  try {
    if (req.method === 'GET') {
      const replies = await listReplies(db, userId);
      return res.status(200).json({ replies, limit: SAVED_REPLY_LIMIT });
    }

    if (req.method === 'POST' && action === 'used') {
      if (!id) return fail(res, 400, { code: 'invalid', field: 'id', reason: 'required' });
      const r = await db.updateMany({ where: { id, userId }, data: { usageCount: { increment: 1 } } });
      if (!r.count) return fail(res, 404, { code: 'notFound' });
      return res.status(204).end();
    }

    if (req.method === 'POST' && action === 'import') {
      const existing = await db.count({ where: { userId } });
      if (existing > 0) return fail(res, 409, { code: 'notEmpty' });
      const rows = buildImportRows(body.items, SAVED_REPLY_LIMIT);
      // Report what was actually inserted: a concurrent import (two tabs past the count check) has its
      // rows skipped by @@unique([userId, title]) and answers imported=0, so it shows no toast.
      let imported = 0;
      if (rows.length) {
        const r = await db.createMany({
          data: rows.map((r) => ({ userId, title: r.title, body: r.body, platform: r.platform })),
          skipDuplicates: true,
        });
        imported = typeof r?.count === 'number' ? r.count : 0;
      }
      const replies = await listReplies(db, userId);
      return res.status(200).json({ replies, imported, limit: SAVED_REPLY_LIMIT });
    }

    if (req.method === 'POST') {
      if (action) return fail(res, 400, { code: 'invalid', reason: 'invalid' });
      const v = validateSavedReplyInput(body);
      if (!v.ok) return fail(res, 400, v.error);
      const count = await db.count({ where: { userId } });
      if (count >= SAVED_REPLY_LIMIT) return fail(res, 409, { code: 'limit', max: SAVED_REPLY_LIMIT });
      if (await hasTitle(db, userId, v.value.title)) return fail(res, 409, { code: 'duplicate', field: 'title' });
      const row = await db.create({ data: { userId, ...v.value } });
      return res.status(201).json({ reply: toSavedReply(row) });
    }

    if (req.method === 'PATCH') {
      if (!id) return fail(res, 400, { code: 'invalid', field: 'id', reason: 'required' });
      const v = validateSavedReplyPatch(body);
      if (!v.ok) return fail(res, 400, v.error);
      const current = await db.findFirst({ where: { id, userId } });
      if (!current) return fail(res, 404, { code: 'notFound' });
      if (v.value.title !== undefined && (await hasTitle(db, userId, v.value.title, id))) {
        return fail(res, 409, { code: 'duplicate', field: 'title' });
      }
      const row = await db.update({ where: { id: current.id }, data: v.value });
      return res.status(200).json({ reply: toSavedReply(row) });
    }

    if (req.method === 'DELETE') {
      if (!id) return fail(res, 400, { code: 'invalid', field: 'id', reason: 'required' });
      const r = await db.deleteMany({ where: { id, userId } });
      if (!r.count) return fail(res, 404, { code: 'notFound' });
      return res.status(204).end();
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (isNotReady(err)) return fail(res, 503, { code: 'notReady' });
    if (prismaCode(err) === 'P2002') return fail(res, 409, { code: 'duplicate', field: 'title' });
    if (prismaCode(err) === 'P2025') return fail(res, 404, { code: 'notFound' });
    // Never log reply text (it may contain customer names); method + action + Prisma code only.
    logger.error('saved-replies request failed', undefined, { method: req.method, action: action || null, code: prismaCode(err) ?? null });
    return fail(res, 500, { code: 'unavailable' });
  }
}

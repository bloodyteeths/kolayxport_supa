/**
 * Hepsiburada catalog metadata for the product creator. `GET ?action=`:
 *   categories                       leaf + available categories (flat list with paths), cached per process 12 h
 *   category_attributes&categoryId=  base / product / variant attributes of a leaf category
 *   attribute_values&categoryId=&attributeId=&page=   listed values of an enum attribute
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireHepsiburada, sendHbError } from '@/lib/hepsiburada/server';
import type { HepsiburadaClient } from '@/lib/hepsiburada/client';

export type HbCategoryOption = { id: number; name: string; path: string };

const CATEGORY_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CATEGORY_PAGES = 30;
let categoryCache: { at: number; env: string; list: HbCategoryOption[] } | null = null;

/** HB category DTO → option. Pure (tested). */
export function toCategoryOption(c: any): HbCategoryOption | null {
  const id = Number(c?.categoryId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const name = String(c?.displayName || c?.name || id);
  const paths = Array.isArray(c?.paths) ? c.paths.filter((p: unknown) => typeof p === 'string' && p) : [];
  return { id, name, path: paths.length ? paths.join(' › ') : name };
}

async function loadCategories(client: HepsiburadaClient): Promise<HbCategoryOption[]> {
  if (categoryCache && categoryCache.env === client.env && Date.now() - categoryCache.at < CATEGORY_TTL_MS) return categoryCache.list;
  const list: HbCategoryOption[] = [];
  for (let page = 0; page < MAX_CATEGORY_PAGES; page++) {
    const res: any = await client.listCategories({ page, size: 2000, leaf: true });
    const rows: any[] = Array.isArray(res?.data) ? res.data : [];
    for (const c of rows) {
      if (c?.leaf === false || c?.available === false) continue;
      const o = toCategoryOption(c);
      if (o) list.push(o);
    }
    if (!rows.length || res?.last === true || (typeof res?.totalPages === 'number' && page + 1 >= res.totalPages)) break;
  }
  list.sort((a, b) => a.path.localeCompare(b.path, 'tr'));
  categoryCache = { at: Date.now(), env: client.env, list };
  return list;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireHepsiburada(req, res);
  if (!ctx) return;
  const { client } = ctx;
  const action = String(req.query.action || '');

  try {
    if (action === 'categories') {
      const all = await loadCategories(client);
      const q = String(req.query.q || '').trim().toLocaleLowerCase('tr');
      const list = q ? all.filter((c) => c.path.toLocaleLowerCase('tr').includes(q)).slice(0, 100) : all;
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).json({ categories: list, total: all.length });
    }

    if (action === 'category_attributes') {
      const categoryId = Number(req.query.categoryId);
      if (!Number.isInteger(categoryId) || categoryId <= 0) return res.status(400).json({ error: 'categoryId is required' });
      const data = await client.categoryAttributes(categoryId);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).json(data?.data ?? data);
    }

    if (action === 'attribute_values') {
      const categoryId = Number(req.query.categoryId);
      const attributeId = String(req.query.attributeId || '');
      if (!Number.isInteger(categoryId) || !attributeId) return res.status(400).json({ error: 'categoryId and attributeId are required' });
      const page = Math.max(0, Number(req.query.page) || 0);
      const data = await client.attributeValues(categoryId, attributeId, { page, size: 1000 });
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).json(data?.data ?? data);
    }

    return res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
  } catch (err) {
    return sendHbError(res, err);
  }
}

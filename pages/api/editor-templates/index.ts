// pages/api/editor-templates — saved bulk-edit templates (lib/bulk/editorTemplates.ts). Stores and lists steps only;
// applying happens in the browser through the normal staging (nothing here writes to a marketplace).
//   GET                         → { templates }
//   POST   { name, step }       → adds the step to the template of that name (created when new) → { template }
//   DELETE ?id=…[&step=<index>] → deletes the template, or one of its steps
// Saving and deleting need the editor's `templates` capability (pro tier); listing is open, so a downgraded account
// still sees what it saved.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { editorAllows, editorLockedBody } from '@/lib/billing/editorTier';
import { accountEditorTier } from '@/lib/billing/editorTierServer';
import {
  TEMPLATE_LIMITS,
  addTemplateStep,
  normaliseTemplateName,
  normaliseTemplateStep,
  templateStepsOf,
  type EditorTemplate,
} from '@/lib/bulk/editorTemplates';

const MARKETPLACE = 'etsy';

type Row = { id: string; name: string; steps: unknown; updatedAt: Date };

export function toTemplate(row: Row): EditorTemplate {
  return { id: row.id, name: row.name, marketplace: MARKETPLACE, steps: templateStepsOf(row.steps), updatedAt: new Date(row.updatedAt).toISOString() };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const userId = user.id;

  if (req.method === 'GET') {
    const rows = await prisma.editorTemplate.findMany({ where: { userId, marketplace: MARKETPLACE }, orderBy: { updatedAt: 'desc' } });
    return res.status(200).json({ templates: rows.map(toTemplate) });
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tier = await accountEditorTier(userId);
  if (!editorAllows(tier, 'templates')) return res.status(402).json(editorLockedBody(tier, 'templates'));

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const name = normaliseTemplateName(body.name);
    const step = normaliseTemplateStep(body.step);
    if (!name || !step) return res.status(400).json({ error: 'Invalid template', code: 'invalid' });
    const existing = await prisma.editorTemplate.findUnique({ where: { userId_marketplace_name: { userId, marketplace: MARKETPLACE, name } } });
    if (existing) {
      const steps = addTemplateStep(templateStepsOf(existing.steps), step);
      const row = await prisma.editorTemplate.update({ where: { id: existing.id }, data: { steps: steps as unknown as Prisma.InputJsonValue } });
      return res.status(200).json({ template: toTemplate(row) });
    }
    const count = await prisma.editorTemplate.count({ where: { userId, marketplace: MARKETPLACE } });
    if (count >= TEMPLATE_LIMITS.perUser) return res.status(409).json({ error: 'Too many templates', code: 'limit', max: TEMPLATE_LIMITS.perUser });
    const row = await prisma.editorTemplate.create({ data: { userId, marketplace: MARKETPLACE, name, steps: [step] as unknown as Prisma.InputJsonValue } });
    return res.status(201).json({ template: toTemplate(row) });
  }

  // DELETE
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return res.status(400).json({ error: 'id required', code: 'invalid' });
  const row = await prisma.editorTemplate.findFirst({ where: { id, userId, marketplace: MARKETPLACE } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  const stepRaw = typeof req.query.step === 'string' ? req.query.step : '';
  if (stepRaw !== '') {
    const index = Number(stepRaw);
    const steps = templateStepsOf(row.steps);
    if (!Number.isInteger(index) || index < 0 || index >= steps.length) return res.status(400).json({ error: 'Invalid step', code: 'invalid' });
    const next = steps.filter((_, i) => i !== index);
    if (next.length) {
      const updated = await prisma.editorTemplate.update({ where: { id }, data: { steps: next as unknown as Prisma.InputJsonValue } });
      return res.status(200).json({ template: toTemplate(updated) });
    }
  }
  await prisma.editorTemplate.delete({ where: { id } });
  return res.status(200).json({ deleted: id });
}

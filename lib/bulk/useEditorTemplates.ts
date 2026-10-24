// lib/bulk/useEditorTemplates.ts — the signed-in user's saved bulk-edit templates (pages/api/editor-templates).
import useSWR from 'swr';
import type { EditorTemplate, TemplateStep } from './editorTemplates';

export const EDITOR_TEMPLATES_KEY = '/api/editor-templates';

export class EditorTemplateError extends Error {
  constructor(public status: number, public code: string | null) {
    super(`editor-templates ${status}`);
  }
}

async function call(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new EditorTemplateError(res.status, typeof body?.code === 'string' ? body.code : typeof body?.limitType === 'string' ? body.limitType : null);
  return body;
}

export function useEditorTemplates(enabled = true) {
  const { data, error, mutate, isLoading } = useSWR<{ templates: EditorTemplate[] }>(enabled ? EDITOR_TEMPLATES_KEY : null, (u: string) => call(u), {
    revalidateOnFocus: false,
  });
  const templates = data?.templates ?? [];
  return {
    templates,
    loading: isLoading,
    error: Boolean(error),
    /** Adds the step to the template of that name (created when new). */
    async saveStep(name: string, step: TemplateStep): Promise<EditorTemplate> {
      const body = await call(EDITOR_TEMPLATES_KEY, { method: 'POST', body: JSON.stringify({ name, step }) });
      await mutate();
      return body.template as EditorTemplate;
    },
    /** Deletes the template, or one step of it. */
    async remove(id: string, step?: number): Promise<void> {
      const qs = new URLSearchParams({ id, ...(step !== undefined ? { step: String(step) } : {}) });
      await call(`${EDITOR_TEMPLATES_KEY}?${qs.toString()}`, { method: 'DELETE' });
      await mutate();
    },
  };
}

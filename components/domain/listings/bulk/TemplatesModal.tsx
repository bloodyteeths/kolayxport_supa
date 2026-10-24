// components/domain/listings/bulk/TemplatesModal.tsx — Etsy "Apply template…": the user's saved bulk-edit
// templates, each with its steps; Apply stages them on the selected listings (templatePlan.ts), Delete removes a
// template or one step. Templates are built from the Change price / Tags / Set field dialogs ("Save as template step").
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { Button } from '@/components/ds/inputs/Button';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import type { EditorTemplate, TemplateStep } from '@/lib/bulk/editorTemplates';
import { useEditorTemplates } from '@/lib/bulk/useEditorTemplates';

type T = ReturnType<typeof useTranslations>;

/** One line describing a step (no profile names: ids only resolve per shop). */
export function stepSummary(s: TemplateStep, t: T): string {
  if (s.kind === 'price') {
    return t(`step.price.${s.mode}`, { value: String(s.value) }) + (s.round !== 'none' ? ` (.${s.round})` : '');
  }
  if (s.kind === 'tags') return t(`step.tags.${s.mode}`, { tags: s.tags.join(', ') });
  const v = s.value as Record<string, unknown>;
  const label = t(`field.${s.key}`);
  if (s.key === 'materials') return `${label}: ${t(`step.mode.${String(v.materialsMode ?? 'replace')}`)} ${(Array.isArray(v.materials) ? v.materials : []).join(', ')}`;
  if (s.key === 'description') {
    const text = String(v.description ?? '');
    return `${label}: ${t(`step.mode.${String(v.descriptionMode ?? 'replace')}`)} “${text.length > 40 ? `${text.slice(0, 40)}…` : text}”`;
  }
  if (s.key === 'personalization') return `${label}: ${v.personalization === 'off' ? t('step.off') : t('step.on')}`;
  if (s.key === 'weight') return `${label}: ${String(v.weight ?? '')} ${String(v.weightUnit ?? '')}`;
  if (s.key === 'dimensions') return `${label}: ${[v.length, v.width, v.height].join(' × ')} ${String(v.dimensionsUnit ?? '')}`;
  return t('step.fieldSet', { field: label });
}

export interface TemplatesModalProps {
  open: boolean;
  onClose: () => void;
  count: number;
  onApply: (template: EditorTemplate) => Promise<void>;
}

export function TemplatesModal({ open, onClose, count, onApply }: TemplatesModalProps) {
  const t = useTranslations('listings.templates');
  const toast = useToast();
  const { templates, loading, error, remove } = useEditorTemplates(open);
  const [busy, setBusy] = React.useState<string | null>(null);

  const apply = async (tpl: EditorTemplate) => {
    setBusy(tpl.id);
    try {
      await onApply(tpl);
      onClose();
    } finally {
      setBusy(null);
    }
  };
  const del = async (id: string, step?: number) => {
    try {
      await remove(id, step);
    } catch {
      toast.error(t('deleteFailed'));
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" title={t('title', { count })} description={t('description')} primary={{ id: 'templates-close', label: t('close'), onClick: onClose }} secondary={null} data-testid="listings-templates">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '60vh', overflowY: 'auto' }}>
        {loading ? <Typography variant="body2" sx={{ color: neutral[600] }}>{t('loading')}</Typography> : null}
        {error ? <Typography variant="body2" sx={{ color: neutral[600] }}>{t('loadFailed')}</Typography> : null}
        {!loading && !error && templates.length === 0 ? (
          <Typography variant="body2" sx={{ color: neutral[600] }} data-testid="templates-empty">{t('empty')}</Typography>
        ) : null}
        {templates.map((tpl) => (
          <Box key={tpl.id} sx={{ border: `1px solid ${neutral[200]}`, borderRadius: '8px', p: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="template-card">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Typography variant="label" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{tpl.name}</Typography>
              <IconButton icon={icons.delete} label={t('delete')} size="sm" tone="danger" onClick={() => void del(tpl.id)} />
              <Button variant="primary" size="sm" onClick={() => void apply(tpl)} loading={busy === tpl.id} disabled={Boolean(busy) || tpl.steps.length === 0 || count === 0} data-testid="template-apply">
                {t('apply', { count })}
              </Button>
            </Box>
            <Box component="ol" sx={{ m: 0, pl: '18px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {tpl.steps.map((s, i) => (
                <Box component="li" key={i} sx={{ fontSize: 13, color: neutral[700] }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{stepSummary(s, t)}</Box>
                    {tpl.steps.length > 1 ? <IconButton icon={icons.close} label={t('removeStep')} size="xs" onClick={() => void del(tpl.id, i)} /> : null}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Modal>
  );
}

// components/domain/listings/bulk/TemplateStepSaver.tsx — "Save as template step" inside the Change price, Tags and
// Set field dialogs (Etsy). Saves what the dialog is set to as one step of a named template (new or existing);
// nothing is staged by saving. Locked plans get the upgrade prompt. Inline (no nested dialog).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { TextField } from '@/components/ds/inputs/TextField';
import { useToast } from '@/components/ds/feedback/toast';
import { neutral } from '@/lib/ds/tokens';
import { TEMPLATE_LIMITS, normaliseTemplateName, type TemplateStep } from '@/lib/bulk/editorTemplates';
import { EditorTemplateError, useEditorTemplates } from '@/lib/bulk/useEditorTemplates';
import { useEditorTier } from '@/lib/billing/useEditorTier';
import { requestEditorUpgrade } from '../editor/EditorUpgrade';

export function TemplateStepSaver({ step }: { step: TemplateStep | null }) {
  const t = useTranslations('listings.templates');
  const toast = useToast();
  const { allows } = useEditorTier();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const { templates, saveStep } = useEditorTemplates(open);

  const start = () => {
    if (!allows('templates')) {
      requestEditorUpgrade('templates');
      return;
    }
    setOpen(true);
  };
  const save = async () => {
    const n = normaliseTemplateName(name);
    if (!n || !step || busy) return;
    setBusy(true);
    try {
      const tpl = await saveStep(n, step);
      toast.success(t('saved', { name: tpl.name, count: tpl.steps.length }));
      setOpen(false);
      setName('');
    } catch (err) {
      if (err instanceof EditorTemplateError && err.code === 'editor') requestEditorUpgrade('templates');
      else if (err instanceof EditorTemplateError && err.code === 'limit') toast.error(t('limit', { max: TEMPLATE_LIMITS.perUser }));
      else toast.error(t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Box>
        <Button variant="ghost" size="sm" onClick={start} disabled={!step} data-testid="template-save-step">
          {t('saveStep')}
        </Button>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', p: '10px', border: `1px solid ${neutral[200]}`, borderRadius: '8px' }} data-testid="template-save-form">
      <Typography variant="caption" sx={{ color: neutral[600] }}>{t('saveHelp')}</Typography>
      <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <TextField
            value={name}
            onChange={setName}
            placeholder={t('namePlaceholder')}
            maxLength={TEMPLATE_LIMITS.name}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
            }}
            data-testid="template-name"
          />
        </Box>
        <Button variant="secondary" size="sm" onClick={() => void save()} loading={busy} disabled={!normaliseTemplateName(name) || !step} data-testid="template-save-confirm">
          {t('save')}
        </Button>
      </Box>
      {templates.length ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {templates.slice(0, 8).map((tpl) => (
            <Button key={tpl.id} variant="ghost" size="sm" onClick={() => setName(tpl.name)}>
              {tpl.name}
            </Button>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

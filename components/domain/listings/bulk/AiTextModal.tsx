// components/domain/listings/bulk/AiTextModal.tsx — Etsy bulk "AI description / translate" (listings page).
// 1) Choose: improve descriptions (US English) or translate title / description / tags into English (e.g. listings
//    copied from Trendyol). 2) Run: the selected listings go to the AI a few at a time (lib/bulk/aiText.ts).
// 3) Review a sample of the results, then stage them as drafts; nothing reaches Etsy before "Send N changes".
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { RadioGroup } from '@/components/ds/inputs/RadioGroup';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { TextArea } from '@/components/ds/inputs/TextArea';
import { neutral } from '@/lib/ds/tokens';
import type { ListingRow } from '@/lib/listings/types';
import { runAiText, type AiTextField, type AiTextInput, type AiTextMode, type AiTextRunSummary } from '@/lib/bulk/aiText';
import { requestEditorUpgrade } from '../editor/EditorUpgrade';

export interface AiTextModalProps {
  open: boolean;
  onClose: () => void;
  rows: ListingRow[];
  /** Current title / description / tags (draft overlay first) of these listings. */
  loadInputs: (rows: ListingRow[]) => Promise<AiTextInput[]>;
  /** Stages the results; returns the staged count. */
  onStage: (results: AiTextRunSummary['results']) => Promise<void>;
}

type Phase = { kind: 'setup' } | { kind: 'running'; done: number; total: number } | { kind: 'review'; summary: AiTextRunSummary; inputs: Map<string, AiTextInput> };

export function AiTextModal({ open, onClose, rows, loadInputs, onStage }: AiTextModalProps) {
  const t = useTranslations('listings.aiText');
  const [mode, setMode] = React.useState<AiTextMode>('translate');
  const [fields, setFields] = React.useState<AiTextField[]>(['title', 'description', 'tags']);
  const [instructions, setInstructions] = React.useState('');
  const [phase, setPhase] = React.useState<Phase>({ kind: 'setup' });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPhase({ kind: 'setup' });
    setError(null);
    setBusy(false);
    return () => abort.current?.abort();
  }, [open]);

  const toggle = (f: AiTextField, on: boolean) => setFields((cur) => (on ? Array.from(new Set([...cur, f])) : cur.filter((x) => x !== f)));

  const run = async () => {
    setError(null);
    setPhase({ kind: 'running', done: 0, total: rows.length });
    const controller = new AbortController();
    abort.current = controller;
    let inputs: AiTextInput[];
    try {
      inputs = await loadInputs(rows);
    } catch {
      setError(t('loadFailed'));
      setPhase({ kind: 'setup' });
      return;
    }
    const summary = await runAiText(inputs, {
      mode,
      fields,
      instructions,
      signal: controller.signal,
      onProgress: (done, total) => setPhase({ kind: 'running', done, total }),
    });
    if (controller.signal.aborted) return;
    if (summary.stop === 'limited' && !summary.results.length) {
      onClose();
      requestEditorUpgrade('ai');
      return;
    }
    if (summary.stop === 'rateLimited' && !summary.results.length) setError(t('rateLimited'));
    else if (summary.stop === 'failed') setError(t('failed'));
    setPhase({ kind: 'review', summary, inputs: new Map(inputs.map((i) => [i.id, i])) });
  };

  const stage = async () => {
    if (phase.kind !== 'review' || !phase.summary.results.length) return;
    setBusy(true);
    try {
      await onStage(phase.summary.results);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const running = phase.kind === 'running';
  const review = phase.kind === 'review' ? phase : null;
  const primary = review
    ? { id: 'aiText-stage', label: t('stage', { count: review.summary.results.length }), onClick: () => void stage(), loading: busy, disabled: !review.summary.results.length }
    : { id: 'aiText-run', label: t('run', { count: rows.length }), onClick: () => void run(), loading: running, disabled: running || (mode === 'translate' && !fields.length) };

  return (
    <Modal
      open={open}
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      size="md"
      title={t('title', { count: rows.length })}
      description={t('description')}
      primary={primary}
      data-testid="listings-ai-text"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {phase.kind === 'setup' ? (
          <>
            <FormField label={t('mode')}>
              <RadioGroup<AiTextMode>
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'translate', label: t('modeTranslate') },
                  { value: 'improve', label: t('modeImprove') },
                ]}
              />
            </FormField>
            {mode === 'translate' ? (
              <FormField label={t('fields')}>
                <Box sx={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  {(['title', 'description', 'tags'] as const).map((f) => (
                    <Checkbox key={f} checked={fields.includes(f)} onChange={(on) => toggle(f, on)} label={t(`field.${f}`)} />
                  ))}
                </Box>
              </FormField>
            ) : null}
            <FormField label={t('instructions')} helper={t('instructionsHelp')}>
              <TextArea value={instructions} onChange={setInstructions} minRows={2} />
            </FormField>
            <Typography variant="caption" sx={{ color: neutral[600] }}>{t('note')}</Typography>
          </>
        ) : null}
        {running ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="ai-text-progress">
            <LinearProgress variant={phase.total ? 'determinate' : 'indeterminate'} value={phase.total ? (phase.done / phase.total) * 100 : 0} />
            <Typography variant="caption" sx={{ color: neutral[600] }}>{t('progress', { done: phase.done, total: phase.total })}</Typography>
          </Box>
        ) : null}
        {review ? (
          <>
            <Typography variant="body2" data-testid="ai-text-summary">
              {t('ready', { count: review.summary.results.length })}
              {review.summary.unusable ? ` ${t('unusable', { count: review.summary.unusable })}` : ''}
              {review.summary.notSent ? ` ${t('notSent', { count: review.summary.notSent })}` : ''}
              {review.summary.failed ? ` ${t('failedCount', { count: review.summary.failed })}` : ''}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '45vh', overflowY: 'auto' }}>
              {review.summary.results.slice(0, 5).map((r) => {
                const before = review.inputs.get(r.id);
                return (
                  <Box key={r.id} sx={{ border: `1px solid ${neutral[200]}`, borderRadius: '8px', p: '8px 10px', fontSize: 13, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {r.title ? (
                      <Box>
                        <Box component="span" sx={{ color: neutral[500], textDecoration: 'line-through' }}>{before?.title}</Box>
                        <Box sx={{ fontWeight: 600 }}>{r.title}</Box>
                      </Box>
                    ) : (
                      <Box sx={{ fontWeight: 600 }}>{before?.title}</Box>
                    )}
                    {r.description ? <Box sx={{ color: neutral[700], whiteSpace: 'pre-line' }}>{r.description.length > 260 ? `${r.description.slice(0, 260)}…` : r.description}</Box> : null}
                    {r.tags ? <Box sx={{ color: neutral[600] }}>{r.tags.join(', ')}</Box> : null}
                  </Box>
                );
              })}
            </Box>
            {review.summary.results.length > 5 ? (
              <Typography variant="caption" sx={{ color: neutral[600] }}>{t('more', { count: review.summary.results.length - 5 })}</Typography>
            ) : null}
          </>
        ) : null}
        {error ? <Typography variant="body2" sx={{ color: 'error.main' }}>{error}</Typography> : null}
      </Box>
    </Modal>
  );
}

// components/domain/photo-studio/OperationBar.tsx — M7-E PhotoStudio operation row (pro-gating §4.2):
//   Do [Add ▾]  at position [End ▾]  from [Upload ▾]  [Choose files…]                Applies to 12 selected
// The operation × position × source model of today's BulkPhotoStudio, on DS inputs. The row only configures the
// run; the page header primary ("Stage N photo changes") runs it (one primary per view, P1). AI ops show their
// credit cost in the summary line; nothing here is sent to Etsy.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Select, type SelectOption } from '@/components/ds/inputs/Select';
import { Button } from '@/components/ds/inputs/Button';
import { TextField } from '@/components/ds/inputs/TextField';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { icons } from '@/lib/ds/icons';
import { neutral, radius } from '@/lib/ds/tokens';
import { IMAGE_TYPES } from '@/components/domain/listing-editor/sections/photosModel';
import {
  STUDIO_ALT_MAX,
  STUDIO_MAX_PHOTOS,
  STUDIO_OPS,
  type PlanInput,
  type StudioOp,
  type StudioPosition,
  type StudioSource,
} from './studioModel';

export interface OperationBarProps {
  input: PlanInput;
  onChange: (next: PlanInput) => void;
  files: File[];
  onFiles: (files: File[]) => void;
  prompt: string;
  onPrompt: (v: string) => void;
  /** Listings that can be a "Copy from" source. */
  copySources: { id: string; title: string }[];
  selectedCount: number;
  /** One-line summary of what the run stages ("18 photo changes on 12 listings · 12 credits"). */
  summary: React.ReactNode;
  disabled?: boolean;
  'data-testid'?: string;
}

const OP_KEY: Record<StudioOp, string> = {
  add: 'op.add', replace: 'op.replace', delete: 'op.delete', move: 'op.move', alt: 'op.alt', enhance: 'op.enhance', removeBg: 'op.removeBg', copy: 'op.copy',
};
const HAS_SOURCE: ReadonlySet<StudioOp> = new Set(['add', 'replace']);
const HAS_POSITION: ReadonlySet<StudioOp> = new Set(['add', 'replace', 'delete', 'move', 'alt', 'enhance', 'removeBg']);
const AI_OPS: ReadonlySet<StudioOp> = new Set(['enhance', 'removeBg']);

export function OperationBar({
  input, onChange, files, onFiles, prompt, onPrompt, copySources, selectedCount, summary, disabled, 'data-testid': testId,
}: OperationBarProps) {
  const t = useTranslations('photoStudio');
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const set = (patch: Partial<PlanInput>) => onChange({ ...input, ...patch });

  const opOptions: SelectOption<StudioOp>[] = STUDIO_OPS.map((op) => ({
    value: op,
    label: AI_OPS.has(op) ? `${t(OP_KEY[op])} ✦` : t(OP_KEY[op]),
  }));
  const positions: SelectOption<string>[] = [
    ...(input.op === 'add' ? [{ value: 'end', label: t('position.end') }] : []),
    ...Array.from({ length: STUDIO_MAX_PHOTOS }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
  ];
  const sourceOptions: SelectOption<StudioSource>[] = [
    { value: 'upload', label: t('source.upload') },
    { value: 'ai', label: `${t('source.ai')} ✦` },
    { value: 'url', label: t('source.url') },
  ];

  const changeOp = (op: StudioOp) => {
    // "End" exists only for Add; every other op targets a concrete position.
    const position: StudioPosition = op === 'add' ? input.position : input.position === 'end' ? 1 : input.position;
    onChange({ ...input, op, position, fileCount: op === 'replace' ? Math.min(files.length, 1) : files.length });
  };

  const pick = (list: FileList | null) => {
    const accepted = Array.from(list ?? []).filter((f) => (IMAGE_TYPES as readonly string[]).includes(f.type));
    const capped = input.op === 'replace' ? accepted.slice(0, 1) : accepted.slice(0, STUDIO_MAX_PHOTOS);
    onFiles(capped);
    set({ fileCount: capped.length });
  };

  const showSource = HAS_SOURCE.has(input.op);
  const label = (text: string) => <Box component="span" sx={{ fontSize: 13, color: neutral[600], whiteSpace: 'nowrap' }}>{text}</Box>;

  return (
    <Box
      data-testid={testId ?? 'photo-studio-operation'}
      sx={{ border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px`, p: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: neutral[0] }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', minHeight: 40 }}>
        {label(t('op.label'))}
        <Box sx={{ width: 200 }}>
          <Select<StudioOp> value={input.op} onChange={changeOp} options={opOptions} size="sm" disabled={disabled} aria-label={t('op.label')} data-testid="photo-studio-op" />
        </Box>
        {HAS_POSITION.has(input.op) && !(input.op === 'alt' && input.altAll) ? (
          <>
            {label(input.op === 'move' ? t('op.from') : t('op.position'))}
            <Box sx={{ width: 96 }}>
              <Select<string>
                value={String(input.position)}
                onChange={(v) => set({ position: v === 'end' ? 'end' : Number(v) })}
                options={positions}
                size="sm"
                disabled={disabled}
                aria-label={t('op.position')}
                data-testid="photo-studio-position"
              />
            </Box>
          </>
        ) : null}
        {input.op === 'move' ? (
          <>
            {label(t('op.moveTo'))}
            <Box sx={{ width: 96 }}>
              <Select<string>
                value={String(input.moveTo)}
                onChange={(v) => set({ moveTo: Number(v) })}
                options={positions.filter((p) => p.value !== 'end')}
                size="sm"
                disabled={disabled}
                aria-label={t('op.moveTo')}
              />
            </Box>
          </>
        ) : null}
        {showSource ? (
          <>
            {label(t('op.source'))}
            <Box sx={{ width: 190 }}>
              <Select<StudioSource> value={input.source} onChange={(v) => set({ source: v })} options={sourceOptions} size="sm" disabled={disabled} aria-label={t('op.source')} data-testid="photo-studio-source" />
            </Box>
          </>
        ) : null}
        {showSource && input.source === 'upload' ? (
          <>
            <Button variant="secondary" size="sm" icon={icons.upload} onClick={() => fileRef.current?.click()} disabled={disabled} disabledReason={t('blocker.running')}>
              {files.length ? t('op.filesChosen', { count: files.length }) : t('op.chooseFiles')}
            </Button>
            {files.length ? (
              <Button variant="ghost" size="sm" onClick={() => { onFiles([]); set({ fileCount: 0 }); }} disabled={disabled} disabledReason={t('blocker.running')}>
                {t('op.clearFiles')}
              </Button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple={input.op !== 'replace'}
              accept={IMAGE_TYPES.join(',')}
              data-testid="photo-studio-file-input"
              onChange={(e) => { pick(e.target.files); e.target.value = ''; }}
            />
          </>
        ) : null}
        {input.op === 'copy' ? (
          <>
            {label(t('op.copyFrom'))}
            <Box sx={{ width: 280 }}>
              <Select<string>
                value={input.copyFromId}
                onChange={(v) => set({ copyFromId: v })}
                options={copySources.map((l) => ({ value: l.id, label: l.title }))}
                placeholder={t('op.copyFromPlaceholder')}
                size="sm"
                disabled={disabled}
                aria-label={t('op.copyFrom')}
              />
            </Box>
          </>
        ) : null}
        {input.op === 'alt' ? (
          <>
            <SegmentedControl<'ai' | 'manual'>
              value={input.altMode}
              onChange={(v) => set({ altMode: v })}
              options={[{ value: 'ai', label: `${t('op.altAi')} ✦` }, { value: 'manual', label: t('op.altManual') }]}
              size="sm"
              aria-label={t('op.alt')}
            />
            <Checkbox checked={input.altAll} onChange={(v) => set({ altAll: v, position: input.position === 'end' ? 1 : input.position })} label={t('op.altAll')} disabled={disabled} />
          </>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Box component="span" sx={{ fontSize: 13, color: neutral[600] }} data-testid="photo-studio-applies">
          {t('appliesTo', { count: selectedCount })}
        </Box>
      </Box>

      {showSource && input.source === 'url' ? (
        <TextField
          value={input.url}
          onChange={(v) => set({ url: v })}
          placeholder={t('op.urlPlaceholder')}
          type="url"
          size="sm"
          disabled={disabled}
          aria-label={t('source.url')}
          data-testid="photo-studio-url"
        />
      ) : null}
      {(showSource && input.source === 'ai') || AI_OPS.has(input.op) ? (
        <TextField
          value={prompt}
          onChange={onPrompt}
          placeholder={AI_OPS.has(input.op) ? t('op.promptTweak') : t('op.prompt')}
          size="sm"
          maxLength={500}
          disabled={disabled}
          aria-label={AI_OPS.has(input.op) ? t('op.promptTweak') : t('op.prompt')}
          data-testid="photo-studio-prompt"
        />
      ) : null}
      {input.op === 'alt' && input.altMode === 'manual' ? (
        <TextField
          value={input.altText}
          onChange={(v) => set({ altText: v.slice(0, STUDIO_ALT_MAX) })}
          placeholder={t('op.altPlaceholder')}
          size="sm"
          maxLength={STUDIO_ALT_MAX}
          disabled={disabled}
          aria-label={t('op.alt')}
          data-testid="photo-studio-alt-text"
        />
      ) : null}
      <Box sx={{ fontSize: 13, color: neutral[700] }} data-testid="photo-studio-summary">{summary}</Box>
    </Box>
  );
}

export default OperationBar;

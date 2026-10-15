// components/domain/listing-editor/sections/PhotoPanel.tsx — M6 editor Group C (listing-editor §6.5, §4.3).
// The photo/video detail panel (`SidePanel size="lg"`, a bottom sheet on phones): large preview, alt text with a
// 250-char counter and an inline AI proposal, Make primary, Replace, Remove. Plus `AltTextBatchPanel`, the
// "Write alt text for N" review list (one proposal per photo, Use / Dismiss / Try again, "Use all").
// The panel never talks to Etsy: every action is a callback into ImageManager / VideoUploader, which stage into the
// DB draft with their existing calls. AI output is English (P5) and goes through the seoRules guards.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { Button } from '@/components/ds/inputs/Button';
import { FormField } from '@/components/ds/inputs/FormField';
import { TextArea } from '@/components/ds/inputs/TextArea';
import { FieldSuggestion } from '@/components/ds/inputs/FieldSuggestion';
import { Banner } from '@/components/ds/feedback/Banner';
import { icons } from '@/lib/ds/icons';
import { neutral, radius, tone } from '@/lib/ds/tokens';
import { AiRequestError, aiErrorCode, coerceAiString, looksGarbled } from '@/lib/etsy/seoRules';
import { ALT_TEXT_MAX, IMAGE_TYPES, VIDEO_TYPES, cleanAltText } from './photosModel';

/** Writes alt text for one photo. Must return English text or throw (AiRequestError carries the code). */
export type WriteAltText = (input: { imageUrl: string; title: string; description?: string }) => Promise<string>;

/**
 * Default alt writer (`POST /api/ai/etsy {action:'generate_alt_text'}` with the photo URL, as BulkPhotoStudio does).
 * `useListingAI` (Group H) may pass its own through `PhotosSection.writeAltText`; both use the same guards.
 */
export const defaultWriteAltText: WriteAltText = async ({ imageUrl, title, description }) => {
  const res = await fetch('/api/ai/etsy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'generate_alt_text', title, description, image_url: imageUrl }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new AiRequestError(aiErrorCode(data));
  const text = cleanAltText(coerceAiString((data as { alt_text?: unknown } | null)?.alt_text));
  if (!text || looksGarbled(text)) throw new AiRequestError('invalid_ai_response');
  return text;
};

export type PanelMedia =
  | {
    kind: 'photo';
    id: string;
    src: string;
    fullSrc: string;
    alt: string;
    /** 1-based position in the strip and the strip length (staged removals included). */
    position: number;
    total: number;
    /** A staged upload (not on the marketplace yet). */
    pending: boolean;
    /** Staged for removal. */
    removing: boolean;
  }
  | {
    kind: 'video';
    src?: string;
    poster?: string;
    pending: boolean;
    removing: boolean;
    /** Etsy is still processing the uploaded video. */
    processing?: boolean;
  };

export interface PhotoPanelProps {
  open: boolean;
  onClose: () => void;
  /** Display name for copy ("Etsy", "eBay"). */
  marketplaceName: string;
  media: PanelMedia | null;
  onPrev?: () => void;
  onNext?: () => void;
  /** Etsy photos only. Omit for eBay (no alt text) and video. */
  alt?: {
    /** False for a staged upload: Etsy takes alt text only for photos already on the listing. */
    editable: boolean;
    onSave: (alt: string) => Promise<void>;
    /** AI writer; omitted → no AI action. */
    write?: () => Promise<string>;
  };
  onMakePrimary?: () => void;
  onReplace?: (file: File) => Promise<void> | void;
  onRemove?: () => void;
  /** Present only when the staged removal can be undone. */
  onUndoRemove?: () => void;
  /** Draft is being sent: everything read-only. */
  readOnly?: boolean;
  'data-testid'?: string;
}

type Proposal = { loading: boolean; value: string; error: boolean | string };
const NO_PROPOSAL: Proposal = { loading: false, value: '', error: false };

/** `etsy.aiErrors.<code>` when the server named the cause (quota, not configured, …); otherwise the default line. */
function aiErrorLine(tEtsy: ReturnType<typeof useTranslations>, err: unknown): boolean | string {
  if (err instanceof AiRequestError && err.code && err.code !== 'invalid_ai_response' && tEtsy.has(`aiErrors.${err.code}` as never)) {
    return tEtsy(`aiErrors.${err.code}` as never);
  }
  return true;
}

export function PhotoPanel({
  open, onClose, marketplaceName, media, onPrev, onNext, alt, onMakePrimary, onReplace, onRemove, onUndoRemove, readOnly,
  'data-testid': testId,
}: PhotoPanelProps) {
  const t = useTranslations('listingEditor');
  const tEtsy = useTranslations('etsy');
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const mediaKey = media ? (media.kind === 'photo' ? media.id : 'video') : '';
  const baseAlt = media?.kind === 'photo' ? media.alt : '';
  const [altDraft, setAltDraft] = React.useState(baseAlt);
  const [saving, setSaving] = React.useState(false);
  const [replacing, setReplacing] = React.useState(false);
  const [proposal, setProposal] = React.useState<Proposal>(NO_PROPOSAL);
  const writeSeq = React.useRef(0);

  // A different photo (‹ › or a new click) starts from its own alt text and drops any proposal.
  React.useEffect(() => {
    setAltDraft(baseAlt);
    setProposal(NO_PROPOSAL);
    writeSeq.current += 1;
  }, [mediaKey, baseAlt]);

  const altDirty = Boolean(alt?.editable) && cleanAltText(altDraft) !== cleanAltText(baseAlt);

  const write = async () => {
    if (!alt?.write) return;
    const seq = ++writeSeq.current;
    setProposal({ loading: true, value: '', error: false });
    try {
      const text = await alt.write();
      if (seq === writeSeq.current) setProposal({ loading: false, value: cleanAltText(text), error: false });
    } catch (err) {
      if (seq === writeSeq.current) setProposal({ loading: false, value: '', error: aiErrorLine(tEtsy, err) });
    }
  };

  const save = async () => {
    if (!alt || !altDirty) return;
    setSaving(true);
    try {
      await alt.onSave(cleanAltText(altDraft));
    } catch {
      // The stager already showed why; the typed text stays in the field (still dirty) so Save can be retried.
    } finally {
      setSaving(false);
    }
  };

  const pickReplacement = async (file: File | undefined) => {
    if (!file || !onReplace) return;
    setReplacing(true);
    try {
      await onReplace(file);
    } finally {
      setReplacing(false);
    }
  };

  const isPhoto = media?.kind === 'photo';
  const title = !media
    ? ''
    : media.kind === 'photo'
      ? t('photos.panelTitle', { position: media.position, total: media.total })
      : t('video.label');
  const removing = Boolean(media?.removing);
  const accept = isPhoto ? IMAGE_TYPES.join(',') : VIDEO_TYPES.join(',');
  const showAlt = isPhoto && Boolean(alt) && !removing;

  return (
    <SidePanel
      open={open && Boolean(media)}
      onClose={onClose}
      size="lg"
      title={title}
      onPrev={onPrev}
      onNext={onNext}
      dirty={altDirty}
      onSave={altDirty ? () => { void save(); } : undefined}
      primary={showAlt && alt?.editable && !readOnly ? {
        id: 'save-alt',
        label: t('photos.saveAlt'),
        onClick: () => { void save(); },
        loading: saving,
        disabled: !altDirty,
        disabledReason: t('photos.saveAltDisabled'),
      } : undefined}
      secondary={{ id: 'close', label: t('photos.close'), onClick: onClose }}
      data-testid={testId ?? 'photo-panel'}
    >
      {media ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {removing ? (
            <Banner
              tone="danger"
              title={t('photos.willRemoveOnSend', { marketplace: marketplaceName })}
              action={onUndoRemove && !readOnly ? { id: 'undo-remove', label: t('banner.undo'), onClick: onUndoRemove } : undefined}
            />
          ) : media.pending ? (
            <Banner tone="attention" title={t('photos.pendingNote', { marketplace: marketplaceName })} />
          ) : null}

          <Box
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: `${radius.md}px`,
              border: `1px solid ${neutral[200]}`, backgroundColor: neutral[50], overflow: 'hidden', minHeight: 200,
            }}
          >
            {media.kind === 'photo' ? (
              <Box
                component="img"
                src={media.fullSrc || media.src}
                alt={media.alt}
                sx={{ display: 'block', maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', opacity: removing ? 0.4 : 1 }}
              />
            ) : media.src ? (
              <Box
                component="video"
                controls
                preload="metadata"
                src={media.src}
                poster={media.poster}
                sx={{ display: 'block', width: '100%', maxHeight: '60vh', backgroundColor: neutral[900], opacity: removing ? 0.4 : 1 }}
              />
            ) : media.poster ? (
              <Box component="img" src={media.poster} alt="" sx={{ display: 'block', maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
            ) : (
              <Box sx={{ p: '24px', fontSize: 13, color: neutral[500], textAlign: 'center' }}>{t('video.noPreview')}</Box>
            )}
          </Box>
          {media.kind === 'video' && media.processing ? (
            <Box sx={{ fontSize: 12, color: neutral[500] }}>{t('video.processing', { marketplace: marketplaceName })}</Box>
          ) : null}

          {showAlt && alt ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <FormField
                label={t('photos.altLabel')}
                helper={alt.editable ? t('photos.altHelper') : t('photos.altAfterSend', { marketplace: marketplaceName })}
                counter={{ value: altDraft.length, max: ALT_TEXT_MAX }}
                dirty={altDirty}
                onRevert={altDirty ? () => setAltDraft(baseAlt) : undefined}
                labelAction={alt.write && alt.editable && !readOnly ? (
                  <Button variant="ghost" size="sm" icon={icons.ai} onClick={() => { void write(); }} loading={proposal.loading} loadingLabel={t('ai.writing')}>
                    {t('photos.writeAltOne')}
                  </Button>
                ) : undefined}
              >
                <TextArea
                  value={altDraft}
                  onChange={(v) => setAltDraft(v.slice(0, ALT_TEXT_MAX))}
                  minRows={2}
                  maxRows={6}
                  maxLength={ALT_TEXT_MAX}
                  disabled={!alt.editable || readOnly}
                />
              </FormField>
              {proposal.loading || proposal.value || proposal.error ? (
                <FieldSuggestion
                  value={proposal.value}
                  counter={proposal.value ? { value: proposal.value.length, max: ALT_TEXT_MAX } : undefined}
                  loading={proposal.loading}
                  error={proposal.error}
                  onUse={() => { setAltDraft(proposal.value); setProposal(NO_PROPOSAL); }}
                  onDismiss={() => { writeSeq.current += 1; setProposal(NO_PROPOSAL); }}
                  onRetry={() => { void write(); }}
                  data-testid="photo-alt-suggestion"
                />
              ) : null}
            </Box>
          ) : null}

          {!readOnly && !removing ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {isPhoto && onMakePrimary && media.kind === 'photo' && media.position > 1 && !media.pending ? (
                <Button variant="secondary" size="sm" icon={icons.primaryPhoto} onClick={onMakePrimary}>{t('photos.makePrimary')}</Button>
              ) : null}
              {onReplace ? (
                <Button variant="secondary" size="sm" icon={icons.upload} loading={replacing} onClick={() => fileRef.current?.click()}>
                  {t('photos.replace')}
                </Button>
              ) : null}
              {onRemove ? (
                <Button variant="danger-ghost" size="sm" onClick={onRemove}>{t('photos.remove')}</Button>
              ) : null}
            </Box>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void pickReplacement(file);
            }}
          />
        </Box>
      ) : null}
    </SidePanel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// "Write alt text for N": one proposal per photo, nothing applied until Use / Use all.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AltBatchItem {
  id: string;
  src: string;
  position: number;
}

export interface AltTextBatchPanelProps {
  open: boolean;
  onClose: () => void;
  marketplaceName: string;
  items: AltBatchItem[];
  write: (item: AltBatchItem) => Promise<string>;
  /** Stages the accepted alt texts (one call per photo, existing `update_alt` op). */
  onUse: (accepted: Array<{ id: string; alt: string }>) => Promise<void>;
  'data-testid'?: string;
}

export function AltTextBatchPanel({ open, onClose, marketplaceName, items, write, onUse, 'data-testid': testId }: AltTextBatchPanelProps) {
  const t = useTranslations('listingEditor');
  const tEtsy = useTranslations('etsy');
  const [proposals, setProposals] = React.useState<Record<string, Proposal>>({});
  /** Photos the user used or dismissed in this session of the panel. */
  const [handled, setHandled] = React.useState<ReadonlySet<string>>(new Set());
  const [applying, setApplying] = React.useState(false);
  /** Per-photo request counter; only ever increases, so a stale answer from an earlier run can never land. */
  const seq = React.useRef<Record<string, number>>({});
  /** The photos this opening of the panel works on, snapshotted when it opens: a photo that gets alt text (Use)
   * leaves `items`, which must not restart the other proposals or ask the AI again. */
  const [sessionItems, setSessionItems] = React.useState<AltBatchItem[] | null>(null);
  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  const run = React.useCallback(async (item: AltBatchItem) => {
    const n = (seq.current[item.id] ?? 0) + 1;
    seq.current[item.id] = n;
    setProposals((p) => ({ ...p, [item.id]: { loading: true, value: '', error: false } }));
    try {
      const text = cleanAltText(await write(item));
      if (seq.current[item.id] !== n) return;
      setProposals((p) => ({ ...p, [item.id]: { loading: false, value: text, error: !text } }));
    } catch (err) {
      if (seq.current[item.id] !== n) return;
      setProposals((p) => ({ ...p, [item.id]: { loading: false, value: '', error: aiErrorLine(tEtsy, err) } }));
    }
  }, [write, tEtsy]);

  // Opening the panel writes proposals one photo at a time (the endpoint is per image; sequential keeps the AI
  // rate budget predictable). Closing cancels the queue.
  React.useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const snapshot = itemsRef.current;
    setSessionItems(snapshot);
    setHandled(new Set());
    setProposals(Object.fromEntries(snapshot.map((i) => [i.id, { loading: true, value: '', error: false }])));
    void (async () => {
      for (const item of snapshot) {
        if (cancelled) break;
        await run(item);
      }
    })();
    return () => {
      cancelled = true;
      // Invalidate answers still in flight without resetting the counters.
      for (const item of snapshot) seq.current[item.id] = (seq.current[item.id] ?? 0) + 1;
      setSessionItems(null);
    };
    // Only the closed → open transition starts a run.
  }, [open]);

  // Before the opening effect runs, the live list stands in for the snapshot. Photos that leave `items` (alt text
  // staged, photo removed) simply drop out of the list.
  const session = sessionItems ?? items;
  const currentIds = new Set(items.map((i) => i.id));
  const visible = session.filter((i) => !handled.has(i.id) && currentIds.has(i.id));
  const ready = visible.filter((i) => proposals[i.id]?.value && !proposals[i.id]?.loading);
  const markHandled = (ids: string[]) => setHandled((prev) => new Set([...prev, ...ids]));

  const apply = async (accepted: Array<{ id: string; alt: string }>) => {
    if (!accepted.length) return;
    setApplying(true);
    try {
      await onUse(accepted);
      markHandled(accepted.map((a) => a.id));
    } catch {
      // The stager already showed why; the proposals stay so Use can be retried.
    } finally {
      setApplying(false);
    }
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size="lg"
      title={t('photos.altBatchTitle')}
      meta={t('photos.altBatchIntro', { count: session.length, marketplace: marketplaceName })}
      primary={{
        id: 'use-all',
        label: t('ai.useAll'),
        onClick: () => { void apply(ready.map((i) => ({ id: i.id, alt: proposals[i.id].value }))); },
        loading: applying,
        disabled: ready.length === 0,
        disabledReason: t('photos.altBatchWaiting'),
      }}
      secondary={{ id: 'close', label: t('photos.close'), onClick: onClose }}
      data-testid={testId ?? 'alt-batch-panel'}
    >
      {session.length === 0 ? (
        <Box sx={{ fontSize: 13, color: neutral[600] }}>{t('photos.altBatchNone')}</Box>
      ) : visible.length === 0 ? (
        <Box sx={{ fontSize: 13, color: tone.success.fg }}>{t('photos.altBatchDone')}</Box>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {visible.map((item) => {
            const p = proposals[item.id] ?? { loading: true, value: '', error: false };
            return (
              <Box component="li" key={item.id} sx={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <Box
                  component="img"
                  src={item.src}
                  alt=""
                  sx={{ width: 72, height: 72, flexShrink: 0, objectFit: 'cover', borderRadius: `${radius.sm}px`, border: `1px solid ${neutral[200]}` }}
                />
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Box sx={{ fontSize: 12, color: neutral[500] }}>{t('photos.photoN', { position: item.position })}</Box>
                  <FieldSuggestion
                    value={p.value}
                    counter={p.value ? { value: p.value.length, max: ALT_TEXT_MAX } : undefined}
                    loading={p.loading}
                    error={p.error}
                    onUse={() => { void apply([{ id: item.id, alt: p.value }]); }}
                    onDismiss={() => {
                      seq.current[item.id] = (seq.current[item.id] ?? 0) + 1;
                      markHandled([item.id]);
                    }}
                    onRetry={() => { void run(item); }}
                  />
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </SidePanel>
  );
}

export default PhotoPanel;

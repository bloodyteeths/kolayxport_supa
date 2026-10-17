// components/domain/listing-editor/AiVideoPanel.tsx — "✦ Create video": an AI product video (Google Veo) from one of
// the listing's photos and a description, refined with follow-ups until the seller likes it, then staged as the
// listing video (same path as an uploaded file — nothing reaches the marketplace until the seller sends).
// Server: pages/api/ai/video (jobs, ~1 min each; every follow-up is a new version kept in the strip).
import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { TextArea } from '@/components/ds/inputs/TextArea';
import { FormField } from '@/components/ds/inputs/FormField';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { accent, neutral as n, radius } from '@/lib/ds/tokens';

export type AiVideoSource = { id: string; src: string; fullSrc?: string };

type Job = {
  id: string;
  parentId: string | null;
  status: 'running' | 'done' | 'failed';
  instruction: string | null;
  errorKey: string | null;
  url: string | null;
  createdAt: string;
};

export interface AiVideoPanelProps {
  open: boolean;
  onClose(): void;
  images: AiVideoSource[];
  /** Stages the chosen video as the listing video (VideoUploader). */
  onUse(file: File): Promise<void> | void;
  defaultPrompt?: string;
}

const POLL_MS = 5000;

export function AiVideoPanel({ open, onClose, images, onUse, defaultPrompt }: AiVideoPanelProps) {
  const t = useTranslations('listingEditor.aiVideo');
  const toast = useToast();
  const [source, setSource] = useState<string | null>(images[0]?.id ?? null);
  const [prompt, setPrompt] = useState(defaultPrompt ?? '');
  const [aspect, setAspect] = useState<'9:16' | '16:9'>('9:16');
  const [duration, setDuration] = useState<'6' | '8'>('8');
  const [quality, setQuality] = useState<'fast' | 'best'>('fast');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [starting, setStarting] = useState(false);
  const [using, setUsing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(0);

  useEffect(() => { if (!source && images[0]) setSource(images[0].id); }, [images, source]);
  useEffect(() => { if (open && !prompt && defaultPrompt) setPrompt(defaultPrompt); }, [open, defaultPrompt, prompt]);

  const cur = jobs.find((j) => j.id === current) ?? null;
  const running = jobs.some((j) => j.status === 'running');

  // Poll the running versions; tick the elapsed counter.
  useEffect(() => {
    if (!running) return undefined;
    const ids = jobs.filter((j) => j.status === 'running').map((j) => j.id).join(',');
    const poll = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/ai/video?ids=${encodeURIComponent(ids)}`, { credentials: 'same-origin' });
        const d = await r.json();
        if (Array.isArray(d?.jobs)) setJobs((prev) => prev.map((p) => d.jobs.find((x: Job) => x.id === p.id) ?? p));
      } catch { /* next tick */ }
    }, POLL_MS);
    const tick = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [running, jobs]);

  const start = async (follow?: string) => {
    const img = images.find((i) => i.id === source);
    if (!follow && (!img || !prompt.trim())) return;
    setStarting(true);
    try {
      const body = follow && cur
        ? { parentId: cur.id, instruction: follow, quality }
        : { sourceUrl: img?.fullSrc || img?.src, prompt: prompt.trim(), aspectRatio: aspect, durationSec: Number(duration), quality };
      const r = await fetch('/api/ai/video', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.job) {
        toast.error(t(`error.${d?.code === 'videoBusy' ? 'busy' : d?.code === 'imageRequired' ? 'image' : 'start'}`));
        return;
      }
      startedAt.current = Date.now();
      setElapsed(0);
      setJobs((prev) => [...prev, d.job]);
      setCurrent(d.job.id);
      setAsk('');
    } finally {
      setStarting(false);
    }
  };

  const use = async () => {
    if (!cur?.url) return;
    setUsing(true);
    try {
      const blob = await (await fetch(cur.url, { credentials: 'same-origin' })).blob();
      await onUse(new File([blob], `ai-video-${cur.id}.mp4`, { type: 'video/mp4' }));
      toast.success(t('used'));
      onClose();
    } catch {
      toast.error(t('error.use'));
    } finally {
      setUsing(false);
    }
  };

  const chips = useMemo(() => [t('chip.slower'), t('chip.closer'), t('chip.turn'), t('chip.background'), t('chip.light')], [t]);
  const versionNo = (id: string) => jobs.findIndex((j) => j.id === id) + 1;

  return (
    <SidePanel
      padded
      open={open}
      onClose={onClose}
      size="md"
      title={t('title')}
      meta={t('subtitle')}
      secondary={{ id: 'aivideo-close', label: t('close'), onClick: onClose }}
      primary={cur?.status === 'done'
        ? { id: 'aivideo-use', label: t('use'), onClick: () => void use(), loading: using }
        : { id: 'aivideo-start', label: cur ? t('newVideo') : t('create'), onClick: () => void start(), loading: starting, disabled: running || !source || !prompt.trim() }}
      data-testid="ai-video-panel"
    >
      {/* 1. Photo */}
      <FormField label={t('photo')} helper={t('photoHelp')}>
        <Box sx={{ display: 'flex', gap: '8px', overflowX: 'auto', pb: '4px' }} role="radiogroup" aria-label={t('photo')}>
          {images.map((img) => (
            <Box
              key={img.id}
              component="button"
              type="button"
              role="radio"
              aria-checked={source === img.id}
              onClick={() => setSource(img.id)}
              disabled={running}
              sx={{ flexShrink: 0, p: 0, width: 72, height: 72, borderRadius: `${radius.md}px`, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${source === img.id ? accent[600] : 'transparent'}`, outline: source === img.id ? `2px solid ${accent[100]}` : 'none', bgcolor: n[100] }}
            >
              <Box component="img" src={img.src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </Box>
          ))}
        </Box>
      </FormField>

      {/* 2. Description + format (first version only; follow-ups keep them) */}
      {!cur ? (
        <>
          <FormField label={t('prompt')} helper={t('promptHelp')}>
            <TextArea value={prompt} onChange={(v) => setPrompt(v.slice(0, 1200))} minRows={3} maxRows={8} placeholder={t('promptPlaceholder')} />
          </FormField>
          <Box sx={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <FormField label={t('format')}>
              <SegmentedControl<'9:16' | '16:9'> value={aspect} onChange={setAspect} size="sm" aria-label={t('format')} options={[{ value: '9:16', label: t('vertical') }, { value: '16:9', label: t('horizontal') }]} />
            </FormField>
            <FormField label={t('length')}>
              <SegmentedControl<'6' | '8'> value={duration} onChange={setDuration} size="sm" aria-label={t('length')} options={[{ value: '6', label: t('seconds', { count: 6 }) }, { value: '8', label: t('seconds', { count: 8 }) }]} />
            </FormField>
            <FormField label={t('quality')}>
              <SegmentedControl<'fast' | 'best'> value={quality} onChange={setQuality} size="sm" aria-label={t('quality')} options={[{ value: 'fast', label: t('fast') }, { value: 'best', label: t('best') }]} />
            </FormField>
          </Box>
        </>
      ) : null}

      {/* 3. Result */}
      {cur ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {cur.status === 'running' ? (
            <Box sx={{ borderRadius: `${radius.md}px`, bgcolor: n[50], border: `1px dashed ${n[300]}`, p: '24px 16px', textAlign: 'center', color: n[600], fontSize: 14 }} data-testid="ai-video-running">
              <Box sx={{ fontWeight: 600, color: n[800], mb: '4px' }}>{t('running', { version: versionNo(cur.id) })}</Box>
              {t('runningHint', { seconds: elapsed })}
            </Box>
          ) : cur.status === 'failed' ? (
            <Banner tone={cur.errorKey === 'videoChildPhoto' ? 'warning' : 'danger'} title={t(`error.${cur.errorKey === 'videoChildPhoto' ? 'childPhoto' : cur.errorKey === 'videoFiltered' ? 'filtered' : 'failed'}`)}>
              {cur.errorKey === 'videoChildPhoto' ? t('error.childPhotoHint') : undefined}
            </Banner>
          ) : cur.url ? (
            <Box
              component="video"
              key={cur.url}
              src={cur.url}
              controls
              autoPlay
              loop
              muted
              playsInline
              sx={{ width: '100%', maxHeight: '60vh', borderRadius: `${radius.md}px`, bgcolor: '#000', display: 'block' }}
              data-testid="ai-video-player"
            />
          ) : null}

          {cur.status !== 'running' ? (
            // Follow-up: each change is a new version from the same photo; earlier versions stay below.
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="ai-video-refine">
              <Box sx={{ fontSize: 13, fontWeight: 600, color: n[800] }}>{t('refineTitle')}</Box>
              <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {chips.map((c) => (
                  <Box key={c} component="button" type="button" disabled={starting || running} onClick={() => void start(c)}
                    sx={{ font: 'inherit', fontSize: 12, lineHeight: '16px', px: '10px', py: '4px', borderRadius: '999px', border: `1px solid ${accent[200]}`, bgcolor: accent[50], color: accent[700], cursor: 'pointer' }}>
                    {c}
                  </Box>
                ))}
              </Box>
              <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); if (ask.trim()) void start(ask.trim()); }} sx={{ display: 'flex', gap: '6px' }}>
                <Box component="input" value={ask} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAsk(e.target.value.slice(0, 400))} placeholder={t('refinePlaceholder')} aria-label={t('refinePlaceholder')}
                  sx={{ flex: 1, minWidth: 0, height: 36, px: '10px', borderRadius: '8px', border: `1px solid ${n[300]}`, font: 'inherit', fontSize: 14, '@media (pointer: coarse)': { fontSize: 16 } }} />
                <Box component="button" type="submit" disabled={!ask.trim() || starting || running}
                  sx={{ font: 'inherit', fontSize: 13, fontWeight: 600, px: '14px', borderRadius: '8px', border: 'none', bgcolor: accent[600], color: '#fff', cursor: 'pointer', '&:disabled': { opacity: 0.5, cursor: 'default' } }}>
                  {t('refineSend')}
                </Box>
              </Box>
            </Box>
          ) : null}

          {jobs.length > 1 ? (
            <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }} data-testid="ai-video-versions">
              <Box component="span" sx={{ fontSize: 12, color: n[500] }}>{t('versions')}</Box>
              {jobs.map((j, i) => (
                <Box key={j.id} component="button" type="button" onClick={() => setCurrent(j.id)} title={j.instruction ?? ''}
                  sx={{ font: 'inherit', fontSize: 12, px: '8px', py: '3px', borderRadius: '6px', cursor: 'pointer', border: `1px solid ${j.id === current ? accent[500] : n[200]}`, bgcolor: j.id === current ? accent[50] : n[0], color: j.status === 'failed' ? n[400] : n[800] }}>
                  {t('version', { n: i + 1 })}{j.status === 'running' ? ' …' : ''}
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </SidePanel>
  );
}

export default AiVideoPanel;

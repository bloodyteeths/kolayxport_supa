// components/domain/media/WatermarkDialog.tsx — the one watermark dialog every channel's photo editor opens.
// Text or logo, size, nine positions or tiled, margin, opacity, a live preview rendered by the server on the
// seller's own photo, and saved presets. It only returns the spec: the caller watermarks and stages its photos.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { TextField } from '@/components/ds/inputs/TextField';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { Select } from '@/components/ds/inputs/Select';
import { Button } from '@/components/ds/inputs/Button';
import { neutral, accent } from '@/lib/ds/tokens';
import {
  WATERMARK_DEFAULT,
  WATERMARK_LIMITS,
  WATERMARK_POSITIONS,
  WATERMARK_TEXT_MAX,
  normalizeWatermarkSpec,
  type WatermarkPosition,
  type WatermarkSpec,
} from '@/lib/media/watermarkSpec';
import {
  deleteWatermarkPreset,
  listWatermarkPresets,
  saveWatermarkPreset,
  uploadWatermarkLogo,
  watermarkLogoUrl,
  watermarkPhoto,
  type WatermarkOriginRef,
  type WatermarkPreset,
} from '@/lib/media/watermarkClient';

export type WatermarkDialogProps = {
  open: boolean;
  onClose: () => void;
  /** A photo of the seller's to preview on (any URL the editors show). */
  previewUrl: string | null;
  /** Its listing + slot: a slot watermarked before previews on its stored original (what the result will use). */
  previewOrigin?: WatermarkOriginRef | null;
  /** Primary button text, e.g. "12 fotoğrafa filigran ekle". */
  applyLabel: string;
  /** Runs with the final spec; the dialog shows progress until it resolves. */
  onApply: (spec: WatermarkSpec) => Promise<void>;
  /** Scope controls of the caller (which photos), rendered above the preview. */
  children?: React.ReactNode;
};

const GRID: Exclude<WatermarkPosition, 'tile'>[] = ['tl', 'tc', 'tr', 'ml', 'c', 'mr', 'bl', 'bc', 'br'];

export function WatermarkDialog({ open, onClose, previewUrl, previewOrigin, applyLabel, onApply, children }: WatermarkDialogProps) {
  const t = useTranslations('watermark');
  const [draft, setDraft] = React.useState<WatermarkSpec>({ ...WATERMARK_DEFAULT });
  const [presets, setPresets] = React.useState<WatermarkPreset[]>([]);
  const [presetName, setPresetName] = React.useState('');
  const [preview, setPreview] = React.useState<string | null>(null);
  const [previewError, setPreviewError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [logoBusy, setLogoBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const spec = normalizeWatermarkSpec(draft);

  React.useEffect(() => {
    if (!open) return;
    void listWatermarkPresets().then((p) => {
      setPresets(p);
      if (p[0]) setDraft(p[0].spec); // the last-used preset comes first
    });
  }, [open]);

  // Live preview, rendered by the server exactly as the result will be (debounced).
  React.useEffect(() => {
    if (!open || !previewUrl || !spec) { setPreview(null); return; }
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      watermarkPhoto(previewUrl, spec, 'preview', ctl.signal, { origin: previewOrigin ?? undefined, preview: true })
        .then((file) => { setPreviewError(false); setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); }); })
        .catch(() => { if (!ctl.signal.aborted) setPreviewError(true); });
    }, 350);
    return () => { clearTimeout(timer); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewUrl, JSON.stringify(spec)]);

  const set = <K extends keyof WatermarkSpec>(k: K, v: WatermarkSpec[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      const { id } = await uploadWatermarkLogo(file);
      setDraft((d) => ({ ...d, kind: 'logo', logoId: id }));
    } catch { setPreviewError(true); } finally { setLogoBusy(false); }
  };
  const slider = (key: 'sizePct' | 'opacityPct' | 'marginPct', limits: readonly [number, number], label: string) => (
    <FormField label={`${label}: ${draft[key]}%`}>
      <Slider size="small" min={limits[0]} max={limits[1]} value={draft[key]} onChange={(_e, v) => set(key, v as number)} aria-label={label} />
    </FormField>
  );

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('title')}
      description={t('description')}
      size="md"
      primary={{
        id: 'apply',
        label: applyLabel,
        loading: busy,
        disabled: !spec,
        disabledReason: !spec ? t(draft.kind === 'text' ? 'needText' : 'needLogo') : undefined,
        onClick: async () => {
          if (!spec) return;
          setBusy(true);
          try { await onApply(spec); } finally { setBusy(false); }
        },
      }}
      secondary={{ id: 'cancel', label: t('cancel'), onClick: onClose }}
      data-testid="watermark-dialog"
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: '20px' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {presets.length ? (
            <FormField label={t('preset')}>
              <Select<string>
                value={presets.find((p) => JSON.stringify(p.spec) === JSON.stringify(spec))?.id ?? null}
                placeholder={t('presetPick')}
                onChange={(id) => { const p = presets.find((x) => x.id === id); if (p) setDraft(p.spec); }}
                options={presets.map((p) => ({ value: p.id, label: p.name }))}
              />
            </FormField>
          ) : null}
          <SegmentedControl<'text' | 'logo'>
            value={draft.kind}
            onChange={(k) => set('kind', k)}
            options={[{ value: 'text', label: t('kind.text') }, { value: 'logo', label: t('kind.logo') }]}
            aria-label={t('kindLabel')}
            fullWidth
          />
          {draft.kind === 'text' ? (
            <Box sx={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <Box sx={{ flex: 1 }}>
                <FormField label={t('text')}>
                  <TextField value={draft.text ?? ''} onChange={(v) => set('text', v)} maxLength={WATERMARK_TEXT_MAX} placeholder={t('textPlaceholder')} />
                </FormField>
              </Box>
              <Box component="input" type="color" aria-label={t('color')} value={draft.color ?? '#ffffff'} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('color', e.target.value)}
                sx={{ width: 40, height: 36, border: `1px solid ${neutral[300]}`, borderRadius: '6px', p: '2px', bgcolor: '#fff' }} />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {draft.logoId ? <Box component="img" src={watermarkLogoUrl(draft.logoId)} alt="" sx={{ width: 64, height: 40, objectFit: 'contain', bgcolor: neutral[100], borderRadius: '6px' }} /> : null}
              <Button variant="secondary" size="sm" loading={logoBusy} onClick={() => fileRef.current?.click()}>{draft.logoId ? t('logoChange') : t('logoUpload')}</Button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
              <Typography variant="caption" sx={{ color: neutral[600] }}>{t('logoHelp')}</Typography>
            </Box>
          )}
          <FormField label={t('position')}>
            <Box sx={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <Box role="radiogroup" aria-label={t('position')} sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 28px)', gap: '4px' }}>
                {GRID.map((p) => (
                  <Box key={p} component="button" type="button" role="radio" aria-checked={draft.position === p} aria-label={t(`pos.${p}`)} onClick={() => set('position', p)}
                    sx={{ width: 28, height: 28, borderRadius: '6px', cursor: 'pointer', border: `1px solid ${draft.position === p ? accent[600] : neutral[300]}`, bgcolor: draft.position === p ? accent[600] : '#fff' }} />
                ))}
              </Box>
              <Button variant={draft.position === 'tile' ? 'primary' : 'secondary'} size="sm" onClick={() => set('position', draft.position === 'tile' ? 'br' : 'tile')}>{t('pos.tile')}</Button>
            </Box>
          </FormField>
          {slider('sizePct', WATERMARK_LIMITS.size, t('size'))}
          {slider('opacityPct', WATERMARK_LIMITS.opacity, t('opacity'))}
          {slider('marginPct', WATERMARK_LIMITS.margin, t('margin'))}
          <Box sx={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <Box sx={{ flex: 1 }}>
              <FormField label={t('saveAs')}>
                <TextField value={presetName} onChange={setPresetName} maxLength={60} placeholder={t('saveAsPlaceholder')} />
              </FormField>
            </Box>
            <Button variant="secondary" size="sm" disabled={!spec || !presetName.trim()} onClick={async () => {
              if (!spec) return;
              const p = await saveWatermarkPreset(presetName.trim(), spec).catch(() => null);
              if (p) { setPresets((cur) => [p, ...cur.filter((x) => x.id !== p.id && x.name !== p.name)]); setPresetName(''); }
            }}>{t('save')}</Button>
          </Box>
          {presets.length ? (
            <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {presets.map((p) => (
                <Button key={p.id} variant="ghost" size="sm" onClick={async () => { await deleteWatermarkPreset(p.id); setPresets((cur) => cur.filter((x) => x.id !== p.id)); }}>
                  {t('deletePreset', { name: p.name })}
                </Button>
              ))}
            </Box>
          ) : null}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {children}
          <Box sx={{ aspectRatio: '1 / 1', bgcolor: neutral[100], borderRadius: '8px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-testid="watermark-preview">
            {preview ? <Box component="img" src={preview} alt={t('previewAlt')} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <Typography variant="caption" sx={{ color: neutral[600], p: '16px', textAlign: 'center' }}>{previewError ? t('previewError') : previewUrl ? t('previewLoading') : t('previewNone')}</Typography>}
          </Box>
          <Typography variant="caption" sx={{ color: neutral[600] }}>{t('stagedNote')}</Typography>
        </Box>
      </Box>
    </Modal>
  );
}

export default WatermarkDialog;

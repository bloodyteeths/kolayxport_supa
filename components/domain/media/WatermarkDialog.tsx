// components/domain/media/WatermarkDialog.tsx — the one watermark dialog every channel's photo editor opens.
// Text or logo, size, nine positions or tiled, margin, opacity, a live preview rendered by the server on the
// seller's own photo, and saved presets. It only returns the spec: the caller watermarks and stages its photos.
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
import { WatermarkPreview, previewSizedUrl } from '@/components/domain/media/WatermarkPreview';
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
  watermarkStorage,
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
  const locale = useLocale();
  const [draft, setDraft] = React.useState<WatermarkSpec>({ ...WATERMARK_DEFAULT });
  const [presets, setPresets] = React.useState<WatermarkPreset[]>([]);
  const [presetName, setPresetName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [logoBusy, setLogoBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const spec = normalizeWatermarkSpec(draft);

  const [storage, setStorage] = React.useState<{ bytes: number; cap: number; keptUntil: string } | null>(null);
  React.useEffect(() => {
    if (!open) return;
    void watermarkStorage().then(setStorage);
    void listWatermarkPresets().then((p) => {
      setPresets(p);
      if (p[0]) setDraft(p[0].spec); // the last-used preset comes first
    });
  }, [open]);

  // Live preview drawn in the browser on a cached ~800 px copy (instant on every slider move); the server renders the
  // full-resolution result only when staging.

  const set = <K extends keyof WatermarkSpec>(k: K, v: WatermarkSpec[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      const { id } = await uploadWatermarkLogo(file);
      setDraft((d) => ({ ...d, kind: 'logo', logoId: id }));
    } catch { /* the logo stays as it was */ } finally { setLogoBusy(false); }
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
              <Box component="input" type="color" aria-label={t('color')} value={draft.color ?? WATERMARK_DEFAULT.color} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('color', e.target.value)}
                sx={{ width: 40, height: 36, border: `1px solid ${neutral[300]}`, borderRadius: '6px', p: '2px', bgcolor: neutral[0] }} />
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
                    sx={{ width: 28, height: 28, borderRadius: '6px', cursor: 'pointer', border: `1px solid ${draft.position === p ? accent[600] : neutral[300]}`, bgcolor: draft.position === p ? accent[600] : neutral[0] }} />
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
        {/* On a phone the preview comes first (it is what the seller watches while moving the sliders). */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', order: { xs: -1, md: 0 } }}>
          {children}
          <Box sx={{ aspectRatio: '1 / 1', maxHeight: { xs: 220, md: 'none' }, bgcolor: neutral[100], borderRadius: '8px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-testid="watermark-preview">
            {previewUrl ? (
              <WatermarkPreview src={previewSizedUrl(previewUrl)} spec={spec ?? { ...draft, kind: 'text', text: '' }} alt={t('previewAlt')} />
            ) : (
              <Typography variant="caption" sx={{ color: neutral[600], p: '16px', textAlign: 'center' }}>{t('previewNone')}</Typography>
            )}
          </Box>
          <Typography variant="caption" sx={{ color: neutral[600] }}>{t('stagedNote')}</Typography>
          {storage ? (
            // Retention (180 days after the last watermark on a photo; 1 GB per account, oldest first).
            <Typography variant="caption" sx={{ color: neutral[600] }} data-testid="watermark-retention">
              {t('retention', {
                date: new Date(storage.keptUntil).toLocaleDateString(locale),
                used: Math.max(1, Math.round(storage.bytes / 1048576)),
                cap: Math.round(storage.cap / 1048576 / 1024),
              })}
            </Typography>
          ) : null}
        </Box>
      </Box>
    </Modal>
  );
}

export default WatermarkDialog;

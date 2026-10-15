// components/ds/inputs/ImageGrid.tsx — DS §4.6 / listing-editor §6: photo tiles with staged badges, drag reorder
// (mouse) and keyboard reorder (Space lifts, arrows move, Space drops, Esc cancels; announced via aria-live),
// upload tile, delete. Clicking a tile calls onOpen (the photo SidePanel edits alt text, replace, primary).
// `variant="strip"` is M6 editor Group S (BUILD_PLAN §4) and is not built here.
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { useTranslations } from 'next-intl';
import { neutral, accent, tone, radius, focusRing, type as typeScale } from '@/lib/ds/tokens';
import { COARSE, focusVisibleSx, useIntlLocale, fmtInt } from './_shared';
import { IconPrimary, IconUpload, IconClose, IconRevert, ICON_STROKE } from './_icons';
import type { DsBaseProps } from './types';

export interface GridImage {
  id: string;
  src: string;
  alt?: string;
  staged?: 'add' | 'delete' | 'reorder';
}

export interface ImageGridProps extends DsBaseProps {
  images: GridImage[];
  max: number;
  onReorder: (ids: string[]) => void;
  onUpload: (files: File[]) => void;
  onDelete: (id: string) => void;
  /** Undo a staged delete ("Will be removed · Undo"). */
  onUndoDelete?: (id: string) => void;
  onOpen: (id: string) => void;
  /** Flag tiles without alt text with a warning dot (Etsy). Default true. */
  flagMissingAlt?: boolean;
  accept?: string;
  disabled?: boolean;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

export function ImageGrid({
  images, max, onReorder, onUpload, onDelete, onUndoDelete, onOpen, flagMissingAlt = true, accept = 'image/*', disabled,
  className, 'data-testid': testId,
}: ImageGridProps) {
  const t = useTranslations('ds.inputs.images');
  const locale = useIntlLocale();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [lifted, setLifted] = useState<{ id: string; origin: string[] } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const ids = images.map((i) => i.id);
  const live = images.filter((i) => i.staged !== 'delete').length;
  const full = live >= max;

  const focusTile = (idx: number) => requestAnimationFrame(() => tileRefs.current[idx]?.focus());

  /** Every upload path (file input, drop on list, drop on tile) goes through here: capped at the free slots. */
  const upload = (files: File[]) => {
    if (disabled || full || !files.length) return;
    const room = Math.max(0, max - live);
    if (room > 0) onUpload(files.slice(0, room));
  };

  const onTileKey = (e: KeyboardEvent<HTMLDivElement>, idx: number, img: GridImage) => {
    // Keys pressed on the tile's own buttons (remove, Undo) belong to those buttons.
    if (e.target !== e.currentTarget) return;
    if (disabled) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (lifted) {
        setLifted(null);
        setAnnounce(t('dropped', { position: idx + 1, total: images.length }));
      } else {
        setLifted({ id: img.id, origin: ids });
        setAnnounce(t('lifted', { position: idx + 1, total: images.length }));
      }
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); onOpen(img.id); return; }
    if (e.key === 'Escape' && lifted) {
      e.preventDefault();
      onReorder(lifted.origin);
      setLifted(null);
      setAnnounce(t('cancelled'));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (img.staged === 'delete') { if (onUndoDelete) onUndoDelete(img.id); } else onDelete(img.id);
      return;
    }
    const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    const target = Math.max(0, Math.min(images.length - 1, idx + delta));
    if (lifted && lifted.id === img.id) {
      if (target !== idx) {
        onReorder(moveItem(ids, idx, target));
        setAnnounce(t('moved', { position: target + 1, total: images.length }));
      }
      focusTile(target);
    } else {
      focusTile(target);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files?.length) { upload(Array.from(e.dataTransfer.files)); return; }
    if (!dragId) return;
    const from = ids.indexOf(dragId);
    if (from >= 0 && from !== idx) onReorder(moveItem(ids, from, idx));
    setDragId(null);
  };

  return (
    <Box className={className} data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: neutral[500] }}>
        <span>{t('hint')}</span>
        <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: full ? tone.warning.fg : neutral[500] }}>
          {t('count', { value: fmtInt(live, locale), max: fmtInt(max, locale) })}
        </Box>
      </Box>
      <Box
        role="list"
        aria-label={t('label')}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); upload(Array.from(e.dataTransfer.files)); } }}
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '8px' }}
      >
        {images.map((img, idx) => {
          const removing = img.staged === 'delete';
          const isLifted = lifted?.id === img.id;
          const missingAlt = flagMissingAlt && !img.alt && !removing;
          return (
            <Box
              key={img.id}
              role="listitem"
              ref={(el: HTMLDivElement | null) => { tileRefs.current[idx] = el; }}
              tabIndex={0}
              aria-label={t('tile', { position: idx + 1, total: images.length, alt: img.alt || t('noAlt') })}
              aria-grabbed={isLifted || undefined}
              draggable={!disabled && !removing}
              onDragStart={() => setDragId(img.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e: DragEvent<HTMLDivElement>) => e.preventDefault()}
              onDrop={(e: DragEvent<HTMLDivElement>) => onDrop(e, idx)}
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => onTileKey(e, idx, img)}
              onClick={() => onOpen(img.id)}
              data-staged={img.staged}
              sx={{
                position: 'relative', aspectRatio: '1 / 1', borderRadius: `${radius.sm}px`, overflow: 'hidden', cursor: 'pointer',
                border: `1px solid ${isLifted ? accent[600] : neutral[200]}`, backgroundColor: neutral[100],
                boxShadow: isLifted ? focusRing : 'none', opacity: dragId === img.id ? 0.5 : 1,
                '&:focus-visible': { outline: 'none', boxShadow: focusRing },
                '&:hover .kx-tile-del, &:focus-within .kx-tile-del': { opacity: 1 },
              }}
            >
              <Box component="img" src={img.src} alt={img.alt ?? ''} loading="lazy" draggable={false} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: removing ? 0.4 : 1 }} />
              {idx === 0 && !removing ? (
                <Box aria-hidden sx={{ position: 'absolute', top: 4, left: 4, display: 'inline-flex', p: '2px', borderRadius: `${radius.xs}px`, backgroundColor: neutral[0], color: neutral[800] }}>
                  <IconPrimary size={12} strokeWidth={ICON_STROKE} />
                </Box>
              ) : null}
              {img.staged === 'add' ? (
                <Box sx={{ position: 'absolute', bottom: 4, left: 4, display: 'inline-flex', alignItems: 'center', gap: '4px', px: '6px', borderRadius: `${radius.full}px`, backgroundColor: neutral[0], fontSize: typeScale.micro[0], lineHeight: '16px', fontWeight: 500, color: tone.attention.fg }}>
                  <Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: tone.attention.solid }} />
                  {t('new')}
                </Box>
              ) : null}
              {missingAlt ? (
                <Box title={t('missingAlt')} sx={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '50%', backgroundColor: tone.warning.solid, border: `1px solid ${neutral[0]}` }} />
              ) : null}
              {removing ? (
                <Box sx={{ position: 'absolute', inset: 'auto 0 0 0', p: '4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', backgroundColor: neutral[0], fontSize: 11, lineHeight: '14px', color: tone.danger.fg, textAlign: 'center' }}>
                  <span>{t('willBeRemoved')}</span>
                  {onUndoDelete ? (
                    <ButtonBase onClick={(e) => { e.stopPropagation(); onUndoDelete(img.id); }} sx={{ gap: '2px', fontSize: 11, fontWeight: 500, color: accent[600], borderRadius: '4px', [COARSE]: { minHeight: 44, minWidth: 44, px: '8px' }, ...focusVisibleSx }}>
                      <IconRevert size={12} strokeWidth={ICON_STROKE} aria-hidden />
                      {t('undo')}
                    </ButtonBase>
                  ) : null}
                </Box>
              ) : !disabled ? (
                <ButtonBase
                  className="kx-tile-del"
                  aria-label={t('remove', { position: idx + 1 })}
                  onClick={(e) => { e.stopPropagation(); onDelete(img.id); }}
                  sx={{
                    // The button is the hit area (24, 44 on coarse pointers, inside the clipped tile); the inner chip is the visual.
                    position: 'absolute', bottom: 4, right: 4, width: 24, height: 24, borderRadius: `${radius.sm}px`,
                    color: neutral[700], opacity: 0, '&:focus-visible': { opacity: 1 }, '&:focus-visible > span': { boxShadow: focusRing },
                    [COARSE]: { opacity: 1, width: 44, height: 44, bottom: 0, right: 0 },
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24,
                      borderRadius: `${radius.sm}px`, backgroundColor: neutral[0], [COARSE]: { width: 32, height: 32 },
                    }}
                  >
                    <IconClose size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  </Box>
                </ButtonBase>
              ) : null}
            </Box>
          );
        })}
        {!full && !disabled ? (
          <ButtonBase
            onClick={() => fileRef.current?.click()}
            aria-label={t('upload')}
            sx={{
              aspectRatio: '1 / 1', borderRadius: `${radius.sm}px`, border: `1px dashed ${neutral[300]}`, color: neutral[600],
              display: 'flex', flexDirection: 'column', gap: '4px', fontSize: 12, backgroundColor: neutral[0],
              '&:hover': { backgroundColor: neutral[50], borderColor: neutral[400] }, ...focusVisibleSx,
            }}
          >
            <IconUpload size={20} strokeWidth={ICON_STROKE} aria-hidden />
            <span>{t('add')}</span>
          </ButtonBase>
        ) : null}
      </Box>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          upload(files);
          e.target.value = '';
        }}
      />
      <Box aria-live="assertive" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{announce}</Box>
    </Box>
  );
}

export default ImageGrid;

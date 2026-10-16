// components/ds/inputs/ImageGrid.tsx — DS §4.6 / listing-editor §6: photo tiles with staged badges, drag reorder
// (mouse) and keyboard reorder (Space lifts, arrows move, Space drops, Esc cancels; announced via aria-live),
// upload tile, delete. Clicking a tile calls onOpen (the photo SidePanel edits alt text, replace, primary).
// `variant="strip"` (listing-editor §4.6, M6 editor Group S): one horizontal row with h-scroll, tiles 96 desktop /
// 72 below 600px, an optional trailing video tile (Etsy) and an inline empty dropzone. Same keyboard, staging and
// badge rules as the grid; the video is not part of the photo order or the photo count.
import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { useTranslations } from 'next-intl';
import { neutral, accent, tone, radius, focusRing, type as typeScale } from '@/lib/ds/tokens';
import { COARSE, focusVisibleSx, useIntlLocale, fmtInt } from './_shared';
import { IconPrimary, IconUpload, IconClose, IconRevert, ICON_STROKE } from './_icons';
import { icons } from '@/lib/ds/icons';
import type { DsBaseProps } from './types';

export interface GridImage {
  id: string;
  src: string;
  alt?: string;
  staged?: 'add' | 'delete' | 'reorder';
}

/** The listing video shown as the strip's trailing tile (Etsy: at most one). */
export interface StripVideo {
  /** Video URL (staged local file or Etsy CDN). Used only when there is no poster. */
  src?: string;
  /** Poster/thumbnail image. */
  poster?: string;
  staged?: 'add' | 'delete';
}

export type ImageGridVariant = 'grid' | 'strip';

/** Strip tile edge: 96 from 600px up, 72 below (listing-editor §4.6). */
export const STRIP_TILE = { desktop: 96, mobile: 72 } as const;

export interface ImageGridProps extends DsBaseProps {
  /** `grid` (default) wraps tiles; `strip` is one h-scrolling row (listing editor photos section). */
  variant?: ImageGridVariant;
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
  /** Strip only: trailing video tile. `null`/absent with `onAddVideo` renders an "Add video" tile. */
  video?: StripVideo | null;
  /** Strip only: click / Enter on the video tile (opens the video SidePanel: player, replace, remove). */
  onOpenVideo?: () => void;
  /** Strip only: shows the "Add video" tile when there is no video. */
  onAddVideo?: () => void;
  /** Strip only: "Undo" on a video staged for removal. */
  onUndoDeleteVideo?: () => void;
  /**
   * Strip only: text inside the wide inline dropzone shown when there are no photos ("This listing has no
   * photos. Etsy needs at least 1 to publish"). Default: the "Add photos" label.
   */
  emptyMessage?: ReactNode;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

export function ImageGrid({
  variant = 'grid', images, max, onReorder, onUpload, onDelete, onUndoDelete, onOpen, flagMissingAlt = true, accept = 'image/*', disabled,
  video, onOpenVideo, onAddVideo, onUndoDeleteVideo, emptyMessage,
  className, 'data-testid': testId,
}: ImageGridProps) {
  const strip = variant === 'strip';
  const stripTile = { width: { xs: STRIP_TILE.mobile, sm: STRIP_TILE.desktop }, height: { xs: STRIP_TILE.mobile, sm: STRIP_TILE.desktop }, flexShrink: 0 } as const;
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
  const emptyStrip = images.length === 0;

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
    <Box className={className} data-testid={testId} data-variant={variant} sx={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: neutral[500] }}>
        {/* No reorder hint above an empty list (nothing to drag). */}
        <span>{images.length > 0 ? t('hint') : null}</span>
        <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: full ? tone.warning.fg : neutral[500] }}>
          {t('count', { value: fmtInt(live, locale), max: fmtInt(max, locale) })}
        </Box>
      </Box>
      <Box
        data-testid={strip ? 'image-strip-scroller' : undefined}
        sx={strip ? {
          display: 'flex', alignItems: 'stretch', gap: '8px', overflowX: 'auto', overflowY: 'hidden', minWidth: 0,
          // Room for the focus ring of the first/last tile inside the clipped scroller.
          p: '3px', m: '-3px', overscrollBehaviorX: 'contain', scrollSnapType: 'x proximity',
        } : { display: 'contents' }}
      >
      <Box
        role="list"
        aria-label={t('label')}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); upload(Array.from(e.dataTransfer.files)); } }}
        sx={strip
          ? { display: 'flex', gap: '8px', flexShrink: 0 }
          : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '8px' }}
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
                ...(strip ? { ...stripTile, scrollSnapAlign: 'start' } : null),
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
        {strip && emptyStrip && disabled && emptyMessage ? (
          // Disabled (e.g. while a sync runs): keep the publish-blocking message, without the upload action.
          <Box
            data-testid="image-strip-empty"
            data-disabled="true"
            sx={{
              ...stripTile, width: { xs: 240, sm: 320 }, px: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', lineHeight: '16px', fontSize: 12, color: neutral[600], borderRadius: `${radius.sm}px`,
              border: `1px dashed ${neutral[200]}`, backgroundColor: neutral[50],
            }}
          >
            {emptyMessage}
          </Box>
        ) : null}
        {!full && !disabled ? (
          <ButtonBase
            onClick={() => fileRef.current?.click()}
            // Empty strip with a message: the visible message is the accessible name (WCAG 2.5.3).
            aria-label={strip && emptyStrip && emptyMessage ? undefined : t('upload')}
            data-testid={strip && emptyStrip ? 'image-strip-empty' : undefined}
            sx={{
              aspectRatio: '1 / 1', borderRadius: `${radius.sm}px`, border: `1px dashed ${neutral[300]}`, color: neutral[600],
              display: 'flex', flexDirection: 'column', gap: '4px', fontSize: 12, backgroundColor: neutral[0],
              '&:hover': { backgroundColor: neutral[50], borderColor: neutral[400] }, ...focusVisibleSx,
              ...(strip ? stripTile : null),
              // Empty strip: one wide inline dropzone instead of a lone square.
              ...(strip && emptyStrip ? { aspectRatio: 'auto', width: { xs: 240, sm: 320 }, px: '16px', textAlign: 'center', lineHeight: '16px' } : null),
            }}
          >
            <IconUpload size={20} strokeWidth={ICON_STROKE} aria-hidden />
            <span>{strip && emptyStrip && emptyMessage ? emptyMessage : t('add')}</span>
          </ButtonBase>
        ) : null}
      </Box>
      {strip && (video || onAddVideo) ? (
        <>
          <Box aria-hidden sx={{ width: '1px', flexShrink: 0, alignSelf: 'stretch', backgroundColor: neutral[200], mx: '4px' }} />
          {video ? (
            <VideoTile
              video={video}
              disabled={disabled}
              onOpen={onOpenVideo}
              onUndo={onUndoDeleteVideo}
              sx={stripTile}
              labels={{ tile: t('videoTile'), video: t('video'), isNew: t('new'), willBeRemoved: t('willBeRemoved'), undo: t('undo'), undoLabel: t('undoVideo') }}
            />
          ) : !disabled && onAddVideo ? (
            <ButtonBase
              onClick={onAddVideo}
              aria-label={t('addVideo')}
              sx={{
                ...stripTile, borderRadius: `${radius.sm}px`, border: `1px dashed ${neutral[300]}`, color: neutral[600],
                display: 'flex', flexDirection: 'column', gap: '4px', fontSize: 12, backgroundColor: neutral[0],
                '&:hover': { backgroundColor: neutral[50], borderColor: neutral[400] }, ...focusVisibleSx,
              }}
            >
              <VideoGlyph size={20} strokeWidth={ICON_STROKE} aria-hidden />
              <span>{t('video')}</span>
            </ButtonBase>
          ) : null}
        </>
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
      <Box aria-live="assertive" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{announce}</Box>
    </Box>
  );
}

const VideoGlyph = icons.video;

interface VideoTileProps {
  video: StripVideo;
  disabled?: boolean;
  onOpen?: () => void;
  onUndo?: () => void;
  sx: Record<string, unknown>;
  labels: { tile: string; video: string; isNew: string; willBeRemoved: string; undo: string; undoLabel: string };
}

/**
 * Strip trailing tile: poster (or first frame), video glyph badge, staged add/delete badges like photo tiles.
 * The tile is a non-interactive group; "open" is a full-size inner button and Undo a separate sibling button
 * (no nested interactive controls). The open button's name carries the staged state.
 */
function VideoTile({ video, disabled, onOpen, onUndo, sx, labels }: VideoTileProps) {
  const removing = video.staged === 'delete';
  const name = video.staged === 'add' ? `${labels.tile}, ${labels.isNew}` : removing ? `${labels.tile}, ${labels.willBeRemoved}` : labels.tile;
  return (
    <Box
      role="group"
      aria-label={labels.video}
      data-testid="image-strip-video"
      data-staged={video.staged}
      sx={{ ...sx, position: 'relative', borderRadius: `${radius.sm}px`, overflow: 'hidden', border: `1px solid ${neutral[200]}`, backgroundColor: neutral[800] }}
    >
      <ButtonBase
        aria-label={name}
        disabled={disabled || !onOpen}
        onClick={() => { if (!disabled) onOpen?.(); }}
        sx={{
          position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', borderRadius: `${radius.sm}px`,
          cursor: onOpen && !disabled ? 'pointer' : 'default',
          '&:focus-visible': { outline: 'none', boxShadow: `inset ${focusRing}` },
        }}
      >
        {video.poster ? (
          <Box component="img" src={video.poster} alt="" loading="lazy" draggable={false} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: removing ? 0.4 : 1 }} />
        ) : video.src ? (
          <Box component="video" src={video.src} muted playsInline preload="metadata" aria-hidden sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: removing ? 0.4 : 1 }} />
        ) : null}
        <Box component="span" aria-hidden sx={{ position: 'absolute', top: 4, left: 4, display: 'inline-flex', alignItems: 'center', gap: '3px', px: '4px', py: '1px', borderRadius: `${radius.xs}px`, backgroundColor: neutral[0], color: neutral[800], fontSize: typeScale.micro[0], lineHeight: '14px', fontWeight: 500 }}>
          <VideoGlyph size={12} strokeWidth={ICON_STROKE} />
          {labels.video}
        </Box>
        {video.staged === 'add' ? (
          <Box component="span" aria-hidden sx={{ position: 'absolute', bottom: 4, left: 4, display: 'inline-flex', alignItems: 'center', gap: '4px', px: '6px', borderRadius: `${radius.full}px`, backgroundColor: neutral[0], fontSize: typeScale.micro[0], lineHeight: '16px', fontWeight: 500, color: tone.attention.fg }}>
            <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: tone.attention.solid }} />
            {labels.isNew}
          </Box>
        ) : null}
      </ButtonBase>
      {removing ? (
        <Box sx={{ position: 'absolute', inset: 'auto 0 0 0', p: '4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', backgroundColor: neutral[0], fontSize: 11, lineHeight: '14px', color: tone.danger.fg, textAlign: 'center' }}>
          <span aria-hidden>{labels.willBeRemoved}</span>
          {onUndo && !disabled ? (
            <ButtonBase aria-label={labels.undoLabel} onClick={() => onUndo()} sx={{ gap: '2px', fontSize: 11, fontWeight: 500, color: accent[600], borderRadius: '4px', [COARSE]: { minHeight: 44, minWidth: 44, px: '8px' }, ...focusVisibleSx }}>
              <IconRevert size={12} strokeWidth={ICON_STROKE} aria-hidden />
              {labels.undo}
            </ButtonBase>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

export default ImageGrid;

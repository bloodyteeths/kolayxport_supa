// components/domain/photo-studio/PhotoDetailPanel.tsx — M7-E PhotoStudio tile panel (pro-gating §4.2):
// `SidePanel lg` "Photo 3 of 6 · Wooden Keepsake Box": large preview, alt text, Replace / Remove / Make primary,
// AI alt text, Undo of a staged removal. It IS the listing editor's Photo detail (`PhotoPanel`, imported, not copied) fed with a studio
// tile; every action stages through the studio hook at once. ‹ › walk the photos of the same listing.
import * as React from 'react';
import { PhotoPanel, type PanelMedia } from '@/components/domain/listing-editor/sections/PhotoPanel';
import type { ListingPhotoView } from './studioModel';

export interface PhotoDetailPanelProps {
  open: boolean;
  onClose: () => void;
  view: ListingPhotoView | null;
  tileId: string | null;
  onNavigate: (tileId: string) => void;
  onSaveAlt: (alt: string) => Promise<void>;
  onWriteAlt: () => Promise<string>;
  onMakePrimary: () => void;
  onReplace: (file: File) => Promise<void>;
  /** Photo on Etsy: stages its removal. New (staged) photo: un-stages its upload. */
  onRemove: () => void;
  /** Takes back a staged removal (PATCH removeMediaIds). */
  onUndoRemove?: () => void;
  readOnly?: boolean;
}

export function PhotoDetailPanel({
  open, onClose, view, tileId, onNavigate, onSaveAlt, onWriteAlt, onMakePrimary, onReplace, onRemove, onUndoRemove, readOnly,
}: PhotoDetailPanelProps) {
  const tiles = view?.tiles ?? [];
  const index = tileId ? tiles.findIndex((t) => t.id === tileId) : -1;
  const tile = index >= 0 ? tiles[index] : null;
  const media: PanelMedia | null = tile
    ? {
      kind: 'photo',
      id: tile.id,
      src: tile.src,
      fullSrc: tile.fullSrc,
      alt: tile.alt,
      position: index + 1,
      total: tiles.length,
      pending: tile.pending,
      removing: tile.staged === 'delete',
    }
    : null;
  const etsyPhoto = Boolean(tile && !tile.pending && tile.imageId != null);
  return (
    <PhotoPanel
      open={open && Boolean(tile)}
      onClose={onClose}
      marketplaceName="Etsy"
      media={media}
      onPrev={index > 0 ? () => onNavigate(tiles[index - 1].id) : undefined}
      onNext={index >= 0 && index < tiles.length - 1 ? () => onNavigate(tiles[index + 1].id) : undefined}
      alt={tile ? { editable: etsyPhoto && !readOnly, onSave: onSaveAlt, write: etsyPhoto ? onWriteAlt : undefined } : undefined}
      onMakePrimary={etsyPhoto && !readOnly ? onMakePrimary : undefined}
      onReplace={etsyPhoto && !readOnly ? onReplace : undefined}
      // A new (staged) photo can always be taken out of the draft; a photo on Etsy keeps the last-photo rule.
      onRemove={!readOnly && (tile?.pending || (etsyPhoto && (view?.liveCount ?? 0) > 1)) ? onRemove : undefined}
      onUndoRemove={tile?.staged === 'delete' && !readOnly ? onUndoRemove : undefined}
      readOnly={readOnly}
      data-testid="photo-studio-panel"
    />
  );
}

export default PhotoDetailPanel;

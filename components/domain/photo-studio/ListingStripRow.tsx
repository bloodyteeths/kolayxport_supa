// components/domain/photo-studio/ListingStripRow.tsx — M7-E PhotoStudio: one listing row (pro-gating §4.2)
//   ☑ │ [48] Wooden Keepsake Box │ [1★][2][3][⊕ new][4]            5 / 20 · will remove 1
// The strip is the DS `ImageGrid variant="strip"` with the editor's staged states (add / delete / reorder).
// Single-tile edits (drag reorder, remove, add files, open the photo panel) stage at once through the hook;
// a staged removal has its Undo on the tile, staged reorders an "Undo order" under the caption (un-stage only).
// Read-only while the listing's draft is being sent or has a queued listing delete (never staged onto).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { Button } from '@/components/ds/inputs/Button';
import { ImageGrid } from '@/components/ds/inputs/ImageGrid';
import { Thumb } from '@/components/ds/data/Thumb';
import { Bone } from '@/components/ds/state/Skeletons';
import { font, neutral, tone } from '@/lib/ds/tokens';
import { IMAGE_TYPES } from '@/components/domain/listing-editor/sections/photosModel';
import { STUDIO_MAX_PHOTOS, type ListingPhotoView } from './studioModel';
import type { LoadStatus, StudioListing } from './usePhotoStudio';

export interface ListingStripRowProps {
  listing: StudioListing;
  view: ListingPhotoView | null;
  status: LoadStatus;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onReorder: (ids: string[]) => void;
  onUpload: (files: File[]) => void;
  onDelete: (tileId: string) => void;
  /** Takes back a staged removal (the tile's Undo). */
  onUndoDelete?: (tileId: string) => void;
  /** Drops the listing's staged reorders (shown while the draft holds any). */
  onUndoOrder?: () => void;
  onOpen: (tileId: string) => void;
  /** A run is in progress: strips are read-only until it ends. */
  busy?: boolean;
}

export function ListingStripRow({ listing, view, status, checked, onCheck, onReorder, onUpload, onDelete, onUndoDelete, onUndoOrder, onOpen, busy }: ListingStripRowProps) {
  const t = useTranslations('photoStudio');
  const locked = Boolean(listing.queuedDelete || listing.syncing);
  const readOnly = locked || Boolean(busy);
  const ai = view ? view.tiles.filter((x) => x.ai).length : 0;

  const caption: string[] = [];
  if (view) {
    caption.push(t('row.count', { count: view.liveCount, max: STUDIO_MAX_PHOTOS }));
    if (view.missingAlt) caption.push(t('row.needAlt', { count: view.missingAlt }));
    if (view.removing) caption.push(t('row.willRemove', { count: view.removing }));
    if (ai) caption.push(t('row.ai', { count: ai }));
  }

  return (
    <Box
      role="row"
      data-testid={`photo-studio-row-${listing.id}`}
      sx={{
        display: 'grid',
        gridTemplateColumns: '40px minmax(200px, 280px) minmax(0, 1fr) 180px',
        alignItems: 'center',
        gap: '12px',
        px: '12px',
        py: '10px',
        borderBottom: `1px solid ${neutral[100]}`,
        backgroundColor: checked ? neutral[25] : neutral[0],
      }}
    >
      <Box role="cell">
        <Checkbox
          checked={checked}
          onChange={onCheck}
          disabled={locked}
          aria-label={t('row.select', { title: listing.title })}
        />
      </Box>
      <Box role="cell" sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <Thumb src={listing.thumbUrl} alt="" size={48} />
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ fontSize: 14, fontWeight: 500, color: neutral[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={listing.title}>
            {listing.title}
          </Box>
          <Box sx={{ fontSize: 12, color: neutral[500], fontFamily: font.mono }}>{listing.id}</Box>
        </Box>
      </Box>
      <Box role="cell" sx={{ minWidth: 0 }}>
        {status === 'loading' || (!view && status !== 'error') ? (
          <Box sx={{ display: 'flex', gap: '8px' }} aria-busy="true" data-testid="photo-studio-strip-loading">
            {[0, 1, 2, 3].map((i) => <Bone key={i} w={64} h={64} />)}
          </Box>
        ) : status === 'error' || !view ? (
          <Box sx={{ fontSize: 13, color: tone.danger.fg }}>{t('row.loadFailed')}</Box>
        ) : (
          <ImageGrid
            variant="strip"
            images={view.tiles.map((x) => ({ id: x.id, src: x.src, alt: x.alt, staged: x.staged }))}
            max={STUDIO_MAX_PHOTOS}
            accept={IMAGE_TYPES.join(',')}
            onReorder={onReorder}
            onUpload={onUpload}
            onDelete={onDelete}
            onUndoDelete={onUndoDelete && !readOnly ? onUndoDelete : undefined}
            onOpen={onOpen}
            disabled={readOnly}
            emptyMessage={t('row.noPhotos')}
            data-testid={`photo-studio-strip-${listing.id}`}
          />
        )}
      </Box>
      <Box role="cell" sx={{ fontSize: 12, color: neutral[600], textAlign: 'right' }}>
        {listing.queuedDelete ? (
          <Box component="span" sx={{ color: tone.danger.fg }}>{t('row.queuedDelete')}</Box>
        ) : listing.syncing ? (
          <Box component="span">{t('row.sending')}</Box>
        ) : (
          <>
            {caption.join(' · ')}
            {onUndoOrder && !readOnly && view && view.ops.imageReorders.size > 0 ? (
              <Box sx={{ mt: '4px' }}>
                <Button variant="ghost" size="sm" onClick={onUndoOrder} data-testid={`photo-studio-undo-order-${listing.id}`}>{t('row.undoOrder')}</Button>
              </Box>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );
}

export default ListingStripRow;

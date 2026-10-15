// components/domain/photo-studio/VideoTab.tsx — M7-E PhotoStudio Video tab (pro-gating §4.2):
// one row per listing with its video tile; the operation row is "Add video to selected" (one file or link fanned
// out, as BulkVideoStudio does) · "Remove video from selected". Same staging path (`kind: 'video'`); the page
// header primary runs it. Etsy allows one video per listing: listings that already have one are skipped on Add.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { Select } from '@/components/ds/inputs/Select';
import { Button } from '@/components/ds/inputs/Button';
import { TextField } from '@/components/ds/inputs/TextField';
import { Thumb } from '@/components/ds/data/Thumb';
import { Bone } from '@/components/ds/state/Skeletons';
import { icons } from '@/lib/ds/icons';
import { font, neutral, radius, tone } from '@/lib/ds/tokens';
import { VIDEO_MAX_BYTES, VIDEO_TYPES } from '@/components/domain/listing-editor/sections/photosModel';
import type { ListingVideoView, VideoOp, VideoSource } from './studioModel';
import type { LoadStatus, StudioListing } from './usePhotoStudio';

export interface VideoOperationBarProps {
  op: VideoOp;
  onOp: (op: VideoOp) => void;
  source: VideoSource;
  onSource: (s: VideoSource) => void;
  file: File | null;
  onFile: (f: File | null) => void;
  url: string;
  onUrl: (v: string) => void;
  selectedCount: number;
  summary: React.ReactNode;
  disabled?: boolean;
  /** A picked file is not a video or is over Etsy's size limit. */
  onRejected: () => void;
}

export function VideoOperationBar({ op, onOp, source, onSource, file, onFile, url, onUrl, selectedCount, summary, disabled, onRejected }: VideoOperationBarProps) {
  const t = useTranslations('photoStudio');
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  return (
    <Box
      data-testid="photo-studio-video-operation"
      sx={{ border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px`, p: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: neutral[0] }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', minHeight: 40 }}>
        <SegmentedControl<VideoOp>
          value={op}
          onChange={onOp}
          options={[{ value: 'add', label: t('video.add') }, { value: 'remove', label: t('video.remove') }]}
          size="sm"
          aria-label={t('op.label')}
        />
        {op === 'add' ? (
          <>
            <Box component="span" sx={{ fontSize: 13, color: neutral[600] }}>{t('op.source')}</Box>
            <Box sx={{ width: 170 }}>
              <Select<VideoSource>
                value={source}
                onChange={onSource}
                options={[{ value: 'upload', label: t('source.upload') }, { value: 'url', label: t('video.sourceUrl') }]}
                size="sm"
                disabled={disabled}
                aria-label={t('op.source')}
              />
            </Box>
            {source === 'upload' ? (
              <>
                <Button variant="secondary" size="sm" icon={icons.upload} onClick={() => fileRef.current?.click()} disabled={disabled} disabledReason={t('blocker.running')}>
                  {file ? file.name : t('video.chooseFile')}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept={VIDEO_TYPES.join(',')}
                  data-testid="photo-studio-video-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    if (f && (!(VIDEO_TYPES as readonly string[]).includes(f.type) || f.size > VIDEO_MAX_BYTES)) { onRejected(); return; }
                    onFile(f);
                  }}
                />
              </>
            ) : null}
          </>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Box component="span" sx={{ fontSize: 13, color: neutral[600] }}>{t('appliesTo', { count: selectedCount })}</Box>
      </Box>
      {op === 'add' && source === 'url' ? (
        <TextField value={url} onChange={onUrl} placeholder={t('video.urlPlaceholder')} type="url" size="sm" disabled={disabled} aria-label={t('video.sourceUrl')} />
      ) : null}
      <Box sx={{ fontSize: 13, color: neutral[700] }} data-testid="photo-studio-video-summary">{summary}</Box>
    </Box>
  );
}

export interface VideoRowProps {
  listing: StudioListing;
  view: ListingVideoView | null;
  status: LoadStatus | undefined;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onRemove: () => void;
  onAddFile: (file: File) => void;
  /** Takes back the staged video upload / removal (un-stage only). */
  onUndo?: () => void;
  busy?: boolean;
}

export function VideoRow({ listing, view, status, checked, onCheck, onRemove, onAddFile, onUndo, busy }: VideoRowProps) {
  const t = useTranslations('photoStudio');
  const tEditor = useTranslations('listingEditor');
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const locked = Boolean(listing.queuedDelete || listing.syncing);
  const readOnly = locked || Boolean(busy);

  let state: React.ReactNode = null;
  let action: React.ReactNode = null;
  if (status !== 'ready' || !view) {
    state = status === 'error'
      ? <Box component="span" sx={{ color: tone.danger.fg }}>{t('row.loadFailed')}</Box>
      : <Bone w={120} h={20} />;
  } else if (view.stagedUpload) {
    state = <Box component="span" sx={{ color: tone.attention.fg }}>{t('video.willAdd')}</Box>;
    if (!readOnly && onUndo) action = <Button variant="ghost" size="sm" onClick={onUndo}>{tEditor('banner.undo')}</Button>;
  } else if (view.remote && view.removing) {
    state = <Box component="span" sx={{ color: tone.danger.fg }}>{t('video.willRemove')}</Box>;
    if (!readOnly && onUndo) action = <Button variant="ghost" size="sm" onClick={onUndo}>{tEditor('banner.undo')}</Button>;
  } else if (view.remote) {
    state = <Box component="span">{view.remote.state === 'processing' ? t('video.processing') : t('video.onEtsy')}</Box>;
    if (!readOnly) action = <Button variant="danger-ghost" size="sm" onClick={onRemove}>{t('video.removeOne')}</Button>;
  } else {
    state = <Box component="span" sx={{ color: neutral[500] }}>{t('video.none')}</Box>;
    if (!readOnly) {
      action = (
        <>
          <Button variant="secondary" size="sm" icon={icons.upload} onClick={() => fileRef.current?.click()}>{t('video.addOne')}</Button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept={VIDEO_TYPES.join(',')}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onAddFile(f);
            }}
          />
        </>
      );
    }
  }

  return (
    <Box
      role="row"
      data-testid={`photo-studio-video-row-${listing.id}`}
      sx={{
        display: 'grid', gridTemplateColumns: '40px minmax(200px, 1fr) 96px minmax(160px, 240px) 160px', alignItems: 'center', gap: '12px',
        px: '12px', py: '10px', borderBottom: `1px solid ${neutral[100]}`, backgroundColor: checked ? neutral[25] : neutral[0],
      }}
    >
      <Box role="cell"><Checkbox checked={checked} onChange={onCheck} disabled={locked} aria-label={t('row.select', { title: listing.title })} /></Box>
      <Box role="cell" sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <Thumb src={listing.thumbUrl} alt="" size={48} />
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ fontSize: 14, fontWeight: 500, color: neutral[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={listing.title}>{listing.title}</Box>
          <Box sx={{ fontSize: 12, color: neutral[500], fontFamily: font.mono }}>{listing.id}</Box>
        </Box>
      </Box>
      <Box role="cell">
        <Thumb src={view?.remote?.thumbnailUrl ?? null} alt="" size={64} />
      </Box>
      <Box role="cell" sx={{ fontSize: 13 }}>
        {listing.queuedDelete ? <Box component="span" sx={{ color: tone.danger.fg }}>{t('row.queuedDelete')}</Box> : listing.syncing ? t('row.sending') : state}
      </Box>
      <Box role="cell" sx={{ display: 'flex', justifyContent: 'flex-end' }}>{action}</Box>
    </Box>
  );
}

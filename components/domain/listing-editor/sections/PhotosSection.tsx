// components/domain/listing-editor/sections/PhotosSection.tsx — listing-editor §2.1 #1 "Photos & video" (M6 Group C).
// One photo strip at the top of the editor (Etsy 20, eBay 24): drag / keyboard reorder, drop files anywhere on the
// strip, staged badges (New, Will be removed, missing alt text), a trailing video tile (Etsy), and the photo panel
// (large preview, alt text with an inline AI proposal, Make primary, Replace, Remove).
// Etsy staging stays inside `components/etsy/{ImageManager,VideoUploader}` (embedded mode, same draft calls and
// mediaSafety rules); eBay pictures stay the `images` field the eBay adapter stages. Nothing here sends anything:
// photos reach the marketplace only with the footer's "Send changes".
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button } from '@/components/ds/inputs/Button';
import type { StripVideo } from '@/components/ds/inputs/ImageGrid';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { icons } from '@/lib/ds/icons';
import { neutral, tone } from '@/lib/ds/tokens';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { DraftRow, ListingSectionProps } from '@/lib/listingEditor/types';
import EtsyImageManager, { type ImageManagerHandle } from '@/components/etsy/ImageManager';
import VideoUploader, { type VideoUploaderHandle } from '@/components/etsy/VideoUploader';
import EbayImageManager, { type EbayImageManagerHandle } from '@/components/ebay/ImageManager';
import { useListingEditor, useRegisterDraftSection } from '../useListingDraft';
import type { WriteAltText } from './PhotoPanel';
import { PHOTO_MAX, type EtsyImageLike, type PhotosSummary } from './photosModel';

/** Imperative actions for the frame (score fixes, ⌘K): "Add photos", "Write alt text", "Add video", … */
export interface PhotosSectionHandle {
  openUpload(): void;
  generatePhoto(): void;
  /** Etsy only. */
  pasteLinks(): void;
  /** Etsy only: opens the video (or the file picker when there is none). */
  openVideo(): void;
  /** Etsy only: "Write alt text for N" (score fix `ai_alt_text`). */
  writeMissingAlt(): void;
  openPhoto(id?: string): void;
}

export interface PhotosSectionProps extends Partial<ListingSectionProps> {
  /** AI alt writer (useListingAI, Group H). Default: `/api/ai/etsy generate_alt_text` with the seoRules guards. `null` hides AI. */
  writeAltText?: WriteAltText | null;
  /**
   * Drops one staged EtsyDraftMedia row (undo a staged photo/video removal, remove a staged upload). There is no
   * route for it yet (requested); without it, removals are confirmed and staged uploads leave with Discard changes.
   */
  removeStagedMedia?: (draftMediaId: string) => Promise<void>;
  /** Frame access to the section's actions (score panel fixes). */
  handleRef?: React.Ref<PhotosSectionHandle>;
}

/** Changes whenever the draft's media rows (or the draft itself) change: sub-editors re-read staged media. */
export function mediaVersion(draft: Pick<DraftRow, 'id' | 'status' | 'media'> | null | undefined): string {
  if (!draft) return 'none';
  return `${draft.id}:${draft.status}:${(draft.media ?? []).map((m) => `${m.id}${m.operation}${m.rank ?? ''}${m.altText ?? ''}`).join(',')}`;
}

export function PhotosSection(props: PhotosSectionProps) {
  const ed = useListingEditor();
  return ed.marketplace === 'ebay' ? <EbayPhotos {...props} /> : <EtsyPhotos {...props} />;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Etsy
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface EtsyVideoRow {
  video_id: number;
  video_url?: string;
  thumbnail_url?: string;
  state?: string;
}

type VideoLoad = { status: 'idle' | 'loading' | 'ready' | 'error'; videos: EtsyVideoRow[] };

function EtsyPhotos({ id = 'photos', writeAltText, removeStagedMedia, handleRef }: PhotosSectionProps) {
  const t = useTranslations('listingEditor');
  const ed = useListingEditor();
  const { ctx, mode, readOnly, notifyChange, reportFacts, reloadDraft, marketplaceName } = ed;
  const listingId = ctx.listingId;
  const shopId = ctx.shopId;
  const isLocal = !listingId || Number(listingId) < 0;
  const imagesRef = React.useRef<ImageManagerHandle | null>(null);
  const videoRef = React.useRef<VideoUploaderHandle | null>(null);
  const [summary, setSummary] = React.useState<PhotosSummary | null>(null);
  const [videoTile, setVideoTile] = React.useState<StripVideo | null>(null);
  const [videoLoad, setVideoLoad] = React.useState<VideoLoad>({ status: 'idle', videos: [] });
  const [videoReload, setVideoReload] = React.useState(0);

  // Etsy photos as the legacy ImageManager reads them (decoded alt text comes from the adapter).
  const remoteImages = ed.view.meta.images;
  const imagesKey = remoteImages.map((i) => `${i.id}:${i.rank}:${i.alt}`).join('|');
  const images: Array<EtsyImageLike & { url_75x75: string; url_170x135: string }> = React.useMemo(
    () => remoteImages.map((img) => ({
      listing_image_id: Number(img.id),
      url_75x75: img.thumbSrc || img.src,
      url_170x135: img.src,
      url_570xN: img.src,
      url_fullxfull: img.fullSrc || img.src,
      rank: img.rank,
      alt_text: img.alt,
    })),
    // imagesKey stands for remoteImages (a new array whenever the view re-merges).
    [imagesKey],
  );

  // Videos: their own region (a failure never blocks photos or fields). Re-read after a refresh/send.
  const remoteUpdated = ed.view.meta.updatedAt ? new Date(ed.view.meta.updatedAt).getTime() : 0;
  React.useEffect(() => {
    if (isLocal || !listingId) {
      setVideoLoad({ status: 'ready', videos: [] });
      return undefined;
    }
    let cancelled = false;
    setVideoLoad((v) => ({ status: 'loading', videos: v.videos }));
    const params = new URLSearchParams({ action: 'get_listing_videos', listing_id: listingId, shop_id: shopId });
    fetch(`/api/clawd/etsy?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rows: Array<Record<string, unknown>> = Array.isArray(data?.videos) ? data.videos : Array.isArray(data?.results) ? data.results : [];
        const videos = rows.map((v) => ({
          video_id: Number(v.video_id),
          video_url: typeof v.video_url === 'string' ? v.video_url : undefined,
          thumbnail_url: typeof v.thumbnail_url === 'string' ? v.thumbnail_url : undefined,
          state: typeof v.video_state === 'string' ? v.video_state : typeof v.state === 'string' ? v.state : undefined,
        })).filter((v) => Number.isFinite(v.video_id));
        if (!cancelled) setVideoLoad({ status: 'ready', videos });
      })
      .catch(() => { if (!cancelled) setVideoLoad((v) => ({ status: 'error', videos: v.videos })); });
    return () => { cancelled = true; };
  }, [isLocal, listingId, shopId, remoteUpdated, videoReload]);

  const version = mediaVersion(ed.draft);
  const afterStage = React.useCallback(() => {
    // Media rows live on the draft: re-read it so "Not sent yet" and the count include the photo change.
    void reloadDraft();
    notifyChange();
  }, [reloadDraft, notifyChange]);

  useRegisterDraftSection({
    id: 'photos',
    key: 'photos:images',
    isDirty: () => imagesRef.current?.isDirty() ?? false,
    stage: () => imagesRef.current?.stage() ?? Promise.resolve(),
    changes: () => [{ group: 'photoOrder' }],
  });
  useRegisterDraftSection({
    id: 'photos',
    key: 'photos:video',
    isDirty: () => videoRef.current?.isDirty() ?? false,
    stage: () => videoRef.current?.stage() ?? Promise.resolve(),
    changes: () => [{ group: 'video' }],
  });

  // Score + preview inputs: photos as they will be after Send; video unknown (na) when it could not load.
  React.useEffect(() => {
    if (!summary) return;
    reportFacts({
      images: summary.images,
      hasVideo: videoLoad.status === 'error' ? undefined : summary.hasVideo,
    });
  }, [summary, videoLoad.status, reportFacts]);

  const altEnabled = writeAltText !== null;
  const missingAlt = summary?.missingAlt ?? 0;
  const count = summary?.count ?? images.length;
  // Staged removals keep their slot until Send (uploads go first), so capacity counts them.
  const slots = summary?.slots ?? images.length;
  const full = slots >= PHOTO_MAX.etsy;
  const fullUntilSent = full && count < slots;
  const hasVideo = Boolean(videoTile);

  React.useImperativeHandle(handleRef, () => ({
    openUpload: () => imagesRef.current?.openUpload(),
    generatePhoto: () => imagesRef.current?.openGenerate(),
    pasteLinks: () => imagesRef.current?.openPasteLinks(),
    openVideo: () => videoRef.current?.open(),
    writeMissingAlt: () => imagesRef.current?.writeMissingAlt(),
    openPhoto: (photoId?: string) => imagesRef.current?.openPhoto(photoId),
  }), []);

  if (!listingId) {
    // Resuming a staged new listing: the strip appears once the draft (and its local id) is loaded.
    return (
      <Section id={sectionAnchorId(id)} title={t('section.photos')} variant="plain" data-testid="le-section-photos">
        <Box sx={{ height: 96 }} />
      </Section>
    );
  }

  const emptyMessage = mode === 'create'
    ? (
      <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '4px' }}>
        <span>{t('photos.dropzone')}</span>
        <Box component="span" sx={{ fontWeight: 500 }}>{t('photos.choose')}</Box>
      </Box>
    )
    : t('photos.noPhotos', { marketplace: marketplaceName });

  return (
    <Section
      id={sectionAnchorId(id)}
      title={t('section.photos')}
      variant="plain"
      headerSlot={missingAlt > 0 ? (
        <Box component="span" sx={{ fontSize: 12, color: tone.warning.fg }}>{t('photos.needAlt', { count: missingAlt })}</Box>
      ) : undefined}
      data-testid="le-section-photos"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
        <EtsyImageManager
          ref={imagesRef}
          embedded
          listingId={listingId}
          shopId={shopId}
          images={images}
          onImagesChanged={afterStage}
          listingTitle={String(ed.view.fields.title ?? '')}
          listingDescription={String(ed.view.fields.description ?? '')}
          writeAltText={writeAltText}
          video={videoLoad.status === 'error' && !videoTile ? null : videoTile}
          onOpenVideo={() => videoRef.current?.open()}
          onAddVideo={videoLoad.status === 'ready' ? () => videoRef.current?.pick() : undefined}
          onUndoDeleteVideo={removeStagedMedia ? () => videoRef.current?.undoRemove() : undefined}
          onSummary={setSummary}
          removeStagedMedia={removeStagedMedia}
          draftVersion={version}
          readOnly={readOnly}
          emptyMessage={emptyMessage}
          onLocalChange={notifyChange}
        />
        <VideoUploader
          ref={videoRef}
          embedded
          listingId={listingId}
          shopId={shopId}
          videos={videoLoad.videos}
          onVideoChanged={afterStage}
          onTileChange={setVideoTile}
          removeStagedMedia={removeStagedMedia}
          draftVersion={version}
          readOnly={readOnly}
          onLocalChange={notifyChange}
        />
        {mode === 'create' && count === 0 ? (
          <Box sx={{ fontSize: 12, color: neutral[500] }}>{t('photos.hint', { max: PHOTO_MAX.etsy })}</Box>
        ) : null}
        {videoLoad.status === 'error' ? (
          <ErrorState
            variant="inline"
            title={t('video.loadFailed')}
            onRetry={() => setVideoReload((n) => n + 1)}
            retrying={false}
          />
        ) : null}
        {!readOnly && fullUntilSent ? (
          <Box sx={{ fontSize: 12, color: neutral[500] }}>{t('photos.fullUntilSent', { max: PHOTO_MAX.etsy, marketplace: marketplaceName })}</Box>
        ) : null}
        {!readOnly ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            {!full ? (
              <Box component="span" id={fieldAnchorId('photos')} tabIndex={-1} sx={{ outline: 'none' }}>
                <Button variant="ghost" size="sm" icon={icons.upload} onClick={() => imagesRef.current?.openUpload()}>{t('photos.choose')}</Button>
              </Box>
            ) : null}
            {!full ? (
              <Button variant="ghost" size="sm" icon={icons.ai} onClick={() => imagesRef.current?.openGenerate()}>{t('ai.generatePhoto')}</Button>
            ) : null}
            {!full ? (
              <Button variant="ghost" size="sm" onClick={() => imagesRef.current?.openPasteLinks()}>{t('photos.pasteLinks')}</Button>
            ) : null}
            {altEnabled && missingAlt > 0 ? (
              <Button variant="ghost" size="sm" icon={icons.ai} onClick={() => imagesRef.current?.writeMissingAlt()}>
                {t('ai.writeAlt', { count: missingAlt })}
              </Button>
            ) : null}
            {!hasVideo && videoLoad.status === 'ready' ? (
              <Box component="span" id={fieldAnchorId('video')} tabIndex={-1} sx={{ outline: 'none' }}>
                <Button variant="ghost" size="sm" icon={icons.video} onClick={() => videoRef.current?.pick()}>{t('video.add')}</Button>
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// eBay (picture URLs are the `images` field; the eBay adapter stages them)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function asUrlList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
}

function EbayPhotos({ id = 'photos', handleRef }: PhotosSectionProps) {
  const t = useTranslations('listingEditor');
  const ed = useListingEditor();
  const { readOnly, reportFacts, setField, mode, marketplaceName } = ed;
  const ref = React.useRef<EbayImageManagerHandle | null>(null);
  const images = asUrlList(ed.view.fields.images);
  const baseline = asUrlList(ed.remote?.images);
  const [summary, setSummary] = React.useState<PhotosSummary | null>(null);

  useRegisterDraftSection({
    id: 'photos',
    key: 'photos:images',
    isDirty: () => ref.current?.isDirty() ?? false,
    stage: () => ref.current?.stage() ?? Promise.resolve(),
    changes: () => [{ group: 'photos' }],
  });

  React.useEffect(() => {
    if (summary) reportFacts({ images: summary.images, hasVideo: false });
  }, [summary, reportFacts]);

  React.useImperativeHandle(handleRef, () => ({
    openUpload: () => ref.current?.openUpload(),
    generatePhoto: () => ref.current?.openGenerate(),
    pasteLinks: () => undefined,
    openVideo: () => undefined,
    writeMissingAlt: () => undefined,
    openPhoto: () => ref.current?.openPhoto(),
  }), []);

  const full = images.length >= PHOTO_MAX.ebay;
  const emptyMessage = mode === 'create'
    ? (
      <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '4px' }}>
        <span>{t('photos.dropzone')}</span>
        <Box component="span" sx={{ fontWeight: 500 }}>{t('photos.choose')}</Box>
      </Box>
    )
    : t('photos.noPhotos', { marketplace: marketplaceName });

  return (
    <Section id={sectionAnchorId(id)} title={t('section.photosEbay')} variant="plain" data-testid="le-section-photos">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
        <EbayImageManager
          ref={ref}
          embedded
          images={images}
          baseline={mode === 'edit' ? baseline : []}
          onImagesChanged={(next) => setField('images', next)}
          productTitle={String(ed.view.fields.title ?? '')}
          maxImages={PHOTO_MAX.ebay}
          onSummary={setSummary}
          readOnly={readOnly}
          emptyMessage={emptyMessage}
        />
        {mode === 'create' && images.length === 0 ? (
          <Box sx={{ fontSize: 12, color: neutral[500] }}>{t('photos.hintEbay', { max: PHOTO_MAX.ebay })}</Box>
        ) : null}
        {!readOnly && !full ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <Box component="span" id={fieldAnchorId('photos')} tabIndex={-1} sx={{ outline: 'none' }}>
              <Button variant="ghost" size="sm" icon={icons.upload} onClick={() => ref.current?.openUpload()}>{t('photos.choose')}</Button>
            </Box>
            <Button variant="ghost" size="sm" icon={icons.ai} onClick={() => ref.current?.openGenerate()}>{t('ai.generatePhoto')}</Button>
          </Box>
        ) : null}
      </Box>
    </Section>
  );
}

export default PhotosSection;

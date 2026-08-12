import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Typography, Button, IconButton, Checkbox, TextField, Chip, Tooltip,
  ToggleButton, ToggleButtonGroup, CircularProgress, LinearProgress, InputAdornment,
  Dialog, DialogTitle, DialogContent,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Close as CloseIcon,
  UploadFile as UploadIcon,
  Link as LinkIcon,
  PlayCircle as PlayIcon,
  Videocam as VideoIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { stageEtsyDraft, stageEtsyDraftFile } from '@/lib/etsy/draftClient';

interface StudioListing {
  listing_id: number;
  title: string;
  thumbnail?: { url_75x75?: string } | null;
}

interface ListingVideo {
  video_id: number;
  video_url?: string;
  thumbnail_url?: string;
  video_state?: string;
}

interface BulkVideoStudioProps {
  shopId: string;
  listings: StudioListing[];
  checkedIds: Set<number>;
  onToggleChecked: (id: number) => void;
  onToggleAll: () => void;
  onSetChecked: (ids: number[]) => void;
  allChecked: boolean;
  someChecked: boolean;
  searchTerm: string;
  onSearchChange: (v: string) => void;
  onCompleted: () => void;
}

type VideoOp = 'add' | 'delete';
type VideoSource = 'upload' | 'url';

export default function BulkVideoStudio(props: BulkVideoStudioProps) {
  const {
    shopId, listings, checkedIds, onToggleChecked, onToggleAll, onSetChecked,
    allChecked, someChecked, searchTerm, onSearchChange, onCompleted,
  } = props;
  const t = useTranslations('etsy.bulkEditor');

  const [op, setOp] = useState<VideoOp>('add');
  const [source, setSource] = useState<VideoSource>('upload');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videosById, setVideosById] = useState<Record<number, ListingVideo[]>>({});
  const [videosLoading, setVideosLoading] = useState(false);
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inFlightRef = useRef<Set<number>>(new Set());

  const checkedListings = useMemo(
    () => listings.filter(l => checkedIds.has(l.listing_id)),
    [listings, checkedIds],
  );

  const loadVideos = useCallback(async (listingIds: number[]) => {
    const missing = Array.from(new Set(listingIds))
      .filter(id => videosById[id] === undefined && !inFlightRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach(id => inFlightRef.current.add(id));
    setVideosLoading(true);
    const CONCURRENCY = 6;
    let cursor = 0;
    const worker = async () => {
      while (cursor < missing.length) {
        const id = missing[cursor++];
        let vids: ListingVideo[] = [];
        try {
          const res = await fetch(`/api/clawd/etsy?action=get_listing_videos&listing_id=${id}&shop_id=${shopId}`);
          if (res.ok) {
            const data = await res.json();
            vids = (data.videos || data.results || []).map((v: any) => ({
              video_id: Number(v.video_id) || 0,
              video_url: v.video_url,
              thumbnail_url: v.thumbnail_url,
              video_state: v.video_state,
            })).filter((v: ListingVideo) => v.video_id);
          }
        } catch { /* ignore */ }
        setVideosById(prev => ({ ...prev, [id]: vids }));
        inFlightRef.current.delete(id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));
    if (inFlightRef.current.size === 0) setVideosLoading(false);
  }, [videosById, shopId]);

  useEffect(() => { loadVideos(listings.map(l => l.listing_id)); }, [listings, loadVideos]);

  const videosFor = useCallback((id: number) => videosById[id] || [], [videosById]);

  const preflight = useMemo(() => {
    let apply = 0, skip = 0;
    for (const l of checkedListings) {
      const has = videosFor(l.listing_id).length > 0;
      const ok = op === 'add' ? !has : has;
      if (ok) apply++; else skip++;
    }
    return { apply, skip };
  }, [checkedListings, op, videosFor]);

  const onPickFile = useCallback((file: File | null) => {
    if (!file) { setVideoFile(null); return; }
    if (!file.type.startsWith('video/')) { toast.error(t('videoStudio.notVideo')); return; }
    setVideoFile(file);
  }, [t]);

  const applyAdd = useCallback(async () => {
    if (checkedListings.length === 0) { toast.error(t('photoStudio.selectListings')); return; }
    if (source === 'upload' && !videoFile) { toast.error(t('videoStudio.chooseSourceFirst')); return; }
    if (source === 'url' && !videoUrl.trim()) { toast.error(t('videoStudio.chooseSourceFirst')); return; }

    setApplying(true); setProgress(0);
    let success = 0, failed = 0, skipped = 0;
    for (let i = 0; i < checkedListings.length; i++) {
      const listing = checkedListings[i];
      try {
        if (videosFor(listing.listing_id).length > 0) { skipped++; }
        else {
          if (source === 'upload' && videoFile) {
            await stageEtsyDraftFile({ shopId, listingId: listing.listing_id, file: videoFile, kind: 'video', operation: 'upload' });
          } else {
            await stageEtsyDraft({ shopId, listingId: listing.listing_id,
              media: [{ kind: 'video', operation: 'upload', sourceUrl: videoUrl.trim() }] });
          }
          success++;
        }
      } catch { failed++; }
      setProgress(Math.round(((i + 1) / checkedListings.length) * 100));
      if (i < checkedListings.length - 1) await new Promise(r => setTimeout(r, 150));
    }
    setApplying(false);
    setVideoFile(null); setVideoUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (failed === 0 && skipped === 0) toast.success(t('videoStudio.videoStaged'));
    else toast(t('photoStudio.stagedPartial', { success, failed, skipped }), { icon: failed ? '⚠️' : 'ℹ️' });
    onCompleted();
  }, [checkedListings, source, videoFile, videoUrl, shopId, videosFor, onCompleted, t]);

  const applyDelete = useCallback(async () => {
    if (checkedListings.length === 0) { toast.error(t('photoStudio.selectListings')); return; }
    if (!confirm(t('videoStudio.confirmDelete', { count: checkedListings.length }))) return;

    setApplying(true); setProgress(0);
    let success = 0, failed = 0, skipped = 0;
    for (let i = 0; i < checkedListings.length; i++) {
      const listing = checkedListings[i];
      const vids = videosFor(listing.listing_id);
      try {
        if (vids.length === 0) { skipped++; }
        else {
          for (const v of vids) {
            await stageEtsyDraft({ shopId, listingId: listing.listing_id,
              media: [{ kind: 'video', operation: 'delete', etsyMediaId: v.video_id }] });
          }
          setVideosById(prev => ({ ...prev, [listing.listing_id]: [] }));
          success++;
        }
      } catch { failed++; }
      setProgress(Math.round(((i + 1) / checkedListings.length) * 100));
      if (i < checkedListings.length - 1) await new Promise(r => setTimeout(r, 120));
    }
    setApplying(false);
    if (failed === 0 && skipped === 0) toast.success(t('videoStudio.videoDeleteStaged'));
    else toast(t('photoStudio.stagedPartial', { success, failed, skipped }), { icon: failed ? '⚠️' : 'ℹ️' });
    onCompleted();
  }, [checkedListings, shopId, videosFor, onCompleted, t]);

  const deleteSingle = useCallback(async (listingId: number) => {
    const vids = videosFor(listingId);
    if (vids.length === 0) return;
    if (!confirm(t('videoStudio.confirmDeleteOne'))) return;
    try {
      for (const v of vids) {
        await stageEtsyDraft({ shopId, listingId, media: [{ kind: 'video', operation: 'delete', etsyMediaId: v.video_id }] });
      }
      setVideosById(prev => ({ ...prev, [listingId]: [] }));
      toast.success(t('videoStudio.videoDeleteStaged'));
      onCompleted();
    } catch { toast.error(t('photoStudio.reorderFailed')); }
  }, [videosFor, shopId, onCompleted, t]);

  return (
    <Box>
      {/* Recipe bar */}
      <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <ToggleButtonGroup exclusive size="small" value={op} onChange={(_, v) => v && setOp(v)}
          sx={{ mb: 1.5, '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, px: 2, gap: 0.5, borderRadius: '8px !important', border: '1px solid #e5e7eb !important', mr: 0.5 } }}>
          <ToggleButton value="add"><AddIcon fontSize="small" />{t('videoStudio.opAdd')}</ToggleButton>
          <ToggleButton value="delete"><DeleteIcon fontSize="small" />{t('videoStudio.opDelete')}</ToggleButton>
        </ToggleButtonGroup>

        {op === 'add' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <ToggleButtonGroup exclusive size="small" value={source} onChange={(_, v) => v && setSource(v)}
              sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, px: 2, gap: 0.5 } }}>
              <ToggleButton value="upload"><UploadIcon fontSize="small" />{t('videoStudio.sourceUpload')}</ToggleButton>
              <ToggleButton value="url"><LinkIcon fontSize="small" />{t('videoStudio.sourceUrl')}</ToggleButton>
            </ToggleButtonGroup>
            {source === 'upload' ? (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }}
                  onChange={(e) => onPickFile(e.target.files?.[0] || null)} />
                <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => fileInputRef.current?.click()}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px' }}>{t('videoStudio.selectVideo')}</Button>
                {videoFile && <Chip label={videoFile.name} size="small" onDelete={() => onPickFile(null)} sx={{ maxWidth: 240 }} />}
              </Box>
            ) : (
              <TextField size="small" fullWidth placeholder={t('videoStudio.urlPlaceholder')}
                value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} />
            )}
            <Typography variant="caption" color="text.secondary">{t('videoStudio.alreadyHasNote')}</Typography>
          </Box>
        )}
        {op === 'delete' && (
          <Typography variant="caption" color="error">{t('videoStudio.deleteNote')}</Typography>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.75, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={op === 'add' ? applyAdd : applyDelete}
            disabled={applying || checkedListings.length === 0}
            color={op === 'delete' ? 'error' : 'primary'}
            startIcon={applying ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <VideoIcon />}
            sx={{ minHeight: 42, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '10px' }}>
            {applying ? `${progress}%`
              : op === 'add' ? t('videoStudio.addToN', { count: checkedListings.length })
              : t('videoStudio.deleteFromN', { count: checkedListings.length })}
          </Button>
          {!applying && checkedListings.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {preflight.skip > 0
                ? t('photoStudio.preflightWithSkip', { apply: preflight.apply, skip: preflight.skip })
                : t('photoStudio.preflightAll', { apply: preflight.apply })}
            </Typography>
          )}
          {applying && <LinearProgress variant="determinate" value={progress} sx={{ flex: 1, minWidth: 120, borderRadius: 2 }} />}
        </Box>
      </Paper>

      {/* Search + select */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
        <Checkbox checked={allChecked} indeterminate={someChecked} onChange={onToggleAll} sx={{ p: 0.5 }} />
        <TextField size="small" placeholder={t('search.placeholder')} value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)} sx={{ flex: 1, minWidth: 120, maxWidth: 400 }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment>,
            endAdornment: searchTerm ? (
              <InputAdornment position="end"><IconButton size="small" onClick={() => onSearchChange('')}><ClearIcon sx={{ fontSize: 16 }} /></IconButton></InputAdornment>
            ) : undefined,
          }} />
        <Button size="small" variant="text" onClick={() => onSetChecked(listings.filter(l => videosFor(l.listing_id).length === 0).map(l => l.listing_id))}
          sx={{ textTransform: 'none', fontWeight: 700 }}>{t('videoStudio.selectNoVideo')}</Button>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {t('search.selected', { selected: checkedListings.length, total: listings.length })}
        </Typography>
        {videosLoading && <CircularProgress size={16} />}
      </Box>

      {/* Per-listing video grid */}
      {listings.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{searchTerm ? t('search.noMatch') : t('search.noListings')}</Typography>
        </Paper>
      ) : listings.map(listing => {
        const vids = videosFor(listing.listing_id);
        const vid = vids[0];
        const isChecked = checkedIds.has(listing.listing_id);
        return (
          <Paper key={listing.listing_id} variant="outlined"
            sx={{ p: { xs: 1, sm: 1.25 }, mb: 1, opacity: isChecked ? 1 : 0.45, transition: 'opacity 0.15s' }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Checkbox checked={isChecked} onChange={() => onToggleChecked(listing.listing_id)} sx={{ p: 0.5 }} />
              <Box sx={{ width: 34, height: 34, borderRadius: 1, flexShrink: 0, bgcolor: '#f1f5f9',
                backgroundImage: listing.thumbnail?.url_75x75 ? `url(${listing.thumbnail.url_75x75})` : 'none',
                backgroundSize: 'cover', backgroundPosition: 'center' }} />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {listing.title}
              </Typography>
              {vid ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Tooltip title={t('videoStudio.playVideo')}>
                    <Box onClick={() => vid.video_url && setPreview({ title: listing.title, url: vid.video_url })}
                      sx={{ position: 'relative', width: 64, height: 40, borderRadius: 1, overflow: 'hidden', cursor: vid.video_url ? 'pointer' : 'default',
                        bgcolor: '#0f172a', backgroundImage: vid.thumbnail_url ? `url(${vid.thumbnail_url})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center',
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PlayIcon sx={{ color: 'white', opacity: 0.9 }} />
                    </Box>
                  </Tooltip>
                  {vid.video_state && <Chip size="small" label={vid.video_state} sx={{ fontWeight: 600, textTransform: 'capitalize' }} />}
                  <Tooltip title={t('videoStudio.deleteVideo')}>
                    <IconButton size="small" color="error" onClick={() => deleteSingle(listing.listing_id)}><DeleteIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </Box>
              ) : (
                <Chip size="small" variant="outlined" label={t('videoStudio.noVideo')} sx={{ fontWeight: 600, color: 'text.secondary' }} />
              )}
            </Box>
          </Paper>
        );
      })}

      {/* Video preview */}
      <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, fontWeight: 700 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview?.title}</Typography>
          <IconButton size="small" onClick={() => setPreview(null)}><CloseIcon fontSize="small" /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {preview && (
            <video src={preview.url} controls autoPlay style={{ width: '100%', maxHeight: '70vh', borderRadius: 8, background: '#000' }} />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}

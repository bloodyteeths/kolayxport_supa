// components/domain/video-studio/VideoStudio.tsx — KolayXport Video Studio: AI product videos (Google Veo 3.1 on
// Vertex AI) for every marketplace. Founder 2026-10-17: "something nobody has … perfect, with features, controls,
// follow-ups"; "it must not alter the dress — feed many photos and videos so every frame stays the same"; "it has to
// look natural, nobody buys AI videos".
//
// Left: where it will be used (format / length / sound / resolution per marketplace), the product photos (any listing,
// the seller's uploads, frames from the seller's own videos) with the start / end frame slots, the product lock, the
// shot, the look and the director controls, the output and its AI kredisi cost. Right: the result with variants,
// the quality check against the photos (with one-click "fix these"), versions, readiness, edits and the library.
// Jobs run on the server; leaving the page does not stop them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Box from '@mui/material/Box';
import { useLocale, useTranslations } from 'next-intl';
import { Page, PageHeader } from '@/components/ds/page';
import { Button, Checkbox, SearchField, Select, Switch, TextArea, TextField } from '@/components/ds/inputs';
import { Banner, useToast } from '@/components/ds/feedback';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { useFormatters } from '@/lib/format';
import { accent, neutral as n, radius, tone } from '@/lib/ds/tokens';
import {
  BASIC_SCENES, DEFAULT_DIRECTION, OBJECT_PRESETS, PERSON_PRESETS, VIDEO_AUDIO, VIDEO_CAMERAS, VIDEO_EXPRESSIONS, VIDEO_LIGHTS, VIDEO_LOOKS, VIDEO_MOTIONS,
  directVideo, type VideoDirection,
} from '@/lib/ai/videoDirector';
import { VIDEO_TARGETS, VIDEO_TARGET_PROFILES, generationAspect, videoReadiness, type VideoFormat, type VideoTarget } from '@/lib/ai/videoTargets';
import { canAfford, extendCredits, imageCredits, videoCredits } from '@/lib/billing/aiCredits';
import { showCreditsDialog } from '@/lib/billing/creditsDialogStore';
import { refreshCredits, useCredits } from '@/components/domain/credits/useCredits';
import { LIMIT_UI_HEADER } from '@/lib/http/limitInterceptor';

type Photo = { key: string; ref: string; src: string; landscape?: boolean; fromVideo?: boolean };
type Qa = { status: 'running' | 'done' | 'failed'; match?: number; realism?: number; diffs?: { text: string; fix: string }[]; issues?: { text: string; fix: string }[]; autoFix?: string; autoFixMode?: 'fix' | 'safer' };
type PhotoInfo = { view: 'front' | 'back' | 'side' | 'detail' | 'flat' | 'other'; fullBody: boolean; person: boolean };
type Ideas = { kind: 'worn' | 'object'; shots: { label: string; hint: string; action: string; showsBack: boolean }[]; scenes: { label: string; prompt: string }[] };
type Job = {
  id: string; parentId: string | null; groupId: string | null; variantIndex: number; status: 'preparing' | 'running' | 'done' | 'failed';
  mode: string; instruction: string | null; aspectRatio: string; durationSec: number; resolution: string; quality: string;
  seed: number | null; errorKey: string | null; favorite: boolean; listingRef: string | null; title: string | null;
  direction: Partial<VideoDirection> | null; url: string | null; createdAt: string; credits?: number; qa?: Qa | null;
  published?: Record<string, { status: 'sending' | 'done' | 'failed'; error?: string; at: string }> | null;
};
type ListingHit = { id: string; title: string; thumbUrl: string | null };
const MARKETPLACES = ['etsy', 'ebay', 'shopify', 'trendyol', 'wix'] as const;
type Mp = (typeof MARKETPLACES)[number];

const POLL_MS = 6000;
const CONSENT_KEY = 'kx.videoStudio.consent';
const MAX_PRODUCT_PHOTOS = 10;
/** Shot types that turn or move (the end frame shows what the first one cannot) — mirrors the API. */
const TURNING = new Set(['twirl', 'turntable', 'frontBack', 'walk', 'pose', 'lifestyle']);
/** Shots that end on the back: the back photo becomes the end frame automatically. */
const SHOWS_BACK = new Set(['twirl', 'turntable', 'frontBack']);

/** Compact single-choice pills (denser than a select for 3–8 options). */
function Pills<T extends string>({ value, options, onChange, label }: { value: T; options: { value: NoInfer<T>; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <Box role="radiogroup" aria-label={label} sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Box key={o.value} component="button" type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            sx={{ font: 'inherit', fontSize: 13, lineHeight: '18px', px: '10px', py: '5px', borderRadius: '999px', cursor: 'pointer',
              border: `1px solid ${on ? accent[500] : n[200]}`, bgcolor: on ? accent[50] : n[0], color: on ? accent[700] : n[700], fontWeight: on ? 600 : 400 }}>
            {o.label}
          </Box>
        );
      })}
    </Box>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Box component="section" sx={{ bgcolor: n[0], border: `1px solid ${n[200]}`, borderRadius: `${radius.lg}px`, p: '14px', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
      <Box>
        <Box component="h2" sx={{ m: 0, fontSize: 14, fontWeight: 600, color: n[900] }}>{title}</Box>
        {hint ? <Box sx={{ fontSize: 12, color: n[500], mt: '2px' }}>{hint}</Box> : null}
      </Box>
      {children}
    </Box>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <Box sx={{ fontSize: 12, fontWeight: 600, color: n[600] }}>{label}</Box>
      {children}
    </Box>
  );
}

/** A start / end frame slot above the photo grid. */
function Slot({ label, photo, active, placeholder, onSelect, onClear, clearLabel }: { label: string; photo: Photo | null; active: boolean; placeholder: string; onSelect: () => void; onClear: () => void; clearLabel: string }) {
  return (
    <Box component="button" type="button" onClick={onSelect} aria-pressed={active}
      sx={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', gap: '8px', alignItems: 'center', p: '6px', font: 'inherit', textAlign: 'left', cursor: 'pointer',
        borderRadius: '10px', border: `${active ? 2 : 1}px solid ${active ? accent[600] : n[200]}`, bgcolor: active ? accent[50] : n[0] }}>
      <Box sx={{ width: 52, height: 52, borderRadius: '8px', overflow: 'hidden', bgcolor: n[100], flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: n[400], fontSize: 20 }}>
        {photo ? <Box component="img" src={photo.src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '+'}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ fontSize: 12, fontWeight: 600, color: active ? accent[700] : n[800] }}>{label}</Box>
        <Box sx={{ fontSize: 11, lineHeight: '15px', color: n[500] }}>{photo ? '' : placeholder}</Box>
      </Box>
      {photo ? (
        <Box component="span" role="button" aria-label={clearLabel} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onClear(); }}
          sx={{ position: 'absolute', top: 4, right: 6, fontSize: 14, color: n[500], cursor: 'pointer', px: '4px' }}>✕</Box>
      ) : null}
    </Box>
  );
}

function ScorePill({ label, value }: { label: string; value: number | undefined }) {
  if (value === undefined) return null;
  const t = value >= 8 ? tone.success : value >= 6 ? tone.warning : tone.danger;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px', px: '8px', py: '3px', borderRadius: '8px', bgcolor: t.bg, border: `1px solid ${t.border}`, color: t.fg, fontSize: 12 }}>
      {label} <b style={{ fontSize: 13 }}>{value}/10</b>
    </Box>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const qaScore = (j: Job) => (j.qa?.status === 'done' ? (j.qa.match ?? 0) * 2 + (j.qa.realism ?? 0) : -1);

export function VideoStudio() {
  const t = useTranslations('videoStudio');
  const tc = useTranslations('credits');
  const f = useFormatters();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { balance } = useCredits();

  // ── Target (marketplace rules) ──
  const [target, setTarget] = useState<VideoTarget>('etsy');
  const profile = VIDEO_TARGET_PROFILES[target];
  const [format, setFormat] = useState<VideoFormat>(profile.format);
  const [durationSec, setDurationSec] = useState<4 | 6 | 8>(8);
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [quality, setQuality] = useState<'fast' | 'best'>('fast');
  const [variants, setVariants] = useState(2);
  const [advanced, setAdvanced] = useState(false);
  // Automatic frame choice (POST /api/ai/video/analyze): which photo is the front / back / close-up.
  const [info, setInfo] = useState<Record<string, PhotoInfo>>({});
  const [auto, setAuto] = useState<{ start: string | null; end: string | null } | null>(null);
  const userPicked = useRef(false);
  const userPerson = useRef(false);
  const userShot = useRef(false);
  const userFormat = useRef(false);
  // Shots and settings the AI suggests for THIS product (any category, any marketplace).
  const [ideas, setIdeas] = useState<Ideas | null>(null);

  // ── Product photos ──
  const [mp, setMp] = useState<Mp>('etsy');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ListingHit[]>([]);
  const [store, setStore] = useState<string>('');
  const [listing, setListing] = useState<{ mp: Mp; id: string; store: string; title: string } | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [uploading, setUploading] = useState<'photo' | 'video' | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ── Direction ──
  const [dir, setDir] = useState<VideoDirection>({ ...DEFAULT_DIRECTION, audio: 'none' });
  const set = <K extends keyof VideoDirection>(k: K, v: VideoDirection[K]) => setDir((d) => ({ ...d, [k]: v }));
  const [start, setStart] = useState<Photo | null>(null);
  const [end, setEnd] = useState<Photo | null>(null);
  const [slot, setSlot] = useState<'start' | 'end'>('start');
  const [lock, setLock] = useState(true);
  const [consent, setConsent] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  // ── Results ──
  const [jobs, setJobs] = useState<Job[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [libFilter, setLibFilter] = useState<'all' | 'favorite' | 'listing'>('all');
  const [trim, setTrim] = useState<{ start: string; end: string }>({ start: '', end: '' });

  useEffect(() => {
    try { setConsent(window.localStorage.getItem(CONSENT_KEY) === '1'); } catch { /* private mode */ }
  }, []);

  // Target → marketplace defaults.
  const applyTarget = useCallback((tg: VideoTarget) => {
    const p = VIDEO_TARGET_PROFILES[tg];
    setTarget(tg);
    setFormat(p.format);
    setDurationSec(p.durationSec);
    setResolution(p.resolution);
    setDir((d) => ({ ...d, audio: p.audio, target: tg }));
    // Listings come from the same marketplace (Amazon / social: the seller picks where the photos are).
    const m = MARKETPLACES.find((x) => x === tg);
    if (m) { setMp(m); setQuery(''); }
  }, []);
  const setScene = (v: VideoDirection['scene']) => setDir((d) => ({ ...d, scene: v, mode: v === 'keep' ? 'image' : 'scene' }));

  // Deep link from a listing editor: ?mp=etsy&listing=123&store=456&title=…
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    const m = MARKETPLACES.find((x) => x === q.mp);
    if (m && typeof q.listing === 'string') {
      setMp(m);
      applyTarget(m);
      void pickListing({ id: q.listing, title: typeof q.title === 'string' ? q.title : '', thumbUrl: null }, m, typeof q.store === 'string' ? q.store : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  // Library on open.
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/ai/video', { credentials: 'same-origin' });
        const d = await r.json();
        if (Array.isArray(d?.jobs)) setJobs(d.jobs);
      } catch { /* empty library */ }
    })();
  }, []);

  // Listing search (debounced).
  useEffect(() => {
    const h = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ marketplace: mp, pageSize: '12', ...(query.trim() ? { q: query.trim() } : {}) });
        const r = await fetch(`/api/listings?${params}`, { credentials: 'same-origin' });
        if (!r.ok) { setHits([]); return; }
        const d = await r.json();
        setHits((d?.rows ?? []).map((x: any) => ({ id: String(x.id), title: String(x.title || ''), thumbUrl: x.thumbUrl ?? null })));
        setStore(String(d?.store?.id ?? ''));
      } catch { setHits([]); }
    }, 300);
    return () => window.clearTimeout(h);
  }, [mp, query]);

  const probe = (p: Photo) =>
    new Promise<Photo>((resolve) => {
      const img = new window.Image();
      img.onload = () => resolve({ ...p, landscape: img.naturalWidth > img.naturalHeight * 1.1 });
      img.onerror = () => resolve(p);
      img.src = p.src;
    });

  const pickListing = async (h: ListingHit, m: Mp = mp, st: string = store) => {
    setListing({ mp: m, id: h.id, store: st, title: h.title });
    set('product', h.title.slice(0, 160));
    setPhotosLoading(true);
    try {
      const r = await fetch(`/api/ai/video/listing-photos?${new URLSearchParams({ mp: m, id: h.id, store: st })}`, { credentials: 'same-origin' });
      const d = await r.json();
      const list: Photo[] = (d?.photos ?? []).map((p: any) => ({ key: `l:${p.id}`, ref: p.fullSrc || p.src, src: p.src || p.fullSrc }));
      const probed = await Promise.all(list.map(probe));
      setPhotos((prev) => [...prev.filter((x) => x.ref.startsWith('upload:')), ...probed]);
      userPicked.current = false;
      userShot.current = false;
      setIdeas(null);
      setStart(probed[0] ?? null);
      setEnd(null);
      setSlot('end');
    } catch {
      toast.error(t('error.photos'));
    } finally {
      setPhotosLoading(false);
    }
  };

  const addPhotos = (list: Photo[]) => {
    setPhotos((prev) => [...prev, ...list]);
    setStart((s) => s ?? list[0] ?? null);
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files).slice(0, 10)) {
      if (/^video\//.test(file.type)) {
        if (file.size > 200 * 1024 * 1024) { toast.error(t('error.videoTooLarge')); continue; }
        setUploading('video');
        try {
          const r = await fetch('/api/ai/video/source-video', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file });
          const d = await r.json().catch(() => null);
          if (!r.ok || !Array.isArray(d?.photos)) throw new Error(d?.code || 'video');
          addPhotos(await Promise.all(d.photos.map((p: any) => probe({ key: p.ref, ref: p.ref, src: p.url, fromVideo: true }))));
          toast.success(t('videoFrames', { count: d.photos.length }));
        } catch { toast.error(t('error.video')); } finally { setUploading(null); }
        continue;
      }
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) { toast.error(t('error.uploadType')); continue; }
      setUploading('photo');
      try {
        const r = await fetch('/api/ai/video/source', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: { data: await fileToBase64(file), mimeType: file.type } }) });
        const d = await r.json();
        if (!r.ok || !d?.ref) throw new Error('upload');
        addPhotos([await probe({ key: d.ref, ref: d.ref, src: d.url })]);
      } catch { toast.error(t('error.upload')); } finally { setUploading(null); }
    }
  };

  const removePhoto = (p: Photo) => {
    setPhotos((prev) => prev.filter((x) => x.key !== p.key));
    if (start?.key === p.key) setStart(null);
    if (end?.key === p.key) setEnd(null);
  };

  const assign = (p: Photo) => {
    if (dir.mode === 'scene') return;
    userPicked.current = true;
    if (start?.key === p.key) { setStart(null); setSlot('start'); return; }
    if (end?.key === p.key) { setEnd(null); setSlot('end'); return; }
    if (slot === 'start' || !start) { setStart(p); setSlot('end'); } else { setEnd(p); }
  };

  const roleOf = (p: Photo): string | null => {
    if (dir.mode === 'scene') return null;
    if (start?.key === p.key) return t('role.start');
    if (end?.key === p.key) return t('role.end');
    return null;
  };

  // Every photo locks the product (start + end first), up to 10.
  const productRefs = useMemo(() => {
    const ordered = [start, end, ...photos].filter((x): x is Photo => Boolean(x));
    return Array.from(new Set(ordered.map((p) => p.ref))).slice(0, MAX_PRODUCT_PHOTOS);
  }, [start, end, photos]);

  const showsBack = SHOWS_BACK.has(dir.preset) || (dir.preset === 'custom' && dir.showsBack === true);
  const turning = TURNING.has(dir.preset) || (dir.preset === 'custom' && dir.showsBack === true);
  // Look at the photos once and pick the anchor frames (unless the seller picked them).
  const photoKey = photos.map((p) => p.ref).join('|');
  useEffect(() => {
    if (!photos.length) { setAuto(null); return undefined; }
    const h = window.setTimeout(async () => {
      try {
        const r = await fetch('/api/ai/video/analyze', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs: photos.map((p) => p.ref).slice(0, 12), title: listing?.title ?? dir.product ?? '', locale }) });
        const d = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(d?.photos)) return;
        const map: Record<string, PhotoInfo> = {};
        for (const x of d.photos) map[x.ref] = { view: x.view, fullBody: Boolean(x.fullBody), person: Boolean(x.person) };
        setInfo((prev) => ({ ...prev, ...map }));
        setAuto({ start: d.start ?? null, end: d.end ?? null });
        const kind: 'worn' | 'object' = d.product?.kind === 'worn' ? 'worn' : 'object';
        const shots = Array.isArray(d.shots) ? d.shots : [];
        setIdeas({ kind, shots, scenes: Array.isArray(d.scenes) ? d.scenes : [] });
        const person = userPerson.current ? undefined : d.photos.some((x: any) => x.person);
        setDir((dd) => {
          const next = { ...dd, productKind: kind, ...(person === undefined ? {} : { person }) };
          // Unless the seller chose a shot, start with the best suggestion for this product.
          if (!userShot.current && shots[0]) return { ...next, preset: 'custom', shotText: shots[0].action, showsBack: Boolean(shots[0].showsBack) };
          return next;
        });
      } catch { /* the seller picks by hand */ }
    }, 500);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey]);
  useEffect(() => {
    if (!auto || userPicked.current) return;
    const byRef = (ref: string | null) => (ref ? photos.find((p) => p.ref === ref) ?? null : null);
    const s0 = byRef(auto.start);
    if (s0) setStart(s0);
    setEnd(showsBack ? byRef(auto.end) : null);
    setSlot('end');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, dir.preset, dir.shotText]);
  const autoChosen = Boolean(auto && !userPicked.current && start && start.ref === auto.start);

  const sourceLandscape = ((dir.mode === 'scene' ? photos[0] : start) ?? photos[0])?.landscape ?? false;
  useEffect(() => {
    if (userFormat.current || !(start ?? photos[0])) return;
    const wanted = profile.format;
    const clash = (sourceLandscape && (wanted === '9:16' || wanted === '4:5')) || (!sourceLandscape && wanted === '16:9');
    const pick = !clash ? wanted : profile.formats.includes('1:1') ? '1:1' : sourceLandscape ? '16:9' : '9:16';
    if (pick !== format) setFormat(pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceLandscape, target, start?.key]);
  const effective = useMemo(() => (resolution !== '720p' ? { durationSec: 8 as const, resolution } : { durationSec, resolution }), [durationSec, resolution]);
  const direction: VideoDirection = { ...dir, target, format };
  const promptPreview = useMemo(() => directVideo(direction), [direction]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = dir.mode === 'scene' ? (photos.length ? null : t('need.photos')) : !start ? t('need.start') : null;
  const aiStart = dir.mode === 'scene';
  const aiEnd = !end && lock && turning && productRefs.length > 0;
  const cost = videoCredits({ quality, resolution: effective.resolution, durationSec: effective.durationSec, variants }) + (aiStart ? imageCredits() : 0) + (aiEnd ? imageCredits() : 0);
  const affordable = canAfford(balance, cost);
  const costFor = (q: 'fast' | 'best') => videoCredits({ quality: q, resolution: effective.resolution, durationSec: effective.durationSec, variants }) + (aiStart ? imageCredits() : 0) + (aiEnd ? imageCredits() : 0);
  const listingMarket = (MARKETPLACES as readonly string[]).includes(target);
  const autoSummary = [t(`format.${format.replace(':', 'x')}`), t('seconds', { count: effective.durationSec }), effective.resolution === '4k' ? '4K' : effective.resolution, profile.audioRemoved || dir.audio === 'none' ? t('audio.none') : t(`audio.${dir.audio}`)].join(' · ');

  const cur = jobs.find((j) => j.id === current) ?? null;
  const watching = (j: Job) => j.status === 'running' || j.status === 'preparing' || j.qa?.status === 'running'
    || Object.values(j.published ?? {}).some((x) => x.status === 'sending')
    || (j.status === 'done' && !j.qa && Date.now() - new Date(j.createdAt).getTime() < 10 * 60_000 && j.mode !== 'edit');
  const pending = jobs.some(watching);

  // Poll running jobs and quality checks.
  useEffect(() => {
    if (!pending) return undefined;
    const ids = jobs.filter(watching).map((j) => j.id).slice(0, 40).join(',');
    const h = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/ai/video?ids=${encodeURIComponent(ids)}`, { credentials: 'same-origin' });
        const d = await r.json();
        if (!Array.isArray(d?.jobs)) return;
        let refund = false;
        setJobs((prev) => {
          const byId = new Map(prev.map((j) => [j.id, j]));
          for (const j of d.jobs as Job[]) {
            const was = byId.get(j.id);
            if (was && was.status !== 'done' && j.status === 'done') toast.success(t('readyToast'));
            if (was && was.status !== 'failed' && j.status === 'failed') refund = true;
            byId.set(j.id, j);
          }
          return Array.from(byId.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        });
        if (refund) void refreshCredits();
      } catch { /* next tick */ }
    }, POLL_MS);
    return () => window.clearInterval(h);
  }, [pending, jobs, t, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const addJob = (j: Job) => {
    setJobs((prev) => [j, ...prev.filter((x) => x.id !== j.id)]);
    setCurrent(j.id);
  };

  const post = async (url: string, body: unknown, label: string, need: number): Promise<Job | null> => {
    if (need > 0 && !canAfford(balance, need)) { showCreditsDialog(need); return null; }
    setBusy(label);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', [LIMIT_UI_HEADER]: 'inline' }, body: JSON.stringify({ ...(body as object), locale }) });
      const d = await r.json().catch(() => null);
      if (r.status === 402) { showCreditsDialog(d?.need ?? need); return null; }
      if (!r.ok || !d?.job) {
        const code = d?.code;
        toast.error(t(`error.${['videoBusy', 'imageRequired', 'productPhotosRequired', 'nothingToEdit', 'aiBudget'].includes(code) ? code : 'start'}`));
        if (d?.job) addJob(d.job);
        return null;
      }
      addJob(d.job);
      return d.job as Job;
    } finally {
      setBusy(null);
      if (need > 0) void refreshCredits();
    }
  };

  const generate = async () => {
    if (missing) return;
    if (dir.person && !consent) { toast.error(t('error.consent')); return; }
    await post('/api/ai/video', {
      sources: { start: dir.mode === 'scene' ? null : start?.ref, end: dir.mode === 'scene' ? null : end?.ref, product: productRefs },
      direction, lock, aspectRatio: generationAspect(format, sourceLandscape), durationSec: effective.durationSec, resolution: effective.resolution,
      quality, variants, seed: null,
      listingRef: listing ? `${listing.mp}:${listing.id}${listing.store ? `:${listing.store}` : ''}` : null, title: listing?.title ?? null,
    }, 'generate', cost);
  };

  const followCost = cur ? videoCredits({ quality: cur.quality, resolution: cur.resolution, durationSec: Math.min(8, cur.durationSec), variants: 1 }) : 0;
  const followUp = async (instruction: string) => {
    if (!cur || !instruction.trim()) return;
    await post('/api/ai/video', { parentId: cur.id, instruction: instruction.trim(), variants: 1 }, 'followUp', followCost);
    setAsk('');
  };

  const extend = async () => { if (cur) await post('/api/ai/video', { extendOf: cur.id }, 'extend', extendCredits(cur.quality)); };
  const edit = async (e: Record<string, unknown>) => { if (cur) await post('/api/ai/video/edit', { id: cur.id, ...e }, 'edit', 0); };

  const toggleFav = async (j: Job) => {
    setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, favorite: !x.favorite } : x)));
    await fetch('/api/ai/video', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: j.id, favorite: !j.favorite }) }).catch(() => undefined);
  };

  const remove = async (j: Job) => {
    if (!(await confirm({ title: t('deleteTitle'), body: t('deleteBody'), confirmLabel: t('delete'), tone: 'danger' }))) return;
    const r = await fetch(`/api/ai/video?id=${encodeURIComponent(j.id)}`, { method: 'DELETE', credentials: 'same-origin' });
    if (r.ok) {
      setJobs((prev) => prev.filter((x) => x.id !== j.id));
      if (current === j.id) setCurrent(null);
    }
  };

  const useOnListing = (j: Job) => {
    const [m, id, st] = (j.listingRef ?? '').split(':');
    if (m === 'etsy' && id) {
      void router.push(`/app/etsy-listings/${encodeURIComponent(id)}${st ? `?shop=${encodeURIComponent(st)}&` : '?'}aiVideo=${encodeURIComponent(j.id)}#photos`);
    }
  };

  const publish = async (j: Job, mpName: string) => {
    if (!(await confirm({ title: t('publish.confirmTitle', { marketplace: t(`target.name.${mpName}`) }), body: t('publish.confirmBody'), confirmLabel: t('publish.send') }))) return;
    setBusy('publish');
    try {
      const r = await fetch('/api/ai/video/publish', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: j.id }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.job) { toast.error(t(`publish.error.${d?.code === 'publishBusy' ? 'busy' : 'start'}`)); return; }
      setJobs((prev) => prev.map((x) => (x.id === d.job.id ? d.job : x)));
    } finally {
      setBusy(null);
    }
  };

  const curDir = (cur?.direction ?? {}) as Partial<VideoDirection>;
  const curTarget = (curDir.target as VideoTarget | undefined) ?? target;
  const readiness = cur && cur.status === 'done'
    ? videoReadiness(curTarget, { durationSec: cur.durationSec, resolution: cur.resolution, format: (cur.aspectRatio as VideoFormat) || '9:16', hasAudio: curDir.audio !== 'none' })
    : null;
  const group = cur ? jobs.filter((j) => j.groupId === cur.groupId).sort((a, b) => a.variantIndex - b.variantIndex) : [];
  const bestInGroup = group.length > 1 && group.every((g) => g.status !== 'done' || g.qa?.status === 'done' || g.qa?.status === 'failed')
    ? group.reduce<Job | null>((b, g) => (qaScore(g) > (b ? qaScore(b) : -1) ? g : b), null)
    : null;
  const chain = useMemo(() => {
    if (!cur) return [] as Job[];
    const out: Job[] = [];
    let p: Job | undefined = cur;
    for (let i = 0; p && i < 20; i++) { out.unshift(p); p = jobs.find((j) => j.id === p!.parentId); }
    return out;
  }, [cur, jobs]);
  const library = jobs.filter((j) => (libFilter === 'favorite' ? j.favorite : libFilter === 'listing' ? listing && j.listingRef?.startsWith(`${listing.mp}:${listing.id}`) : true));
  const listingMp = (cur?.listingRef ?? '').split(':')[0];
  const etsyListing = listingMp === 'etsy';
  const directMp = ['ebay', 'shopify', 'wix'].includes(listingMp) ? listingMp : null;
  const manualMp = curTarget === 'amazon' || listingMp === 'trendyol' || (!listingMp && curTarget === 'trendyol') ? (curTarget === 'amazon' ? 'amazon' : 'trendyol') : null;
  const sent = directMp ? cur?.published?.[directMp] ?? null : null;
  const qa = cur?.qa ?? null;
  const fixes = qa?.status === 'done' ? [...(qa.diffs ?? []), ...(qa.issues ?? [])].map((x) => x.fix).filter(Boolean) : [];
  // The automatic fix the server started after a failed check (stored on the take's first variant).
  const groupMain = cur ? jobs.find((j) => j.id === cur.groupId) ?? cur : null;
  const autoFixJob = groupMain?.qa?.autoFix ? jobs.find((j) => j.id === groupMain.qa!.autoFix) ?? null : null;
  const autoFixDone = useRef<Set<string>>(new Set());
  // When every variant of a take is checked, show the best one (unless the seller picked a variant).
  const pickedVariant = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!bestInGroup || !cur || cur.groupId !== bestInGroup.groupId || cur.id === bestInGroup.id) return;
    if (pickedVariant.current.has(bestInGroup.groupId ?? '')) return;
    pickedVariant.current.add(bestInGroup.groupId ?? '');
    setCurrent(bestInGroup.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestInGroup?.id]);
  useEffect(() => {
    if (!autoFixJob || autoFixJob.status !== 'done' || autoFixDone.current.has(autoFixJob.id)) return;
    autoFixDone.current.add(autoFixJob.id);
    if (cur && cur.groupId === groupMain?.groupId) setCurrent(autoFixJob.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFixJob?.id, autoFixJob?.status]);

  const L = <K extends string>(group2: string, keys: readonly K[]) => keys.map((k) => ({ value: k, label: t(`${group2}.${k}` as 'title') }));
  const chips = [...(curDir.person ? [t('chip.expression')] : []), t('chip.slower'), t('chip.closer'), t('chip.showProduct'), t('chip.keepProduct'), t('chip.realer'), t('chip.staticCam')];
  const creditsLabel = (c: number) => tc('cost', { count: f.num(c) });

  return (
    <Page title={t('title')} width="list">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(380px, 460px) minmax(0, 1fr)' }, gap: '16px', alignItems: 'start' }}>
        {/* ───────────── Left: setup ───────────── */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <Block title={t('step.where')} hint={t(`target.rules.${target}`)}>
            <Pills label={t('step.where')} value={target} onChange={applyTarget} options={VIDEO_TARGETS.map((x) => ({ value: x, label: t(`target.name.${x}`) }))} />
            <Box sx={{ fontSize: 12, color: n[600] }}>{t('target.auto', { summary: autoSummary })}</Box>
          </Block>

          <Block title={t('step.product')} hint={t('photos.hint')}>
            <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {!listingMarket ? (
                <Box sx={{ width: 140 }}>
                  <Select<Mp> value={mp} onChange={(v) => { setMp(v); setQuery(''); }} options={MARKETPLACES.map((m) => ({ value: m, label: t(`target.name.${m}`) }))} aria-label={t('photos.marketplace')} size="sm" />
                </Box>
              ) : null}
              <Box sx={{ flex: 1, minWidth: 160 }}>
                <SearchField value={query} onChange={setQuery} placeholder={t('photos.search', { marketplace: t(`target.name.${mp}`) })} aria-label={t('photos.search', { marketplace: t(`target.name.${mp}`) })} />
              </Box>
            </Box>
            {!listing || query ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', maxHeight: 220, overflowY: 'auto', border: `1px solid ${n[100]}`, borderRadius: '8px' }}>
                {hits.map((h) => (
                  <Box key={h.id} component="button" type="button" onClick={() => { setQuery(''); void pickListing(h); }}
                    sx={{ display: 'flex', gap: '8px', alignItems: 'center', p: '6px 8px', border: 0, borderBottom: `1px solid ${n[100]}`, bgcolor: n[0], textAlign: 'left', cursor: 'pointer', font: 'inherit', '&:hover': { bgcolor: n[50] } }}>
                    <Box component="img" src={h.thumbUrl || ''} alt="" sx={{ width: 36, height: 36, borderRadius: '6px', objectFit: 'cover', bgcolor: n[100], flexShrink: 0 }} />
                    <Box sx={{ fontSize: 13, color: n[800], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</Box>
                  </Box>
                ))}
                {!hits.length ? <Box sx={{ p: '10px', fontSize: 13, color: n[500] }}>{t('photos.noResults')}</Box> : null}
              </Box>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 13, color: n[700] }}>
                <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{listing.title}</Box>
                <Button variant="ghost" size="sm" onClick={() => { setListing(null); setPhotos((p) => p.filter((x) => x.ref.startsWith('upload:'))); setStart(null); setEnd(null); }}>{t('photos.change')}</Button>
              </Box>
            )}

            {dir.mode === 'image' ? (
              <Box sx={{ display: 'flex', gap: '8px' }}>
                <Slot label={t('slot.start')} photo={start} active={slot === 'start'} placeholder={t('slot.startHint')} onSelect={() => setSlot('start')} onClear={() => { userPicked.current = true; setStart(null); setSlot('start'); }} clearLabel={t('slot.clear')} />
                <Slot label={t('slot.end')} photo={end} active={slot === 'end'} placeholder={aiEnd ? t('slot.endAi') : t('slot.endHint')} onSelect={() => setSlot('end')} onClear={() => { userPicked.current = true; setEnd(null); setSlot('end'); }} clearLabel={t('slot.clear')} />
              </Box>
            ) : null}
            {dir.mode === 'image' && autoChosen ? <Box sx={{ fontSize: 12, color: n[500] }}>{t('slot.auto')}</Box> : null}

            {photosLoading ? <Box sx={{ fontSize: 13, color: n[500] }}>{t('photos.loading')}</Box> : null}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '8px' }}>
              {photos.map((p) => {
                const role = roleOf(p);
                const used = productRefs.includes(p.ref);
                return (
                  <Box key={p.key} sx={{ position: 'relative' }}>
                    <Box component="button" type="button" onClick={() => assign(p)} aria-pressed={Boolean(role)}
                      sx={{ display: 'block', width: '100%', p: 0, aspectRatio: '1', borderRadius: '8px', overflow: 'hidden', cursor: dir.mode === 'scene' ? 'default' : 'pointer', bgcolor: n[100],
                        border: `2px solid ${role ? accent[600] : 'transparent'}`, opacity: used ? 1 : 0.45 }}>
                      <Box component="img" src={p.src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      {role ? <Box sx={{ position: 'absolute', left: 4, bottom: 4, px: '6px', py: '1px', borderRadius: '6px', bgcolor: accent[600], color: '#fff', fontSize: 11, fontWeight: 600 }}>{role}</Box> : null}
                      {p.fromVideo && !role ? <Box sx={{ position: 'absolute', left: 4, bottom: 4, px: '5px', borderRadius: '6px', bgcolor: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10 }}>{t('photos.fromVideo')}</Box> : null}
                      {info[p.ref] && info[p.ref].view !== 'other' ? <Box sx={{ position: 'absolute', left: 4, top: 4, px: '5px', borderRadius: '6px', bgcolor: 'rgba(255,255,255,.88)', color: n[800], fontSize: 10, fontWeight: 600 }}>{t(`view.${info[p.ref].view}`)}</Box> : null}
                    </Box>
                    <Box component="button" type="button" aria-label={t('photos.remove')} onClick={() => removePhoto(p)}
                      sx={{ position: 'absolute', top: 3, right: 3, width: 22, height: 22, borderRadius: '50%', border: 0, bgcolor: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 12, lineHeight: '22px', cursor: 'pointer', p: 0 }}>✕</Box>
                  </Box>
                );
              })}
              <Box component="button" type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(uploading)}
                sx={{ aspectRatio: '1', borderRadius: '8px', border: `1px dashed ${n[300]}`, bgcolor: n[50], color: n[600], fontSize: 11, lineHeight: '14px', cursor: 'pointer', font: 'inherit', p: '4px' }}>
                {uploading === 'video' ? t('photos.readingVideo') : uploading ? t('photos.uploading') : `+ ${t('photos.upload')}`}
              </Box>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/*" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
            </Box>
            {photos.length ? <Box sx={{ fontSize: 12, color: n[500] }}>{t('photos.used', { count: productRefs.length, max: MAX_PRODUCT_PHOTOS })}</Box> : null}
          </Block>

          <Block title={t('step.video')}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '6px' }}>
              {(ideas?.shots ?? []).map((x) => {
                const on = dir.preset === 'custom' && dir.shotText === x.action;
                return (
                  <Box key={x.action} component="button" type="button" aria-pressed={on}
                    onClick={() => { userShot.current = true; setDir((d) => ({ ...d, preset: 'custom', shotText: x.action, showsBack: x.showsBack })); }}
                    sx={{ textAlign: 'left', font: 'inherit', p: '8px 10px', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${on ? accent[500] : accent[200]}`, bgcolor: on ? accent[50] : n[0] }}>
                    <Box sx={{ fontSize: 10, fontWeight: 700, color: accent[600], textTransform: 'uppercase', letterSpacing: '.04em' }}>✦ {t('shot.suggested')}</Box>
                    <Box sx={{ fontSize: 13, fontWeight: 600, color: on ? accent[700] : n[800] }}>{x.label}</Box>
                    {x.hint ? <Box sx={{ fontSize: 11, lineHeight: '15px', color: n[500], mt: '2px' }}>{x.hint}</Box> : null}
                  </Box>
                );
              })}
              {[...(dir.person ? PERSON_PRESETS : OBJECT_PRESETS), ...(!dir.person && ideas?.kind === 'worn' ? (['hanger'] as const) : []), 'custom' as const].map((x) => {
                const on = dir.preset === x && (x !== 'custom' || !dir.shotText);
                return (
                  <Box key={x} component="button" type="button" aria-pressed={on}
                    onClick={() => { userShot.current = true; setDir((d) => ({ ...d, preset: x, shotText: undefined, showsBack: undefined })); }}
                    sx={{ textAlign: 'left', font: 'inherit', p: '8px 10px', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${on ? accent[500] : n[200]}`, bgcolor: on ? accent[50] : n[0] }}>
                    <Box sx={{ fontSize: 13, fontWeight: 600, color: on ? accent[700] : n[800] }}>{t(`preset.${x}.label`)}</Box>
                    <Box sx={{ fontSize: 11, lineHeight: '15px', color: n[500], mt: '2px' }}>{t(`preset.${x}.hint`)}</Box>
                  </Box>
                );
              })}
            </Box>
            {!ideas && photos.length ? <Box sx={{ fontSize: 12, color: n[500] }}>{t('shot.thinking')}</Box> : null}
            {turning && !end && !lock ? <Box sx={{ fontSize: 12, color: tone.warning.fg }}>{t('shot.backWarning')}</Box> : null}
            <Labeled label={t('director.scene')}>
              <Box role="radiogroup" aria-label={t('director.scene')} sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {[
                  ...BASIC_SCENES.map((x) => ({ key: x, label: t(`scene.${x}`), on: dir.scene === x, pick: () => setScene(x) })),
                  ...(ideas?.scenes ?? []).map((x) => ({ key: x.prompt, label: `✦ ${x.label}`, on: dir.scene === 'custom' && dir.sceneText === x.prompt, pick: () => setDir((d) => ({ ...d, scene: 'custom', sceneText: x.prompt, mode: 'scene' })) })),
                  { key: 'custom', label: t('scene.custom'), on: dir.scene === 'custom' && !(ideas?.scenes ?? []).some((x) => x.prompt === dir.sceneText), pick: () => setDir((d) => ({ ...d, scene: 'custom', sceneText: '', mode: 'scene' })) },
                ].map((o) => (
                  <Box key={o.key} component="button" type="button" role="radio" aria-checked={o.on} onClick={o.pick}
                    sx={{ font: 'inherit', fontSize: 13, lineHeight: '18px', px: '10px', py: '5px', borderRadius: '999px', cursor: 'pointer',
                      border: `1px solid ${o.on ? accent[500] : n[200]}`, bgcolor: o.on ? accent[50] : n[0], color: o.on ? accent[700] : n[700], fontWeight: o.on ? 600 : 400 }}>
                    {o.label}
                  </Box>
                ))}
              </Box>
              {dir.scene === 'custom' && !(ideas?.scenes ?? []).some((x) => x.prompt === dir.sceneText) ? <TextField value={dir.sceneText ?? ''} onChange={(v) => set('sceneText', v.slice(0, 300))} placeholder={t('director.scenePlaceholder')} /> : null}
              {dir.scene !== 'keep' ? <Box sx={{ fontSize: 12, color: n[500] }}>{t('scene.aiHint')}</Box> : null}
            </Labeled>
            <Labeled label={t('director.notes')}>
              <TextArea value={dir.notes ?? ''} onChange={(v) => set('notes', v.slice(0, 800))} minRows={2} maxRows={6} placeholder={t('director.notesPlaceholder')} />
            </Labeled>
            <Labeled label={t('output.quality')}>
              <Box role="radiogroup" aria-label={t('output.quality')} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                {(['fast', 'best'] as const).map((q) => {
                  const on = quality === q;
                  return (
                    <Box key={q} component="button" type="button" role="radio" aria-checked={on} onClick={() => setQuality(q)}
                      sx={{ textAlign: 'left', font: 'inherit', p: '8px 10px', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${on ? accent[500] : n[200]}`, bgcolor: on ? accent[50] : n[0] }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                        <Box sx={{ fontSize: 13, fontWeight: 600, color: on ? accent[700] : n[800] }}>{t(`quality.${q}`)}</Box>
                        <Box sx={{ fontSize: 12, color: n[500], whiteSpace: 'nowrap' }}>{creditsLabel(costFor(q))}</Box>
                      </Box>
                      <Box sx={{ fontSize: 11, lineHeight: '15px', color: n[500], mt: '2px' }}>{t(`qualityHint.${q}`)}</Box>
                    </Box>
                  );
                })}
              </Box>
            </Labeled>
          </Block>

          <Box component="button" type="button" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}
            sx={{ alignSelf: 'flex-start', border: 0, bgcolor: 'transparent', p: '2px 0', color: accent[700], fontSize: 13, fontWeight: 600, cursor: 'pointer', font: 'inherit' }}>
            {advanced ? `▾ ${t('advanced.hide')}` : `▸ ${t('advanced.show')}`}
          </Box>
          {advanced ? (
            <Block title={t('advanced.title')} hint={t('advanced.hint')}>
              <Switch checked={lock} onChange={setLock} label={t('lock.label')} description={t('lock.hint')} />
              <Labeled label={t('director.look')}>
                <Pills label={t('director.look')} value={dir.look} onChange={(v) => set('look', v)} options={L('look', VIDEO_LOOKS)} />
                <Box sx={{ fontSize: 12, color: n[500] }}>{t(`lookHint.${dir.look}`)}</Box>
              </Labeled>
              <Switch checked={dir.person} onChange={(v) => { userPerson.current = true; set('person', v); }} label={t('director.person')} description={t('director.personHint')} />
              {dir.person ? (
                <Labeled label={t('director.expression')}><Pills label={t('director.expression')} value={dir.expression} onChange={(v) => set('expression', v)} options={L('expression', VIDEO_EXPRESSIONS)} /></Labeled>
              ) : null}
              <Labeled label={t('director.camera')}><Pills label={t('director.camera')} value={dir.camera} onChange={(v) => set('camera', v)} options={L('camera', VIDEO_CAMERAS)} /></Labeled>
              <Labeled label={t('director.motion')}>
                <Pills label={t('director.motion')} value={dir.motion} onChange={(v) => set('motion', v)} options={L('motion', VIDEO_MOTIONS)} />
                {dir.motion === 'lively' ? <Box sx={{ fontSize: 12, color: n[500] }}>{t('director.motionHint')}</Box> : null}
              </Labeled>
              <Labeled label={t('director.light')}><Pills label={t('director.light')} value={dir.light} onChange={(v) => set('light', v)} options={L('light', VIDEO_LIGHTS)} /></Labeled>
              {profile.audioRemoved ? (
                <Box sx={{ fontSize: 12, color: n[500] }}>{t('director.audioRemoved', { marketplace: t(`target.name.${target}`) })}</Box>
              ) : (
                <Labeled label={t('director.audio')}><Pills label={t('director.audio')} value={dir.audio} onChange={(v) => set('audio', v)} options={L('audio', VIDEO_AUDIO)} /></Labeled>
              )}
              <Labeled label={t('director.avoid')}>
                <TextField value={dir.avoid ?? ''} onChange={(v) => set('avoid', v.slice(0, 300))} placeholder={t('director.avoidPlaceholder')} />
              </Labeled>
              <Labeled label={t('output.format')}>
                <Pills<VideoFormat> label={t('output.format')} value={format} onChange={(v) => { userFormat.current = true; setFormat(v); }} options={profile.formats.map((x) => ({ value: x, label: t(`format.${x.replace(':', 'x')}`) }))} />
              </Labeled>
              <Box sx={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <Labeled label={t('output.length')}>
                  <Pills label={t('output.length')} value={String(effective.durationSec) as '4' | '6' | '8'} onChange={(v) => setDurationSec(Number(v) as 4 | 6 | 8)} options={(['4', '6', '8'] as const).map((x) => ({ value: x, label: t('seconds', { count: Number(x) }) }))} />
                </Labeled>
                <Labeled label={t('output.resolution')}>
                  <Pills<'720p' | '1080p' | '4k'> label={t('output.resolution')} value={resolution} onChange={(v) => setResolution(v)} options={[{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }, { value: '4k', label: '4K' }]} />
                </Labeled>
              </Box>
              {resolution !== '720p' ? <Box sx={{ fontSize: 12, color: n[500] }}>{t('output.eightOnly')}</Box> : null}
              <Labeled label={t('output.variants')}>
                <Pills label={t('output.variants')} value={String(variants) as '1' | '2' | '3' | '4'} onChange={(v) => setVariants(Number(v))} options={(['1', '2', '3', '4'] as const).map((x) => ({ value: x, label: x }))} />
                <Box sx={{ fontSize: 12, color: n[500] }}>{t('output.variantsHint')}</Box>
              </Labeled>
              <Switch checked={dir.grain} onChange={(v) => set('grain', v)} label={t('output.grain')} description={t('output.grainHint')} />
              <Box component="button" type="button" onClick={() => setShowPrompt((x) => !x)} sx={{ alignSelf: 'flex-start', border: 0, bgcolor: 'transparent', p: 0, color: accent[700], fontSize: 12, cursor: 'pointer', font: 'inherit' }}>
                {showPrompt ? t('output.hidePrompt') : t('output.showPrompt')}
              </Box>
              {showPrompt ? <Box component="pre" sx={{ m: 0, p: '10px', bgcolor: n[50], borderRadius: '8px', fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: n[700] }}>{promptPreview}</Box> : null}
            </Block>
          ) : null}

          {dir.person ? (
            <Checkbox checked={consent} onChange={(v) => { setConsent(v); try { window.localStorage.setItem(CONSENT_KEY, v ? '1' : '0'); } catch { /* ignore */ } }} label={t('consent')} />
          ) : null}
          {missing ? <Box sx={{ fontSize: 13, color: tone.warning.fg }}>{missing}</Box> : null}
          <Button variant="primary" onClick={() => (affordable ? void generate() : showCreditsDialog(cost))} disabled={Boolean(missing) || busy === 'generate' || (dir.person && !consent)} loading={busy === 'generate'}>
            {affordable ? `${t('generate', { count: variants })} · ${creditsLabel(cost)}` : tc('buyFor', { count: f.num(cost) })}
          </Button>
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: '6px', flexWrap: 'wrap', fontSize: 12, color: n[500], textAlign: 'center' }}>
            <span>{t('eta', { minutes: (quality === 'best' ? 2 : 1) + (aiStart || aiEnd ? 1 : 0) })}</span>
            {balance ? (
              <span>
                {tc('balanceShort', { count: balance.total === null ? '∞' : f.num(balance.total) })}{' '}
                <Box component="button" type="button" onClick={() => showCreditsDialog()} sx={{ border: 0, p: 0, bgcolor: 'transparent', color: accent[700], font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}>{tc('buyShort')}</Box>
              </span>
            ) : null}
          </Box>
        </Box>

        {/* ───────────── Right: result, versions, library ───────────── */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', position: { lg: 'sticky' }, top: { lg: 12 }, minWidth: 0 }}>
          <Block title={cur ? t('result.titleVersion', { n: Math.max(1, chain.length) }) : t('result.title')}>
            {!cur ? (
              <Box sx={{ p: '32px 16px', textAlign: 'center', color: n[500], fontSize: 14, border: `1px dashed ${n[200]}`, borderRadius: '10px' }}>{t('result.empty')}</Box>
            ) : cur.status === 'preparing' || cur.status === 'running' ? (
              <Box sx={{ p: '32px 16px', textAlign: 'center', bgcolor: n[50], borderRadius: '10px', color: n[600], fontSize: 14 }}>
                <Box sx={{ fontWeight: 600, color: n[800], mb: '4px' }}>{cur.status === 'preparing' ? t('result.preparing') : t('result.running')}</Box>
                {cur.status === 'preparing' ? t('result.preparingHint') : t('result.runningHint')}
              </Box>
            ) : cur.status === 'failed' ? (
              <Banner tone={cur.errorKey === 'videoChildPhoto' ? 'warning' : 'danger'} title={t(`result.error.${cur.errorKey === 'videoChildPhoto' ? 'childPhoto' : cur.errorKey === 'videoFiltered' ? 'filtered' : cur.errorKey === 'keyframeFailed' ? 'keyframe' : cur.errorKey === 'videoWording' ? 'wording' : 'failed'}`)}>
                {(cur.credits ?? 0) > 0 ? t('result.refunded', { count: f.num(cur.credits ?? 0) }) : undefined}
              </Banner>
            ) : (
              <Box component="video" key={cur.url ?? ''} src={cur.url ?? undefined} controls autoPlay loop muted playsInline
                sx={{ width: '100%', maxHeight: '62vh', borderRadius: '10px', bgcolor: '#000', display: 'block' }} />
            )}

            {group.length > 1 ? (
              <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                <Box component="span" sx={{ fontSize: 12, color: n[500] }}>{t('result.variants')}</Box>
                {group.map((g) => (
                  <Box key={g.id} component="button" type="button" onClick={() => { pickedVariant.current.add(g.groupId ?? ''); setCurrent(g.id); }}
                    sx={{ font: 'inherit', fontSize: 12, px: '8px', py: '3px', borderRadius: '6px', cursor: 'pointer', border: `1px solid ${g.id === current ? accent[500] : n[200]}`, bgcolor: g.id === current ? accent[50] : n[0] }}>
                    {t('result.variant', { n: g.variantIndex + 1 })}
                    {g.qa?.status === 'done' && g.qa.match !== undefined ? ` · ${g.qa.match}/10` : ''}
                    {bestInGroup?.id === g.id ? ` ★ ${t('qa.best')}` : ''}
                    {g.status === 'running' || g.status === 'preparing' ? ' …' : ''}
                  </Box>
                ))}
              </Box>
            ) : null}

            {autoFixJob && autoFixJob.id !== cur?.id ? (
              <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', p: '10px', borderRadius: '8px', bgcolor: autoFixJob.status === 'done' ? tone.success.bg : accent[50], border: `1px solid ${autoFixJob.status === 'done' ? tone.success.border : accent[200]}` }} data-testid="video-autofix">
                <Box sx={{ flex: 1, minWidth: 0, fontSize: 13, color: n[800] }}>{autoFixJob.status === 'done' ? t('qa.autoFixReady') : autoFixJob.status === 'failed' ? t('qa.autoFixFailed') : groupMain?.qa?.autoFixMode === 'safer' ? t('qa.autoFixSafer') : t('qa.autoFixRunning')}</Box>
                {autoFixJob.status === 'done' ? <Button variant="secondary" size="sm" onClick={() => setCurrent(autoFixJob.id)}>{t('qa.autoFixShow')}</Button> : null}
              </Box>
            ) : null}
            {cur?.id && autoFixJob?.id === cur.id ? <Box sx={{ fontSize: 12, color: n[600] }}>{t('qa.isAutoFix')}</Box> : null}

            {cur && cur.status === 'done' && qa ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', p: '10px', borderRadius: '8px', bgcolor: n[50], border: `1px solid ${n[200]}` }} data-testid="video-qa">
                <Box sx={{ fontSize: 13, fontWeight: 600, color: n[800] }}>{t('qa.title')}</Box>
                {qa.status === 'running' ? <Box sx={{ fontSize: 12, color: n[600] }}>{t('qa.running')}</Box> : null}
                {qa.status === 'failed' ? <Box sx={{ fontSize: 12, color: n[500] }}>{t('qa.failed')}</Box> : null}
                {qa.status === 'done' ? (
                  <>
                    <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <ScorePill label={t('qa.match')} value={qa.match} />
                      <ScorePill label={t('qa.realism')} value={qa.realism} />
                    </Box>
                    {qa.diffs?.length ? <Box sx={{ fontSize: 12, color: n[700] }}><b>{t('qa.diffs')}</b>{qa.diffs.map((d) => <Box key={d.text}>• {d.text}</Box>)}</Box> : null}
                    {qa.issues?.length ? <Box sx={{ fontSize: 12, color: n[700] }}><b>{t('qa.issues')}</b>{qa.issues.map((d) => <Box key={d.text}>• {d.text}</Box>)}</Box> : null}
                    {!qa.diffs?.length && !qa.issues?.length ? <Box sx={{ fontSize: 12, color: tone.success.fg }}>{t('qa.clean')}</Box> : null}
                    {fixes.length ? (
                      <Button variant="secondary" size="sm" onClick={() => void followUp(`Fix: ${fixes.join('; ')}`.slice(0, 400))} disabled={Boolean(busy)} loading={busy === 'followUp'}>
                        {`${t('qa.fix')} · ${creditsLabel(followCost)}`}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </Box>
            ) : null}

            {readiness ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', p: '10px', borderRadius: '8px', bgcolor: readiness.ok ? tone.success.bg : tone.warning.bg, border: `1px solid ${readiness.ok ? tone.success.border : tone.warning.border}` }}>
                <Box sx={{ fontSize: 13, fontWeight: 600, color: readiness.ok ? tone.success.fg : tone.warning.fg }}>
                  {readiness.ok ? t('ready.ok', { marketplace: t(`target.name.${curTarget}`) }) : t('ready.notOk', { marketplace: t(`target.name.${curTarget}`) })}
                </Box>
                {readiness.issues.map((i) => <Box key={i.key} sx={{ fontSize: 12, color: n[700] }}>{t(`ready.issue.${i.key}`, i.params ?? {})}</Box>)}
              </Box>
            ) : null}

            {cur && cur.status === 'done' ? (
              <>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <Box sx={{ fontSize: 13, fontWeight: 600, color: n[800] }}>{t('refine.title')} <Box component="span" sx={{ fontWeight: 400, color: n[500] }}>· {creditsLabel(followCost)}</Box></Box>
                  <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {chips.map((c) => (
                      <Box key={c} component="button" type="button" disabled={Boolean(busy)} onClick={() => void followUp(c)}
                        sx={{ font: 'inherit', fontSize: 12, lineHeight: '16px', px: '10px', py: '4px', borderRadius: '999px', border: `1px solid ${accent[200]}`, bgcolor: accent[50], color: accent[700], cursor: 'pointer' }}>{c}</Box>
                    ))}
                  </Box>
                  <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); void followUp(ask); }} sx={{ display: 'flex', gap: '6px' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}><TextField value={ask} onChange={(v) => setAsk(v.slice(0, 400))} placeholder={t('refine.placeholder')} /></Box>
                    <Button variant="secondary" type="submit" disabled={!ask.trim() || Boolean(busy)} loading={busy === 'followUp'}>{t('refine.send')}</Button>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <Button variant="secondary" size="sm" onClick={() => void extend()} loading={busy === 'extend'} disabled={Boolean(busy)}>{`${t('action.extend')} · ${creditsLabel(extendCredits(cur.quality))}`}</Button>
                  {cur.aspectRatio !== '1:1' ? <Button variant="secondary" size="sm" onClick={() => void edit({ square: true })} disabled={Boolean(busy)}>{t('action.square')}</Button> : null}
                  {cur.aspectRatio === '9:16' ? <Button variant="secondary" size="sm" onClick={() => void edit({ portrait45: true })} disabled={Boolean(busy)}>{t('action.portrait45')}</Button> : null}
                  {curDir.audio !== 'none' ? <Button variant="secondary" size="sm" onClick={() => void edit({ mute: true })} disabled={Boolean(busy)}>{t('action.mute')}</Button> : null}
                  <Button variant="ghost" size="sm" href={`${cur.url}&download=1`}>{t('action.download')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void toggleFav(cur)}>{cur.favorite ? t('action.unfavorite') : t('action.favorite')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void remove(cur)}>{t('delete')}</Button>
                </Box>
                <Box sx={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Box sx={{ fontSize: 12, color: n[600] }}>{t('action.trim')}</Box>
                  <Box sx={{ width: 70 }}><TextField value={trim.start} onChange={(v) => setTrim((x) => ({ ...x, start: v.replace(/[^\d.]/g, '') }))} placeholder={t('action.from')} /></Box>
                  <Box sx={{ width: 70 }}><TextField value={trim.end} onChange={(v) => setTrim((x) => ({ ...x, end: v.replace(/[^\d.]/g, '') }))} placeholder={t('action.to')} /></Box>
                  <Button variant="secondary" size="sm" disabled={Boolean(busy) || (!trim.start && !trim.end)} onClick={() => void edit({ trimStart: Number(trim.start) || 0, trimEnd: Number(trim.end) || undefined })}>{t('action.trimApply')}</Button>
                </Box>
                {etsyListing ? (
                  <Button variant="primary" onClick={() => useOnListing(cur)}>{t('action.useEtsy')}</Button>
                ) : directMp ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <Button variant="primary" onClick={() => void publish(cur, directMp)} disabled={Boolean(busy) || sent?.status === 'sending'} loading={busy === 'publish'}>
                      {sent?.status === 'done' ? t('publish.again', { marketplace: t(`target.name.${directMp}`) }) : t('publish.button', { marketplace: t(`target.name.${directMp}`) })}
                    </Button>
                    {sent ? (
                      <Box sx={{ fontSize: 12, color: sent.status === 'failed' ? tone.danger.fg : sent.status === 'done' ? tone.success.fg : n[600] }} data-testid="video-publish-status">
                        {sent.status === 'sending' ? t(`publish.sending.${directMp === 'ebay' ? 'ebay' : 'other'}`) : sent.status === 'done' ? t(`publish.done.${directMp}`) : t(`publish.error.${['reconnect', 'tooLarge', 'rejected', 'processing', 'listingNotFound'].includes(sent.error ?? '') ? sent.error : 'failed'}`, { marketplace: t(`target.name.${directMp}`) })}
                      </Box>
                    ) : null}
                  </Box>
                ) : manualMp ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <Box sx={{ fontSize: 12, color: n[600] }}>{t(`publish.manual.${manualMp}`)}</Box>
                    <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <Button variant="primary" size="sm" href={`${cur.url}&download=1`}>{t('action.download')}</Button>
                      <Button variant="secondary" size="sm" href={manualMp === 'amazon' ? 'https://sellercentral.amazon.com/gp/help/external/200216080' : 'https://partner.trendyol.com/'} external>{t(`publish.open.${manualMp}`)}</Button>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ fontSize: 12, color: n[500] }}>{t('publish.noListing')}</Box>
                )}
              </>
            ) : null}

            {chain.length > 1 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <Box sx={{ fontSize: 12, color: n[500] }}>{t('result.history')}</Box>
                {chain.map((c, i) => (
                  <Box key={c.id} component="button" type="button" onClick={() => setCurrent(c.id)}
                    sx={{ textAlign: 'left', font: 'inherit', fontSize: 12, p: '4px 8px', borderRadius: '6px', cursor: 'pointer', border: `1px solid ${c.id === current ? accent[500] : n[100]}`, bgcolor: c.id === current ? accent[50] : n[0], color: n[700], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t('result.version', { n: i + 1 })}{c.instruction ? ` · ${c.instruction}` : ''}{c.status === 'running' || c.status === 'preparing' ? ' …' : ''}
                  </Box>
                ))}
              </Box>
            ) : null}
          </Block>

          <Block title={t('library.title')}>
            <Pills<'all' | 'favorite' | 'listing'> label={t('library.title')} value={libFilter} onChange={(v) => setLibFilter(v)} options={[{ value: 'all', label: t('library.all') }, { value: 'favorite', label: t('library.favorites') }, ...(listing ? [{ value: 'listing' as const, label: t('library.thisListing') }] : [])]} />
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: '8px' }}>
              {library.slice(0, 30).map((j) => (
                <Box key={j.id} component="button" type="button" onClick={() => setCurrent(j.id)}
                  sx={{ p: 0, position: 'relative', aspectRatio: '9 / 12', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', bgcolor: n[900], border: `2px solid ${j.id === current ? accent[600] : 'transparent'}` }}>
                  {j.url ? <Box component="video" src={`${j.url}#t=1`} muted playsInline preload="metadata" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : (
                    <Box sx={{ color: n[300], fontSize: 12, p: '8px' }}>{j.status === 'running' || j.status === 'preparing' ? t('library.running') : t('library.failed')}</Box>
                  )}
                  {j.favorite ? <Box sx={{ position: 'absolute', top: 4, right: 6, color: '#ffd166', fontSize: 14 }}>★</Box> : null}
                  {j.qa?.status === 'done' && j.qa.match !== undefined ? <Box sx={{ position: 'absolute', top: 4, left: 6, px: '4px', borderRadius: '4px', bgcolor: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10 }}>{j.qa.match}/10</Box> : null}
                  <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, p: '4px 6px', background: 'linear-gradient(transparent, rgba(0,0,0,.7))', color: '#fff', fontSize: 11, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {j.title || t('library.untitled')}
                  </Box>
                </Box>
              ))}
              {!library.length ? <Box sx={{ fontSize: 13, color: n[500] }}>{t('library.empty')}</Box> : null}
            </Box>
          </Block>
        </Box>
      </Box>
    </Page>
  );
}

export default VideoStudio;

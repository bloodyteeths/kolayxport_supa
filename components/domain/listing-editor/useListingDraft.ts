// components/domain/listing-editor/useListingDraft.ts — the one autosave engine (listing-editor §5.1).
//
// One save layer: every edit is staged into the DB draft (EtsyListingDraft / EbayListingDraft) 1.5s after the
// last change, on field blur, on ⌘S, before Send, on route change and when the tab is hidden. One request in
// flight; changes during a request queue one follow-up. localStorage is only the offline fallback
// (`listing_draft_<id>`). Nothing reaches the marketplace without `send()` (the footer primary), `send()`
// never forces past a conflict, and a draft with a queued delete is only sent with `confirmedDelete`.
//
// Contract for the section groups (B, C, D) — read it through `useListingEditor()`:
//   - plain fields: `setField(key, value)` / `setFields(patch)`; read `view.fields`, `isFieldDirty(key)`,
//     `revert([key])`, `issuesFor(key)`.
//   - sections that stage on their own (photos, video, variations, personalization, category details, SKU):
//     `register({ id, key?, isDirty, stage, changes?, validate?, reset? })` in an effect (returns unregister;
//     `useRegisterDraftSection` does it), then call `notifyChange()` whenever their unsaved state changes so
//     the engine schedules a save and recounts. Their staging calls use `ctx.shopId` + `ctx.listingId`.
//   - facts for the score and preview (photos + alt text, video, required attributes, variations summary):
//     `reportFacts({ … })`.
import * as React from 'react';
import type {
  CopySourceData,
  DraftRow,
  DraftSection,
  EditorMarketplace,
  EditorMode,
  FieldIssue,
  FieldMap,
  ListingFacts,
  ListingMeta,
  ListingView,
  ChangeSummary,
  QueuedAction,
  SaveState,
  SendResult,
} from '@/lib/listingEditor/types';
import { hasQueuedDelete } from '@/lib/listingEditor/types';
import { diffKeys, summarizeChanges } from './changeSummary';
import type { AdapterContext, AdapterErrorInfo, ListingEditorAdapter } from './adapters/types';

export const AUTOSAVE_DEBOUNCE_MS = 1500;

export type LoadState = 'loading' | 'ready' | 'error';

export interface LoadErrorInfo {
  /** 401 → reconnect, 404 → not on the marketplace any more, null → network / unknown. */
  status: number | null;
  key: string | null;
}

export interface UseListingDraftOptions<F extends FieldMap> {
  adapter: ListingEditorAdapter<F>;
  shopId: string;
  mode: EditorMode;
  /** Edit: the marketplace id. Create: a negative local id when resuming a staged new listing, else null. */
  listingId: string | null;
  /** Create: resume the draft with this id (`new?draft=`). */
  draftId?: string | null;
  /** Create: copy prefill (`?copy=` is loaded through `adapter.loadCopySource` when `copyFromId` is given). */
  copy?: CopySourceData | null;
  copyFromId?: string | null;
  /** Called once the create workspace has its draft (page replaces the URL with `?draft=<id>`). */
  onDraftCreated?: (draft: DraftRow) => void;
  /** Called after a successful send created the listing (page replaces the URL with the real id). */
  onCreated?: (listingId: string) => void;
  debounceMs?: number;
}

export interface UseListingDraft<F extends FieldMap = FieldMap> {
  marketplace: EditorMarketplace;
  mode: EditorMode;
  ctx: AdapterContext;
  loadState: LoadState;
  loadError: LoadErrorInfo | null;
  /** Remote values merged with the staged patch. */
  view: ListingView<F>;
  /** Last refreshed marketplace state (null in create). */
  remote: F | null;
  draft: DraftRow | null;
  /** The drafts fetch failed: editing works, Send is disabled (we could not check for an unsent draft). */
  draftCheckFailed: boolean;
  changes: ChangeSummary[];
  saveState: SaveState;
  savedAt?: Date;
  saveError: AdapterErrorInfo | null;
  sending: boolean;
  /** Issues of the last Send attempt (block_sync), plus live block_save issues. */
  issues: FieldIssue[];
  /** Create: fields prefilled from the last create on this shop ("From your last listing"). */
  defaultsApplied: string[];
  /** A newer device copy than the DB draft exists (restore banner). */
  deviceCopy: { fields: Partial<F>; savedAt: number } | null;
  /** The remote listing changed since the page loaded (refresh or live event). */
  remoteChangedAt: Date | null;

  setField: (key: keyof F & string, value: F[keyof F]) => void;
  setFields: (patch: Partial<F>) => void;
  isFieldDirty: (key: string) => boolean;
  revert: (keys: string[]) => void;
  issuesFor: (key: string) => FieldIssue[];
  register: (section: DraftSection) => () => void;
  notifyChange: () => void;
  reportFacts: (facts: Partial<ListingFacts>) => void;
  saveNow: () => Promise<boolean>;
  send: (opts?: { publish?: boolean; confirmedDelete?: boolean }) => Promise<SendResult>;
  discard: () => Promise<void>;
  refreshRemote: () => Promise<void>;
  reloadDraft: () => Promise<DraftRow | null>;
  /** Restore a snapshot (History panel, device copy): stages, never sends. */
  restore: (fields: Partial<F>) => void;
  restoreDeviceCopy: () => void;
  dismissDeviceCopy: () => void;
  /** Stage queued actions (+ their temp-id fields, e.g. `create_shipping_profile` + `shipping_profile_id`). */
  stageActions: (actions: QueuedAction[], fields?: Record<string, unknown>) => Promise<DraftRow | null>;
  /** Reload the DB draft and overlay its fieldPatch on the form (after a server-side restore, e.g. History). */
  adoptServerDraft: () => Promise<void>;
  removeActions: (types: string[]) => Promise<DraftRow | null>;
  /** Clears the Send issues (banner dismissed / field fixed). */
  clearIssues: () => void;
}

const EMPTY_META: ListingMeta = {
  id: null,
  state: null,
  url: null,
  updatedAt: null,
  views: 0,
  favorites: 0,
  currency: null,
  images: [],
};

function draftTime(draft: DraftRow | null): number {
  const t = draft?.updatedAt ? new Date(draft.updatedAt).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function pick<F extends FieldMap>(fields: F, keys: readonly string[]): Partial<F> {
  const out: Partial<F> = {};
  for (const k of keys) (out as Record<string, unknown>)[k] = fields[k];
  return out;
}

export function useListingDraft<F extends FieldMap>(opts: UseListingDraftOptions<F>): UseListingDraft<F> {
  const { adapter, shopId, mode } = opts;
  const debounceMs = opts.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;

  // Create mode always has a (negative, local) listing id so sub-editors can stage media before the first field.
  const [listingId, setListingId] = React.useState<string | null>(() =>
    mode === 'create' ? opts.listingId ?? (opts.draftId ? null : adapter.newLocalListingId()) : opts.listingId,
  );
  const ctx = React.useMemo<AdapterContext>(() => ({ shopId, listingId }), [shopId, listingId]);

  const [loadState, setLoadState] = React.useState<LoadState>('loading');
  const [loadError, setLoadError] = React.useState<LoadErrorInfo | null>(null);
  const [remote, setRemote] = React.useState<F | null>(null);
  /** Baseline for diffs: remote (edit) or the blank workspace (create). */
  const [baseline, setBaseline] = React.useState<F>(() => adapter.blankFields());
  const [fields, setFieldsState] = React.useState<F>(() => adapter.blankFields());
  const [extra, setExtra] = React.useState<Record<string, unknown>>({});
  /** Field values as last written to the DB draft (null = nothing staged yet). */
  const [savedFields, setSavedFields] = React.useState<F | null>(null);
  const [meta, setMeta] = React.useState<ListingMeta>(EMPTY_META);
  const [facts, setFacts] = React.useState<ListingFacts>({});
  const [draft, setDraft] = React.useState<DraftRow | null>(null);
  const [draftCheckFailed, setDraftCheckFailed] = React.useState(false);
  const [saveState, setSaveState] = React.useState<SaveState>('idle');
  const [savedAt, setSavedAt] = React.useState<Date | undefined>(undefined);
  const [saveError, setSaveError] = React.useState<AdapterErrorInfo | null>(null);
  const [sending, setSending] = React.useState(false);
  /** Send was clicked and its pre-send save is running (UI busy; `sending` itself stays false so section
   *  staging that resolves into fields — eBay picture URLs — is not dropped by the setFields guard). */
  const [preparing, setPreparing] = React.useState(false);
  const [sendIssues, setSendIssues] = React.useState<FieldIssue[]>([]);
  const [serverIssues, setServerIssues] = React.useState<FieldIssue[]>([]);
  const [defaultsApplied, setDefaultsApplied] = React.useState<string[]>([]);
  const [deviceCopy, setDeviceCopy] = React.useState<{ fields: Partial<F>; savedAt: number } | null>(null);
  const [remoteChangedAt, setRemoteChangedAt] = React.useState<Date | null>(null);
  const [sectionsVersion, setSectionsVersion] = React.useState(0);

  // Live values for async code (timers, the save queue) without stale closures.
  const live = React.useRef({ fields, extra, savedFields, draft, remote, baseline, listingId, mode, saveState, sending, draftCheckFailed, meta });
  live.current = { fields, extra, savedFields, draft, remote, baseline, listingId, mode, saveState, sending, draftCheckFailed, meta };
  /** Set state AND the live ref, so async code after an await (send after saveNow) sees the new value at once. */
  const commitDraft = React.useCallback((d: DraftRow | null) => {
    live.current = { ...live.current, draft: d };
    setDraft(d);
  }, []);
  const commitSaved = React.useCallback((f: F | null) => {
    live.current = { ...live.current, savedFields: f };
    setSavedFields(f);
  }, []);
  const sections = React.useRef(new Map<string, DraftSection>());
  const pendingImageUrls = React.useRef<string[]>([]);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = React.useRef<Promise<boolean> | null>(null);
  const followUp = React.useRef(false);
  const mounted = React.useRef(true);
  const createdNotified = React.useRef(false);
  /** Synchronous double-send guard (two clicks / ⌘↵ twice while the pre-send save runs). */
  const sendLock = React.useRef(false);
  /** The workspace no longer stages: the listing was created under a real id (create re-keyed on a failed
   *  send — the page moves to the edit route) or deleted by a send. Autosave must never write to it again. */
  const frozen = React.useRef(false);
  const draftIdOpt = React.useRef(opts.draftId ?? null);
  const onDraftCreated = React.useRef(opts.onDraftCreated);
  onDraftCreated.current = opts.onDraftCreated;
  const onCreated = React.useRef(opts.onCreated);
  onCreated.current = opts.onCreated;

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // ── load ────────────────────────────────────────────────────────────────────────────────────────────────
  const loadKey = `${mode}|${shopId}|${opts.listingId ?? ''}|${opts.draftId ?? ''}|${opts.copyFromId ?? ''}`;
  const copyRef = React.useRef(opts.copy);
  copyRef.current = opts.copy;

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoadState('loading');
      setLoadError(null);
      setRemoteChangedAt(null);
      try {
        if (mode === 'edit') {
          const id = opts.listingId;
          const [loaded, draftResult] = await Promise.all([
            adapter.load({ shopId, listingId: id }),
            adapter.loadDraft({ shopId, listingId: id }).then(
              (d) => ({ ok: true as const, draft: d }),
              () => ({ ok: false as const, draft: null }),
            ),
          ]);
          if (cancelled) return;
          // I0 8b: the DB draft is overlaid before the form is shown, so a replaceFields stage never wipes it.
          const { fields: overlaid, extra: ex } = adapter.overlay(loaded.fields, draftResult.draft);
          setRemote(loaded.fields);
          setBaseline(loaded.fields);
          setMeta(loaded.meta);
          setFacts({ images: loaded.meta.images.map((i) => ({ id: i.id, src: i.src, alt: i.alt })) });
          setFieldsState(overlaid);
          setExtra(ex);
          commitSaved(draftResult.draft ? overlaid : loaded.fields);
          commitDraft(draftResult.draft);
          setDraftCheckFailed(!draftResult.ok);
          setSaveState(draftResult.draft ? 'saved' : 'idle');
          // Offline fallback: a device copy newer than the DB draft (or with no draft) → restore banner.
          const copy = adapter.readDeviceCopy(String(id));
          if (copy && (!draftResult.draft || copy.savedAt > draftTime(draftResult.draft))) {
            const differs = diffKeys(pick(overlaid, Object.keys(copy.fields)) as FieldMap, copy.fields as FieldMap).length > 0;
            setDeviceCopy(differs ? copy : null);
          } else setDeviceCopy(null);
        } else {
          // create: blank → remembered defaults → copy / prefill → resumed draft
          const blank = adapter.blankFields();
          let start = blank;
          let draftRow: DraftRow | null = null;
          let draftOk = true;
          if (opts.draftId || opts.listingId) {
            try {
              draftRow = await adapter.loadDraft({ shopId, listingId: opts.listingId, draftId: opts.draftId });
            } catch {
              draftOk = false;
            }
            if (cancelled) return;
            if (draftRow && createdOnMarketplace(draftRow)) {
              // `?draft=` of a new listing whose create already ran (a later step failed): edit it, never re-create.
              frozen.current = true;
              setListingId(draftRow.listingId);
              onCreated.current?.(draftRow.listingId);
            } else if (draftRow) setListingId(draftRow.listingId);
            else if (opts.draftId && draftOk) {
              // The draft was sent or discarded meanwhile: start a fresh workspace.
              setListingId(adapter.newLocalListingId());
            }
          }
          if (!draftRow) {
            const defaults = adapter.readCreateDefaults(shopId);
            let copy = copyRef.current ?? null;
            if (!copy && opts.copyFromId && adapter.loadCopySource) {
              copy = await adapter.loadCopySource({ shopId, listingId: opts.copyFromId });
              if (cancelled) return;
            }
            const fromCopy = copy ? adapter.fieldsFromCopy(copy) : {};
            start = { ...blank, ...defaults, ...fromCopy } as F;
            setDefaultsApplied(Object.keys(defaults).filter((k) => !(k in fromCopy)));
            pendingImageUrls.current = copy?.imageUrls ?? [];
            setFacts(
              pendingImageUrls.current.length
                ? { images: pendingImageUrls.current.map((src, i) => ({ id: `url-${i}`, src, alt: '', staged: 'add' as const })) }
                : {},
            );
          }
          const { fields: overlaid, extra: ex } = adapter.overlay(start, draftRow);
          setRemote(null);
          setBaseline(blank);
          setMeta({ ...EMPTY_META, id: draftRow?.listingId ?? null });
          setFieldsState(overlaid);
          setExtra(ex);
          commitSaved(draftRow ? overlaid : null);
          commitDraft(draftRow);
          setDraftCheckFailed(!draftOk);
          // A copy / prefill workspace has content that is not saved yet.
          const hasUnsaved = !draftRow && diffKeys(blank, overlaid).length > 0 && Boolean(copyRef.current || opts.copyFromId);
          setSaveState(draftRow ? 'saved' : hasUnsaved ? 'dirty' : 'idle');
          // Offline fallback for a resumed new listing (the copy is keyed by its local id, like edit).
          const copy = draftRow ? adapter.readDeviceCopy(draftRow.listingId) : null;
          if (copy && copy.savedAt > draftTime(draftRow)) {
            const differs = diffKeys(pick(overlaid, Object.keys(copy.fields)) as FieldMap, copy.fields as FieldMap).length > 0;
            setDeviceCopy(differs ? copy : null);
          } else setDeviceCopy(null);
        }
        if (!cancelled) setLoadState('ready');
      } catch (err) {
        if (cancelled) return;
        const info = adapter.errorInfo(err);
        setLoadError({ status: info.status, key: info.key });
        setLoadState('error');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // loadKey covers every input; adapter is a module constant.
  }, [loadKey]);

  // ── derived ─────────────────────────────────────────────────────────────────────────────────────────────
  const changedKeys = React.useMemo(() => adapter.changedKeys(mode === 'edit' ? remote : null, fields), [adapter, mode, remote, fields]);
  const unsavedKeys = React.useMemo(
    () => (savedFields ? diffKeys(savedFields, fields) : diffKeys(baseline, fields)),
    [savedFields, baseline, fields],
  );

  const sectionStates = React.useMemo(
    () =>
      Array.from(sections.current.values()).map((s) => ({
        id: s.id,
        dirty: safeDirty(s),
        changes: s.changes?.(),
      })),
    // sectionsVersion bumps on register / notifyChange
    [sectionsVersion],
  );

  const changes = React.useMemo(
    () =>
      summarizeChanges({
        mode,
        remote: mode === 'edit' ? remote : baseline,
        current: fields,
        changedKeys,
        unsavedKeys,
        extraKeys: Object.keys(extra),
        draft,
        sections: sectionStates,
      }),
    [mode, remote, baseline, fields, changedKeys, unsavedKeys, extra, draft, sectionStates],
  );

  const liveIssues = React.useMemo(
    () => adapter.validate(fields, mode).filter((i) => i.severity === 'block_save'),
    [adapter, fields, mode],
  );
  const issues = React.useMemo(() => {
    const seen = new Set<string>();
    const out: FieldIssue[] = [];
    for (const i of [...liveIssues, ...serverIssues, ...sendIssues]) {
      const k = `${i.field}|${i.key}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(i);
    }
    return out;
  }, [liveIssues, serverIssues, sendIssues]);

  const view = React.useMemo<ListingView<F>>(
    () => ({ marketplace: adapter.marketplace, mode, fields, meta, facts }),
    [adapter.marketplace, mode, fields, meta, facts],
  );

  // ── save queue ──────────────────────────────────────────────────────────────────────────────────────────
  const anySectionDirty = () => Array.from(sections.current.values()).some(safeDirty);

  /**
   * The drafts fetch failed on open, so the form never saw an existing DB draft. Before anything is staged
   * (a field stage is `replaceFields`), load the draft again and overlay its fieldPatch UNDER the user's
   * edits — the same rule as on open (I0 8b). False = still unknown: nothing may be staged.
   */
  const recoverDraftCheck = React.useCallback(async (): Promise<boolean> => {
    const l = live.current;
    let d: DraftRow | null;
    try {
      d = await adapter.loadDraft({
        shopId,
        listingId: l.listingId,
        draftId: l.mode === 'create' ? l.draft?.id ?? draftIdOpt.current : null,
      });
    } catch {
      return false;
    }
    if (!mounted.current) return false;
    const now = live.current;
    const base = now.mode === 'edit' && now.remote ? now.remote : now.baseline;
    const userKeys = diffKeys((now.savedFields ?? now.baseline) as FieldMap, now.fields as FieldMap);
    const { fields: serverFields, extra: ex } = adapter.overlay(base, d);
    const merged = { ...serverFields, ...pick(now.fields, userKeys) } as F;
    let id = now.listingId;
    if (now.mode === 'create') {
      if (d?.listingId) id = d.listingId;
      else if (!id) id = adapter.newLocalListingId();
      if (id !== now.listingId) setListingId(id);
    }
    const saved = d || now.mode === 'edit' ? serverFields : null;
    live.current = { ...live.current, fields: merged, extra: ex, listingId: id, draftCheckFailed: false, savedFields: saved, draft: d };
    setFieldsState(merged);
    setExtra(ex);
    setSavedFields(saved);
    setDraft(d);
    setDraftCheckFailed(false);
    return true;
  }, [adapter, shopId]);

  const runSave = React.useCallback(async (): Promise<boolean> => {
    if (frozen.current) return true;
    if (live.current.draftCheckFailed) {
      const pre = live.current;
      const anyPending =
        diffKeys((pre.savedFields ?? pre.baseline) as FieldMap, pre.fields as FieldMap).length > 0 ||
        anySectionDirty() ||
        pendingImageUrls.current.length > 0;
      if (!anyPending) return true;
      if (mounted.current) setSaveState('saving');
      if (!(await recoverDraftCheck())) {
        // Still unknown: never stage over a draft we did not see. Keep the edits on this device instead.
        if (pre.listingId) adapter.writeDeviceCopy(pre.listingId, live.current.fields);
        if (mounted.current) setSaveState('offline');
        return false;
      }
    }
    const l = live.current;
    const id = l.listingId;
    if (!id) return true;
    const snapshot = l.fields;
    const startedExtra = l.extra;
    const pendingKeys = l.savedFields ? diffKeys(l.savedFields, snapshot) : diffKeys(l.baseline, snapshot);
    const dirtySections = Array.from(sections.current.values()).filter(safeDirty);
    const hasUrls = pendingImageUrls.current.length > 0;
    if (!pendingKeys.length && !dirtySections.length && !hasUrls) {
      if (mounted.current) setSaveState(l.draft ? 'saved' : 'idle');
      return true;
    }
    // block_save values never enter the draft (server rule mirrored): keep them in the form, show inline.
    const blocking = adapter.validate(snapshot, l.mode).filter((i) => i.severity === 'block_save');
    if (pendingKeys.length && blocking.length) {
      if (mounted.current) setSaveState('dirty');
      return false;
    }
    if (mounted.current) {
      setSaveState('saving');
      setSaveError(null);
    }
    const c: AdapterContext = { shopId, listingId: id };
    try {
      let current = l.draft;
      if (pendingKeys.length || (l.mode === 'create' && hasUrls)) {
        current = await adapter.stageFields({ ctx: c, mode: l.mode, remote: l.remote, current: snapshot, extra: startedExtra, draft: l.draft });
        if (current && l.mode === 'create' && !createdNotified.current) {
          createdNotified.current = true;
          onDraftCreated.current?.(current);
        }
      }
      if (hasUrls && l.mode === 'create' && adapter.stageImageUrls) {
        const urls = pendingImageUrls.current;
        pendingImageUrls.current = [];
        current = (await adapter.stageImageUrls(c, urls)) ?? current;
      }
      for (const s of dirtySections) await s.stage();
      if (dirtySections.length) current = await adapter.loadDraft({ shopId, listingId: id });
      if (l.mode === 'create' && current && !createdNotified.current) {
        createdNotified.current = true;
        onDraftCreated.current?.(current);
      }
      adapter.clearDeviceCopy(id);
      if (!mounted.current) return true;
      commitDraft(current);
      commitSaved(snapshot);
      setServerIssues([]);
      setSavedAt(new Date());
      setDraftCheckFailed(false);
      setSectionsVersion((v) => v + 1);
      const stillDirty = live.current.fields !== snapshot || anySectionDirty();
      setSaveState(stillDirty ? 'dirty' : current ? 'saved' : 'idle');
      return true;
    } catch (err) {
      const info = adapter.errorInfo(err);
      if (info.network) adapter.writeDeviceCopy(id, live.current.fields);
      if (!mounted.current) return false;
      setSaveError(info);
      if (info.issues?.length) setServerIssues(info.issues);
      setSaveState(info.network ? 'offline' : 'error');
      return false;
    }
  }, [adapter, shopId, recoverDraftCheck]);

  const saveNow = React.useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) {
      followUp.current = true;
      await inFlight.current;
      if (!followUp.current) return live.current.saveState !== 'error' && live.current.saveState !== 'offline';
    }
    followUp.current = false;
    const p = runSave();
    inFlight.current = p;
    let ok = false;
    try {
      ok = await p;
    } finally {
      inFlight.current = null;
    }
    if (followUp.current) {
      followUp.current = false;
      return saveNow();
    }
    return ok;
  }, [runSave]);

  const schedule = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void saveNow();
    }, debounceMs);
  }, [debounceMs, saveNow]);

  // ── edits ───────────────────────────────────────────────────────────────────────────────────────────────
  const touched = React.useCallback(() => {
    setSendIssues([]);
    setSaveState((s) => (s === 'saving' ? s : 'dirty'));
    schedule();
  }, [schedule]);

  const setFields = React.useCallback(
    (patch: Partial<F>) => {
      if (live.current.sending) return;
      // Synchronous ref update: a save started in the same tick (⌘S, Send) stages these values.
      const next = { ...live.current.fields, ...patch } as F;
      live.current = { ...live.current, fields: next };
      setFieldsState(next);
      setDefaultsApplied((d) => (d.length ? d.filter((k) => !(k in patch)) : d));
      touched();
    },
    [touched],
  );

  const setField = React.useCallback(
    (key: keyof F & string, value: F[keyof F]) => setFields({ [key]: value } as Partial<F>),
    [setFields],
  );

  const revert = React.useCallback(
    (keys: string[]) => {
      const base = live.current.mode === 'edit' ? live.current.remote : live.current.baseline;
      if (!base) return;
      setFields(pick(base, keys));
    },
    [setFields],
  );

  const restore = React.useCallback((patch: Partial<F>) => setFields(patch), [setFields]);

  const isFieldDirty = React.useCallback((key: string) => changedKeys.includes(key), [changedKeys]);
  const issuesFor = React.useCallback((key: string) => issues.filter((i) => i.field === key), [issues]);

  const register = React.useCallback((section: DraftSection) => {
    const key = section.key ?? section.id;
    sections.current.set(key, section);
    setSectionsVersion((v) => v + 1);
    return () => {
      if (sections.current.get(key) === section) sections.current.delete(key);
      setSectionsVersion((v) => v + 1);
    };
  }, []);

  const notifyChange = React.useCallback(() => {
    setSectionsVersion((v) => v + 1);
    if (anySectionDirty()) touched();
  }, [touched]);

  const reportFacts = React.useCallback((patch: Partial<ListingFacts>) => {
    setFacts((prev) => {
      let same = true;
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify((prev as Record<string, unknown>)[k]) !== JSON.stringify(v)) same = false;
      }
      return same ? prev : { ...prev, ...patch };
    });
  }, []);

  // ── draft + remote refresh ─────────────────────────────────────────────────────────────────────────────
  const reloadDraft = React.useCallback(async (): Promise<DraftRow | null> => {
    // Retry after a failed draft check: overlay what was found under the user's edits (never just adopt the
    // row, or the next replaceFields stage would wipe the keys the form never showed).
    if (live.current.draftCheckFailed) {
      await recoverDraftCheck();
      return live.current.draft;
    }
    const id = live.current.listingId;
    if (!id) return null;
    try {
      const d = await adapter.loadDraft({ shopId, listingId: id });
      if (mounted.current) {
        commitDraft(d);
        setDraftCheckFailed(false);
      }
      return d;
    } catch {
      if (mounted.current) setDraftCheckFailed(true);
      return live.current.draft;
    }
  }, [adapter, shopId, recoverDraftCheck]);

  /**
   * Pull the live listing; keep every field the user changed (never overwrite a dirty field).
   * `afterOwnSend`: the refresh right after our own successful send. Our write bumped the marketplace's
   * updatedAt, so it is not a remote change, and every edit just went out: adopt the remote values as they are
   * now (the marketplace may normalise what we sent, e.g. HTML or tag order) instead of keeping our copies, which
   * would show as "1 change not sent".
   */
  const refreshRemote = React.useCallback(async (opts: { afterOwnSend?: boolean } = {}) => {
    const l = live.current;
    if (l.mode !== 'edit' || !l.listingId) return;
    const loaded = await adapter.load({ shopId, listingId: l.listingId });
    const prevRemote = live.current.remote;
    const keep = prevRemote && !opts.afterOwnSend ? adapter.changedKeys(prevRemote, live.current.fields) : [];
    const savedKeep = prevRemote && live.current.savedFields && !opts.afterOwnSend ? adapter.changedKeys(prevRemote, live.current.savedFields) : [];
    if (!mounted.current) return;
    setRemote(loaded.fields);
    setBaseline(loaded.fields);
    const before = live.current.meta.updatedAt;
    if (opts.afterOwnSend) setRemoteChangedAt(null);
    else if (before && loaded.meta.updatedAt && loaded.meta.updatedAt.getTime() !== before.getTime()) setRemoteChangedAt(loaded.meta.updatedAt);
    setMeta(loaded.meta);
    setFieldsState((cur) => ({ ...loaded.fields, ...pick(cur, keep) }));
    const saved = live.current.savedFields;
    commitSaved(saved ? ({ ...loaded.fields, ...pick(saved, savedKeep) } as F) : saved);
    await reloadDraft();
  }, [adapter, shopId, reloadDraft]);

  // ── send ────────────────────────────────────────────────────────────────────────────────────────────────
  const sendLocked = React.useCallback(
    async (sendOpts: { publish?: boolean; confirmedDelete?: boolean }): Promise<SendResult> => {
      let saved = await saveNow();
      // Section staging can change fields after runSave took its snapshot (an eBay picture upload resolving puts
      // its URL into `images`): save again so Send never goes out on a draft without them.
      const fieldsUnsaved = () => {
        const l = live.current;
        return diffKeys((l.savedFields ?? l.baseline) as FieldMap, l.fields as FieldMap).length > 0;
      };
      for (let round = 0; saved && round < 3 && (fieldsUnsaved() || anySectionDirty()); round++) saved = await saveNow();
      if (saved && fieldsUnsaved()) return { outcome: 'failed', error: live.current.saveState };
      if (!saved) {
        const blocking = adapter.validate(live.current.fields, live.current.mode).filter((i) => i.severity !== 'warn');
        if (blocking.length) {
          setSendIssues(blocking);
          return { outcome: 'blocked', issues: blocking };
        }
        return { outcome: 'failed', error: live.current.saveState };
      }
      const l = live.current;
      const sectionIssues = Array.from(sections.current.values()).flatMap((s) => s.validate?.() ?? []);
      const blocking = [...adapter.validate(l.fields, l.mode), ...sectionIssues].filter((i) => i.severity !== 'warn');
      if (blocking.length) {
        setSendIssues(blocking);
        return { outcome: 'blocked', issues: blocking };
      }
      let current = l.draft;
      if (!current) return { outcome: 'cancelled' };
      if (hasQueuedDelete(current) && !sendOpts.confirmedDelete) return { outcome: 'blocked' };
      const c: AdapterContext = { shopId, listingId: l.listingId };
      setSending(true);
      try {
        if (l.mode === 'create') {
          const queuedPublish = current.queuedActions.some((a) => a.type === 'publish' && !a.completedAt);
          if (sendOpts.publish && !queuedPublish) current = (await adapter.stageActions(c, [{ type: 'publish' }])) ?? current;
          if (!sendOpts.publish && queuedPublish) current = (await adapter.removeActions(current.id, ['publish'])) ?? current;
        }
        const result = await adapter.send(current, { publish: sendOpts.publish });
        if (result.deleted) {
          // A queued delete ran: the listing is gone. Stop autosave; the page leaves the editor.
          frozen.current = true;
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          if (l.listingId) adapter.clearDeviceCopy(l.listingId);
          if (mounted.current) {
            commitDraft(null);
            live.current = { ...live.current, extra: {} };
            setExtra({});
            setSendIssues([]);
            commitSaved(live.current.fields);
            setSaveState('idle');
          }
          return { outcome: 'sent', listingId: result.listingId, deleted: true, warnings: result.warnings };
        }
        if (l.mode === 'create') {
          adapter.writeCreateDefaults(shopId, l.fields);
          const realId = result.listingId;
          if (mounted.current) setSending(false);
          if (realId && Number(realId) > 0) onCreated.current?.(realId);
          return { outcome: 'sent', listingId: realId, warnings: result.warnings };
        }
        // Edit: the listing is up to date; reload Etsy values and the (now synced) draft.
        if (mounted.current) {
          commitDraft(null);
          // Draft-only keys (no form input) were sent with the draft: never re-stage their old values.
          live.current = { ...live.current, extra: {} };
          setExtra({});
          setSendIssues([]);
        }
        let refreshed = false;
        try {
          await refreshRemote({ afterOwnSend: true });
          refreshed = true;
        } catch {
          /* the send succeeded; the refresh can be retried from SyncMeta */
        }
        if (mounted.current) {
          // refreshRemote already committed the fresh remote values as saved; only fall back to the form copy.
          if (!refreshed) commitSaved(live.current.fields);
          setSaveState('idle');
        }
        return { outcome: 'sent', listingId: result.listingId, warnings: result.warnings };
      } catch (err) {
        const info = adapter.errorInfo(err);
        if (info.issues?.length) setSendIssues(info.issues);
        if (l.mode === 'create') {
          // The server may have created the listing before a later step failed: it re-keys the draft to the
          // real id. Reload by draft id (not the local id, which no longer matches) and move to edit semantics,
          // so a retry patches that listing instead of creating a duplicate.
          let d: DraftRow | null = null;
          let reloaded = false;
          try {
            d = await adapter.loadDraft({ shopId, draftId: current.id });
            reloaded = true;
          } catch {
            /* keep the current row */
          }
          if (reloaded && mounted.current) commitDraft(d);
          if (d?.listingId && (createdOnMarketplace(d) || (d.listingId !== l.listingId && !d.listingId.startsWith('-')))) {
            frozen.current = true;
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
            live.current = { ...live.current, listingId: d.listingId };
            if (mounted.current) setListingId(d.listingId);
            onCreated.current?.(d.listingId);
            return { outcome: 'failed', listingId: d.listingId, error: err };
          }
        } else {
          await reloadDraft();
        }
        return { outcome: info.conflict ? 'conflict' : 'failed', error: err };
      } finally {
        if (mounted.current) setSending(false);
      }
    },
    [adapter, saveNow, shopId, refreshRemote, reloadDraft, commitDraft, commitSaved],
  );

  const send = React.useCallback(
    async (sendOpts: { publish?: boolean; confirmedDelete?: boolean } = {}): Promise<SendResult> => {
      if (sendLock.current || live.current.sending) return { outcome: 'cancelled' };
      if (live.current.draftCheckFailed) return { outcome: 'blocked' };
      sendLock.current = true;
      setPreparing(true);
      try {
        return await sendLocked(sendOpts);
      } finally {
        sendLock.current = false;
        if (mounted.current) setPreparing(false);
      }
    },
    [sendLocked],
  );

  // ── discard ─────────────────────────────────────────────────────────────────────────────────────────────
  const discard = React.useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) await inFlight.current.catch(() => false);
    const l = live.current;
    if (l.draft) await adapter.discard(l.draft.id);
    for (const s of Array.from(sections.current.values())) s.reset?.();
    if (l.listingId) adapter.clearDeviceCopy(l.listingId);
    pendingImageUrls.current = [];
    if (!mounted.current) return;
    const base = l.mode === 'edit' && l.remote ? l.remote : l.baseline;
    setFieldsState(base);
    commitSaved(l.mode === 'edit' ? base : null);
    setExtra({});
    commitDraft(null);
    setSendIssues([]);
    setServerIssues([]);
    setDeviceCopy(null);
    setSaveState('idle');
    setSectionsVersion((v) => v + 1);
  }, [adapter]);

  const stageActions = React.useCallback(
    async (actions: QueuedAction[], actionFields?: Record<string, unknown>) => {
      const id = live.current.listingId;
      if (!id) return null;
      await saveNow();
      const d = await adapter.stageActions({ shopId, listingId: id }, actions, actionFields);
      if (!mounted.current) return d;
      commitDraft(d);
      if (actionFields && Object.keys(actionFields).length) {
        // The temp-id fields are now in the DB draft: mirror them in the form and the saved snapshot.
        const patch = actionFields as Partial<F>;
        setFieldsState((prev) => ({ ...prev, ...patch }));
        commitSaved({ ...(live.current.savedFields ?? live.current.baseline), ...patch } as F);
      }
      setSaveState(live.current.saveState === 'dirty' ? 'dirty' : 'saved');
      setSavedAt(new Date());
      return d;
    },
    [adapter, shopId, saveNow],
  );

  const adoptServerDraft = React.useCallback(async () => {
    const l = live.current;
    if (!l.listingId) return;
    const d = await adapter.loadDraft({ shopId, listingId: l.listingId });
    if (!mounted.current) return;
    const base = l.mode === 'edit' && l.remote ? l.remote : l.baseline;
    const { fields: overlaid, extra: ex } = adapter.overlay(base, d);
    commitDraft(d);
    setFieldsState(overlaid);
    setExtra(ex);
    commitSaved(overlaid);
    setSaveState(d ? 'saved' : 'idle');
    setSavedAt(new Date());
  }, [adapter, shopId]);

  const removeActions = React.useCallback(
    async (types: string[]) => {
      const d = live.current.draft;
      if (!d) return null;
      const next = await adapter.removeActions(d.id, types);
      if (mounted.current) commitDraft(next);
      return next;
    },
    [adapter],
  );

  const restoreDeviceCopy = React.useCallback(() => {
    const copy = deviceCopy;
    if (!copy) return;
    setDeviceCopy(null);
    setFields(copy.fields);
  }, [deviceCopy, setFields]);

  const dismissDeviceCopy = React.useCallback(() => {
    const id = live.current.listingId;
    if (id) adapter.clearDeviceCopy(id);
    setDeviceCopy(null);
  }, [adapter]);

  const clearIssues = React.useCallback(() => setSendIssues([]), []);

  // ── flush triggers: tab hidden ──────────────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVis = () => {
      if (document.visibilityState === 'hidden' && (live.current.saveState === 'dirty' || timer.current)) void saveNow();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [saveNow]);

  return {
    marketplace: adapter.marketplace,
    mode,
    ctx,
    loadState,
    loadError,
    view,
    remote: mode === 'edit' ? remote : null,
    draft,
    draftCheckFailed,
    changes,
    saveState,
    savedAt,
    saveError,
    sending: sending || preparing,
    issues,
    defaultsApplied,
    deviceCopy,
    remoteChangedAt,
    setField,
    setFields,
    isFieldDirty,
    revert,
    issuesFor,
    register,
    notifyChange,
    reportFacts,
    saveNow,
    send,
    discard,
    refreshRemote,
    reloadDraft,
    restore,
    restoreDeviceCopy,
    dismissDeviceCopy,
    stageActions,
    adoptServerDraft,
    removeActions,
    clearIssues,
  };
}

/** The draft's `create_listing` already ran on the marketplace (the server marks it completed and re-keys). */
function createdOnMarketplace(d: DraftRow): boolean {
  return d.queuedActions.some((a) => a?.type === 'create_listing' && Boolean(a.completedAt));
}

function safeDirty(s: DraftSection): boolean {
  try {
    return s.isDirty();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Context (what section / rail / panel components read)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ListingEditorContextValue<F extends FieldMap = FieldMap> extends UseListingDraft<F> {
  /** Brand name for copy ("Etsy" / "eBay"); i18n messages take it as `{marketplace}`. */
  marketplaceName: string;
  /** Fields are read-only while a send is running or the draft is `syncing`. */
  readOnly: boolean;
  /** Scroll to a section (and focus a field inside it when given). */
  scrollTo: (section: string, field?: string) => void;
  /** Score-panel / rail fix actions that need the frame (e.g. 'review', 'history'). */
  openPanel: (panel: 'health' | 'preview' | 'review' | 'history' | 'profiles' | 'schedule') => void;
}

export const ListingEditorContext = React.createContext<ListingEditorContextValue | null>(null);

/** The editor engine + frame helpers. Throws outside `<ListingEditor>`. */
export function useListingEditor<F extends FieldMap = FieldMap>(): ListingEditorContextValue<F> {
  const v = React.useContext(ListingEditorContext);
  if (!v) throw new Error('useListingEditor must be used inside <ListingEditor>');
  return v as unknown as ListingEditorContextValue<F>;
}

/** Same, or null outside the editor (components reused elsewhere, tests). */
export function useOptionalListingEditor<F extends FieldMap = FieldMap>(): ListingEditorContextValue<F> | null {
  return React.useContext(ListingEditorContext) as unknown as ListingEditorContextValue<F> | null;
}

/**
 * Registers a staging section for the lifetime of the component. The handle object may change every
 * render; the registration reads the latest one through a ref, so it is registered once per `id`/`key`.
 */
export function useRegisterDraftSection(section: DraftSection | null): void {
  const editor = useOptionalListingEditor();
  const ref = React.useRef(section);
  ref.current = section;
  const register = editor?.register;
  const id = section?.id;
  const key = section?.key ?? section?.id;
  React.useEffect(() => {
    if (!register || !id) return undefined;
    const proxy: DraftSection = {
      id,
      key,
      isDirty: () => ref.current?.isDirty() ?? false,
      stage: () => ref.current?.stage() ?? Promise.resolve(),
      changes: () => ref.current?.changes?.() ?? [],
      validate: () => ref.current?.validate?.() ?? [],
      reset: () => ref.current?.reset?.(),
    };
    return register(proxy);
  }, [register, id, key]);
}

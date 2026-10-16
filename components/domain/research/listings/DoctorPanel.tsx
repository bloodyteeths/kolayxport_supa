// components/domain/research/listings/DoctorPanel.tsx — the Doctor panel (research.md §7.1, §7.2):
// SidePanel lg 720 (full-height sheet on mobile), list stays mounted, ‹ › between rows.
//
// Body: Last 30 days (Measured) · main keyword (edit) · inline fix (price / AI title) · listing ScorePanel +
// "Compared with peers" · Staged here. Footer: [Open editor] [Stage N fixes] — the primary STAGES one draft per
// listing (`useDoctorStaging`), ⌘S does the same. Nothing here sends to a marketplace (research §3.4).
//
// Fix routing (`fixKindFor`): price → "Set price…" (MoneyField prefilled with the peer median and the p25–p75
// band) · title → "Suggest a title" FieldSuggestion (AI, 1 credit, Etsy) · tags → Keyword explorer for this
// listing (the R2 panel; a new tab until R2) · photos → Photo studio (Pro) or the editor #photos · other → editor.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { IconAction } from '@/components/ds/overlay/IconAction';
import { Thumb } from '@/components/ds/data/Thumb';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { useDsFormat } from '@/components/ds/data/fmt';
import { Metric } from '@/components/ds/research/Metric';
import { PriceBand } from '@/components/ds/research/PriceBand';
import { Button } from '@/components/ds/inputs/Button';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { TextField } from '@/components/ds/inputs/TextField';
import { FieldSuggestion } from '@/components/ds/inputs/FieldSuggestion';
import { useToast } from '@/components/ds/feedback/toast';
import { researchToolHref } from '@/components/domain/research/ResearchLayout';
import { icons } from '@/lib/ds/icons';
import { neutral as n, radius } from '@/lib/ds/tokens';
import type { Check } from '@/lib/listingScore/types';
import type { DoctorRow, Guarded } from '@/lib/research/types';
import { requestTitleSuggestion, useDoctorPeers, type StageOutcome } from '@/lib/research/hooks/useDoctor';
import type { StagePatch } from '@/lib/listings/types';
import { PeerChecks } from './PeerChecks';
import { StagedHere } from './StagedHere';
import {
  cleanAiTitle,
  editorFieldFor,
  editorHref,
  fixKindFor,
  notSentHref,
  photoFixHref,
  priceProposalBlocked,
  proposalsToPatch,
  removeProposal,
  upsertProposal,
  usablePeerMedian,
  type DoctorMkt,
  type DoctorProposal,
} from './doctorModel';

export type DoctorPanelProps = {
  row: DoctorRow | null;
  open: boolean;
  mkt: DoctorMkt;
  shopId: string | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** `editor-etsy` / `editor-ebay` flag: open the new editor, else the listings page with `?open=`. */
  /** `features.bulkPhotoStudio`. */
  photoStudio: boolean;
  /** Staging (one draft per listing). */
  stage: (items: { id: string; patch: StagePatch }[]) => Promise<StageOutcome>;
  /** After a successful stage (refresh the list). */
  onStaged?: (listingId: string) => void;
  /** Test seam for navigation. */
  navigate?: (href: string, opts?: { newTab?: boolean }) => void;
};

const TOAST_TITLE_MAX = 28;
const shortTitle = (s: string) => (s.length > TOAST_TITLE_MAX ? `${s.slice(0, TOAST_TITLE_MAX - 1).trimEnd()}…` : s);

const guardOf = (g: Guarded<number>) => ({ ok: g.guard.ok, reasonKey: g.guard.reasonKey, reasonParams: g.guard.reasonParams });
const valueOf = (g: Guarded<number>) => (g.guard.ok && typeof g.value === 'number' && Number.isFinite(g.value) ? g.value : null);

type TitleState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; value: string; rationale?: string } | { status: 'error'; message?: string };

export function DoctorPanel({
  row, open, mkt, shopId, onClose, onPrev, onNext, photoStudio, stage, onStaged, navigate,
}: DoctorPanelProps) {
  const t = useTranslations();
  const fmt = useDsFormat();
  const toast = useToast();
  const router = useRouter();
  const go = React.useCallback(
    (href: string, opts?: { newTab?: boolean }) => {
      if (navigate) return navigate(href, opts);
      if (opts?.newTab) {
        window.open(href, '_blank', 'noopener,noreferrer');
        return;
      }
      void router.push(href);
    },
    [navigate, router],
  );

  const listingId = row?.listing.id ?? null;
  const [proposals, setProposals] = React.useState<DoctorProposal[]>([]);
  const [keywordOverride, setKeywordOverride] = React.useState<string | null>(null);
  const [editingKeyword, setEditingKeyword] = React.useState<string | null>(null);
  const [priceDraft, setPriceDraft] = React.useState<number | null | undefined>(undefined);
  const [titleState, setTitleState] = React.useState<TitleState>({ status: 'idle' });
  const [staging, setStaging] = React.useState(false);

  // A different listing starts clean (the dirty guard already confirmed discarding).
  React.useEffect(() => {
    setProposals([]);
    setKeywordOverride(null);
    setEditingKeyword(null);
    setPriceDraft(undefined);
    setTitleState({ status: 'idle' });
  }, [listingId]);

  const keyword = keywordOverride;
  const peers = useDoctorPeers(open ? listingId : null, { mkt, shop: shopId, keyword });
  const peerPrice = peers.data?.peers.price ?? null;
  const peerMedian = usablePeerMedian(peerPrice);
  const mainKeyword = peers.data?.keyword ?? row?.mainKeyword ?? null;

  const listing = row?.listing ?? null;
  const currency = listing?.price?.currency ?? peerPrice?.currency ?? 'USD';

  // ── fixes ──────────────────────────────────────────────────────────────────────────────────────────
  const suggestTitle = React.useCallback(async () => {
    if (!listing) return;
    setTitleState({ status: 'loading' });
    try {
      const res = await requestTitleSuggestion({ title: listing.title, keyword: mainKeyword?.keyword ?? null });
      if (res.status === 402) {
        setTitleState({ status: 'error', message: t('research.doc.aiCredits') });
        return;
      }
      const clean = res.status >= 200 && res.status < 300 ? cleanAiTitle(res.title, mkt === 'etsy' ? 140 : 80) : null;
      if (!clean) {
        setTitleState({ status: 'error' });
        return;
      }
      const rationale = typeof res.explanation === 'string' && res.explanation.length <= 240 ? res.explanation : undefined;
      setTitleState({ status: 'ready', value: clean, rationale });
    } catch {
      setTitleState({ status: 'error' });
    }
  }, [listing, mainKeyword?.keyword, mkt, t]);

  // Accepted-but-unstaged proposals live only in this panel: while there are any, a same-tab navigation (editor,
  // photos) would drop them without the SidePanel's dirty guard, so those targets open in a new tab instead.
  const hasProposals = proposals.length > 0;
  const leave = React.useCallback((href: string) => go(href, hasProposals ? { newTab: true } : undefined), [go, hasProposals]);

  const onFix = React.useCallback(
    (check: Check) => {
      if (!listing) return;
      const kind = fixKindFor(check);
      if (kind === 'price') {
        if (priceProposalBlocked(listing)) {
          leave(editorHref(mkt, listing.id, shopId, 'price'));
          return;
        }
        setPriceDraft(peerMedian ?? listing.price?.amount ?? null);
        return;
      }
      if (kind === 'title' && mkt === 'etsy') {
        void suggestTitle();
        return;
      }
      if (kind === 'tags') {
        go(researchToolHref('keywords', mkt, { listing: listing.id, shop: shopId ?? undefined }), { newTab: true });
        return;
      }
      if (kind === 'photos') {
        leave(photoFixHref(mkt, listing.id, shopId, { photoStudio }));
        return;
      }
      leave(editorHref(mkt, listing.id, shopId, editorFieldFor(check)));
    },
    [listing, mkt, shopId, photoStudio, peerMedian, suggestTitle, go, leave],
  );

  const acceptPrice = () => {
    if (!listing || priceDraft == null || !(priceDraft > 0)) return;
    setProposals((ps) => upsertProposal(ps, { field: 'price', checkId: 'price_vs_peers', from: listing.price?.amount ?? null, to: priceDraft, currency }));
    setPriceDraft(undefined);
  };

  const acceptTitle = () => {
    if (!listing || titleState.status !== 'ready') return;
    setProposals((ps) => upsertProposal(ps, { field: 'title', checkId: 'title_length', from: listing.title, to: titleState.value }));
    setTitleState({ status: 'idle' });
  };

  // ── stage (the panel primary, ⌘S) ──────────────────────────────────────────────────────────────────
  const stageNow = React.useCallback(async () => {
    if (!listing || !proposals.length || staging) return;
    setStaging(true);
    try {
      const out = await stage([{ id: listing.id, patch: proposalsToPatch(proposals) }]);
      if (out.staged.includes(listing.id)) {
        const count = proposals.length;
        setProposals([]);
        toast.info(t('research.toast.fixesStaged', { count, title: shortTitle(listing.title) }), {
          action: { label: t('research.doc.goToListings'), onClick: () => go(notSentHref(mkt, shopId)) },
        });
        onStaged?.(listing.id);
      } else {
        const f = out.failed[0];
        const keyed = f?.errorKey && t.has(`etsy.${f.errorKey}`) ? t(`etsy.${f.errorKey}`) : null;
        toast.error(keyed ?? t('research.doc.stageFailed'), { persist: false });
      }
    } finally {
      setStaging(false);
    }
  }, [listing, proposals, staging, stage, toast, t, go, mkt, shopId, onStaged]);

  if (!row || !listing) {
    return <SidePanel padded open={false} onClose={onClose} title="" size="lg" />;
  }

  const count = proposals.length;
  const primary = {
    id: 'doctor-stage',
    label: t('research.action.stageFixes', { count: Math.max(count, 1) }),
    icon: icons.edit,
    onClick: () => void stageNow(),
    loading: staging,
    loadingLabel: t('research.doc.staging'),
    disabled: count === 0,
    disabledReason: count === 0 ? t('research.doc.noProposals') : undefined,
    shortcut: '⌘S',
  };
  const editorTarget = editorHref(mkt, listing.id, shopId);
  const secondary = hasProposals
    ? { id: 'doctor-open-editor', label: t('research.doc.fix.openEditor'), onClick: () => leave(editorTarget) }
    : { id: 'doctor-open-editor', label: t('research.doc.fix.openEditor'), href: editorTarget };
  const overflow = listing.externalUrl
    ? [{ id: 'doctor-view-external', label: t('research.doc.viewOn', { marketplace: mkt === 'etsy' ? 'Etsy' : 'eBay' }), icon: icons.externalLink, onClick: () => go(listing.externalUrl ?? '', { newTab: true }) }]
    : [];

  const unsent = listing.sync && listing.sync.status !== 'synced' ? listing.sync.changedFields.length : 0;
  const saveNote = count > 0 ? t('research.doc.unstaged', { count }) : unsent > 0 ? t('research.doc.notSent', { count: unsent }) : undefined;

  const metaParts = [...listing.metaLine];
  if (peers.data && peers.data.peers.n > 0 && mainKeyword) {
    metaParts.push(t('research.doc.comparedWith', { n: peers.data.peers.n, keyword: mainKeyword.keyword }));
  }

  const views = valueOf(row.views30d);
  const sales = valueOf(row.sales30d);
  const conv = valueOf(row.conversion);
  const favorites = typeof listing.extra.favorites === 'number' ? listing.extra.favorites : null;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size="lg"
      title={listing.title}
      leading={<Thumb src={listing.thumbUrl} alt="" size={40} />}
      status={<StatusPill domain="listing" status={listing.status} raw={listing.statusRaw} />}
      meta={metaParts.join(' · ')}
      onPrev={onPrev}
      onNext={onNext}
      primary={primary}
      secondary={secondary}
      overflow={overflow}
      dirty={count > 0}
      saveState={staging ? 'saving' : count > 0 ? 'dirty' : 'idle'}
      saveNote={saveNote}
      onSave={() => void stageNow()}
      data-testid="doctor-panel"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Last 30 days (Measured; lifetime favorites labelled "(all time)") */}
        <Box component="section" data-testid="doctor-last30">
          <Typography variant="titleSm" component="h3" sx={{ m: 0, mb: '4px', color: n[800] }}>
            {t('research.doc.last30')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px' }}>
            <span>
              <Metric value={views != null ? fmt.num(views) : null} kind={row.views30d.kind} guard={guardOf(row.views30d)} />{' '}
              <Typography component="span" variant="caption" sx={{ color: n[600] }}>{t('research.doc.unit.views', { count: views ?? 0 })}</Typography>
            </span>
            <span>
              <Metric value={sales != null ? fmt.num(sales) : null} kind={row.sales30d.kind} guard={guardOf(row.sales30d)} />{' '}
              <Typography component="span" variant="caption" sx={{ color: n[600] }}>{t('research.doc.unit.sales', { count: sales ?? 0 })}</Typography>
            </span>
            <span>
              <Metric value={conv != null ? fmt.percent(conv, 1) : null} kind={row.conversion.kind} guard={guardOf(row.conversion)} />{' '}
              <Typography component="span" variant="caption" sx={{ color: n[600] }}>{t('research.doc.unit.conversion')}</Typography>
            </span>
            {favorites != null ? (
              <Typography component="span" variant="caption" sx={{ color: n[600] }}>
                {t('research.doc.unit.favoritesAllTime', { count: favorites, value: fmt.num(favorites) })}
              </Typography>
            ) : null}
          </Box>
          <Typography variant="caption" component="p" sx={{ m: 0, mt: '2px', color: n[500] }}>
            {t('research.doc.last30Source')}
          </Typography>
        </Box>

        {/* Main keyword (tracked / from the title / AI pick), editable for the peer comparison */}
        {mkt === 'etsy' ? (
          <Box component="section" data-testid="doctor-main-keyword" sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Typography variant="caption" component="span" sx={{ color: n[600] }}>
              {mainKeyword && mainKeyword.source !== 'tracked' ? t('research.doc.mainKwSuggested') : t('research.doc.mainKw')}
            </Typography>
            {editingKeyword !== null ? (
              <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1, minWidth: 200 }}>
                <TextField
                  value={editingKeyword}
                  onChange={(v) => setEditingKeyword(v)}
                  size="sm"
                  maxLength={80}
                  autoFocus
                  aria-label={t('research.doc.mainKw')}
                  data-testid="doctor-keyword-input"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!editingKeyword.trim()}
                  disabledReason={t('research.doc.keywordRequired')}
                  onClick={() => {
                    setKeywordOverride(editingKeyword.trim());
                    setEditingKeyword(null);
                  }}
                  data-testid="doctor-keyword-apply"
                >
                  {t('research.doc.compare')}
                </Button>
              </Box>
            ) : (
              <>
                <Typography variant="dense" component="span" sx={{ color: n[900] }}>
                  {mainKeyword?.keyword ?? '—'}
                </Typography>
                <IconAction
                  icon={icons.edit}
                  label={t('research.doc.editKeyword')}
                  size="sm"
                  onClick={() => setEditingKeyword(mainKeyword?.keyword ?? '')}
                  data-testid="doctor-keyword-edit"
                />
              </>
            )}
          </Box>
        ) : null}

        {/* Inline fixes (one panel at a time: no nested SidePanel) */}
        {priceDraft !== undefined ? (
          <Box
            component="section"
            aria-label={t('research.doc.fix.setPrice')}
            data-testid="doctor-price-editor"
            sx={{ display: 'flex', flexDirection: 'column', gap: '8px', p: '12px', border: `1px solid ${n[200]}`, borderRadius: `${radius.md}px` }}
          >
            <Typography variant="titleSm" component="h3" sx={{ m: 0, color: n[800] }}>
              {t('research.doc.fix.setPrice')}
            </Typography>
            {peerPrice ? (
              <PriceBand
                p25={peerPrice.p25}
                median={peerPrice.median}
                p75={peerPrice.p75}
                currency={peerPrice.currency || currency}
                n={peerPrice.n}
                implausible={peerPrice.quality === 'implausible'}
                data-testid="doctor-price-band"
              />
            ) : null}
            <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <MoneyField
                value={priceDraft}
                onChange={setPriceDraft}
                currency={currency}
                size="sm"
                min={0.2}
                aria-label={t('research.doc.fix.setPrice')}
                data-testid="doctor-price-input"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={acceptPrice}
                disabled={priceDraft == null || !(priceDraft > 0)}
                disabledReason={t('research.doc.priceRequired')}
                data-testid="doctor-price-use"
              >
                {t('research.doc.usePrice')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPriceDraft(undefined)}>
                {t('common.cancel')}
              </Button>
            </Box>
          </Box>
        ) : null}

        {titleState.status !== 'idle' ? (
          <FieldSuggestion
            value={titleState.status === 'ready' ? titleState.value : ''}
            counter={titleState.status === 'ready' ? { value: titleState.value.length, max: mkt === 'etsy' ? 140 : 80 } : undefined}
            basis={peers.data && mainKeyword ? t('research.doc.comparedWith', { n: peers.data.peers.n, keyword: mainKeyword.keyword }) : undefined}
            rationale={titleState.status === 'ready' ? titleState.rationale : undefined}
            loading={titleState.status === 'loading'}
            error={titleState.status === 'error' ? titleState.message ?? true : undefined}
            onUse={acceptTitle}
            onDismiss={() => setTitleState({ status: 'idle' })}
            onRetry={() => void suggestTitle()}
            credits={1}
            data-testid="doctor-title-suggestion"
          />
        ) : null}

        <PeerChecks
          row={row}
          peers={peers}
          peersSupported={mkt === 'etsy'}
          onFix={onFix}
          busyFixIds={titleState.status === 'loading' ? ['title_length', 'title_vs_peers', 'title_format'] : []}
        />

        <StagedHere proposals={proposals} onRemove={(f) => setProposals((ps) => removeProposal(ps, f))} disabled={staging} />
      </Box>
    </SidePanel>
  );
}

export default DoctorPanel;

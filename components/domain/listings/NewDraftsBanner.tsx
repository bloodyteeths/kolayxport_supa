// components/domain/listings/NewDraftsBanner.tsx — drafts that create a listing ("not on Etsy/eBay yet"): Etsy creates and copies, eBay creates (editor + CSV).
// Port of the legacy page's pending-new-listings panel (EtsyListingsLegacy PendingNewListingsPanel). These drafts
// have no grid row (the grid reads the Etsy listing cache only), so without this they are invisible: "Send N"
// skips them and the toast says "send it from the editor".
//
// One info Banner "2 new listings are not on Etsy yet · Show". The list under it names each draft (title, photos,
// "partly created", "goes live when sent", copy target) with Open (the editor: a negative id opens create mode,
// where the explicit send lives) and Discard (confirm). Nothing is sent from here.
import * as React from 'react';
import Box from '@mui/material/Box';
import { Banner } from '@/components/ds/feedback/Banner';
import { Button } from '@/components/ds/inputs/Button';
import { Thumb } from '@/components/ds/data/Thumb';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { useToast } from '@/components/ds/feedback/toast';
import { neutral, tone } from '@/lib/ds/tokens';
import type { ListingsT } from './columns';
import type { NewListingDraft } from './useStagedChanges';

export type NewDraftsBannerProps = {
  /** Display name ("Etsy"). */
  marketplaceName: string;
  /** Loads the drafts (`adapter.listNewListings`). */
  load: () => Promise<NewListingDraft[]>;
  /** Changes whenever the list revalidates, so a send from the editor or a discard elsewhere is picked up. */
  version: unknown;
  /** Editor link for a draft (null hides Open). */
  hrefFor: (d: NewListingDraft) => string | null;
  /** Shop names by id (copy target label). */
  shopName: (id: string) => string | null;
  discard: (draftId: string) => Promise<void>;
  t: ListingsT;
};

/** Meta line parts for one draft (pure, unit-tested). */
export function newDraftMeta(d: NewListingDraft, t: ListingsT, ctx: { marketplaceName: string; shopName: (id: string) => string | null }): string[] {
  const parts = [t('listings.newDrafts.photos', { count: d.photoCount })];
  if (d.kind === 'copy') {
    const shop = d.targetShopId ? ctx.shopName(d.targetShopId) ?? d.targetShopId : null;
    if (shop) parts.push(t('listings.newDrafts.copyTo', { shop }));
  } else if (d.partialId) {
    parts.push(t('listings.newDrafts.partiallyCreated', { id: d.partialId, marketplace: ctx.marketplaceName }));
  }
  if (d.willPublish) parts.push(t('listings.newDrafts.willPublish'));
  if (d.status === 'sync_failed' || d.status === 'conflict') parts.push(t('listings.newDrafts.failed'));
  else if (d.status === 'syncing') parts.push(t('listings.newDrafts.sending'));
  return parts;
}

export function NewDraftsBanner({ marketplaceName, load, version, hrefFor, shopName, discard, t }: NewDraftsBannerProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const [drafts, setDrafts] = React.useState<NewListingDraft[]>([]);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const loadRef = React.useRef(load);
  loadRef.current = load;

  React.useEffect(() => {
    let cancelled = false;
    loadRef
      .current()
      .then((list) => {
        if (!cancelled) setDrafts(list);
      })
      .catch(() => {
        // A failed read keeps the last list: this banner is a pointer, the drafts themselves are safe in the DB.
      });
    return () => {
      cancelled = true;
    };
  }, [version, nonce]);

  if (!drafts.length) return null;

  const onDiscard = async (d: NewListingDraft) => {
    const title = d.title || t('listings.newDrafts.untitled');
    const ok = await confirm({
      title: t('listings.newDrafts.discardConfirm', { title }),
      body: t('listings.newDrafts.discardBody', { marketplace: marketplaceName }),
      confirmLabel: t('listings.newDrafts.discard'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(d.draftId);
    try {
      await discard(d.draftId);
      setDrafts((cur) => cur.filter((x) => x.draftId !== d.draftId));
      toast.success(t('listings.newDrafts.discarded'));
    } catch {
      toast.error(t('listings.cell.stageFailed'));
    } finally {
      setBusy(null);
      setNonce((n) => n + 1);
    }
  };

  return (
    <Box sx={{ mb: '8px' }} data-testid="listings-new-drafts">
      <Banner
        tone="info"
        title={t('listings.newDrafts.title', { count: drafts.length, marketplace: marketplaceName })}
        action={{
          id: 'toggleNewDrafts',
          label: open ? t('listings.newDrafts.hide') : t('listings.newDrafts.show'),
          onClick: () => setOpen((v) => !v),
        }}
      />
      {open ? (
        <Box
          component="ul"
          sx={{ listStyle: 'none', m: 0, mt: '8px', p: 0, border: `1px solid ${neutral[200]}`, borderRadius: '8px', bgcolor: neutral[0] }}
          data-testid="listings-new-drafts-list"
        >
          {drafts.map((d, i) => {
            const href = hrefFor(d);
            const meta = newDraftMeta(d, t, { marketplaceName, shopName });
            const failed = d.status === 'sync_failed' || d.status === 'conflict';
            return (
              <Box
                component="li"
                key={d.draftId}
                sx={{
                  display: 'flex',
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  flexDirection: { xs: 'column', sm: 'row' },
                  gap: '12px',
                  p: '12px',
                  borderTop: i > 0 ? `1px solid ${neutral[100]}` : 'none',
                }}
                data-testid={`listings-new-draft-${d.draftId}`}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0, width: '100%' }}>
                  <Thumb src={d.thumbUrl} alt="" size={40} />
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ fontSize: 14, lineHeight: '20px', fontWeight: 500, color: neutral[900], overflowWrap: 'anywhere' }}>
                      {d.title || t('listings.newDrafts.untitled')}
                    </Box>
                    <Box sx={{ fontSize: 12, lineHeight: '16px', color: failed ? tone.danger.fg : neutral[600] }}>{meta.join(' · ')}</Box>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  {href ? (
                    <Button variant="secondary" size="sm" href={href} data-testid={`listings-new-draft-open-${d.draftId}`}>
                      {t('listings.newDrafts.open')}
                    </Button>
                  ) : null}
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    loading={busy === d.draftId}
                    disabled={Boolean(busy) || d.status === 'syncing'}
                    disabledReason={d.status === 'syncing' ? t('listings.newDrafts.sending') : undefined}
                    onClick={() => void onDiscard(d)}
                    data-testid={`listings-new-draft-discard-${d.draftId}`}
                  >
                    {t('listings.newDrafts.discard')}
                  </Button>
                </Box>
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}

export default NewDraftsBanner;

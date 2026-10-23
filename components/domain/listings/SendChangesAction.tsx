// components/domain/listings/SendChangesAction.tsx — listings-grid §6.2 "Send N changes to {marketplace}" (G5).
//
// The page primary while N > 0 (header on desktop, StickyActionBar on mobile). It sends every `draft`/`failed`
// draft of the store in chunks of ≤ 500 and EXCLUDES conflicts and queued deletes (and Etsy new-listing drafts,
// which the editor sends). When something was excluded, a confirm says so first. A conflict is never forced; a
// deletion is sent only from the row ⋯ "Send deletion…" with type-to-confirm. Nothing is ever sent automatically.
import * as React from 'react';
import { StickyActionBar } from '@/components/ds/page/StickyActionBar';
import type { ActionSpec } from '@/components/ds/page';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import type { ListingMarketplace, SendResult } from '@/lib/listings/types';
import type { ListingsT } from './columns';
import type { SendPlan, UseStagedChanges } from './useStagedChanges';
import { useEditorTier } from '@/lib/billing/useEditorTier';
import { requestEditorUpgrade } from '@/components/domain/listings/editor/EditorUpgrade';

export type SendChangesOptions = {
  marketplace: ListingMarketplace;
  /** N = unsent listings (counts.sync pending + failed + conflict, CRITIQUE C1). */
  unsent: number;
  staged: Pick<UseStagedChanges, 'planAll' | 'send'>;
  t: ListingsT;
  /** Reconnect needed / usage limit: Send is disabled with this reason. */
  disabledReason?: string;
  /** 402 from a send: the page shows the usage Banner (no toast, CRITIQUE C6). */
  onLimit?: () => void;
  /** After a send (rows refresh themselves through useStagedChanges). */
  onSent?: (result: SendResult) => void;
};

export type SendChanges = {
  /** Header / palette action; null when N = 0. */
  action: ActionSpec | null;
  sending: boolean;
  /** Sends drafts after the user picked them (Retry failed, Send selected). */
  sendDrafts: (drafts: Array<{ draftId: string; id: string }>) => Promise<SendResult | null>;
  run: () => Promise<void>;
};

/**
 * "2 listings changed on Etsy · 1 deletion · 1 new listing (send it from the editor)" — one pre-built clause per
 * non-empty bucket, so no count combination leaves a dangling "and" (pure, unit-tested). Empty string = none.
 */
export function excludedClauses(plan: Pick<SendPlan, 'conflicts' | 'deletes' | 'newListings' | 'syncing'>, t: ListingsT, marketplace: ListingMarketplace): string {
  const parts: string[] = [];
  if (plan.conflicts.length) parts.push(t('listings.send.excluded.conflicts', { count: plan.conflicts.length, on: t('listings.mp.on', { marketplace }) }));
  if (plan.deletes.length) parts.push(t('listings.send.excluded.deletes', { count: plan.deletes.length }));
  if (plan.newListings.length) parts.push(t('listings.send.excluded.newListings', { count: plan.newListings.length }));
  if (plan.syncing.length) parts.push(t('listings.send.excluded.syncing', { count: plan.syncing.length }));
  return parts.join(' · ');
}

function isLimit(err: unknown): boolean {
  return (err as { status?: number } | null)?.status === 402;
}

export function useSendChanges({ marketplace, unsent, staged, t, disabledReason, onLimit, onSent }: SendChangesOptions): SendChanges {
  const confirm = useConfirm();
  const toast = useToast();
  const [sendingCount, setSendingCount] = React.useState(0);
  const editorTier = useEditorTier();
  const to = t('listings.mp.to', { marketplace });

  const report = React.useCallback(
    (result: SendResult, retry: (ids: string[]) => void) => {
      const failedIds = [...result.failed.map((f) => f.id)];
      const message = t('listings.send.toastResult', { sent: result.sent.length, failed: failedIds.length + result.conflicts.length, to });
      if (failedIds.length || result.conflicts.length) {
        toast.error(message, failedIds.length ? { action: { label: t('listings.send.retryFailed'), onClick: () => retry(failedIds) } } : undefined);
      } else {
        toast.success(message);
      }
      if (result.scheduled?.length) toast.info(t('listings.send.scheduledOverBudget', { count: result.scheduled.length }));
    },
    [t, to, toast],
  );

  const sendDrafts = React.useCallback(
    async (drafts: Array<{ draftId: string; id: string }>): Promise<SendResult | null> => {
      if (!drafts.length) return null;
      // Etsy editor tier send cap (lib/billing/editorTier): over the cap → upgrade prompt, nothing sent.
      if (marketplace === 'etsy' && !editorTier.withinCap(drafts.length)) {
        requestEditorUpgrade('sendSize', { count: drafts.length });
        return null;
      }
      setSendingCount(drafts.length);
      try {
        const result = await staged.send(drafts);
        const byDraft = new Map(drafts.map((d) => [d.draftId, d]));
        report(result, (ids) => {
          void sendDraftsRef.current(ids.map((id) => byDraft.get(id)).filter((d): d is { draftId: string; id: string } => Boolean(d)));
        });
        onSent?.(result);
        return result;
      } catch (err) {
        if (isLimit(err)) onLimit?.();
        else toast.error(t('listings.send.failedGeneric'));
        return null;
      } finally {
        setSendingCount(0);
      }
    },
    [staged, report, onSent, onLimit, toast, t],
  );
  const sendDraftsRef = React.useRef(sendDrafts);
  sendDraftsRef.current = sendDrafts;

  const run = React.useCallback(async () => {
    if (sendingCount > 0) return;
    let plan;
    try {
      plan = await staged.planAll();
    } catch {
      toast.error(t('listings.send.failedGeneric'));
      return;
    }
    const { sendable } = plan;
    const waiting = excludedClauses(plan, t, marketplace);
    if (!sendable.length) {
      // Never a silent no-op: say what is waiting and where it is sent from.
      toast.info(waiting ? t('listings.send.nothingSendable', { waiting }) : t('listings.send.nothingToSend'));
      return;
    }
    if (plan.conflicts.length || plan.deletes.length || plan.newListings.length) {
      const ok = await confirm({
        title: t('listings.send.confirmExcluded', { count: sendable.length, to, waiting }),
        confirmLabel: t('listings.send.cta', { count: sendable.length, to }),
      });
      if (!ok) return;
    }
    await sendDrafts(sendable);
  }, [sendingCount, staged, toast, t, confirm, to, marketplace, sendDrafts]);

  const sending = sendingCount > 0;
  const action: ActionSpec | null =
    unsent > 0 || sending
      ? {
          id: 'sendChanges',
          label: t('listings.send.cta', { count: unsent, to }),
          icon: icons.push,
          loading: sending,
          loadingLabel: t('listings.send.loading', { count: sendingCount || unsent }),
          disabled: Boolean(disabledReason) || sending,
          disabledReason,
          shortcut: 'mod+enter',
          onClick: () => void run(),
        }
      : null;

  return { action, sending, sendDrafts, run };
}

/** Mobile (< 900px): "7 changes not sent yet · [Send 7 changes to Etsy]" StickyActionBar, only while N > 0. */
export function SendChangesBar({ action, unsent, t, hidden }: { action: ActionSpec | null; unsent: number; t: ListingsT; hidden?: boolean }) {
  if (!action || hidden) return null;
  return (
    // No separate status line: the button already says "Send 9 changes to Etsy" (the line cost a row on phones).
    <StickyActionBar
      variant="mobile"
      primary={action}
      data-testid="listings-send-bar"
    />
  );
}

export default useSendChanges;

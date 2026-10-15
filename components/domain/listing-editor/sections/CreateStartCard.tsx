// components/domain/listing-editor/sections/CreateStartCard.tsx — M6b-D: the "Start faster" card of the
// Trendyol / Wix / Shopify creators (marketplace-editors §5.1, §5.4). Create mode only; it disappears after the
// first edit (nothing changed yet and no draft saved). Trendyol: "Copy an Etsy or eBay listing…" (photos, price and
// a Turkish AI draft of the title and description — the AI run itself is M6b-E's `useListingAI`; the seller reviews
// every field). Wix / Shopify: "Copy one of your products…" (no AI in v1, §1). The card only calls `onCopy`;
// the route opens the picker and navigates to `new?copy=` / `?crosslist=`.
// Wire it through `ListingEditor` `slots.startFaster` with `createStartCardSlot(...)`.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs';
import { icons } from '@/lib/ds/icons';
import { neutral, radius } from '@/lib/ds/tokens';
import type { DraftRow } from '@/lib/listingEditor/types';
import type { CatalogEditorMarketplace } from './marketplaceSectionShared';

/** The card shows only on an untouched create workspace. Pure. */
export function showCreateStartCard(input: { mode: 'edit' | 'create'; changeCount: number; draft: Pick<DraftRow, 'id'> | null }): boolean {
  return input.mode === 'create' && input.changeCount === 0 && !input.draft;
}

export interface CreateStartCardProps {
  marketplace: CatalogEditorMarketplace;
  /** Opens the copy picker. Omit to hide the button (the card then renders nothing). */
  onCopy?: () => void;
  /** AI credits the Trendyol copy costs (Turkish draft of title + description). Shown only when > 0. */
  credits?: number;
  /** Copy is running (picker closed, source loading / AI writing). */
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  'data-testid'?: string;
}

export function CreateStartCard({
  marketplace, onCopy, credits, loading, disabled, disabledReason, 'data-testid': testId = 'le-create-start-card',
}: CreateStartCardProps) {
  const t = useTranslations('listingEditor');
  if (!onCopy) return null;
  const trendyol = marketplace === 'trendyol';
  return (
    <Box
      component="section"
      aria-label={t('start.title')}
      data-testid={testId}
      sx={{ border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px`, p: '16px', display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: 720 }}
    >
      <Box component="h3" sx={{ m: 0, fontSize: 14, fontWeight: 600, color: neutral[900] }}>{t('start.title')}</Box>
      <Box sx={{ display: 'flex', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: '12px' }}>
        <Button
          variant="secondary"
          icon={trendyol ? icons.ai : icons.copy}
          onClick={onCopy}
          loading={loading}
          loadingLabel={t('ai.writing')}
          disabled={disabled}
          disabledReason={disabledReason}
        >
          {trendyol ? t('trendyol.copyListing') : t('common.copyProduct')}
        </Button>
        <Box sx={{ color: neutral[600], fontSize: 13, flex: 1 }}>
          {trendyol ? t('trendyol.copyListingBody') : t('common.copyProductBody')}
          {trendyol && credits && credits > 0 ? ` · ${t('ai.cost', { count: credits })}` : ''}
        </Box>
      </Box>
    </Box>
  );
}

/** What the slot reads from `EditorSlotContext` (structurally compatible with any `ListingEditor` slot context). */
export interface StartCardSlotContext {
  editor: { mode: 'edit' | 'create'; changes: readonly unknown[]; draft: Pick<DraftRow, 'id'> | null };
}

/**
 * `ListingEditor` `slots.startFaster` adapter: renders the card while the create workspace is untouched.
 * Usage: `slots={{ startFaster: createStartCardSlot({ marketplace: 'trendyol', onCopy, credits: 2 }) }}`.
 */
export function createStartCardSlot(props: CreateStartCardProps): (c: StartCardSlotContext) => React.ReactNode {
  return function StartFasterSlot(c: StartCardSlotContext) {
    return showCreateStartCard({ mode: c.editor.mode, changeCount: c.editor.changes.length, draft: c.editor.draft }) ? <CreateStartCard {...props} /> : null;
  };
}

// components/domain/listing-editor/RailChanges.tsx: "Not sent yet (N)" in the editor's right rail
// (listing-editor §2, §5.2). One row per changed field group plus one per queued state action, the same list
// the footer save-state popover shows (render this component there too). "Revert" hands the row back to the
// editor (`useListingDraft` restores the remote value and re-stages); nothing here talks to the API.
// A queued delete is always listed first, in danger text. In create mode the rail shows
// "Needed before sending (N)" instead, from the editor's validation.
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { neutral as n, px, radius, space, tone, control } from '@/lib/ds/tokens';
import { Button } from '@/components/ds/inputs/Button';
import { KeyValueList, type KeyValueItem } from '@/components/ds/data/KeyValueList';

/** Change groups counted in the footer and listed here (listing-editor §5.2 "Count"). */
export const CHANGE_GROUPS = [
  'title', 'description', 'tags', 'materials', 'price', 'quantity', 'sku',
  'photos', 'photoOrder', 'altText', 'video', 'variations',
  'category', 'categoryDetails', 'itemDetails', 'shopSection', 'personalization',
  'shippingProfile', 'processing', 'returnPolicy', 'weightSize',
  'itemSpecifics', 'condition', 'policies',
] as const;
export type ChangeGroup = (typeof CHANGE_GROUPS)[number];

/**
 * Queued actions with their own row (`EtsyListingDraft.queuedActions[].type`, see `QUEUED_ACTION_TYPES` in
 * lib/etsy/draftService.ts; `withdraw` is eBay's end-listing). Unknown types use `other`.
 */
export const QUEUED_ACTIONS = [
  'delete', 'deactivate', 'publish', 'renew', 'create', 'copy', 'withdraw',
  'createShopSection', 'createShippingProfile', 'createReturnPolicy',
] as const;
export type QueuedActionKind = (typeof QUEUED_ACTIONS)[number];

export interface RailChangeItem {
  /** Stable id (the editor's ChangeSummary id); passed back to `onRevert`. */
  id: string;
  /** Field group. Exactly one of `group` / `queuedAction` is set; a row with neither is labelled "Other change". */
  group?: ChangeGroup;
  /** Queued action type, e.g. `delete`, `deactivate`, `create_listing` → `create`. */
  queuedAction?: string;
  /** Optional detail for list-like groups (tags, materials, photos): "2 added, 1 removed". */
  added?: number;
  removed?: number;
  /** false hides Revert for this row (default: revertable when `onRevert` is given). */
  revertable?: boolean;
}

export interface RailNeededItem {
  id: string;
  /** Full i18n key (e.g. `listingEditor.section.photos`, `listingEditor.field.category`). */
  labelKey: string;
  params?: Record<string, string | number>;
  /** Scroll to and focus the missing field. */
  onSelect?: () => void;
}

export interface RailChangesProps {
  marketplace: 'etsy' | 'ebay' | 'trendyol' | 'wix' | 'shopify';
  changes: RailChangeItem[];
  onRevert?: (item: RailChangeItem) => void;
  /** Rows whose revert is in flight. */
  revertingIds?: string[];
  /** Create mode: what must be filled before the first send. Rendered instead of the empty line. */
  needed?: RailNeededItem[];
  /** Hide the "Not sent yet (N)" title (popover use, where the trigger already says it). */
  hideTitle?: boolean;
  'data-testid'?: string;
}

const MP_NAME = { etsy: 'Etsy', ebay: 'eBay', trendyol: 'Trendyol', wix: 'Wix', shopify: 'Shopify' } as const;

const QUEUED_ALIASES: Record<string, QueuedActionKind> = {
  create_listing: 'create',
  create_shop_section: 'createShopSection',
  create_shipping_profile: 'createShippingProfile',
  create_return_policy: 'createReturnPolicy',
};

/** `create_listing` / `CREATE` → `create`, `create_shop_section` → `createShopSection`; unknown types → `other`. */
export function queuedActionKind(type: string | undefined | null): QueuedActionKind | 'other' {
  const t = String(type ?? '').trim().toLowerCase();
  if (QUEUED_ALIASES[t]) return QUEUED_ALIASES[t];
  return (QUEUED_ACTIONS as readonly string[]).includes(t) ? (t as QueuedActionKind) : 'other';
}

/** Queued delete first (it can delete the listing), then the caller's order. Stable. */
export function orderChanges(items: RailChangeItem[]): RailChangeItem[] {
  return items
    .map((c, i) => ({ c, i, d: c.queuedAction && queuedActionKind(c.queuedAction) === 'delete' ? 0 : 1 }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.c);
}

export function RailChanges({
  marketplace, changes, onRevert, revertingIds = [], needed, hideTitle, 'data-testid': testId,
}: RailChangesProps) {
  const t = useTranslations('listingEditor.changes');
  const tAll = useTranslations();
  const mp = MP_NAME[marketplace];
  const rows = orderChanges(changes);

  if (rows.length === 0 && needed && needed.length > 0) {
    return (
      <Box data-testid={testId ?? 'rail-changes'} data-mode="needed">
        <Typography component="h3" variant="titleSm" sx={{ m: 0, mb: px(space[1]), color: n[800] }}>
          {t('neededTitle', { count: needed.length })}
        </Typography>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', columnGap: px(space[3]), rowGap: px(space[1]) }}>
          {needed.map((item) => {
            const label = tAll(item.labelKey, item.params ?? {});
            return (
              <Box component="li" key={item.id}>
                {item.onSelect ? (
                  <ButtonBase
                    onClick={item.onSelect}
                    sx={{
                      color: n[700], borderRadius: px(radius.xs), textDecoration: 'underline', textUnderlineOffset: '2px',
                      '@media (pointer: coarse)': { minHeight: px(control.lg) },
                    }}
                  >
                    <Typography component="span" variant="dense">{label}</Typography>
                  </ButtonBase>
                ) : (
                  <Typography component="span" variant="dense" sx={{ color: n[700] }}>{label}</Typography>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  }

  const items: KeyValueItem[] = rows.map((c) => {
    const kind = c.queuedAction ? queuedActionKind(c.queuedAction) : null;
    const label = kind ? t(`queued.${kind}`, { marketplace: mp })
      : c.group && (CHANGE_GROUPS as readonly string[]).includes(c.group) ? t(`group.${c.group}`)
        : t('group.other');
    const added = typeof c.added === 'number' && c.added > 0 ? c.added : 0;
    const removed = typeof c.removed === 'number' && c.removed > 0 ? c.removed : 0;
    const danger = kind === 'delete';
    const detail = danger
      ? t('deleteNote', { marketplace: mp })
      : added && removed ? t('addedRemoved', { added, removed })
        : added ? t('added', { count: added })
          : removed ? t('removed', { count: removed }) : null;
    const canRevert = !!onRevert && c.revertable !== false;
    return {
      label,
      value: (
        <Box
          data-change-id={c.id}
          data-danger={danger || undefined}
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: px(space[2]), minHeight: px(control.sm) }}
        >
          <Typography component="span" variant="dense" sx={{ color: danger ? tone.danger.fg : n[600], minWidth: 0 }}>
            {detail}
          </Typography>
          {canRevert && (
            <Button
              variant="ghost"
              size="sm"
              loading={revertingIds.includes(c.id)}
              aria-label={t('revertLabel', { group: label })}
              onClick={() => onRevert?.(c)}
            >
              {t('revert')}
            </Button>
          )}
        </Box>
      ),
    };
  });

  return (
    <Box data-testid={testId ?? 'rail-changes'} data-mode="changes">
      {!hideTitle && (
        <Typography component="h3" variant="titleSm" sx={{ m: 0, mb: px(space[1]), color: n[800] }}>
          {t('title', { count: rows.length })}
        </Typography>
      )}
      {rows.length === 0 ? (
        <Typography component="p" variant="dense" sx={{ m: 0, color: n[500] }}>{t('empty')}</Typography>
      ) : (
        <KeyValueList items={items} labelWidth="45%" />
      )}
    </Box>
  );
}

export default RailChanges;

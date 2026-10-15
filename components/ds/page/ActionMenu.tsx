// `⋯` overflow menu for ActionSpec lists in ds/page + ds/toolbar. A thin adapter over the single DS
// OverflowMenu (components/ds/overlay/OverflowMenu.tsx, DS §4.5): danger items last behind a divider,
// disabled items show their reason. Keeps the page label (`ds.page.moreActions`) and test ids.
import { useTranslations } from 'next-intl';
import { OverflowMenu, orderOverflowItems } from '../overlay/OverflowMenu';
import type { ActionSpec, DsBaseProps } from './types';

export type ActionMenuProps = DsBaseProps & {
  items: ActionSpec[];
  /** Accessible label of the trigger; default `ds.page.moreActions`. */
  label?: string;
  size?: 'sm' | 'md';
};

/** Danger actions last, separated by a divider (DS §1 P1). Alias of the overlay helper. */
export function orderMenuItems(items: ActionSpec[]): (ActionSpec | 'divider')[] {
  return orderOverflowItems(items);
}

export function ActionMenu({ items, label, size = 'sm', className, ...rest }: ActionMenuProps) {
  const t = useTranslations('ds.page');
  if (!items.length) return null;
  return (
    <OverflowMenu
      items={items}
      label={label ?? t('moreActions')}
      size={size}
      triggerVariant="secondary"
      itemTestIdPrefix="menu-"
      className={className}
      data-testid={rest['data-testid'] ?? 'action-menu'}
    />
  );
}

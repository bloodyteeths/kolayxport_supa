import React, { useId, useState } from 'react';
import Link from 'next/link';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { neutral as n, tone } from '@/lib/ds/tokens';
import type { ActionSpec } from '../types/actions';
import { IconAction } from './IconAction';
import { MoreIcon } from './icons.internal';

export type OverflowItem = ActionSpec | 'divider';

export interface OverflowMenuProps {
  items: OverflowItem[];
  /** Accessible name of the ⋯ trigger, e.g. "More actions for Etsy". Default: ds.overlay.more */
  label?: string;
  size?: 'sm' | 'md';
  /** Menu alignment against the trigger. */
  align?: 'left' | 'right';
  /** Trigger style; `secondary` adds the 1px border used in page headers. Default ghost. */
  triggerVariant?: 'ghost' | 'secondary';
  /** Test-id prefix for menu rows (`${prefix}${id}`). Default `overflow-item-`. */
  itemTestIdPrefix?: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * Danger actions are always moved to the end, after a divider (DS P1). Leading/trailing/duplicate
 * dividers are dropped. Exported for tests and for BottomSheet lists that mirror a ⋯ menu.
 */
export function orderOverflowItems(items: OverflowItem[]): OverflowItem[] {
  const normal: OverflowItem[] = [];
  const danger: ActionSpec[] = [];
  for (const it of items) {
    if (it !== 'divider' && it.tone === 'danger') danger.push(it);
    else normal.push(it);
  }
  const out: OverflowItem[] = [];
  for (const it of normal) {
    if (it === 'divider' && (out.length === 0 || out[out.length - 1] === 'divider')) continue;
    out.push(it);
  }
  while (out[out.length - 1] === 'divider') out.pop();
  if (danger.length) {
    if (out.length) out.push('divider');
    out.push(...danger);
  }
  return out;
}

/** `⋯` menu (DS §4.5). Renders nothing when there are no items (a button that can do nothing is not rendered). */
export function OverflowMenu({
  items, label, size = 'sm', align = 'right', triggerVariant, itemTestIdPrefix = 'overflow-item-', className, ...rest
}: OverflowMenuProps) {
  const t = useTranslations('ds.overlay');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const ordered = orderOverflowItems(items);
  if (!ordered.some((i) => i !== 'divider')) return null;
  const close = () => setAnchor(null);

  return (
    <>
      <IconAction
        icon={MoreIcon}
        label={label ?? t('more')}
        size={size}
        variant={triggerVariant}
        className={className}
        data-testid={rest['data-testid'] ?? 'overflow-trigger'}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-controls={anchor ? menuId : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
      />
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={!!anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: align }}
        transformOrigin={{ vertical: 'top', horizontal: align }}
      >
        {ordered.map((it, i) => {
          if (it === 'divider') return <Divider key={`d-${i}`} sx={{ my: '4px !important', borderColor: n[100] }} />;
          const Icon = it.icon;
          const danger = it.tone === 'danger';
          const disabled = !!it.disabled || !!it.loading;
          const linkProps = it.href && !disabled ? { component: Link, href: it.href } : {};
          return (
            <MenuItem
              key={it.id}
              {...linkProps}
              disabled={disabled}
              data-testid={`${itemTestIdPrefix}${it.id}`}
              onClick={() => {
                close();
                it.onClick?.();
              }}
              sx={{ color: danger ? tone.danger.fg : n[800], alignItems: 'flex-start', py: '8px' }}
            >
              {Icon && (
                <Box component="span" sx={{ display: 'inline-flex', mt: '1px', color: danger ? tone.danger.fg : n[500] }}>
                  <Icon size={16} strokeWidth={1.75} aria-hidden />
                </Box>
              )}
              <Box component="span" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span>{it.loading && it.loadingLabel ? it.loadingLabel : it.label}</span>
                {it.disabled && it.disabledReason && (
                  <Box component="span" sx={{ fontSize: 12, lineHeight: '16px', color: n[500], whiteSpace: 'normal' }}>
                    {it.disabledReason}
                  </Box>
                )}
              </Box>
              {it.shortcut && (
                <Box component="kbd" sx={{ fontFamily: 'inherit', fontSize: 11, color: n[400], ml: '16px' }}>
                  {it.shortcut}
                </Box>
              )}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}

export default OverflowMenu;

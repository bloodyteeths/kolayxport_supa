// components/ds/shell/SearchTrigger.tsx — the centred "[⌕ Search or jump to…  ⌘K]" button (shell-nav §3.3).
//
// A `button`, not an input: it opens the command palette (group E). 32 px tall, 400 px wide (min 240,
// shrinks first), neutral-0, border-strong (neutral-300), placeholder neutral-500, `Kbd` right-aligned.
// `Kbd` resolves ⌘K vs Ctrl K after mount, so SSR and the first client render agree.
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { useTranslations } from 'next-intl';
import { Kbd, isApplePlatform } from '@/components/ds/format/Kbd';
import { ICON_STROKE, icons } from '@/lib/ds/icons';
import { control, focusRing, neutral as n, px, radius } from '@/lib/ds/tokens';

export type SearchTriggerProps = {
  onOpen: () => void;
  /** aria-expanded of the palette. */
  expanded?: boolean;
  className?: string;
  'data-testid'?: string;
};

export function SearchTrigger({ onOpen, expanded, className, 'data-testid': testId = 'search-trigger' }: SearchTriggerProps) {
  const t = useTranslations('shell');
  const [mac, setMac] = React.useState(false);
  React.useEffect(() => {
    setMac(isApplePlatform(typeof navigator === 'undefined' ? undefined : navigator));
  }, []);
  const SearchIcon = icons.search;
  const label = t('topbar.search');
  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
      className={className}
      data-testid={testId}
      sx={{
        // Shrinks first (spec §3.3): the `auto` TopBar track sizes to this, so it must be viewport-driven.
        width: 'clamp(240px, 40vw, 400px)',
        minWidth: 240,
        maxWidth: '100%',
        height: px(control.sm),
        px: px(10),
        gap: px(8),
        justifyContent: 'flex-start',
        bgcolor: n[0],
        border: `1px solid ${n[300]}`,
        borderRadius: px(radius.sm),
        color: n[500],
        '&:hover': { borderColor: n[400] },
        '&.Mui-focusVisible': { boxShadow: focusRing, borderColor: n[400] },
      }}
    >
      <SearchIcon size={16} strokeWidth={ICON_STROKE} aria-hidden />
      <Box
        component="span"
        sx={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 13, lineHeight: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {label}
      </Box>
      <Kbd keys="mod+k" />
    </ButtonBase>
  );
}

export default SearchTrigger;

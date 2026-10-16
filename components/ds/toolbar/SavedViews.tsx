// DS §4.3 SavedViews: replaces segmented status controls. Desktop: "View: To ship ▾" dropdown with
// counts, "Save view…" and delete for user views. Mobile: a horizontally scrolling chip strip (the
// only allowed h-scroll besides research tabs).
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import { useFormatter, useTranslations } from 'next-intl';
import { accent, control, focusRing, neutral, radius, tone, zIndex } from '@/lib/ds/tokens';
import { dsIcons, ICON_SIZE, ICON_STROKE } from '../page/icons';
import { coarseHitArea } from '../page/touch';
import type { DsBaseProps } from '../page/types';
import { useIsMobile } from '../page/useViewport';
import type { SavedView } from './types';

export type SavedViewsProps = DsBaseProps & {
  views: SavedView[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Enables "Save view…" (current query is the page's job). */
  onSave?: (label: string) => void;
  /** Enables delete on user (non built-in) views. */
  onDelete?: (id: string) => void;
  /** Force a layout; default follows the viewport (menu on desktop, chips on mobile). */
  variant?: 'auto' | 'menu' | 'chips';
  /** Trigger prefix; default "View". */
  label?: string;
};

function CountBadge({ view }: { view: SavedView }) {
  const format = useFormatter();
  if (typeof view.count !== 'number') return null;
  return (
    <Box component="span" className="tnum" sx={{ fontSize: 12, color: view.countTone === 'danger' && view.count > 0 ? tone.danger.fg : neutral[500] }}>
      {format.number(view.count)}
    </Box>
  );
}

export function SavedViews({ views, activeId, onSelect, onSave, onDelete, variant = 'auto', label, className, ...rest }: SavedViewsProps) {
  const t = useTranslations('ds.toolbar');
  const isMobile = useIsMobile();
  const chips = variant === 'chips' || (variant === 'auto' && isMobile);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState('');
  const active = views.find((v) => v.id === activeId);
  const testId = rest['data-testid'] ?? 'saved-views';

  if (chips) {
    return (
      <Box
        role="tablist"
        aria-label={label ?? t('view')}
        className={className}
        data-testid={testId}
        data-layout="chips"
        sx={{ display: 'flex', gap: '6px', overflowX: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' }, py: '2px' }}
      >
        {views.map((v) => {
          const on = v.id === activeId;
          return (
            <ButtonBase
              key={v.id}
              role="tab"
              aria-selected={on}
              onClick={() => onSelect(v.id)}
              data-testid={`view-chip-${v.id}`}
              sx={{
                flexShrink: 0,
                height: 36,
                px: '12px',
                gap: '6px',
                fontSize: 13,
                fontWeight: on ? 600 : 500,
                borderRadius: `${radius.full}px`,
                // DS selection style (no filled blue pill): white surface, dark text, hairline.
                border: `1px solid ${on ? neutral[900] : neutral[200]}`,
                bgcolor: on ? neutral[0] : neutral[100],
                color: on ? neutral[900] : neutral[600],
                '@media (pointer: coarse)': { height: 36 }, // view chips: 36px on touch (44px chips doubled the toolbar height)
              }}
            >
              {v.label}
              <CountBadge view={v} />
            </ButtonBase>
          );
        })}
      </Box>
    );
  }

  const close = () => {
    setAnchor(null);
    setSaving(false);
    setName('');
  };
  const submitSave = () => {
    const trimmed = name.trim();
    if (!trimmed || !onSave) return;
    onSave(trimmed);
    close();
  };
  const ChevronIcon = dsIcons.dropdown;
  const SaveIcon = dsIcons.saveView;
  const DeleteIcon = dsIcons.delete;
  const CheckIcon = dsIcons.selected;
  // A view is built-in unless it says `builtIn: false` (user views from useLocalSavedViews do).
  const builtIn = views.filter((v) => v.builtIn !== false);
  const custom = views.filter((v) => v.builtIn === false);

  const renderItem = (v: SavedView) => {
    const on = v.id === activeId;
    return (
      <MenuItem
        key={v.id}
        selected={on}
        onClick={() => {
          onSelect(v.id);
          close();
        }}
        data-testid={`view-option-${v.id}`}
        sx={{ gap: '8px' }}
      >
        <Box sx={{ width: 20, display: 'inline-flex', color: accent[600] }}>
          {on ? <CheckIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden /> : null}
        </Box>
        <ListItemText primary={v.label} primaryTypographyProps={{ fontSize: 13, noWrap: true }} />
        <CountBadge view={v} />
        {onDelete && v.builtIn === false ? (
          <IconButton
            size="small"
            aria-label={t('deleteView', { label: v.label })}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(v.id);
            }}
            sx={{ width: 24, height: 24, p: '4px', ...coarseHitArea }}
            data-testid={`view-delete-${v.id}`}
          >
            <DeleteIcon size={14} strokeWidth={ICON_STROKE} aria-hidden />
          </IconButton>
        ) : null}
      </MenuItem>
    );
  };

  return (
    <>
      <ButtonBase
        className={className}
        data-testid={testId}
        data-layout="menu"
        aria-haspopup="menu"
        aria-expanded={anchor ? true : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          height: control.sm,
          px: '10px',
          gap: '4px',
          borderRadius: `${radius.sm}px`,
          border: `1px solid ${neutral[300]}`,
          bgcolor: neutral[0],
          fontSize: 13,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          '&:hover': { bgcolor: neutral[50] },
          '&.Mui-focusVisible': { boxShadow: focusRing },
          '@media (pointer: coarse)': { height: 36 }, // view chips: 36px on touch (44px chips doubled the toolbar height)
        }}
      >
        <Box component="span" sx={{ color: neutral[500] }}>
          {t('filterLabel', { label: label ?? t('view') })}
        </Box>
        <Box component="span" sx={{ fontWeight: 500 }} data-testid="saved-views-active">
          {active?.label ?? t('all')}
        </Box>
        {active ? <CountBadge view={active} /> : null}
        <ChevronIcon size={14} strokeWidth={ICON_STROKE} aria-hidden />
      </ButtonBase>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        sx={{ zIndex: zIndex.popover }}
        slotProps={{ paper: { sx: { mt: '4px', minWidth: 240, maxWidth: 320 } } }}
      >
        <MenuList dense autoFocusItem={!saving} aria-label={label ?? t('view')}>
          {builtIn.map(renderItem)}
          {builtIn.length && custom.length ? <Divider /> : null}
          {custom.length ? (
            <Typography variant="micro" component="div" sx={{ px: '12px', pt: '6px', pb: '2px', color: neutral[500] }}>
              {t('myViews')}
            </Typography>
          ) : null}
          {custom.map(renderItem)}
          {onSave && !saving ? <Divider /> : null}
          {onSave && !saving ? (
            <MenuItem onClick={() => setSaving(true)} data-testid="saved-views-save" sx={{ gap: '8px' }}>
              <Box sx={{ width: 20, display: 'inline-flex' }}>
                <SaveIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
              </Box>
              {t('saveView')}
            </MenuItem>
          ) : null}
        </MenuList>
        {onSave && saving ? (
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              submitSave();
            }}
            sx={{ display: 'flex', gap: '6px', p: '8px', borderTop: `1px solid ${neutral[200]}` }}
          >
            <InputBase
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              placeholder={t('viewName')}
              inputProps={{ 'aria-label': t('viewName'), 'data-testid': 'saved-views-name' }}
              sx={{ flex: 1, height: control.sm, px: '8px', fontSize: 13, border: `1px solid ${neutral[300]}`, borderRadius: `${radius.sm}px` }}
            />
            <Button type="submit" variant="contained" size="small" disabled={!name.trim()} data-testid="saved-views-save-confirm">
              {t('save')}
            </Button>
          </Box>
        ) : null}
      </Popover>
    </>
  );
}

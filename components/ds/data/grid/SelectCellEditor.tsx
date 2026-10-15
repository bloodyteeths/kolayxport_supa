// BulkGrid select-edit editor (bulk-grid.md §3.1 Section / Who made / When made / Processing / Shipping): a menu
// anchored to the cell, the current option focused. ↑/↓ move, Enter or click picks (commits), Esc cancels.
import { Menu, MenuItem } from '@mui/material';
import { px, zIndex } from '@/lib/ds/tokens';
import type { GridOption } from '@/lib/bulk/paste';

export interface SelectCellEditorProps {
  anchorEl: HTMLElement | null;
  value: string | null;
  options: GridOption[];
  label: string;
  onCommit(value: string): void;
  onCancel(): void;
}

export function SelectCellEditor({ anchorEl, value, options, label, onCommit, onCancel }: SelectCellEditorProps) {
  const hasValue = value !== null && options.some((o) => o.value === value);
  return (
    <Menu
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={onCancel}
      autoFocus
      variant={hasValue ? 'selectedMenu' : 'menu'}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      sx={{ zIndex: zIndex.popover }}
      MenuListProps={{ 'aria-label': label, dense: true }}
      slotProps={{ paper: { sx: { maxHeight: px(360), minWidth: anchorEl ? anchorEl.offsetWidth : undefined } } }}
      data-grid-editor="true"
    >
      {options.map((o) => (
        <MenuItem
          key={o.value}
          selected={o.value === value}
          onClick={() => onCommit(o.value)}
          sx={{ fontSize: px(13) }}
        >
          {o.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

export default SelectCellEditor;

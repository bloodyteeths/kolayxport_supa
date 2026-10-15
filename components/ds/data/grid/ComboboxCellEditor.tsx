// BulkGrid combobox-edit editor (bulk-grid.md §3.1 Category): a Popover anchored to the cell with the DS
// Combobox (static options or async search, e.g. Etsy taxonomy). Picking an option commits; Esc or a click
// outside cancels. The picked option's label is returned so the grid can show it before the host reloads.
import { useRef, useState } from 'react';
import { Box, Popover } from '@mui/material';
import { Combobox, type ComboboxOption } from '@/components/ds/inputs/Combobox';
import { elevation, px, radius, space, zIndex } from '@/lib/ds/tokens';
import type { GridOptions } from '@/lib/bulk/paste';

export interface ComboboxCellEditorProps {
  anchorEl: HTMLElement | null;
  value: ComboboxOption | null;
  options: GridOptions;
  label: string;
  onCommit(option: ComboboxOption): void;
  onCancel(): void;
}

export function ComboboxCellEditor({ anchorEl, value, options, label, onCommit, onCancel }: ComboboxCellEditorProps) {
  const [current, setCurrent] = useState<ComboboxOption | null>(value);
  const done = useRef(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };
  const pick = (o: ComboboxOption | null) => {
    setCurrent(o);
    if (!o || done.current) return;
    done.current = true;
    onCommit(o);
  };
  const isAsync = typeof options === 'function';

  return (
    <Popover
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={cancel}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      sx={{ zIndex: zIndex.popover }}
      TransitionProps={{ onEntered: () => boxRef.current?.querySelector<HTMLInputElement>('input')?.focus() }}
      slotProps={{ paper: { sx: { borderRadius: px(radius.md), boxShadow: elevation.e3 } } }}
    >
      <Box
        ref={boxRef}
        data-grid-editor="true"
        onKeyDown={(e) => {
          // Autocomplete uses Esc to close its list first; a second Esc (list closed) cancels the edit.
          if (e.key === 'Escape' && !boxRef.current?.querySelector('[aria-expanded="true"]')) { e.preventDefault(); cancel(); }
          e.stopPropagation();
        }}
        sx={{ p: px(space[3]), width: px(Math.max(320, anchorEl?.offsetWidth ?? 0)) }}
      >
        <Combobox
          value={current}
          onChange={pick}
          aria-label={label}
          {...(isAsync ? { loadOptions: options } : { options })}
        />
      </Box>
    </Popover>
  );
}

export default ComboboxCellEditor;

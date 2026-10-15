// BulkGrid inline editor for text-edit / money-edit / int-edit (bulk-grid.md §4 "Edit" mode). The input fills
// the cell at the same height. Enter commits + moves down, ⇧Enter up, Tab / ⇧Tab right / left, Esc cancels.
// Blur commits without moving focus. Invalid values are committed too: the host keeps them local (danger outline), never
// staged. Inside the editor the browser pastes into the input normally (the grid paste handler ignores it).
import { useEffect, useRef, useState } from 'react';
import { Box, InputBase } from '@mui/material';
import { useTranslations } from 'next-intl';
import { accent, neutral as n, tone as toneTokens, px, radius, space } from '@/lib/ds/tokens';

/** Where focus goes after the editor closes. `blur` = focus already left (a click elsewhere): don't move it. */
export type EditorExit = 'down' | 'up' | 'right' | 'left' | 'stay' | 'blur';

export interface CellEditorProps {
  /** Initial text: the formatted value, or the printable key that started the edit. */
  initial: string;
  /** When the edit was started by typing, the caret goes to the end instead of selecting all. */
  replace?: boolean;
  type: 'text-edit' | 'money-edit' | 'int-edit';
  align: 'left' | 'right';
  label: string;
  counter?: number;
  describedBy?: string;
  onCommit(text: string, exit: EditorExit): void;
  onCancel(): void;
}

export function CellEditor({ initial, replace, type, align, label, counter, describedBy, onCommit, onCancel }: CellEditorProps) {
  const t = useTranslations('ds.grid');
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (replace) el.setSelectionRange(el.value.length, el.value.length);
    else el.select();
  }, [replace]);

  const finish = (exit: EditorExit) => {
    if (done.current) return;
    done.current = true;
    onCommit(text, exit);
  };
  const over = counter != null && text.length > counter;

  return (
    <Box data-grid-editor="true" sx={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%', height: '100%' }}>
      <InputBase
        inputRef={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        inputProps={{
          'aria-label': label,
          'aria-describedby': describedBy,
          inputMode: type === 'money-edit' ? 'decimal' : type === 'int-edit' ? 'numeric' : 'text',
          spellCheck: type === 'text-edit',
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); finish(e.shiftKey ? 'up' : 'down'); }
          else if (e.key === 'Tab') { e.preventDefault(); finish(e.shiftKey ? 'left' : 'right'); }
          else if (e.key === 'Escape') { e.preventDefault(); done.current = true; onCancel(); }
        }}
        onBlur={() => finish('blur')}
        onPaste={(e) => e.stopPropagation()}
        onCopy={(e) => e.stopPropagation()}
        sx={{
          flex: 1,
          height: px(32),
          px: px(space[2]),
          fontSize: px(13),
          bgcolor: n[0],
          border: `1px solid ${over ? toneTokens.danger.solid : accent[600]}`,
          borderRadius: px(radius.sm),
          fontVariantNumeric: type === 'text-edit' ? undefined : 'tabular-nums',
          '& input': { textAlign: align, p: 0 },
          ...(counter != null ? { pr: px(56) } : {}),
        }}
      />
      {counter != null && (
        <Box
          component="span"
          aria-hidden
          sx={{
            position: 'absolute', right: px(space[2]), fontSize: px(11), lineHeight: px(16), pointerEvents: 'none',
            color: over ? toneTokens.danger.fg : n[500], fontVariantNumeric: 'tabular-nums',
          }}
        >
          {t('counter', { value: text.length, max: counter })}
        </Box>
      )}
    </Box>
  );
}

export default CellEditor;

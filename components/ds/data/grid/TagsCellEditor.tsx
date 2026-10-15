// BulkGrid tags-edit editor (bulk-grid.md §3.1 Tags, §4): a Popover anchored to the cell with the DS TagInput
// (limits from the column, title-overlap flag from the row). Enter / `,` add a tag (TagInput); ⌘/Ctrl+Enter or
// "Done" or a click outside commits and closes; Esc cancels and restores the previous tags.
import { useRef, useState } from 'react';
import { Box, Button, Popover } from '@mui/material';
import { useTranslations } from 'next-intl';
import { TagInput, type TagInputProps } from '@/components/ds/inputs/TagInput';
import { elevation, px, radius, space, zIndex } from '@/lib/ds/tokens';

export interface TagsCellEditorProps {
  anchorEl: HTMLElement | null;
  initial: string[];
  label: string;
  max?: number;
  maxLength?: number;
  /** Extra TagInput rules (Etsy: normalize=cleanTag, tagKey, overlap, flagOverlapWith=title). */
  tagInputProps?: Partial<Pick<TagInputProps, 'normalize' | 'tagKey' | 'overlap' | 'validate' | 'flagOverlapWith' | 'singleWordHint' | 'overLimitMessage'>>;
  onCommit(tags: string[]): void;
  onCancel(): void;
}

export function TagsCellEditor({ anchorEl, initial, label, max, maxLength, tagInputProps, onCommit, onCancel }: TagsCellEditorProps) {
  const t = useTranslations('ds.table');
  const [tags, setTags] = useState<string[]>(initial);
  const done = useRef(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const commit = () => { if (done.current) return; done.current = true; onCommit(tags); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };

  return (
    <Popover
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={(_e, reason) => (reason === 'escapeKeyDown' ? cancel() : commit())}
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
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        onPaste={(e) => e.stopPropagation()}
        sx={{ p: px(space[3]), width: px(360), display: 'flex', flexDirection: 'column', gap: px(space[2]) }}
      >
        <TagInput
          value={tags}
          onChange={setTags}
          max={max}
          maxLength={maxLength}
          aria-label={label}
          {...tagInputProps}
        />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" size="small" onClick={commit}>{t('done')}</Button>
        </Box>
      </Box>
    </Popover>
  );
}

export default TagsCellEditor;

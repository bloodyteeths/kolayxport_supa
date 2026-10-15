// components/ds/inputs/TextArea.tsx — DS §3.7: auto-grows 4 → 24 rows, no inner scroll below the max.
// `preview` adds the "Edit | Preview" toggle that renders the text the way the marketplace does.
import { useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import Box from '@mui/material/Box';
import OutlinedInput from '@mui/material/OutlinedInput';
import { useTranslations } from 'next-intl';
import { neutral, radius } from '@/lib/ds/tokens';
import { useFieldContext, COARSE } from './_shared';
import { SegmentedControl } from './SegmentedControl';
import type { DsBaseProps } from './types';

export interface TextAreaProps extends DsBaseProps {
  value: string;
  onChange: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  /** Renders the "Edit | Preview" toggle; the function renders the preview body. */
  preview?: (value: string) => ReactNode;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  'aria-label'?: string;
}

export function TextArea({
  value, onChange, id, name, placeholder, minRows = 4, maxRows = 24, preview, invalid, disabled, readOnly, autoFocus,
  maxLength, onBlur, onKeyDown, inputRef, className, 'data-testid': testId, 'aria-label': ariaLabel,
}: TextAreaProps) {
  const t = useTranslations('ds.inputs');
  const field = useFieldContext();
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const isInvalid = Boolean(invalid ?? field?.invalid);
  const fieldId = id ?? field?.id;

  return (
    <Box className={className} data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {preview ? (
        <SegmentedControl<'edit' | 'preview'>
          value={mode}
          onChange={setMode}
          aria-label={t('textArea.modeLabel')}
          options={[
            { value: 'edit', label: t('textArea.edit') },
            { value: 'preview', label: t('textArea.preview') },
          ]}
        />
      ) : null}
      {mode === 'preview' && preview ? (
        <Box
          aria-live="polite"
          sx={{
            border: `1px solid ${neutral[200]}`, borderRadius: `${radius.sm}px`, p: '10px 12px', minHeight: minRows * 20 + 20,
            fontSize: 14, lineHeight: '20px', color: neutral[800], whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            backgroundColor: neutral[25],
          }}
        >
          {preview(value)}
        </Box>
      ) : (
        <OutlinedInput
          multiline
          minRows={minRows}
          maxRows={maxRows}
          id={fieldId}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value, e as ChangeEvent<HTMLTextAreaElement>)}
          placeholder={placeholder}
          notched={false}
          error={isInvalid}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          fullWidth
          onBlur={onBlur as never}
          onKeyDown={onKeyDown as never}
          inputRef={inputRef}
          inputProps={{
            maxLength,
            'aria-label': ariaLabel,
            'aria-invalid': isInvalid || undefined,
            'aria-describedby': field?.describedBy,
          }}
          sx={{ fontSize: 14, alignItems: 'flex-start', [COARSE]: { fontSize: 16 } }}
        />
      )}
    </Box>
  );
}

export default TextArea;

// components/domain/listing-editor/sections/TitleInput.tsx — the listing title as a 2-line auto-growing text box
// (usability pass 2026-10-15: a single-line input cut a 129-character Etsy title off mid-word). Shared by the
// Etsy, eBay and catalog (Trendyol / Wix / Shopify) title sections. A title is one line on every marketplace,
// so Enter never adds a line break and pasted line breaks become spaces.
import type { KeyboardEvent } from 'react';
import { TextArea } from '@/components/ds/inputs';

export interface TitleInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  'data-testid'?: string;
}

/** Rows: 2 at rest (a 140-character title fits on desktop), grows to 4 on a phone, never an inner scroll below that. */
export const TITLE_MIN_ROWS = 2;
export const TITLE_MAX_ROWS = 4;

/**
 * Descriptions grow with their text and the page scrolls, never a small box inside the page (founder complaint).
 * The high max only stops a pathological paste from building a box thousands of pixels tall.
 */
export const DESCRIPTION_MIN_ROWS = 6;
export const DESCRIPTION_MAX_ROWS = 400;

export const singleLine = (v: string) => v.replace(/[\r\n]+/g, ' ');

export function TitleInput({ id, value, onChange, readOnly, 'data-testid': testId }: TitleInputProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘↵ / Ctrl+↵ still reach the page shortcut (send); a bare Enter must not add a newline.
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault();
  };
  return (
    <TextArea
      id={id}
      value={value}
      onChange={(v) => onChange(singleLine(v))}
      onKeyDown={onKeyDown}
      minRows={TITLE_MIN_ROWS}
      maxRows={TITLE_MAX_ROWS}
      readOnly={readOnly}
      data-testid={testId}
    />
  );
}

export default TitleInput;

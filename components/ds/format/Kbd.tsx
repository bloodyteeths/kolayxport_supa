// components/ds/format/Kbd.tsx — DS §4.4. Keyboard hint: `keys` uses "+" inside a chord and a space between
// steps of a sequence ("mod+k", "g h", "mod+enter", "?"). `mod` is ⌘ on Apple platforms and Ctrl elsewhere,
// resolved after mount (SSR renders Ctrl), so the server and the first client render agree.

import { Fragment, useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { font, neutral, radius, type as typeScale } from '@/lib/ds/tokens';

export interface KbdProps {
  keys: string;
  className?: string;
  'data-testid'?: string;
}

/** Keys shown as a word; the words come from i18n `ds.kbd.*` (English defaults for pure use). */
export const KBD_WORD_KEYS = ['ctrl', 'win', 'shift', 'alt', 'esc', 'tab', 'space', 'delete'] as const;
export type KbdWord = (typeof KBD_WORD_KEYS)[number];
export type KbdLabels = Record<KbdWord, string>;
export const DEFAULT_KBD_LABELS: KbdLabels = {
  ctrl: 'Ctrl',
  win: 'Win',
  shift: 'Shift',
  alt: 'Alt',
  esc: 'Esc',
  tab: 'Tab',
  space: 'Space',
  delete: 'Del',
};

// Symbol glyphs are language-neutral constants.
const MAC: Record<string, string> = { mod: '⌘', cmd: '⌘', meta: '⌘', ctrl: '⌃', shift: '⇧', alt: '⌥', option: '⌥' };
const SYMBOLS: Record<string, string> = {
  enter: '↵',
  return: '↵',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  backspace: '⌫',
};
const OTHER_MODS: Record<string, KbdWord> = { mod: 'ctrl', cmd: 'ctrl', ctrl: 'ctrl', meta: 'win', shift: 'shift', alt: 'alt', option: 'alt' };
const NAMED_WORDS: Record<string, KbdWord> = { esc: 'esc', escape: 'esc', tab: 'tab', space: 'space', delete: 'delete' };

export function isApplePlatform(nav: { platform?: string; userAgent?: string } | undefined): boolean {
  if (!nav) return false;
  return /mac|iphone|ipad|ipod/i.test(nav.platform || '') || /mac os x|iphone|ipad/i.test(nav.userAgent || '');
}

/** Pure: "mod+k" → [["⌘","K"]] (mac) / [["Ctrl","K"]]; "g h" → [["g"],["h"]]. */
export function formatKeys(keys: string, mac: boolean, labels: KbdLabels = DEFAULT_KBD_LABELS): string[][] {
  return keys
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((chord) => {
      const parts = chord === '+' ? ['+'] : chord.split('+').filter(Boolean);
      const hasMod = parts.length > 1;
      return parts.map((p) => {
        const k = p.toLowerCase();
        if (mac && MAC[k]) return MAC[k];
        if (!mac && OTHER_MODS[k]) return labels[OTHER_MODS[k]];
        if (SYMBOLS[k]) return SYMBOLS[k];
        if (NAMED_WORDS[k]) return labels[NAMED_WORDS[k]];
        return hasMod && p.length === 1 ? p.toLocaleUpperCase('en') : p;
      });
    });
}

const [capSize, capLine] = typeScale.caption;

export function Kbd({ keys, className, 'data-testid': testId }: KbdProps) {
  const t = useTranslations('ds.kbd');
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(isApplePlatform(typeof navigator === 'undefined' ? undefined : navigator));
  }, []);
  const labels = Object.fromEntries(KBD_WORD_KEYS.map((k) => [k, t(k)])) as KbdLabels;
  const chords = formatKeys(keys, mac, labels);
  return (
    <Box component="span" className={className} data-testid={testId} sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      {chords.map((chord, i) => (
        <Fragment key={i}>
          <Box
            component="kbd"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              minWidth: 20,
              height: 20,
              px: '5px',
              justifyContent: 'center',
              borderRadius: `${radius.xs}px`,
              border: `1px solid ${neutral[200]}`,
              bgcolor: neutral[50],
              color: neutral[600],
              fontFamily: font.sans,
              fontSize: capSize,
              lineHeight: `${capLine}px`,
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {chord.join(mac ? '' : ' ')}
          </Box>
        </Fragment>
      ))}
    </Box>
  );
}

export default Kbd;

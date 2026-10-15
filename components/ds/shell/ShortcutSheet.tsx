// components/ds/shell/ShortcutSheet.tsx — the `?` sheet (shell-nav §3.7, §7).
//
// A `Modal` md (560) titled "Keyboard shortcuts": a 2-column `KeyValueList` of description + `Kbd`.
// Global rows first (⌘K, g + letter, [, ?, Esc), then every binding a page registered with
// `useShortcuts(map, { describe: true })` (read through `useShortcutList()`). Not offered under
// `pointer: coarse` (AppShell does not bind `?` there and the account menu hides the row).
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { KeyValueList, type KeyValueItem } from '@/components/ds/data/KeyValueList';
import { Kbd } from '@/components/ds/format/Kbd';
import { Modal } from '@/components/ds/overlay/Modal';
import { useShortcutList, type DescribedShortcut } from '@/lib/ds/useShortcuts';

export type ShortcutSheetProps = {
  open: boolean;
  onClose: () => void;
};

/** Global rows (combo in `Kbd` syntax, `shell.shortcuts.*` key). */
export const GLOBAL_SHORTCUT_ROWS: readonly { keys: string; labelKey: 'shortcuts.palette' | 'shortcuts.goTo' | 'shortcuts.sidebar' | 'shortcuts.help' | 'shortcuts.close' }[] = [
  { keys: 'mod+k', labelKey: 'shortcuts.palette' },
  { keys: 'g', labelKey: 'shortcuts.goTo' },
  { keys: '[', labelKey: 'shortcuts.sidebar' },
  { keys: '?', labelKey: 'shortcuts.help' },
  { keys: 'esc', labelKey: 'shortcuts.close' },
];

/** Pure: page rows without duplicates of the global combos. */
export function pageShortcutRows(list: DescribedShortcut[]): DescribedShortcut[] {
  const global = new Set(['mod+k', '[', '?', 'escape', 'esc']);
  const seen = new Set<string>();
  const out: DescribedShortcut[] = [];
  for (const s of list) {
    const key = s.combo.trim().toLowerCase();
    if (global.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function ShortcutSheet({ open, onClose }: ShortcutSheetProps) {
  const t = useTranslations('shell');
  const tDs = useTranslations('ds.overlay');
  const described = useShortcutList();
  const items: KeyValueItem[] = [
    ...GLOBAL_SHORTCUT_ROWS.map((r) => ({ label: t(r.labelKey), value: <Kbd keys={r.keys} /> })),
    ...pageShortcutRows(described).map((s) => ({ label: s.description, value: <Kbd keys={s.combo} /> })),
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={t('shortcuts.title')}
      primary={{ id: 'close', label: tDs('close'), onClick: onClose }}
      secondary={null}
      data-testid="shortcut-sheet"
    >
      <KeyValueList items={items} columns={2} labelWidth="60%" />
    </Modal>
  );
}

export default ShortcutSheet;

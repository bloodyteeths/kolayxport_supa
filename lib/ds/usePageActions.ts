// lib/ds/usePageActions.ts — DS §1 P3 / §4.2: every page header action is reachable from ⌘K.
//
// `PageHeader` reports its actions to `Page`, which hands them to the shell (`PageShellMeta.headerActions`,
// group F); the palette reads those directly, so a page that renders `<PageHeader>` needs nothing else.
// `usePageActions(actions)` is for actions that are not in a PageHeader (a legacy page, a toolbar-only
// action). Both paths go through `actionToCommand`, and the palette dedupes them by id.
//
// Mapping: no `paletteGroup` → "On this page"; `paletteGroup: 'actions' | 'goto'` → that group.
// A disabled action stays listed with its reason (P1) and cannot run; a loading one shows its loading
// label and cannot run twice.
import type { ActionSpec } from '@/components/ds/types/actions';
import { useCommandRegistrations, type Command } from './useCommand';

/** Pure ActionSpec → Command. `href` without `onClick` navigates. */
export function actionToCommand(a: ActionSpec): Command {
  const busy = Boolean(a.loading);
  return {
    id: `page:${a.id}`,
    label: a.label,
    group: a.paletteGroup === 'goto' ? 'goto' : 'actions',
    onThisPage: !a.paletteGroup,
    icon: a.icon,
    shortcut: a.shortcut,
    disabled: Boolean(a.disabled) || busy,
    disabledReason: a.disabled ? a.disabledReason : busy ? a.loadingLabel ?? a.label : undefined,
    href: a.href,
    run: a.onClick ? () => a.onClick?.() : undefined,
  };
}

/** Pure: the commands for a list of actions (falsy entries and actions with nothing to do are skipped). */
export function actionsToCommands(actions: readonly (ActionSpec | null | undefined | false)[]): Command[] {
  const out: Command[] = [];
  const seen = new Set<string>();
  for (const a of actions) {
    if (!a || seen.has(a.id) || (!a.onClick && !a.href)) continue;
    seen.add(a.id);
    out.push(actionToCommand(a));
  }
  return out;
}

/** Registers `actions` in ⌘K while the caller is mounted. */
export function usePageActions(actions: readonly (ActionSpec | null | undefined | false)[], options: { enabled?: boolean } = {}): void {
  useCommandRegistrations(actionsToCommands(actions), 'page', options.enabled ?? true);
}

export default usePageActions;

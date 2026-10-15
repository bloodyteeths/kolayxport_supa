// Stable reporting of ActionSpecs upward (PageHeader → Page → shell / ⌘K, Page → shell meta).
// Pages pass actions inline, so object identity changes on every render. Effects key on a value
// signature instead, and the reported specs call the *latest* handler through a ref, so a new onClick
// closure (e.g. Export capturing the current filters) is never stale and never re-emits.
import type { ActionSpec, PageBreadcrumb } from './types';

function iconName(icon: ActionSpec['icon']): string | null {
  if (!icon) return null;
  const named = icon as { displayName?: string; name?: string };
  return named.displayName ?? named.name ?? 'icon';
}

/** Every displayed field of an ActionSpec (not the handler identity). */
export function actionSignature(a: ActionSpec | null | undefined): unknown[] | null {
  if (!a) return null;
  return [
    a.id,
    a.label,
    a.href ?? null,
    a.disabled ?? false,
    a.disabledReason ?? null,
    a.loading ?? false,
    a.loadingLabel ?? null,
    a.tone ?? null,
    a.shortcut ?? null,
    a.paletteGroup ?? null,
    iconName(a.icon),
    Boolean(a.onClick),
  ];
}

export function actionsKey(actions: (ActionSpec | null | undefined)[]): string {
  return JSON.stringify(actions.map(actionSignature));
}

export function breadcrumbsKey(crumbs: PageBreadcrumb[] | undefined): string {
  return JSON.stringify((crumbs ?? []).map((c) => [c.label, c.href ?? null, (c.menu ?? []).map((m) => [m.label, m.href])]));
}

/**
 * A copy of `a` whose onClick resolves the current handler at call time (`resolve(id)`), so the copy can
 * be held by the shell indefinitely without going stale.
 */
export function withLiveHandler(a: ActionSpec, resolve: (id: string) => ActionSpec | undefined): ActionSpec {
  if (!a.onClick) return a;
  return { ...a, onClick: () => resolve(a.id)?.onClick?.() };
}

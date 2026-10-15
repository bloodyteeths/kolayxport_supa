// Icons used by the page/toolbar primitives (M1-e), all taken from the semantic registry
// `lib/ds/icons.ts` (DS §3.15). No direct lucide-react import here.
import { icons, ICON_STROKE as REGISTRY_STROKE, iconSize, type LucideIcon } from '@/lib/ds/icons';

export type { LucideIcon };

export const dsIcons = {
  back: icons.back,
  search: icons.search,
  clear: icons.close,
  close: icons.close,
  dropdown: icons.disclosure,
  more: icons.more,
  pull: icons.pull,
  filters: icons.filter,
  selected: icons.check,
  delete: icons.delete,
  density: icons.density,
  view: icons.savedView,
  saveView: icons.saveView,
} as const satisfies Record<string, LucideIcon>;

/** DS §3.15: stroke 1.75, 16px in controls. */
export const ICON_STROKE = REGISTRY_STROKE;
export const ICON_SIZE = iconSize.control;

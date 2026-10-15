// Registry meanings (lib/ds/icons.ts, M1-a) under the names the M1-c primitives use.
// No lucide import here: every glyph comes from the frozen registry.
import { icons, toneIcons } from '@/lib/ds/icons';

export type { LucideIcon } from '@/lib/ds/icons';

export const CloseIcon = icons.close;
export const PrevIcon = icons.back;
export const NextIcon = icons.next;
export const MoreIcon = icons.more;
export const LockedIcon = icons.locked;
export const SuccessIcon = toneIcons.success;
export const InfoIcon = toneIcons.info;
export const WarningIcon = toneIcons.warning;
export const DangerIcon = toneIcons.danger;
export const AttentionIcon = toneIcons.attention;
export const CopyIcon = icons.copy;
export const CheckIcon = icons.check;
export const NoResultsIcon = icons.noResults;
export const ConnectIcon = icons.connections;

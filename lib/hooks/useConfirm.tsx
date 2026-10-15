// lib/hooks/useConfirm — kept import path for callers outside the DS (components/stock/*, components/etsy/*): the DS
// confirm (components/ds/overlay/ConfirmDialog, DS §3.6). `ConfirmOptions` accepts the older `description` /
// `destructive` aliases.
export { ConfirmProvider, useConfirm, type ConfirmFn, type ConfirmOptions } from '@/components/ds/overlay/ConfirmDialog';
export { useConfirm as default } from '@/components/ds/overlay/ConfirmDialog';

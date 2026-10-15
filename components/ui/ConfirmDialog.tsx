/**
 * M1-f shim (DESIGN_SYSTEM §3.6/§4.5; deleted in M10). `components/ds/overlay/ConfirmDialog` absorbs this
 * component: its `ConfirmOptions` is a superset of the legacy contract (`description` and `destructive` are
 * accepted as aliases of `body` and `tone: 'danger'`; `items`, `maxItems`, `confirmLabel`, `cancelLabel`,
 * `typeToConfirm` are unchanged), so this module is a plain re-export. `lib/hooks/useConfirm` (and its
 * `ConfirmProvider` in `_app`) keep importing from here with no change.
 *
 * Behavior deltas vs the old dialog: DS Modal look (440px, title-md, ghost Cancel + primary/danger confirm),
 * z-index 1550 (`nested`, DS §3.6) instead of 1600, and labels from the `ds.overlay.*` namespace.
 */
export { ConfirmDialog, default } from '@/components/ds/overlay/ConfirmDialog';
export type { ConfirmOptions, ConfirmDialogProps } from '@/components/ds/overlay/ConfirmDialog';

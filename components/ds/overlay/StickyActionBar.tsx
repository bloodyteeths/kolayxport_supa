// DS §4.2 puts StickyActionBar at components/ds/page/StickyActionBar.tsx; that is the only implementation
// (it also publishes `--kx-action-bar`). Re-exported here so overlay imports keep working (P4).
export { StickyActionBar, ACTION_BAR_VAR, type StickyActionBarProps } from '../page/StickyActionBar';
export { StickyActionBar as default } from '../page/StickyActionBar';

// Page/toolbar entry point for the single DS ActionSpec renderer (components/ds/overlay/actions.tsx,
// itself a thin adapter over components/ds/inputs/Button). Kept so ds/page and ds/toolbar callers keep
// their `sm` default size; there is no second implementation.
import { ActionButton as DsActionButton, type ActionButtonProps as DsActionButtonProps } from '../overlay/actions';

export type ActionButtonVariant = 'primary' | 'secondary' | 'ghost';

export type ActionButtonProps = Omit<DsActionButtonProps, 'variant' | 'size'> & {
  variant?: ActionButtonVariant;
  size?: 'sm' | 'md' | 'xl';
};

export function ActionButton({ size = 'sm', ...props }: ActionButtonProps) {
  return <DsActionButton size={size} {...props} />;
}

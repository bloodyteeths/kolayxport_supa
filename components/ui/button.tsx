import * as React from 'react';

// M1-f shim (DESIGN_SYSTEM §4.7; deleted in M10). Formerly button.js; legacy shadcn-style button used by
// components/Layout.js and pages/subscribe.js (both import '@/components/ui/button', extension-less). Callers
// pass arbitrary children (icon + text) and Tailwind `className`, which the DS `Button` (children: string) does
// not accept, so this keeps the API and renders the DS §3.8 look with the token utilities from
// styles/tokens.css: default = primary (solid accent-600), outline = secondary (white, 1px neutral-300),
// ghost = transparent with neutral-50 hover. 40px (md), radius 6, label 13/500, no transform, no shadow.
// New code: use components/ds/inputs/Button.

export type LegacyButtonVariant = 'default' | 'outline' | 'ghost';

export interface LegacyButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: LegacyButtonVariant;
}

const BASE =
  'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md text-label font-medium ' +
  'transition-colors duration-150 focus:outline-none focus-visible:shadow-focus ' +
  'disabled:opacity-50 disabled:pointer-events-none';

export const BUTTON_VARIANTS: Record<LegacyButtonVariant, string> = {
  default: 'bg-accent-600 text-neutral-0 hover:bg-accent-700',
  outline: 'bg-neutral-0 text-neutral-800 border border-neutral-300 hover:bg-neutral-50',
  ghost: 'bg-transparent text-neutral-700 hover:bg-neutral-50',
};

export const Button = React.forwardRef<HTMLButtonElement, LegacyButtonProps>(function Button(
  { className = '', variant = 'default', ...props },
  ref,
) {
  const key: LegacyButtonVariant = variant in BUTTON_VARIANTS ? variant : 'default';
  const classes = `${BASE} ${BUTTON_VARIANTS[key]} ${className}`.trim();
  return <button ref={ref} className={classes} data-variant={key} {...props} />;
});

export default Button;

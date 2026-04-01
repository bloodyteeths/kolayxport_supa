import React from 'react';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'purple';

interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
  size?: 'sm' | 'md';
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
  success: { bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
  warning: { bg: '#fffbeb', text: '#a16207', dot: '#f59e0b' },
  error:   { bg: '#fef2f2', text: '#b91c1c', dot: '#ef4444' },
  info:    { bg: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6' },
  neutral: { bg: '#f8fafc', text: '#64748b', dot: '#94a3b8' },
  purple:  { bg: '#f5f3ff', text: '#6d28d9', dot: '#8b5cf6' },
};

export default function StatusBadge({ label, variant = 'neutral', dot = true, size = 'sm' }: StatusBadgeProps) {
  const s = variantStyles[variant];
  const isSmall = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full ${
        isSmall ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      }`}
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {dot && (
        <span
          className={`rounded-full flex-shrink-0 ${isSmall ? 'w-1.5 h-1.5' : 'w-2 h-2'}`}
          style={{ backgroundColor: s.dot }}
        />
      )}
      {label}
    </span>
  );
}

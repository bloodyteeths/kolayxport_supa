// components/domain/billing/parts.tsx — small layout pieces shared by the Billing cards (domain composition
// of DS tokens only; no new visual language).
import type { CSSProperties, ReactNode } from 'react';
import { accent, neutral, px, space, tone, type as typeScale } from '@/lib/ds/tokens';

type TypeKey = keyof typeof typeScale;

export function textStyle(key: TypeKey, color: string = neutral[900]): CSSProperties {
  const [size, line, weight, tracking] = typeScale[key];
  return { fontSize: size, lineHeight: px(line), fontWeight: weight, letterSpacing: tracking, color, margin: 0 };
}

/** One caption/body line in a card. `tone` warning/danger/accent colours the text only. */
export function Line({ children, variant = 'body', toneKey, testId }: {
  children: ReactNode;
  variant?: 'body' | 'caption';
  toneKey?: 'warning' | 'danger' | 'accent' | 'muted';
  testId?: string;
}) {
  const color =
    toneKey === 'warning' ? tone.warning.fg
      : toneKey === 'danger' ? tone.danger.fg
        : toneKey === 'accent' ? accent[700]
          : toneKey === 'muted' || variant === 'caption' ? neutral[500] : neutral[700];
  return (
    <p style={{ ...textStyle(variant, color), marginTop: px(space[1]) }} data-testid={testId}>
      {children}
    </p>
  );
}

/** A label · value · trailing-action row (the Billing "Payment method" / "Billing details" rows). */
export function DetailRow({ label, value, action, testId }: { label: string; value: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: px(space[3]), paddingTop: px(space[2]), paddingBottom: px(space[2]) }}
    >
      <span style={{ ...textStyle('label', neutral[700]), flex: '0 0 160px' }}>{label}</span>
      <span style={{ ...textStyle('body', neutral[700]), flex: '1 1 200px', minWidth: 0 }}>{value}</span>
      {action ? <span style={{ flexShrink: 0 }}>{action}</span> : null}
    </div>
  );
}

export function Divider() {
  return <hr aria-hidden style={{ border: 0, borderTop: `1px solid ${neutral[100]}`, margin: `${px(space[3])} 0 ${px(space[1])}` }} />;
}

/** Card header: title (title-md) + trailing slot (pill, actions, meta). */
export function CardHeader({ title, after, trailing, testId }: { title: ReactNode; after?: ReactNode; trailing?: ReactNode; testId?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: px(space[2]), flexWrap: 'wrap' }} data-testid={testId}>
      <h3 style={textStyle('titleMd')}>{title}</h3>
      {after}
      <span style={{ flex: 1 }} />
      {trailing}
    </div>
  );
}

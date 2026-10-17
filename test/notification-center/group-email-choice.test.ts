import { describe, expect, it } from 'vitest';
import { groupEmailChoice } from '@/components/notification-center/NotificationPreferencesPanel';

describe('groupEmailChoice', () => {
  const x = (email: boolean, emailMode: 'instant' | 'digest' = 'instant') => ({ email, emailMode });
  it('reads a group as off / instant (any instant) / digest', () => {
    expect(groupEmailChoice([x(false), x(false, 'digest')])).toBe('off');
    expect(groupEmailChoice([x(true), x(true)])).toBe('instant');
    expect(groupEmailChoice([x(true, 'digest'), x(true, 'digest')])).toBe('digest');
    expect(groupEmailChoice([x(true), x(false)])).toBe('instant');
    expect(groupEmailChoice([x(true, 'digest'), x(false)])).toBe('digest');
  });
});

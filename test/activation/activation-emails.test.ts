import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { activationEmailBody, activationEmailsEnabled, dueStep, inWorkingHours, isSkippedAccount } from '@/lib/activation/emails';

const H = 3600_000;
const now = new Date('2026-10-22T06:15:00Z');
const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * H);
const none = new Set<string>();

describe('dueStep', () => {
  it('nothing before 24 h', () => expect(dueStep(at(23), none, now)).toBeNull());
  it('day1 between 24 h and 96 h', () => {
    expect(dueStep(at(24), none, now)).toBe('day1');
    expect(dueStep(at(95), none, now)).toBe('day1');
  });
  it('day1 only once', () => expect(dueStep(at(30), new Set(['day1']), now)).toBeNull());
  it('day4 from 96 h, also when day1 was never sent (no double mail)', () => {
    expect(dueStep(at(96), new Set(['day1']), now)).toBe('day4');
    expect(dueStep(at(100), none, now)).toBe('day4');
  });
  it('nothing after both, or after the 7-day window', () => {
    expect(dueStep(at(120), new Set(['day1', 'day4']), now)).toBeNull();
    expect(dueStep(at(7 * 24), none, now)).toBeNull();
  });
});

describe('isSkippedAccount', () => {
  const base = { email: 'seller@gmail.com', role: 'user', billingProvider: null, subscriptionPlan: 'trial' };
  it('normal seller gets the mails', () => expect(isSkippedAccount(base)).toBe(false));
  it('skips admins, reviewers, test addresses, Shopify-billed accounts', () => {
    expect(isSkippedAccount({ ...base, role: 'admin' })).toBe(true);
    expect(isSkippedAccount({ ...base, email: 'review@kolayxport.com' })).toBe(true);
    expect(isSkippedAccount({ ...base, email: 'play-review@kolayxport.com' })).toBe(true);
    expect(isSkippedAccount({ ...base, email: 'demo@kolayxport.test' })).toBe(true);
    expect(isSkippedAccount({ ...base, billingProvider: 'shopify' })).toBe(true);
    expect(isSkippedAccount({ ...base, subscriptionPlan: 'shopify_free' })).toBe(true);
    expect(isSkippedAccount({ ...base, email: null })).toBe(true);
  });
});

describe('activationEmailBody', () => {
  it('day1 links Settings → Connections and the opt-out; no prices', () => {
    const b = activationEmailBody('day1', 'Ayşe Yılmaz');
    expect(b.textBody).toContain('Merhaba Ayşe,');
    expect(b.textBody).toContain('/ayarlar?tab=connections');
    expect(b.textBody).toContain('/app/bildirimler?tab=preferences');
    expect(b.htmlBody).toContain('Mağazamı bağla');
    expect(b.textBody).not.toMatch(/₺|\$|TL\b|indirim|plan seç/i);
  });
  it('day4 links the how-to page and the connect page', () => {
    const b = activationEmailBody('day4', null);
    expect(b.textBody.startsWith('Merhaba,')).toBe(true);
    expect(b.textBody).toContain('/app/nasil-kullanirim');
    expect(b.textBody).toContain('/ayarlar?tab=connections');
  });
});

describe('activationEmailsEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('sends only when ACTIVATION_EMAILS is exactly "on"', () => {
    vi.stubEnv('ACTIVATION_EMAILS', 'on');
    expect(activationEmailsEnabled()).toBe(true);
    for (const v of ['', 'ON', 'On', 'true', '1', 'yes', ' on']) {
      vi.stubEnv('ACTIVATION_EMAILS', v);
      expect(activationEmailsEnabled()).toBe(false);
    }
  });
  it('unset is a dry run', () => {
    vi.stubEnv('ACTIVATION_EMAILS', undefined as unknown as string);
    expect(activationEmailsEnabled()).toBe(false);
  });
});

describe('inWorkingHours (Mon–Fri 09:00–17:30 Turkey time)', () => {
  it('the daily 06:15 UTC run on a weekday is inside', () => expect(inWorkingHours(new Date('2026-10-23T06:15:00Z'))).toBe(true)); // Fri 09:15 TR
  it('weekends are outside', () => {
    expect(inWorkingHours(new Date('2026-10-24T06:15:00Z'))).toBe(false); // Sat
    expect(inWorkingHours(new Date('2026-10-25T06:15:00Z'))).toBe(false); // Sun
  });
  it('edges: 08:59 out, 09:00 in, 17:29 in, 17:30 out (TR)', () => {
    expect(inWorkingHours(new Date('2026-10-26T05:59:00Z'))).toBe(false);
    expect(inWorkingHours(new Date('2026-10-26T06:00:00Z'))).toBe(true);
    expect(inWorkingHours(new Date('2026-10-26T14:29:00Z'))).toBe(true);
    expect(inWorkingHours(new Date('2026-10-26T14:30:00Z'))).toBe(false);
  });
});

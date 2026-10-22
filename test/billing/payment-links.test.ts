import { describe, expect, it } from 'vitest';
import { canLink, saleAlertText } from '@/lib/billing/paymentLinks';

describe('canLink', () => {
  const verified = new Date();
  it('links a verified account with no Stripe customer', () => expect(canLink({ emailVerified: verified, stripeCustomerId: null }, 'cus_1')).toBe('link'));
  it('never links an unverified email or a missing user', () => {
    expect(canLink({ emailVerified: null, stripeCustomerId: null }, 'cus_1')).toBe('no_match');
    expect(canLink(null, 'cus_1')).toBe('no_match');
  });
  it('never overwrites another Stripe customer', () => expect(canLink({ emailVerified: verified, stripeCustomerId: 'cus_other' }, 'cus_1')).toBe('conflict'));
  it('same customer is already linked', () => expect(canLink({ emailVerified: verified, stripeCustomerId: 'cus_1' }, 'cus_1')).toBe('already'));
});

describe('saleAlertText', () => {
  it('says when the account must be linked by hand', () => {
    const t = saleAlertText({ products: ['KolayXport Kurulum Hizmeti'], amount: '9.900 TRY', email: 'a@b.com', link: { status: 'no_match' }, sessionId: 'cs_1' });
    expect(t.subject).toContain('Kurulum Hizmeti');
    expect(t.text).toContain('elle bağlayın');
  });
  it('says the plan updates itself when matched', () => {
    const t = saleAlertText({ products: ['Büyüme yıllık'], amount: '1 TRY', email: 'a@b.com', link: { status: 'linked', userId: 'u1' }, sessionId: 'cs_1' });
    expect(t.text).toContain('otomatik');
  });
});

import { describe, expect, it } from 'vitest';
import { BODY_MAX, cleanTicketInput, supportInbox, ticketRef } from '@/lib/support/tickets';

describe('cleanTicketInput', () => {
  it('cleans a valid new ticket', () => {
    expect(cleanTicketInput({ subject: '  Etsy   bağlanmıyor ', category: 'connection', body: ' Hata alıyorum \n' }, true))
      .toEqual({ ok: true, subject: 'Etsy bağlanmıyor', category: 'connection', body: 'Hata alıyorum' });
  });
  it('unknown category becomes other', () => {
    const r = cleanTicketInput({ subject: 'x', category: 'hack', body: 'y' }, true);
    expect(r.ok && r.category).toBe('other');
  });
  it('requires subject for a new ticket, body always', () => {
    expect(cleanTicketInput({ subject: '', body: 'y' }, true)).toEqual({ ok: false, error: 'subject_required' });
    expect(cleanTicketInput({ subject: 'x', body: '   ' }, true)).toEqual({ ok: false, error: 'body_required' });
    expect(cleanTicketInput({ body: 'reply' }, false).ok).toBe(true);
  });
  it('rejects over-long text and non-strings', () => {
    expect(cleanTicketInput({ subject: 'x', body: 'a'.repeat(BODY_MAX + 1) }, true)).toEqual({ ok: false, error: 'too_long' });
    expect(cleanTicketInput({ subject: 1, body: {} }, true)).toEqual({ ok: false, error: 'subject_required' });
  });
});

describe('refs and inbox', () => {
  it('ticket ref', () => expect(ticketRef(1001)).toBe('KX-1001'));
  it('support inbox defaults to the founder Gmail', () => expect(supportInbox()).toBe(process.env.SUPPORT_INBOX || 'kolayxport@gmail.com'));
});

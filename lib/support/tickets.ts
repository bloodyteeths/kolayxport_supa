// lib/support/tickets.ts — in-app support tickets (founder request 2026-10-22: users get support; emails reach
// kolayxport@gmail.com). Flow:
//   user opens a ticket (subject, category, message) → status open → alert email to SUPPORT_INBOX
//   staff answers in /admin/destek → status answered → email to the user (Reply-To SUPPORT_INBOX)
//   user replies in the app → status open again → alert to SUPPORT_INBOX
//   either side can close; a user reply reopens.
// Emails go through Postmark (lib/auth/email.ts) with Reply-To the support inbox, so a reply by email lands in
// Gmail. Support emails are transactional (the user asked), so no working-hours hold.
import prisma from '@/lib/prisma';
import { sendEmail } from '@/lib/auth/email';
import { renderEmailHtml } from '@/lib/email/layout';
import { logger } from '@/lib/logger';

export const SUPPORT_CATEGORIES = ['connection', 'orders', 'labels', 'billing', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUBJECT_MAX = 140;
export const BODY_MAX = 5000;
/** Max tickets a user can open per day (spam guard). */
export const DAILY_TICKET_LIMIT = 10;

export function supportInbox(): string {
  return (process.env.SUPPORT_INBOX || 'kolayxport@gmail.com').trim();
}

export function ticketRef(n: number): string {
  return `KX-${n}`;
}

/** Pure: validate a new ticket or reply. Returns an error code or the cleaned values. */
export function cleanTicketInput(input: { subject?: unknown; category?: unknown; body?: unknown }, needSubject: boolean):
  | { ok: true; subject: string; category: SupportCategory; body: string }
  | { ok: false; error: 'subject_required' | 'body_required' | 'too_long' } {
  const subject = typeof input.subject === 'string' ? input.subject.trim().replace(/\s+/g, ' ') : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const category = (SUPPORT_CATEGORIES as readonly string[]).includes(String(input.category)) ? (input.category as SupportCategory) : 'other';
  if (needSubject && !subject) return { ok: false, error: 'subject_required' };
  if (!body) return { ok: false, error: 'body_required' };
  if (subject.length > SUBJECT_MAX || body.length > BODY_MAX) return { ok: false, error: 'too_long' };
  return { ok: true, subject, category, body };
}

function base(): string {
  return (process.env.NEXTAUTH_URL || 'https://kolayxport.com').replace(/\/$/, '');
}

async function notifyTeam(kind: 'new' | 'reply', t: { id: string; number: number; subject: string; category: string }, user: { email: string | null; name: string | null }, body: string) {
  const ref = ticketRef(t.number);
  const textBody = `${kind === 'new' ? 'Yeni destek talebi' : 'Destek talebine yeni yanıt'}: ${ref}

Konu: ${t.subject}
Kategori: ${t.category}
Kullanıcı: ${user.name || '-'} <${user.email || '-'}>

${body}

Yanıtlamak için: ${base()}/admin/destek?t=${t.id}`;
  const r = await sendEmail({ to: supportInbox(), subject: `[${ref}] ${t.subject}`, textBody, replyTo: user.email || undefined });
  if (!r.sent) logger.warn('support team alert not sent', { ticket: ref, reason: r.reason });
}

async function notifyUser(t: { number: number; subject: string }, user: { email: string | null; name: string | null }, body: string) {
  if (!user.email) return;
  const ref = ticketRef(t.number);
  const url = `${base()}/app/destek?t=${ref}`;
  const first = (user.name || '').trim().split(/\s+/)[0];
  const textBody = `${first ? `Merhaba ${first},` : 'Merhaba,'}

${ref} numaralı destek talebinize ("${t.subject}") yanıt verdik:

${body}

Talebi görmek ve yanıtlamak için:

${url}

Bu e-postayı yanıtlayarak da bize yazabilirsiniz.

---

We replied to your support ticket ${ref}. Open the link above to read it and reply, or just reply to this email.`;
  const r = await sendEmail({
    to: user.email,
    subject: `KolayXport destek — ${ref}: ${t.subject}`,
    textBody,
    htmlBody: renderEmailHtml({ text: textBody, title: `Destek talebi ${ref}`, action: { url, label: 'Talebi aç' }, preheader: 'Destek ekibimiz yanıt verdi.' }),
    replyTo: supportInbox(),
  });
  if (!r.sent) logger.warn('support user email not sent', { ticket: ref, reason: r.reason });
}

export async function openTicket(userId: string, input: { subject?: unknown; category?: unknown; body?: unknown }) {
  const v = cleanTicketInput(input, true);
  if (!v.ok) return v;
  const today = await prisma.supportTicket.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (today >= DAILY_TICKET_LIMIT) return { ok: false as const, error: 'rate_limited' as const };
  const ticket = await prisma.supportTicket.create({
    data: { userId, subject: v.subject, category: v.category, status: 'open', messages: { create: { author: 'user', authorId: userId, body: v.body } } },
    select: { id: true, number: true, subject: true, category: true },
  });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  await notifyTeam('new', ticket, user ?? { email: null, name: null }, v.body);
  return { ok: true as const, ticket: { id: ticket.id, ref: ticketRef(ticket.number) } };
}

/** User reply on their own ticket (reopens it). */
export async function userReply(userId: string, ticketId: string, input: { body?: unknown }) {
  const v = cleanTicketInput(input, false);
  if (!v.ok) return v;
  const t = await prisma.supportTicket.findFirst({ where: { id: ticketId, userId }, select: { id: true, number: true, subject: true, category: true } });
  if (!t) return { ok: false as const, error: 'not_found' as const };
  await prisma.$transaction([
    prisma.supportMessage.create({ data: { ticketId: t.id, author: 'user', authorId: userId, body: v.body } }),
    prisma.supportTicket.update({ where: { id: t.id }, data: { status: 'open' } }),
  ]);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  await notifyTeam('reply', t, user ?? { email: null, name: null }, v.body);
  return { ok: true as const };
}

/** Staff answer (marks answered and emails the user). */
export async function staffReply(staffId: string, ticketId: string, input: { body?: unknown }) {
  const v = cleanTicketInput(input, false);
  if (!v.ok) return v;
  const t = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true, number: true, subject: true, user: { select: { email: true, name: true } } } });
  if (!t) return { ok: false as const, error: 'not_found' as const };
  await prisma.$transaction([
    prisma.supportMessage.create({ data: { ticketId: t.id, author: 'staff', authorId: staffId, body: v.body } }),
    prisma.supportTicket.update({ where: { id: t.id }, data: { status: 'answered' } }),
  ]);
  await notifyUser(t, t.user, v.body);
  return { ok: true as const };
}

export async function setStatus(ticketId: string, status: 'open' | 'answered' | 'closed', userId?: string) {
  const where = userId ? { id: ticketId, userId } : { id: ticketId };
  const r = await prisma.supportTicket.updateMany({ where, data: { status } });
  return r.count === 1;
}

const MSG_SELECT = { id: true, author: true, body: true, createdAt: true } as const;

export async function listUserTickets(userId: string) {
  const rows = await prisma.supportTicket.findMany({
    where: { userId }, orderBy: { updatedAt: 'desc' }, take: 50,
    select: { id: true, number: true, subject: true, category: true, status: true, createdAt: true, updatedAt: true, messages: { select: MSG_SELECT, orderBy: { createdAt: 'asc' } } },
  });
  return rows.map(({ number, ...r }) => ({ ...r, ref: ticketRef(number) }));
}

export async function listAllTickets(status?: string) {
  const rows = await prisma.supportTicket.findMany({
    where: status && status !== 'all' ? { status } : {}, orderBy: { updatedAt: 'desc' }, take: 200,
    select: {
      id: true, number: true, subject: true, category: true, status: true, createdAt: true, updatedAt: true,
      user: { select: { email: true, name: true, subscriptionPlan: true } },
      messages: { select: MSG_SELECT, orderBy: { createdAt: 'asc' } },
    },
  });
  return rows.map(({ number, ...r }) => ({ ...r, ref: ticketRef(number) }));
}

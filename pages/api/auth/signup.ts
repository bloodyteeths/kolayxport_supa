import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '@/lib/prisma';
import { rateLimit } from '@/lib/middleware/rateLimit';
import { issueToken } from '@/lib/auth/tokens';
import { sendEmail, verificationEmailBody, maskEmail } from '@/lib/auth/email';
import { logAuthEvent } from '@/lib/admin/events';
import { validatePassword } from '@/lib/auth/passwordPolicy';
import { newTrialExpiry } from '@/lib/billing/planLimits';
import { contextFromRequest, sendServerEvent } from '@/lib/tracking/server';
import { recordAcquisition } from '@/lib/partners/acquisition';
import { logger } from '@/lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!rateLimit(60_000, 5)(req, res)) return;

  let { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  email = email.toLowerCase().trim();

  const policy = validatePassword(password, { email, name });
  if (!policy.ok) {
    return res.status(400).json({ error: policy.message, code: policy.code });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        id: uuidv4(),
        email,
        name: name || email.split('@')[0],
        password: hashedPassword,
        // emailVerified stays null until the user clicks the verification link.
        subscriptionPlan: 'trial',
        subscriptionStatus: 'trialing',
        trialExpiresAt: newTrialExpiry(),
        usageResetAt: newTrialExpiry(),
        orderSyncCount: 0,
        labelCount: 0,
      },
    });
  } catch (e: any) {
    // Concurrent signup with the same email: the early findUnique check
    // above let both requests through, and Prisma's unique constraint
    // on email surfaces as P2002. Translate to the same 409 the fast
    // path returns instead of leaking a 500.
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    throw e;
  }

  // First-touch partner code / UTMs (docs/gtm/referral-spec.md §2.2). Never fails the signup.
  try {
    await recordAcquisition(user.id, { cookies: req.cookies, body: req.body?.attribution, via: 'signup' });
  } catch (e) {
    logger.warn('Signup acquisition not recorded', { error: e instanceof Error ? e.message : String(e) });
  }

  // Funnel: server copies of sign_up / start_trial (same event_id as the browser event, consent-gated).
  const clientEventId = typeof req.body?.eventId === 'string' ? String(req.body.eventId).slice(0, 64) : `${user.id}-signup`;
  const trackingCtx = contextFromRequest(req);
  const attribution = Object.fromEntries(
    Object.entries((req.body?.attribution && typeof req.body.attribution === 'object') ? req.body.attribution : {})
      .filter(([k, v]) => /^(utm_(source|medium|campaign|content|term)|landing)$/.test(k) && typeof v === 'string')
      .map(([k, v]) => [k, String(v).slice(0, 100)]),
  ) as Record<string, string>;
  void sendServerEvent({ name: 'sign_up', eventId: clientEventId, email, userId: user.id, params: attribution }, trackingCtx);
  void sendServerEvent({ name: 'start_trial', eventId: `${clientEventId}-trial`, email, userId: user.id }, trackingCtx);

  // Fire-and-forget the verification email. Don't block signup on Postmark.
  try {
    const plainToken = await issueToken({ identifier: email, purpose: 'email_verify' });
    const base = process.env.NEXTAUTH_URL || 'https://kolayxport.com';
    const url = `${base.replace(/\/$/, '')}/api/auth/verify-email?token=${encodeURIComponent(plainToken)}`;
    const { subject, textBody, htmlBody } = verificationEmailBody(url);
    const sendResult = await sendEmail({ to: email, subject, textBody, htmlBody });
    logAuthEvent('info', {
      message: 'Signup verification email queued',
      operation: 'email.verify_signup',
      details: { userId: user.id, to: maskEmail(email), sent: sendResult.sent, reason: sendResult.reason },
    });
  } catch (err) {
    logAuthEvent('error', {
      message: 'Signup verification email failed (signup itself succeeded)',
      operation: 'email.verify_signup_error',
      details: { userId: user.id, to: maskEmail(email) },
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }

  return res.status(201).json({ success: true });
}

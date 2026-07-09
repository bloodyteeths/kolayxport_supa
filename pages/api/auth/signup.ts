import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '@/lib/prisma';
import { rateLimit } from '@/lib/middleware/rateLimit';
import { issueToken } from '@/lib/auth/tokens';
import { sendEmail, verificationEmailBody, maskEmail } from '@/lib/auth/email';
import { logAuthEvent } from '@/lib/admin/events';
import { validatePassword } from '@/lib/auth/passwordPolicy';

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
        trialExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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

  // Fire-and-forget the verification email. Don't block signup on Postmark.
  try {
    const plainToken = await issueToken({ identifier: email, purpose: 'email_verify' });
    const base = process.env.NEXTAUTH_URL || 'https://kolayxport.com';
    const url = `${base.replace(/\/$/, '')}/api/auth/verify-email?token=${encodeURIComponent(plainToken)}`;
    const { subject, textBody } = verificationEmailBody(url);
    const sendResult = await sendEmail({ to: email, subject, textBody });
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

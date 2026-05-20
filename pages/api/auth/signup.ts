import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '@/lib/prisma';
import { rateLimit } from '@/lib/middleware/rateLimit';

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

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      id: uuidv4(),
      email,
      name: name || email.split('@')[0],
      password: hashedPassword,
      subscriptionPlan: 'trial',
      subscriptionStatus: 'trialing',
      trialExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      orderSyncCount: 0,
      labelCount: 0,
    },
  });

  return res.status(201).json({ success: true });
}

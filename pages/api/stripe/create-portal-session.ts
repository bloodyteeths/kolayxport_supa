import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { stripe } from '../../../lib/stripe';
import prisma from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await getAuthUser(req, res);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // Get user's stripe customer ID
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { stripeCustomerId: true }
    });

    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account found' });
    }

    // Create portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${req.headers.origin}/ayarlar`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (error: any) {
    console.error('Failed to create portal session:', error);
    return res.status(500).json({ 
      error: 'Failed to create billing portal session',
      details: error.message 
    });
  }
}
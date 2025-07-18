import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { stripe } from '../../../lib/stripe';
import prisma from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabaseServerClient(req, res);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Get user's stripe customer ID
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { stripeCustomerId: true }
    });

    if (!user?.stripeCustomerId) {
      return res.status(200).json({ invoices: [] });
    }

    // Get invoices from Stripe
    const invoices = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 20,
      status: 'paid'
    });

    // Format invoice data for frontend
    const formattedInvoices = invoices.data.map(invoice => ({
      id: invoice.id,
      date: new Date(invoice.created * 1000),
      amount: invoice.amount_paid / 100, // Convert from cents
      currency: invoice.currency.toUpperCase(),
      status: invoice.status,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      invoicePdf: invoice.invoice_pdf,
      description: invoice.lines.data[0]?.description || 'Subscription',
      period: {
        start: invoice.lines.data[0]?.period?.start ? new Date(invoice.lines.data[0].period.start * 1000) : null,
        end: invoice.lines.data[0]?.period?.end ? new Date(invoice.lines.data[0].period.end * 1000) : null,
      }
    }));

    return res.status(200).json({ invoices: formattedInvoices });
  } catch (error: any) {
    console.error('Failed to fetch billing history:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch billing history',
      details: error.message 
    });
  }
}
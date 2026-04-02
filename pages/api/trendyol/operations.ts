import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import prisma from '../../../lib/prisma';
import { createTrendyolClient } from '../../../lib/integrations/trendyolApiClient';
import { logger } from '../../../lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = req.query.action as string;

  try {
    const supabase = getSupabaseServerClient(req, res);
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const credential = await prisma.credential.findUnique({
      where: { userId: user.id },
      select: {
        trendyolSupplierId: true,
        trendyolApiKey: true,
        trendyolApiSecret: true,
      },
    });

    if (!credential?.trendyolSupplierId) {
      return res.status(400).json({ error: 'Trendyol credentials not configured' });
    }

    const client = createTrendyolClient(credential);

    // ================================================================
    // Q&A — GET QUESTIONS
    // ================================================================
    if (action === 'questions' && req.method === 'GET') {
      const data = await client.getQuestions({
        status: req.query.status as string,
        page: parseInt(req.query.page as string) || 0,
        size: parseInt(req.query.size as string) || 20,
      });
      return res.status(200).json(data);
    }

    // ================================================================
    // Q&A — ANSWER QUESTION
    // ================================================================
    if (action === 'answer_question' && req.method === 'POST') {
      const { questionId, text } = req.body;
      if (!questionId || !text) {
        return res.status(400).json({ error: 'questionId and text are required' });
      }
      const data = await client.answerQuestion(questionId, text);
      return res.status(200).json(data);
    }

    // ================================================================
    // CLAIMS / RETURNS
    // ================================================================
    if (action === 'claims' && req.method === 'GET') {
      const data = await client.getClaims({
        status: req.query.status as string,
        page: parseInt(req.query.page as string) || 0,
        size: parseInt(req.query.size as string) || 20,
      });
      return res.status(200).json(data);
    }

    if (action === 'approve_claim' && req.method === 'PUT') {
      const { claimId } = req.body;
      if (!claimId) {
        return res.status(400).json({ error: 'claimId is required' });
      }
      const data = await client.approveClaim(claimId, req.body);
      return res.status(200).json(data);
    }

    // ================================================================
    // INVOICES
    // ================================================================
    if (action === 'send_invoice' && req.method === 'POST') {
      if (!req.body) {
        return res.status(400).json({ error: 'Request body is required' });
      }
      const data = await client.sendInvoice(req.body);
      return res.status(200).json(data);
    }

    if (action === 'delete_invoice' && req.method === 'DELETE') {
      const invoiceLinkId = req.query.invoiceLinkId as string;
      if (!invoiceLinkId) {
        return res.status(400).json({ error: 'invoiceLinkId is required' });
      }
      const data = await client.deleteInvoice(invoiceLinkId);
      return res.status(200).json(data);
    }

    // ================================================================
    // SETTLEMENTS / FINANCE
    // ================================================================
    if (action === 'settlements' && req.method === 'GET') {
      const data = await client.getSettlements({
        startDate: req.query.startDate ? parseInt(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? parseInt(req.query.endDate as string) : undefined,
        page: parseInt(req.query.page as string) || 0,
        size: parseInt(req.query.size as string) || 50,
        transactionType: req.query.transactionType as string,
      });
      return res.status(200).json(data);
    }

    // ================================================================
    // SHIPMENT
    // ================================================================
    if (action === 'update_tracking' && req.method === 'PUT') {
      const shipmentPackageId = req.query.shipmentPackageId as string || req.body?.shipmentPackageId;
      if (!shipmentPackageId) {
        return res.status(400).json({ error: 'shipmentPackageId is required' });
      }
      const data = await client.updateTracking(shipmentPackageId, req.body);
      return res.status(200).json(data);
    }

    if (action === 'shipping_label' && req.method === 'GET') {
      const trackingNumber = req.query.trackingNumber as string;
      if (!trackingNumber) {
        return res.status(400).json({ error: 'trackingNumber is required' });
      }
      const data = await client.getShippingLabel(trackingNumber);
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (error: any) {
    if (error.status && error.body) {
      return res.status(error.status).json({ error: 'Trendyol API Error', details: error.body });
    }
    logger.error('Trendyol operations API error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

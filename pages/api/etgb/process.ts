import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { EtgbService } from '@/lib/services/etgbService';
import { logger } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { orderIds, recipientEmail } = req.body;

    // Validate request
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request. orderIds array is required.' 
      });
    }

    if (orderIds.length > 100) {
      return res.status(400).json({ 
        error: 'Too many orders. Maximum 100 orders per batch.' 
      });
    }

    logger.info('ETGB process request received', {
      userId: user.id,
      orderCount: orderIds.length,
      recipientEmail
    });

    // Initialize ETGB service
    const etgbService = new EtgbService();

    // Process orders
    const result = await etgbService.processOrdersByIds(
      orderIds,
      user.id,
      recipientEmail
    );

    if (result.success) {
      return res.status(200).json({
        success: true,
        batchId: result.batchId,
        message: `ETGB export sent successfully to ${result.emailResult.recipientEmail}`,
        details: {
          fileName: result.excelFile.fileName,
          fileHash: result.excelFile.fileHash,
          messageId: result.emailResult.messageId,
          recipientEmail: result.emailResult.recipientEmail
        }
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'ETGB processing failed',
        message: result.errorMessage,
        batchId: result.batchId
      });
    }

  } catch (error: any) {
    logger.error('ETGB API endpoint failed', 
      error instanceof Error ? error : new Error(String(error)), {
        userId: user.id,
        body: req.body
      });

    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
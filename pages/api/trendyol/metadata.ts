import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import prisma from '../../../lib/prisma';
import { createTrendyolClient } from '../../../lib/integrations/trendyolApiClient';
import { logger } from '../../../lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = req.query.action as string;

  try {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

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
    // CATEGORIES
    // ================================================================
    if (action === 'categories') {
      const data = await client.getCategories();
      // Cache for 24h via response header
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
      return res.status(200).json(data);
    }

    // ================================================================
    // CATEGORY ATTRIBUTES
    // ================================================================
    if (action === 'category_attributes') {
      const categoryId = parseInt(req.query.categoryId as string);
      if (!categoryId) {
        return res.status(400).json({ error: 'categoryId is required' });
      }
      const data = await client.getCategoryAttributes(categoryId);
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
      return res.status(200).json(data);
    }

    // ================================================================
    // BRANDS SEARCH
    // ================================================================
    if (action === 'brands') {
      const name = req.query.name as string;
      if (!name) {
        return res.status(400).json({ error: 'name query parameter is required' });
      }
      const page = parseInt(req.query.page as string) || 0;
      const size = parseInt(req.query.size as string) || 20;
      const data = await client.searchBrands(name, page, size);
      return res.status(200).json(data);
    }

    // ================================================================
    // CARGO COMPANIES
    // ================================================================
    if (action === 'cargo_companies') {
      const data = await client.getCargoCompanies();
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
      return res.status(200).json(data);
    }

    // ================================================================
    // SELLER ADDRESSES
    // ================================================================
    if (action === 'addresses') {
      const data = await client.getAddresses();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (error: any) {
    if (error.status && error.body) {
      return res.status(error.status).json({ error: 'Trendyol API Error', details: error.body });
    }
    logger.error('Trendyol metadata API error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

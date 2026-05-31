import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '../../../lib/logger';

const TRENDYOL_API_BASE = 'https://apigw.trendyol.com/integration';

// Allow larger request bodies for batch product operations
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

/**
 * Build a query string from an object of optional params.
 * Skips undefined/null/empty values.
 */
function buildQueryString(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`).join('&');
}

/**
 * Call the Trendyol API with Basic Auth and required headers.
 * Returns parsed JSON response or throws structured error.
 */
async function callTrendyolAPI(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: any
): Promise<any> {
  const supplierId = process.env.TRENDYOL_SUPPLIER_ID;
  const apiKey = process.env.TRENDYOL_API_KEY;
  const apiSecret = process.env.TRENDYOL_API_SECRET;

  if (!supplierId || !apiKey || !apiSecret) {
    throw { status: 500, body: { error: 'Trendyol credentials not configured (TRENDYOL_SUPPLIER_ID, TRENDYOL_API_KEY, TRENDYOL_API_SECRET)' } };
  }

  const auth = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const url = `${TRENDYOL_API_BASE}${endpoint}`;

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': `${supplierId} - SelfIntegration`,
    },
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    fetchOptions.body = JSON.stringify(body);
  }

  logger.info(`Trendyol API ${method} ${endpoint}`, { method, endpoint });

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    let errorBody;
    try {
      errorBody = JSON.parse(errorText);
    } catch {
      errorBody = { rawError: errorText };
    }
    const error = new Error(`Trendyol API error: ${response.status} - ${errorText}`);
    logger.error('Trendyol API error', error, { endpoint, status: response.status });
    throw { status: response.status, body: errorBody, message: error.message };
  }

  const text = await response.text();
  if (!text) return { success: true };
  try {
    return JSON.parse(text);
  } catch {
    return { rawResponse: text };
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // 1. Authenticate with CLAWD API Key
  // Header-only since Sprint 5 (query-string keys leak via CDN/proxy logs).
  const apiKey = req.headers['x-api-key'];
  const envApiKey = process.env.CLAWD_API_KEY;

  if (!envApiKey) {
    logger.error('CLAWD_API_KEY is not defined in environment variables.');
    return res.status(500).json({ error: 'Server configuration error: API Key not set.' });
  }

  if (!apiKey || apiKey !== envApiKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
  }

  // 2. Get Trendyol Seller ID
  const supplierId = process.env.TRENDYOL_SUPPLIER_ID;
  if (!supplierId) {
    return res.status(500).json({ error: 'TRENDYOL_SUPPLIER_ID not configured' });
  }

  // 3. Route by action
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;

  try {
    // ================================================================
    // PRODUCTS
    // ================================================================

    // GET /api/clawd/trendyol?action=products - List/Filter Products
    if (action === 'products' && req.method === 'GET') {
      const qs = buildQueryString({
        page: (req.query.page as string) || '0',
        size: (req.query.size as string) || '50',
        barcode: req.query.barcode as string,
        stockCode: req.query.stockCode as string,
        productMainId: req.query.productMainId as string,
        approved: req.query.approved as string,
        onSale: req.query.onSale as string,
        rejected: req.query.rejected as string,
        blacklisted: req.query.blacklisted as string,
        brandId: req.query.brandId as string,
      });
      const data = await callTrendyolAPI('GET', `/product/sellers/${supplierId}/products${qs}`);
      return res.status(200).json(data);
    }

    // GET /api/clawd/trendyol?action=product&barcode=XXX - Single Product
    if (action === 'product' && req.method === 'GET') {
      const barcode = req.query.barcode as string;
      const stockCode = req.query.stockCode as string;
      if (!barcode && !stockCode) {
        return res.status(400).json({ error: 'barcode or stockCode is required for action=product' });
      }
      const qs = buildQueryString({
        barcode,
        stockCode,
        size: '1',
      });
      const data = await callTrendyolAPI('GET', `/product/sellers/${supplierId}/products${qs}`);
      // Return first product if available
      const product = data.content && data.content.length > 0 ? data.content[0] : null;
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      return res.status(200).json(product);
    }

    // POST /api/clawd/trendyol?action=create_products - Create Products
    if (action === 'create_products' && req.method === 'POST') {
      if (!req.body || !req.body.items) {
        return res.status(400).json({ error: 'Request body must contain items array' });
      }
      const data = await callTrendyolAPI('POST', `/product/sellers/${supplierId}/products`, req.body);
      return res.status(200).json(data);
    }

    // PUT /api/clawd/trendyol?action=update_product - Update Product
    if (action === 'update_product' && req.method === 'PUT') {
      if (!req.body || !req.body.items) {
        return res.status(400).json({ error: 'Request body must contain items array' });
      }
      const data = await callTrendyolAPI('PUT', `/product/sellers/${supplierId}/products`, req.body);
      return res.status(200).json(data);
    }

    // PUT /api/clawd/trendyol?action=update_price_and_inventory - Bulk Stock & Price
    if (action === 'update_price_and_inventory' && req.method === 'PUT') {
      if (!req.body || !req.body.items) {
        return res.status(400).json({ error: 'Request body must contain items array' });
      }
      const data = await callTrendyolAPI('PUT', `/inventory/sellers/${supplierId}/products/price-and-inventory`, req.body);
      return res.status(200).json(data);
    }

    // GET /api/clawd/trendyol?action=batch_status&batchRequestId=XXX
    if (action === 'batch_status' && req.method === 'GET') {
      const batchRequestId = req.query.batchRequestId as string;
      if (!batchRequestId) {
        return res.status(400).json({ error: 'batchRequestId is required' });
      }
      const data = await callTrendyolAPI('GET', `/product/sellers/${supplierId}/products/batch-requests/${batchRequestId}`);
      return res.status(200).json(data);
    }

    // PUT /api/clawd/trendyol?action=archive_product - Archive/Unarchive Product
    if (action === 'archive_product' && req.method === 'PUT') {
      if (!req.body || !req.body.items) {
        return res.status(400).json({ error: 'Request body must contain items array with barcode(s)' });
      }
      const data = await callTrendyolAPI('PUT', `/product/sellers/${supplierId}/products/archive`, req.body);
      return res.status(200).json(data);
    }

    // ================================================================
    // CATEGORIES & ATTRIBUTES
    // ================================================================

    // GET /api/clawd/trendyol?action=categories - List All Categories
    if (action === 'categories' && req.method === 'GET') {
      const data = await callTrendyolAPI('GET', '/product/product-categories');
      return res.status(200).json(data);
    }

    // GET /api/clawd/trendyol?action=category_attributes&categoryId=XXX
    if (action === 'category_attributes' && req.method === 'GET') {
      const categoryId = req.query.categoryId as string;
      if (!categoryId) {
        return res.status(400).json({ error: 'categoryId is required' });
      }
      const data = await callTrendyolAPI('GET', `/product/product-categories/${categoryId}/attributes`);
      return res.status(200).json(data);
    }

    // ================================================================
    // BRANDS
    // ================================================================

    // GET /api/clawd/trendyol?action=brands&name=XXX
    if (action === 'brands' && req.method === 'GET') {
      const qs = buildQueryString({
        name: req.query.name as string,
        page: req.query.page as string,
        size: req.query.size as string,
      });
      const data = await callTrendyolAPI('GET', `/product/brands${qs}`);
      return res.status(200).json(data);
    }

    // ================================================================
    // ORDERS
    // ================================================================

    // GET /api/clawd/trendyol?action=orders - List Orders
    if (action === 'orders' && req.method === 'GET') {
      const qs = buildQueryString({
        status: req.query.status as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: (req.query.page as string) || '0',
        size: (req.query.size as string) || '50',
        orderNumber: req.query.orderNumber as string,
        orderByField: req.query.orderByField as string,
        orderByDirection: req.query.orderByDirection as string,
      });
      const data = await callTrendyolAPI('GET', `/order/sellers/${supplierId}/orders${qs}`);
      return res.status(200).json(data);
    }

    // GET /api/clawd/trendyol?action=order&orderNumber=XXX - Single Order
    if (action === 'order' && req.method === 'GET') {
      const orderNumber = req.query.orderNumber as string;
      const shipmentPackageId = req.query.shipmentPackageId as string;
      if (!orderNumber && !shipmentPackageId) {
        return res.status(400).json({ error: 'orderNumber or shipmentPackageId is required' });
      }
      const qs = buildQueryString({
        orderNumber,
        shipmentPackageId,
      });
      const data = await callTrendyolAPI('GET', `/order/sellers/${supplierId}/orders${qs}`);
      return res.status(200).json(data);
    }

    // ================================================================
    // SHIPMENT
    // ================================================================

    // PUT /api/clawd/trendyol?action=update_tracking&shipmentPackageId=XXX
    if (action === 'update_tracking' && req.method === 'PUT') {
      const shipmentPackageId = req.query.shipmentPackageId as string || req.body?.shipmentPackageId;
      if (!shipmentPackageId) {
        return res.status(400).json({ error: 'shipmentPackageId is required' });
      }
      const data = await callTrendyolAPI(
        'PUT',
        `/order/sellers/${supplierId}/shipment-packages/${shipmentPackageId}`,
        req.body
      );
      return res.status(200).json(data);
    }

    // PUT /api/clawd/trendyol?action=update_order_status&shipmentPackageId=XXX
    if (action === 'update_order_status' && req.method === 'PUT') {
      const shipmentPackageId = req.query.shipmentPackageId as string || req.body?.shipmentPackageId;
      if (!shipmentPackageId) {
        return res.status(400).json({ error: 'shipmentPackageId is required' });
      }
      const data = await callTrendyolAPI(
        'PUT',
        `/order/sellers/${supplierId}/shipment-packages/${shipmentPackageId}`,
        req.body
      );
      return res.status(200).json(data);
    }

    // POST /api/clawd/trendyol?action=split_package&shipmentPackageId=XXX
    if (action === 'split_package' && req.method === 'POST') {
      const shipmentPackageId = req.query.shipmentPackageId as string || req.body?.shipmentPackageId;
      if (!shipmentPackageId) {
        return res.status(400).json({ error: 'shipmentPackageId is required' });
      }
      const data = await callTrendyolAPI(
        'POST',
        `/order/sellers/${supplierId}/shipment-packages/${shipmentPackageId}/split`,
        req.body
      );
      return res.status(200).json(data);
    }

    // GET /api/clawd/trendyol?action=shipping_label&trackingNumber=XXX
    if (action === 'shipping_label' && req.method === 'GET') {
      const trackingNumber = req.query.trackingNumber as string;
      if (!trackingNumber) {
        return res.status(400).json({ error: 'trackingNumber is required' });
      }
      const qs = buildQueryString({ id: trackingNumber });
      const data = await callTrendyolAPI('GET', `/order/sellers/${supplierId}/common-label/query${qs}`);
      return res.status(200).json(data);
    }

    // ================================================================
    // INVOICE
    // ================================================================

    // POST /api/clawd/trendyol?action=send_invoice
    if (action === 'send_invoice' && req.method === 'POST') {
      if (!req.body) {
        return res.status(400).json({ error: 'Request body is required' });
      }
      const data = await callTrendyolAPI(
        'POST',
        `/order/sellers/${supplierId}/invoice-links`,
        req.body
      );
      return res.status(200).json(data);
    }

    // DELETE /api/clawd/trendyol?action=delete_invoice&invoiceLinkId=XXX
    if (action === 'delete_invoice' && req.method === 'DELETE') {
      const invoiceLinkId = req.query.invoiceLinkId as string;
      if (!invoiceLinkId) {
        return res.status(400).json({ error: 'invoiceLinkId is required' });
      }
      const data = await callTrendyolAPI(
        'DELETE',
        `/order/sellers/${supplierId}/invoice-links/${invoiceLinkId}`
      );
      return res.status(200).json(data);
    }

    // ================================================================
    // RETURNS / CLAIMS
    // ================================================================

    // GET /api/clawd/trendyol?action=claims
    if (action === 'claims' && req.method === 'GET') {
      const qs = buildQueryString({
        status: req.query.status as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: req.query.page as string,
        size: req.query.size as string,
      });
      const data = await callTrendyolAPI('GET', `/order/sellers/${supplierId}/claims${qs}`);
      return res.status(200).json(data);
    }

    // PUT /api/clawd/trendyol?action=approve_claim&claimId=XXX
    if (action === 'approve_claim' && req.method === 'PUT') {
      const claimId = req.query.claimId as string || req.body?.claimId;
      if (!claimId) {
        return res.status(400).json({ error: 'claimId is required' });
      }
      const data = await callTrendyolAPI(
        'PUT',
        `/order/sellers/${supplierId}/claims/${claimId}/approve`,
        req.body
      );
      return res.status(200).json(data);
    }

    // ================================================================
    // CUSTOMER Q&A
    // ================================================================

    // GET /api/clawd/trendyol?action=questions
    if (action === 'questions' && req.method === 'GET') {
      const qs = buildQueryString({
        status: req.query.status as string,
        page: req.query.page as string,
        size: req.query.size as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      });
      const data = await callTrendyolAPI('GET', `/sellers/${supplierId}/questions/filter${qs}`);
      return res.status(200).json(data);
    }

    // POST /api/clawd/trendyol?action=answer_question&questionId=XXX
    if (action === 'answer_question' && req.method === 'POST') {
      const questionId = req.query.questionId as string || req.body?.questionId;
      if (!questionId) {
        return res.status(400).json({ error: 'questionId is required' });
      }
      if (!req.body || !req.body.text) {
        return res.status(400).json({ error: 'Request body must contain text field' });
      }
      const data = await callTrendyolAPI(
        'POST',
        `/sellers/${supplierId}/questions/${questionId}/answers`,
        req.body
      );
      return res.status(200).json(data);
    }

    // ================================================================
    // SETTLEMENT / FINANCE
    // ================================================================

    // GET /api/clawd/trendyol?action=settlements
    if (action === 'settlements' && req.method === 'GET') {
      const qs = buildQueryString({
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: req.query.page as string,
        size: req.query.size as string,
        transactionType: req.query.transactionType as string,
      });
      const data = await callTrendyolAPI('GET', `/finance/sellers/${supplierId}/settlements${qs}`);
      return res.status(200).json(data);
    }

    // GET /api/clawd/trendyol?action=test_settlements - Debug: raw settlements response
    if (action === 'test_settlements' && req.method === 'GET') {
      const now = Date.now();
      const fifteenDaysAgo = now - (15 * 24 * 60 * 60 * 1000);

      // Try both endpoint paths
      let data;
      let endpointUsed = '';
      try {
        data = await callTrendyolAPI('GET', `/finance/che/sellers/${supplierId}/settlements?startDate=${fifteenDaysAgo}&endDate=${now}&page=0&size=10`);
        endpointUsed = `/finance/che/sellers/{supplierId}/settlements`;
      } catch (e1: any) {
        logger.info('test_settlements: /finance/che/ path failed, trying /finance/ path', { error: e1.message || e1.status });
        try {
          data = await callTrendyolAPI('GET', `/finance/sellers/${supplierId}/settlements?startDate=${fifteenDaysAgo}&endDate=${now}&page=0&size=10`);
          endpointUsed = `/finance/sellers/{supplierId}/settlements`;
        } catch (e2: any) {
          return res.status(502).json({
            error: 'Both settlement endpoints failed',
            che_path_error: e1.body || e1.message || String(e1),
            standard_path_error: e2.body || e2.message || String(e2),
          });
        }
      }

      const items = data.content || data.items || data.results || [];
      const sampleItems = items.slice(0, 3);

      logger.info('test_settlements: raw response', {
        endpointUsed,
        totalElements: data.totalElements,
        rawKeys: Object.keys(data),
        sampleCount: sampleItems.length,
        sampleItems,
      });

      return res.status(200).json({
        endpoint_used: endpointUsed,
        query_params: { startDate: fifteenDaysAgo, endDate: now, page: 0, size: 10 },
        total_elements: data.totalElements ?? data.total ?? 'unknown',
        total_pages: data.totalPages ?? 'unknown',
        raw_keys: Object.keys(data),
        full_response_keys: items[0] ? Object.keys(items[0]) : [],
        sample_items: sampleItems,
        full_raw_response: data,
      });
    }

    // ================================================================
    // SUPPLIER INFO
    // ================================================================

    // GET /api/clawd/trendyol?action=addresses
    if (action === 'addresses' && req.method === 'GET') {
      const data = await callTrendyolAPI('GET', `/sellers/${supplierId}/addresses`);
      return res.status(200).json(data);
    }

    // GET /api/clawd/trendyol?action=cargo_companies
    if (action === 'cargo_companies' && req.method === 'GET') {
      const data = await callTrendyolAPI('GET', '/shipment/cargo-companies');
      return res.status(200).json(data);
    }

    // ================================================================
    // UNKNOWN ACTION
    // ================================================================

    return res.status(400).json({
      error: `Unknown action: ${action || '(none)'}`,
      available_actions: {
        products: 'GET - List/filter products',
        product: 'GET - Single product by barcode or stockCode',
        create_products: 'POST - Create products batch',
        update_product: 'PUT - Update product',
        update_price_and_inventory: 'PUT - Bulk stock & price update',
        batch_status: 'GET - Check batch request status',
        archive_product: 'PUT - Archive/unarchive product',
        categories: 'GET - List all categories',
        category_attributes: 'GET - Get category attributes by categoryId',
        brands: 'GET - Search brands by name',
        orders: 'GET - List orders with filters',
        order: 'GET - Single order by orderNumber or shipmentPackageId',
        update_tracking: 'PUT - Update cargo tracking',
        update_order_status: 'PUT - Mark as Picking/Invoiced',
        split_package: 'POST - Split shipment package',
        shipping_label: 'GET - Get shipping label by trackingNumber',
        send_invoice: 'POST - Send invoice link',
        delete_invoice: 'DELETE - Delete invoice link by invoiceLinkId',
        claims: 'GET - Get returned orders / claims',
        approve_claim: 'PUT - Approve return claim',
        questions: 'GET - Get customer questions',
        answer_question: 'POST - Answer customer question',
        settlements: 'GET - Get account statements',
        test_settlements: 'GET - Debug: raw settlements response (last 15 days, tries both endpoint paths)',
        addresses: 'GET - Get seller addresses',
        cargo_companies: 'GET - List cargo companies',
      },
    });

  } catch (error: any) {
    // Forward Trendyol API errors as-is
    if (error.status && error.body) {
      return res.status(error.status).json({
        error: 'Trendyol API Error',
        status: error.status,
        details: error.body,
      });
    }

    // Unexpected errors
    logger.error('Clawd Trendyol API error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
}

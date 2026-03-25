import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { getSupabaseServerClient } from '../../../lib/supabase';

// Etsy API base URL
const ETSY_API_BASE = 'https://openapi.etsy.com/v3/application';

interface EtsyReceipt {
    receipt_id: number;
    customer: {
        name: string;
        first_name: string;
        last_name: string;
    };
    shipping_address: {
        first_line: string;
        second_line: string | null;
        city: string;
        state: string | null;
        zip: string;
        country_iso: string;
        formatted_address?: string;
    };
    items: any[];
    tracking?: {
        tracking_code: string | null;
        carrier_name: string | null;
    };
}

// === Etsy Personalization Types (New Multi-Question API - Feb 2026) ===

type PersonalizationQuestionType = 'text_input' | 'dropdown' | 'unlabeled_upload' | 'labeled_upload';

interface PersonalizationDropdownOption {
    label: string; // 1-20 chars
}

interface PersonalizationQuestion {
    question_id?: number; // present in responses, omit for creation
    question_type: PersonalizationQuestionType;
    question_text: string; // 1-45 chars
    instructions?: string; // max 120 chars, not allowed for dropdown
    required: boolean;
    max_allowed_characters?: number; // 1-1024, required for text_input
    max_allowed_files?: number; // 1-10, for upload types
    options?: PersonalizationDropdownOption[]; // for dropdown/labeled_upload
}

interface PersonalizationPayload {
    personalization_questions: PersonalizationQuestion[];
}

// Helper function to parse full name into first and last name
function parseFullName(fullName: string): { firstName: string; lastName: string } {
    const trimmed = (fullName || '').trim();
    if (!trimmed) return { firstName: '', lastName: '' };

    const parts = trimmed.split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    return { firstName, lastName };
}

async function refreshEtsyToken(shopId: string, refreshToken: string): Promise<string> {
    const response = await fetch('https://api.etsy.com/v3/public/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: process.env.ETSY_API_KEY || '',
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to refresh Etsy token: ${response.statusText}`);
    }

    const data = await response.json();
    const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token || refreshToken;

    // Try updating EtsyShop table first
    const etsyShopUpdate = await prisma.etsyShop.updateMany({
        where: { shopId },
        data: {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            tokenExpiresAt: newExpiresAt,
        },
    });

    // If no rows updated in EtsyShop, update legacy Credential table instead
    if (etsyShopUpdate.count === 0) {
        await prisma.credential.updateMany({
            where: { etsyShopId: shopId },
            data: {
                etsyAccessToken: newAccessToken,
                etsyRefreshToken: newRefreshToken,
                etsyTokenExpiresAt: newExpiresAt,
            },
        });
    }

    return newAccessToken;
}

async function getEtsyAccessToken(shopId: string): Promise<string> {
    // Try EtsyShop table first
    const etsyShop = await prisma.etsyShop.findFirst({
        where: {
            shopId,
            isActive: true,
        },
        select: {
            accessToken: true,
            refreshToken: true,
            tokenExpiresAt: true,
        },
    });

    if (etsyShop) {
        // Check if token is expired or about to expire (within 5 minutes)
        const now = new Date();
        const expiresAt = etsyShop.tokenExpiresAt;

        if (!expiresAt || expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
            // Token expired or about to expire, refresh it
            if (!etsyShop.refreshToken) {
                throw new Error('No refresh token available');
            }
            return await refreshEtsyToken(shopId, etsyShop.refreshToken);
        }

        return etsyShop.accessToken;
    }

    // Fallback: check legacy Credential table
    const credential = await prisma.credential.findFirst({
        where: { etsyShopId: shopId },
        select: { etsyAccessToken: true, etsyRefreshToken: true, etsyTokenExpiresAt: true },
    });

    if (!credential?.etsyAccessToken) {
        throw new Error('Etsy shop not found or not connected');
    }

    // Check if legacy token needs refresh
    const now = new Date();
    const expiresAt = credential.etsyTokenExpiresAt;
    if (!expiresAt || expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
        if (!credential.etsyRefreshToken) {
            throw new Error('No refresh token available');
        }
        return await refreshEtsyToken(shopId, credential.etsyRefreshToken);
    }

    return credential.etsyAccessToken;
}

function validatePersonalizationQuestions(questions: PersonalizationQuestion[]): string | null {
    if (!Array.isArray(questions) || questions.length === 0) {
        return 'personalization_questions must be a non-empty array';
    }
    if (questions.length > 5) {
        return 'Maximum 5 personalization questions per listing';
    }

    const uploadCount = questions.filter(q =>
        q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload'
    ).length;
    if (uploadCount > 1) {
        return 'Maximum 1 upload question per listing';
    }

    const validTypes: PersonalizationQuestionType[] = ['text_input', 'dropdown', 'unlabeled_upload', 'labeled_upload'];

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];

        if (!validTypes.includes(q.question_type)) {
            return `Question ${i + 1}: invalid question_type "${q.question_type}". Must be one of: ${validTypes.join(', ')}`;
        }
        if (!q.question_text || q.question_text.length < 1 || q.question_text.length > 45) {
            return `Question ${i + 1}: question_text must be 1-45 characters`;
        }
        if (q.instructions && q.instructions.length > 120) {
            return `Question ${i + 1}: instructions must be max 120 characters`;
        }
        if (q.required === undefined || typeof q.required !== 'boolean') {
            return `Question ${i + 1}: required must be a boolean`;
        }

        // Type-specific validation
        if (q.question_type === 'text_input') {
            if (!q.max_allowed_characters) {
                return `Question ${i + 1}: max_allowed_characters is required for text_input (1-1024)`;
            }
            if (q.max_allowed_characters < 1 || q.max_allowed_characters > 1024) {
                return `Question ${i + 1}: max_allowed_characters must be 1-1024 for text_input`;
            }
        }
        if (q.question_type === 'dropdown') {
            if (q.instructions) {
                return `Question ${i + 1}: dropdown questions must not have instructions`;
            }
            if (!q.options || !Array.isArray(q.options) || q.options.length < 1 || q.options.length > 30) {
                return `Question ${i + 1}: dropdown requires 1-30 options`;
            }
            for (let j = 0; j < q.options.length; j++) {
                if (!q.options[j].label || q.options[j].label.length < 1 || q.options[j].label.length > 20) {
                    return `Question ${i + 1}, option ${j + 1}: label must be 1-20 characters`;
                }
            }
        }
        if (q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload') {
            if (q.max_allowed_files !== undefined) {
                if (q.max_allowed_files < 1 || q.max_allowed_files > 10) {
                    return `Question ${i + 1}: max_allowed_files must be 1-10 for upload types`;
                }
            }
            if (q.question_type === 'labeled_upload' && q.options && q.max_allowed_files) {
                if (q.options.length !== q.max_allowed_files) {
                    return `Question ${i + 1}: labeled_upload options count must equal max_allowed_files`;
                }
            }
        }
    }

    return null; // valid
}

async function callEtsyAPI(endpoint: string, accessToken: string, options: RequestInit = {}) {
    const url = `${ETSY_API_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Etsy API error: ${response.status} - ${errorText}`);
        logger.error('Etsy API error', error);
        throw error;
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
        return { success: true };
    }

    return response.json();
}

// ---------------------------------------------------------------------------
// Public Etsy API (no OAuth needed — uses only x-api-key)
// ---------------------------------------------------------------------------

async function callEtsyPublicAPI(endpoint: string) {
    const url = `${ETSY_API_BASE}${endpoint}`;
    const apiKey = (process.env.ETSY_API_KEY || '').trim().replace(/^"|"$/g, '');
    const apiSecret = (process.env.ETSY_API_SECRET || '').trim().replace(/^"|"$/g, '');
    const response = await fetch(url, {
        headers: {
            'x-api-key': `${apiKey}:${apiSecret}`,
        },
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Etsy Public API error: ${response.status} - ${errorText}`);
    }
    if (response.status === 204) return { success: true };
    return response.json();
}

// Rate limiter for public API (max ~8 concurrent, 120ms delay)
async function rateLimitedPublicCall(endpoint: string): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 120));
    return callEtsyPublicAPI(endpoint);
}

// Helper: extract keywords from titles
function extractTitleKeywords(titles: string[]): { keyword: string; count: number; pct: number }[] {
    const STOP = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'are', 'was',
        'has', 'have', 'do', 'does', 'not', 'no', 'set', '&', '-', '/', '|', '+', 'x',
        'her', 'him', 'his', 'she', 'he', 'they', 'this', 'that', 'these', 'those',
        'will', 'would', 'could', 'should', 'can', 'may', 'might',
    ]);
    const freq: Record<string, number> = {};
    titles.forEach(t => {
        t.toLowerCase().split(/[\s,;:!?()[\]{}""''|\/\-]+/).filter(
            w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)
        ).forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    });
    const total = Math.max(titles.length, 1);
    return Object.entries(freq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 80)
        .map(([keyword, count]) => ({ keyword, count, pct: Math.round((count / total) * 100) }));
}

async function handlePublicAction(req: NextApiRequest, res: NextApiResponse, action: string) {
    // --- search_market: Search all Etsy listings ---
    if (action === 'search_market' && req.method === 'GET') {
        const keywords = req.query.keywords as string;
        if (!keywords) return res.status(400).json({ error: 'keywords is required' });

        const minPrice = req.query.min_price as string;
        const maxPrice = req.query.max_price as string;
        const sortOn = (req.query.sort_on as string) || 'score';
        const sortOrder = (req.query.sort_order as string) || 'desc';
        const taxonomyId = req.query.taxonomy_id as string;
        const requestedLimit = Math.min(parseInt((req.query.limit as string) || '100'), 300);

        // Paginate up to 3 pages of 100
        const pages = Math.ceil(requestedLimit / 100);
        const allResults: any[] = [];
        let totalCount = 0;

        for (let page = 0; page < pages; page++) {
            const params = new URLSearchParams({
                keywords,
                limit: '100',
                offset: String(page * 100),
                sort_on: sortOn,
                sort_order: sortOrder,
            });
            if (minPrice) params.set('min_price', minPrice);
            if (maxPrice) params.set('max_price', maxPrice);
            if (taxonomyId) params.set('taxonomy_id', taxonomyId);

            const data = page === 0
                ? await callEtsyPublicAPI(`/listings/active?${params}`)
                : await rateLimitedPublicCall(`/listings/active?${params}`);

            totalCount = data.count || 0;
            const results = data.results || [];
            allResults.push(...results);

            if (results.length < 100) break; // no more pages
        }

        // Process items
        const items = allResults.map((l: any) => ({
            listing_id: l.listing_id,
            title: l.title || '',
            description: (l.description || '').slice(0, 300),
            price: l.price ? l.price.amount / l.price.divisor : 0,
            currency_code: l.price?.currency_code || 'USD',
            views: l.views || 0,
            num_favorers: l.num_favorers || 0,
            tags: l.tags || [],
            shop_id: l.shop_id,
            taxonomy_id: l.taxonomy_id,
            url: l.url || '',
            quantity: l.quantity || 0,
            image_url: l.images?.[0]?.url_170x135 || '',
            created_timestamp: l.created_timestamp || 0,
            state: l.state || 'active',
        }));

        // Compute price stats
        const prices = items.map((i: any) => i.price).filter((p: number) => p > 0).sort((a: number, b: number) => a - b);
        let priceStats: any = null;
        if (prices.length > 0) {
            const sum = prices.reduce((a: number, b: number) => a + b, 0);
            const mid = Math.floor(prices.length / 2);
            priceStats = {
                min: prices[0],
                max: prices[prices.length - 1],
                avg: Math.round((sum / prices.length) * 100) / 100,
                median: prices.length % 2 === 0 ? Math.round(((prices[mid - 1] + prices[mid]) / 2) * 100) / 100 : prices[mid],
                count: prices.length,
            };
        }

        // Aggregate tag frequency
        const tagMap: Record<string, number> = {};
        items.forEach((item: any) => {
            (item.tags || []).forEach((tag: string) => {
                const t = tag.toLowerCase().trim();
                if (t) tagMap[t] = (tagMap[t] || 0) + 1;
            });
        });
        const tagFrequency = Object.entries(tagMap)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 100)
            .map(([tag, count]) => ({ tag, count, pct: Math.round((count / Math.max(items.length, 1)) * 100) }));

        // Extract title keywords
        const titleKeywords = extractTitleKeywords(items.map((i: any) => i.title));

        // Unique shop IDs
        const shopIds = [...new Set(items.map((i: any) => i.shop_id).filter(Boolean))];

        return res.status(200).json({
            total: totalCount,
            items,
            priceStats,
            tagFrequency,
            titleKeywords,
            shopIds: shopIds.slice(0, 30),
        });
    }

    // --- get_public_shop: Get shop details (public) ---
    if (action === 'get_public_shop' && req.method === 'GET') {
        const shopId = req.query.target_shop_id as string;
        if (!shopId) return res.status(400).json({ error: 'target_shop_id is required' });

        const data = await callEtsyPublicAPI(`/shops/${shopId}`);
        return res.status(200).json({
            shop_id: data.shop_id,
            shop_name: data.shop_name || '',
            num_sales: data.transaction_sold_count || 0,
            review_count: data.review_count || 0,
            review_average: data.review_average || 0,
            listing_active_count: data.listing_active_count || 0,
            currency_code: data.currency_code || 'USD',
            url: data.url || '',
            icon_url: data.icon_url_fullxfull || '',
            created_timestamp: data.create_date || 0,
        });
    }

    // --- get_public_shop_listings: Get listings from a shop (public) ---
    if (action === 'get_public_shop_listings' && req.method === 'GET') {
        const shopId = req.query.target_shop_id as string;
        if (!shopId) return res.status(400).json({ error: 'target_shop_id is required' });

        const requestedLimit = Math.min(parseInt((req.query.limit as string) || '100'), 500);
        const pages = Math.ceil(requestedLimit / 100);
        const allListings: any[] = [];

        for (let page = 0; page < pages; page++) {
            const data = page === 0
                ? await callEtsyPublicAPI(`/shops/${shopId}/listings/active?limit=100&offset=${page * 100}`)
                : await rateLimitedPublicCall(`/shops/${shopId}/listings/active?limit=100&offset=${page * 100}`);

            const results = data.results || [];
            allListings.push(...results.map((l: any) => ({
                listing_id: l.listing_id,
                title: l.title || '',
                price: l.price ? l.price.amount / l.price.divisor : 0,
                currency_code: l.price?.currency_code || 'USD',
                views: l.views || 0,
                num_favorers: l.num_favorers || 0,
                tags: l.tags || [],
                quantity: l.quantity || 0,
                url: l.url || '',
                created_timestamp: l.created_timestamp || 0,
            })));

            if (results.length < 100) break;
        }

        return res.status(200).json({
            total: allListings.length,
            listings: allListings,
        });
    }

    // --- batch_shops: Get multiple shop details in parallel ---
    if (action === 'batch_shops' && req.method === 'GET') {
        const shopIdsStr = req.query.shop_ids as string;
        if (!shopIdsStr) return res.status(400).json({ error: 'shop_ids is required' });

        const shopIds = shopIdsStr.split(',').slice(0, 20);
        const results = await Promise.allSettled(
            shopIds.map((id, i) =>
                new Promise<any>(resolve => setTimeout(async () => {
                    try {
                        const data = await callEtsyPublicAPI(`/shops/${id}`);
                        resolve({
                            shop_id: data.shop_id,
                            shop_name: data.shop_name || '',
                            num_sales: data.transaction_sold_count || 0,
                            review_count: data.review_count || 0,
                            review_average: data.review_average || 0,
                            listing_active_count: data.listing_active_count || 0,
                            url: data.url || '',
                            icon_url: data.icon_url_fullxfull || '',
                        });
                    } catch {
                        resolve(null);
                    }
                }, i * 120))
            )
        );

        const shops = results
            .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
            .map(r => r.value);

        return res.status(200).json({ shops });
    }

    return res.status(400).json({ error: 'Invalid public action' });
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    // 1. Authenticate — accept API key OR session auth
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const envApiKey = process.env.CLAWD_API_KEY;
    let authenticated = false;

    // Try API key auth first
    if (envApiKey && apiKey === envApiKey) {
        authenticated = true;
    }

    // Fall back to session auth
    if (!authenticated) {
        try {
            const supabase = getSupabaseServerClient(req, res);
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                authenticated = true;
            }
        } catch {
            // Session auth failed, continue
        }
    }

    if (!authenticated) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication' });
    }

    // --- Public Etsy API actions (no OAuth needed, just x-api-key) ---
    const publicAction = req.query.action as string;
    if (publicAction && ['search_market', 'get_public_shop', 'get_public_shop_listings', 'batch_shops'].includes(publicAction)) {
        try {
            return await handlePublicAction(req, res, publicAction);
        } catch (error: any) {
            logger.error('Etsy public API error:', error);
            return res.status(500).json({ error: error.message || 'Public API error' });
        }
    }

    // Get shop ID from query parameter (required)
    const shopId = req.query.shop_id as string;
    if (!shopId) {
        return res.status(400).json({ error: 'shop_id is required' });
    }

    try {
        // Get and refresh Etsy access token if needed
        const accessToken = await getEtsyAccessToken(shopId);

        // Route the request based on path
        const { action, receipt_id, customer } = req.query;

        // GET /api/clawd/etsy?action=receipts - List receipts
        if (req.method === 'GET' && (!action || action === 'receipts')) {
            const limit = parseInt((req.query.limit as string) || '25');
            const offset = parseInt((req.query.offset as string) || '0');

            // Fetch receipts from Etsy API
            const data = await callEtsyAPI(
                `/shops/${shopId}/receipts?limit=${limit}&offset=${offset}&was_paid=true&was_shipped=false`,
                accessToken
            );

            let receipts = data.results || [];

            // Filter by customer name if provided
            if (customer && typeof customer === 'string') {
                const searchTerm = customer.toLowerCase();
                receipts = receipts.filter((receipt: any) => {
                    const name = receipt.name || '';
                    return name.toLowerCase().includes(searchTerm);
                });
            }

            // Format receipts for response
            const formattedReceipts = receipts.map((receipt: any) => {
                const { firstName, lastName } = parseFullName(receipt.name);
                return {
                    receipt_id: receipt.receipt_id,
                    customer: {
                        name: receipt.name || '',
                        first_name: firstName,
                        last_name: lastName,
                    },
                    shipping_address: {
                        first_line: receipt.first_line || '',
                        second_line: receipt.second_line || null,
                        city: receipt.city || '',
                        state: receipt.state || null,
                        zip: receipt.zip || '',
                        country: receipt.country_iso || 'US',
                        formatted_address: receipt.formatted_address || '',
                    },
                    order_date: receipt.created_timestamp,
                    total_price: receipt.grandtotal || 0,
                };
            });

            return res.status(200).json(formattedReceipts);
        }

        // GET /api/clawd/etsy?action=receipt&receipt_id=123 - Get specific receipt
        if (req.method === 'GET' && action === 'receipt' && receipt_id) {
            // Fetch receipt details
            const receipt = await callEtsyAPI(
                `/shops/${shopId}/receipts/${receipt_id}`,
                accessToken
            );

            // Debug: Log raw receipt data to see address structure
            logger.info('Raw Etsy receipt data', {
                receipt_id: receipt.receipt_id,
                name: receipt.name,
                first_line: receipt.first_line,
                second_line: receipt.second_line,
                city: receipt.city,
                state: receipt.state,
                zip: receipt.zip,
                country_iso: receipt.country_iso,
                formatted_address: receipt.formatted_address,
                // Check for nested structures
                has_shipping_address: !!receipt.shipping_address,
                raw_keys: Object.keys(receipt || {}).slice(0, 30),
            });

            // Fetch shipments for tracking info
            let trackingInfo = { tracking_code: null, carrier_name: null };
            try {
                const shipments = await callEtsyAPI(
                    `/shops/${shopId}/receipts/${receipt_id}/shipments`,
                    accessToken
                );
                if (shipments.results && shipments.results.length > 0) {
                    const shipment = shipments.results[0];
                    trackingInfo = {
                        tracking_code: shipment.tracking_code || null,
                        carrier_name: shipment.carrier_name || null,
                    };
                }
            } catch (error) {
                logger.warn('Could not fetch shipment info', { receipt_id, error });
            }

            // Fetch receipt items (transactions)
            let items = [];
            try {
                const transactions = await callEtsyAPI(
                    `/shops/${shopId}/receipts/${receipt_id}/transactions`,
                    accessToken
                );
                items = (transactions.results || []).map((tx: any) => ({
                    transaction_id: tx.transaction_id,
                    title: tx.title || '',
                    quantity: tx.quantity || 1,
                    price: tx.price?.amount || 0,
                    sku: tx.product_data?.sku || '',
                }));
            } catch (error) {
                logger.warn('Could not fetch receipt transactions', { receipt_id, error });
            }

            // If debug=true, return raw receipt data
            if (req.query.debug === 'true') {
                return res.status(200).json({
                    raw_receipt: receipt,
                    raw_keys: Object.keys(receipt || {}),
                });
            }

            const { firstName, lastName } = parseFullName(receipt.name);
            const formatted: EtsyReceipt = {
                receipt_id: receipt.receipt_id,
                customer: {
                    name: receipt.name || '',
                    first_name: firstName,
                    last_name: lastName,
                },
                shipping_address: {
                    first_line: receipt.first_line || '',
                    second_line: receipt.second_line || null,
                    city: receipt.city || '',
                    state: receipt.state || null,
                    zip: receipt.zip || '',
                    country_iso: receipt.country_iso || 'US',
                    formatted_address: receipt.formatted_address || '',
                },
                items,
                tracking: trackingInfo,
            };

            return res.status(200).json(formatted);
        }

        // POST /api/clawd/etsy - Add tracking number
        if (req.method === 'POST' && receipt_id) {
            const { tracking_code, carrier_name } = req.body;

            if (!tracking_code || !carrier_name) {
                return res.status(400).json({ error: 'tracking_code and carrier_name are required' });
            }

            // Submit tracking to Etsy
            const result = await callEtsyAPI(
                `/shops/${shopId}/receipts/${receipt_id}/tracking`,
                accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        tracking_code,
                        carrier_name,
                        send_bcc: false, // Don't send notification to seller
                    }),
                }
            );

            return res.status(200).json({
                success: true,
                receipt_id,
                tracking_code,
                carrier_name,
                data: result,
            });
        }

        // GET /api/clawd/etsy?action=listings - List active listings
        if (req.method === 'GET' && action === 'listings') {
            const limit = parseInt((req.query.limit as string) || '25');
            const offset = parseInt((req.query.offset as string) || '0');

            const data = await callEtsyAPI(
                `/shops/${shopId}/listings/active?limit=${limit}&offset=${offset}`,
                accessToken
            );

            const listings = (data.results || []).map((listing: any) => ({
                listing_id: listing.listing_id,
                title: listing.title || '',
                description: listing.description || '',
                tags: listing.tags || [],
                price: listing.price ? {
                    amount: listing.price.amount,
                    divisor: listing.price.divisor,
                    currency_code: listing.price.currency_code,
                } : null,
                views: listing.views || 0,
                num_favorers: listing.num_favorers || 0,
                quantity: listing.quantity || 0,
                state: listing.state || '',
                url: listing.url || '',
                created_timestamp: listing.created_timestamp,
                updated_timestamp: listing.updated_timestamp,
            }));

            return res.status(200).json({
                count: data.count || listings.length,
                listings,
            });
        }

        // GET /api/clawd/etsy?action=listing&listing_id=XXXXX - Get single listing details
        const listing_id = req.query.listing_id as string;
        const image_id = req.query.image_id as string;
        const video_id = req.query.video_id as string;
        const section_id = req.query.section_id as string;
        if (req.method === 'GET' && action === 'listing' && listing_id) {
            const listing = await callEtsyAPI(
                `/listings/${listing_id}`,
                accessToken
            );

            // If debug=true, return raw listing data
            if (req.query.debug === 'true') {
                return res.status(200).json({
                    raw_listing: listing,
                    raw_keys: Object.keys(listing || {}),
                });
            }

            // Fetch personalization and images in parallel
            let personalization_questions: any[] = [];
            let images: any[] = [];

            const [personalizationResult, imagesResult] = await Promise.allSettled([
                callEtsyAPI(
                    `/listings/${listing_id}/personalization?supports_multiple_personalization_questions=true`,
                    accessToken
                ),
                callEtsyAPI(
                    `/listings/${listing_id}/images`,
                    accessToken
                ),
            ]);

            if (personalizationResult.status === 'fulfilled') {
                personalization_questions = personalizationResult.value.personalization_questions || [];
            }
            if (imagesResult.status === 'fulfilled') {
                images = (imagesResult.value.results || []).map((img: any) => ({
                    listing_image_id: img.listing_image_id,
                    url_75x75: img.url_75x75,
                    url_170x135: img.url_170x135,
                    url_570xN: img.url_570xN,
                    url_fullxfull: img.url_fullxfull,
                    rank: img.rank,
                    alt_text: img.alt_text || '',
                }));
            }

            return res.status(200).json({
                listing_id: listing.listing_id,
                title: listing.title || '',
                description: listing.description || '',
                tags: listing.tags || [],
                materials: listing.materials || [],
                price: listing.price ? {
                    amount: listing.price.amount,
                    divisor: listing.price.divisor,
                    currency_code: listing.price.currency_code,
                } : null,
                views: listing.views || 0,
                num_favorers: listing.num_favorers || 0,
                quantity: listing.quantity || 0,
                state: listing.state || '',
                url: listing.url || '',
                taxonomy_id: listing.taxonomy_id,
                shop_section_id: listing.shop_section_id,
                processing_min: listing.processing_min,
                processing_max: listing.processing_max,
                who_made: listing.who_made,
                when_made: listing.when_made,
                is_supply: listing.is_supply,
                item_weight: listing.item_weight,
                item_weight_unit: listing.item_weight_unit,
                item_length: listing.item_length,
                item_width: listing.item_width,
                item_height: listing.item_height,
                item_dimensions_unit: listing.item_dimensions_unit,
                shipping_profile_id: listing.shipping_profile_id,
                return_policy_id: listing.return_policy_id,
                created_timestamp: listing.created_timestamp,
                updated_timestamp: listing.updated_timestamp,
                is_personalizable: listing.is_personalizable || personalization_questions.length > 0,
                personalization_is_required: listing.personalization_is_required || false,
                personalization_instructions: listing.personalization_instructions || '',
                personalization_char_count_max: listing.personalization_char_count_max || 0,
                personalization_questions,
                images,
            });
        }

        // GET /api/clawd/etsy?action=get_personalization&listing_id=XXXXX - Get listing personalization questions
        if (req.method === 'GET' && action === 'get_personalization' && listing_id) {
            logger.info('Fetching personalization for listing', { listing_id, shopId });

            try {
                // GET endpoint does NOT include shop_id in path (per Etsy docs)
                const data = await callEtsyAPI(
                    `/listings/${listing_id}/personalization?supports_multiple_personalization_questions=true`,
                    accessToken
                );

                return res.status(200).json({
                    listing_id: parseInt(listing_id),
                    personalization_questions: data.personalization_questions || [],
                    count: (data.personalization_questions || []).length,
                });
            } catch (error: any) {
                // If listing has no personalization, Etsy may return 404
                if (error.message && error.message.includes('404')) {
                    return res.status(200).json({
                        listing_id: parseInt(listing_id),
                        personalization_questions: [],
                        count: 0,
                        note: 'No personalization configured for this listing',
                    });
                }
                throw error;
            }
        }

        // POST /api/clawd/etsy?action=set_personalization&listing_id=XXXXX - Set listing personalization questions
        if (req.method === 'POST' && action === 'set_personalization' && listing_id) {
            const { personalization_questions } = req.body;

            const validationError = validatePersonalizationQuestions(personalization_questions);
            if (validationError) {
                return res.status(400).json({ error: validationError });
            }

            logger.info('Setting personalization for listing', {
                listing_id,
                shopId,
                question_count: personalization_questions.length,
                question_types: personalization_questions.map((q: PersonalizationQuestion) => q.question_type),
            });

            const payload: PersonalizationPayload = {
                personalization_questions: personalization_questions.map((q: PersonalizationQuestion) => {
                    const question: Record<string, any> = {
                        question_type: q.question_type,
                        question_text: q.question_text,
                        required: q.required,
                    };
                    if (q.instructions) question.instructions = q.instructions;
                    if (q.question_type === 'text_input' && q.max_allowed_characters) {
                        question.max_allowed_characters = q.max_allowed_characters;
                    }
                    if (q.question_type === 'dropdown' && q.options) {
                        question.options = q.options;
                    }
                    if ((q.question_type === 'unlabeled_upload' || q.question_type === 'labeled_upload') && q.max_allowed_files) {
                        question.max_allowed_files = q.max_allowed_files;
                    }
                    if (q.question_type === 'labeled_upload' && q.options) {
                        question.options = q.options;
                    }
                    // Preserve question_id for updates
                    if (q.question_id) question.question_id = q.question_id;
                    return question;
                }),
            };

            const result = await callEtsyAPI(
                `/shops/${shopId}/listings/${listing_id}/personalization?supports_multiple_personalization_questions=true`,
                accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify(payload),
                }
            );

            return res.status(200).json({
                success: true,
                listing_id: parseInt(listing_id),
                personalization_questions: result.personalization_questions || [],
                message: `Personalization set with ${personalization_questions.length} question(s)`,
            });
        }

        // POST /api/clawd/etsy?action=remove_personalization&listing_id=XXXXX - Remove all personalization
        if ((req.method === 'POST' || req.method === 'DELETE') && action === 'remove_personalization' && listing_id) {
            logger.info('Removing personalization from listing', { listing_id, shopId });

            const result = await callEtsyAPI(
                `/shops/${shopId}/listings/${listing_id}/personalization?supports_multiple_personalization_questions=true`,
                accessToken,
                {
                    method: 'DELETE',
                }
            );

            return res.status(200).json({
                success: true,
                listing_id: parseInt(listing_id),
                message: 'Personalization removed from listing',
            });
        }

        // POST /api/clawd/etsy?action=set_simple_personalization&listing_id=XXXXX - Quick single text question
        if (req.method === 'POST' && action === 'set_simple_personalization' && listing_id) {
            const {
                question_text = 'Personalization',
                instructions = '',
                required = false,
                max_characters = 256,
            } = req.body;

            if (question_text.length > 45) {
                return res.status(400).json({ error: 'question_text must be max 45 characters' });
            }

            const question: PersonalizationQuestion = {
                question_type: 'text_input',
                question_text,
                instructions: instructions.substring(0, 120),
                required,
                max_allowed_characters: Math.min(Math.max(max_characters, 1), 1024),
            };

            logger.info('Setting simple personalization for listing', { listing_id, shopId, question_text });

            const result = await callEtsyAPI(
                `/shops/${shopId}/listings/${listing_id}/personalization?supports_multiple_personalization_questions=true`,
                accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify({ personalization_questions: [question] }),
                }
            );

            return res.status(200).json({
                success: true,
                listing_id: parseInt(listing_id),
                personalization_questions: result.personalization_questions || [],
                message: 'Simple text personalization set',
            });
        }

        // PATCH /api/clawd/etsy?action=update_listing&listing_id=XXXXX - Update listing
        if ((req.method === 'PATCH' || req.method === 'PUT') && action === 'update_listing' && listing_id) {
            const {
                title, description, tags, materials,
                price, quantity, shop_section_id,
                who_made, when_made, is_supply, taxonomy_id,
                shipping_profile_id, return_policy_id,
                item_weight, item_weight_unit,
                item_length, item_width, item_height, item_dimensions_unit,
                processing_min, processing_max, state,
                is_personalizable, personalization_is_required,
                personalization_instructions, personalization_char_count_max,
            } = req.body;

            // Build update payload with only provided fields
            const updatePayload: Record<string, any> = {};
            if (title !== undefined) updatePayload.title = title;
            if (description !== undefined) updatePayload.description = description;
            if (tags !== undefined) updatePayload.tags = tags;
            if (materials !== undefined) updatePayload.materials = materials;
            if (price !== undefined) updatePayload.price = parseFloat(price);
            if (quantity !== undefined) updatePayload.quantity = quantity;
            if (shop_section_id !== undefined) updatePayload.shop_section_id = shop_section_id;
            if (who_made !== undefined) updatePayload.who_made = who_made;
            if (when_made !== undefined) updatePayload.when_made = when_made;
            if (is_supply !== undefined) updatePayload.is_supply = is_supply;
            if (taxonomy_id !== undefined) updatePayload.taxonomy_id = taxonomy_id;
            if (shipping_profile_id !== undefined) updatePayload.shipping_profile_id = shipping_profile_id;
            if (return_policy_id !== undefined) updatePayload.return_policy_id = return_policy_id;
            if (item_weight !== undefined) updatePayload.item_weight = item_weight;
            if (item_weight_unit !== undefined) updatePayload.item_weight_unit = item_weight_unit;
            if (item_length !== undefined) updatePayload.item_length = item_length;
            if (item_width !== undefined) updatePayload.item_width = item_width;
            if (item_height !== undefined) updatePayload.item_height = item_height;
            if (item_dimensions_unit !== undefined) updatePayload.item_dimensions_unit = item_dimensions_unit;
            if (processing_min !== undefined) updatePayload.processing_min = processing_min;
            if (processing_max !== undefined) updatePayload.processing_max = processing_max;
            if (state !== undefined) updatePayload.state = state;
            if (is_personalizable !== undefined) updatePayload.is_personalizable = is_personalizable;
            if (personalization_is_required !== undefined) updatePayload.personalization_is_required = personalization_is_required;
            if (personalization_instructions !== undefined) updatePayload.personalization_instructions = personalization_instructions;
            if (personalization_char_count_max !== undefined) updatePayload.personalization_char_count_max = personalization_char_count_max;

            if (Object.keys(updatePayload).length === 0) {
                return res.status(400).json({
                    error: 'At least one field is required'
                });
            }

            logger.info('Updating Etsy listing', {
                listing_id,
                fields: Object.keys(updatePayload),
            });

            const result = await callEtsyAPI(
                `/shops/${shopId}/listings/${listing_id}`,
                accessToken,
                {
                    method: 'PATCH',
                    body: JSON.stringify(updatePayload),
                }
            );

            return res.status(200).json({
                success: true,
                listing_id,
                updated_fields: Object.keys(updatePayload),
                result,
            });
        }

        // POST /api/clawd/etsy?action=create_listing - Create a draft listing
        if (req.method === 'POST' && action === 'create_listing') {
            const {
                title,
                description,
                price,
                quantity = 1,
                tags = [],
                taxonomy_id,
                who_made = 'i_did',
                when_made = 'made_to_order',
                is_supply = false,
                shipping_profile_id,
                return_policy_id,
                materials = [],
                shop_section_id,
                processing_min,
                processing_max,
                item_weight, item_weight_unit,
                item_length, item_width, item_height, item_dimensions_unit,
                currency_code,
                // New Sept 2025 requirement for processing profiles
                readiness_state_id,
            } = req.body;

            // Validate required fields
            if (!title) {
                return res.status(400).json({ error: 'title is required' });
            }
            if (!description) {
                return res.status(400).json({ error: 'description is required' });
            }
            if (price === undefined || price === null) {
                return res.status(400).json({ error: 'price is required' });
            }
            if (!taxonomy_id) {
                return res.status(400).json({ error: 'taxonomy_id is required (category ID)' });
            }

            // Build the listing payload
            const listingPayload: Record<string, any> = {
                title,
                description,
                price: typeof price === 'number' ? price : parseFloat(price),
                quantity,
                taxonomy_id,
                who_made,
                when_made,
                is_supply,
                state: 'draft', // Create as draft first
            };

            // Add optional fields if provided
            if (currency_code) listingPayload.currency_code = currency_code;
            if (tags && tags.length > 0) listingPayload.tags = tags.slice(0, 13); // Etsy max 13 tags
            if (materials && materials.length > 0) listingPayload.materials = materials.slice(0, 13);
            if (shipping_profile_id) listingPayload.shipping_profile_id = shipping_profile_id;
            if (return_policy_id) listingPayload.return_policy_id = return_policy_id;
            if (shop_section_id) listingPayload.shop_section_id = shop_section_id;
            if (processing_min) listingPayload.processing_min = processing_min;
            if (processing_max) listingPayload.processing_max = processing_max;
            if (item_weight !== undefined) listingPayload.item_weight = item_weight;
            if (item_weight_unit) listingPayload.item_weight_unit = item_weight_unit;
            if (item_length !== undefined) listingPayload.item_length = item_length;
            if (item_width !== undefined) listingPayload.item_width = item_width;
            if (item_height !== undefined) listingPayload.item_height = item_height;
            if (item_dimensions_unit) listingPayload.item_dimensions_unit = item_dimensions_unit;
            // Sept 2025 processing profile requirements
            if (readiness_state_id) listingPayload.readiness_state_id = readiness_state_id;

            logger.info('Creating draft Etsy listing', {
                shopId,
                title: title.substring(0, 50),
                taxonomy_id,
            });

            // legacy=false is required for new processing profiles system (Sept 2025)
            const result = await callEtsyAPI(
                `/shops/${shopId}/listings?legacy=false`,
                accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify(listingPayload),
                }
            );

            // Migration bridge: if legacy personalization fields were passed, convert to new API
            let personalizationSet = false;
            if (req.body.is_personalizable) {
                try {
                    const legacyQuestion: PersonalizationQuestion = {
                        question_type: 'text_input',
                        question_text: 'Personalization',
                        required: req.body.personalization_is_required || false,
                        instructions: req.body.personalization_instructions || '',
                        max_allowed_characters: req.body.personalization_char_count_max || 256,
                    };
                    await callEtsyAPI(
                        `/shops/${shopId}/listings/${result.listing_id}/personalization?supports_multiple_personalization_questions=true`,
                        accessToken,
                        {
                            method: 'POST',
                            body: JSON.stringify({ personalization_questions: [legacyQuestion] }),
                        }
                    );
                    personalizationSet = true;
                    logger.info('Converted legacy personalization to new API', { listing_id: result.listing_id });
                } catch (err) {
                    logger.warn('Failed to set personalization via new API after create', {
                        listing_id: result.listing_id,
                        error: err,
                    });
                }
            }

            return res.status(201).json({
                success: true,
                listing_id: result.listing_id,
                state: result.state,
                title: result.title,
                url: result.url,
                personalization_set: personalizationSet,
                message: 'Draft listing created. Add images then publish when ready.',
            });
        }

        // POST /api/clawd/etsy?action=copy_listing - Duplicate an existing listing as a new draft
        if (req.method === 'POST' && action === 'copy_listing') {
            const { source_listing_id, title_prefix = 'COPY - ' } = req.body;

            if (!source_listing_id) {
                return res.status(400).json({ error: 'source_listing_id is required' });
            }

            logger.info('Copying Etsy listing', {
                shopId,
                source_listing_id,
            });

            // Step 1: Fetch the source listing
            const sourceListing = await callEtsyAPI(
                `/listings/${source_listing_id}`,
                accessToken
            );

            // Fetch images separately (includes param unreliable for single listing)
            let sourceImageList: any[] = [];
            try {
                const imagesData = await callEtsyAPI(
                    `/listings/${source_listing_id}/images`,
                    accessToken
                );
                sourceImageList = imagesData.results || imagesData || [];
            } catch {
                logger.warn('Failed to fetch source listing images', { source_listing_id });
            }

            if (!sourceListing || !sourceListing.listing_id) {
                return res.status(404).json({
                    error: `Source listing ${source_listing_id} not found`
                });
            }

            // Step 2: Build the new listing payload
            const newTitle = `${title_prefix}${sourceListing.title}`;

            // Calculate price from Etsy's amount/divisor format
            let price = 0;
            if (sourceListing.price) {
                price = sourceListing.price.amount / (sourceListing.price.divisor || 100);
            }

            const copyPayload: Record<string, any> = {
                title: newTitle.substring(0, 140), // Etsy title max 140 chars
                description: sourceListing.description || '',
                price: price,
                quantity: sourceListing.quantity || 1,
                taxonomy_id: sourceListing.taxonomy_id,
                who_made: sourceListing.who_made || 'i_did',
                when_made: sourceListing.when_made || 'made_to_order',
                is_supply: sourceListing.is_supply ?? false,
                state: 'draft',
                type: sourceListing.type || 'physical',
            };

            // Physical listings require readiness_state_id
            if (sourceListing.readiness_state_id) {
                copyPayload.readiness_state_id = sourceListing.readiness_state_id;
            } else if (copyPayload.type === 'physical' || !sourceListing.is_digital) {
                // Fetch shop's readiness states and use first one as fallback
                try {
                    const rsData = await callEtsyAPI(`/shops/${shopId}/readiness-states`, accessToken);
                    const states = rsData.results || rsData.readiness_states || rsData;
                    if (Array.isArray(states) && states.length > 0) {
                        copyPayload.readiness_state_id = states[0].readiness_state_id;
                    }
                } catch { /* will fail at create if truly missing */ }
            }

            // Physical listings require shipping_profile_id
            if (sourceListing.shipping_profile_id) {
                copyPayload.shipping_profile_id = sourceListing.shipping_profile_id;
            } else if ((copyPayload.type === 'physical' || copyPayload.type === 'both') && !sourceListing.is_digital) {
                // Fetch shop's first shipping profile as fallback
                try {
                    const profiles = await callEtsyAPI(`/shops/${shopId}/shipping-profiles`, accessToken);
                    const profileList = profiles.results || profiles;
                    if (Array.isArray(profileList) && profileList.length > 0) {
                        copyPayload.shipping_profile_id = profileList[0].shipping_profile_id;
                    }
                } catch { /* will fail at create if truly missing */ }
            }

            // Add optional fields if present in source
            if (sourceListing.tags && sourceListing.tags.length > 0) {
                copyPayload.tags = sourceListing.tags.slice(0, 13);
            }
            if (sourceListing.materials && sourceListing.materials.length > 0) {
                copyPayload.materials = sourceListing.materials.slice(0, 13);
            }
            if (sourceListing.return_policy_id) {
                copyPayload.return_policy_id = sourceListing.return_policy_id;
            }

            // Step 4: Create the new draft listing (personalization handled separately via new endpoint)
            const newListing = await callEtsyAPI(
                `/shops/${shopId}/listings?legacy=false`,
                accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify(copyPayload),
                }
            );

            // Return source images so frontend can copy them (avoids Vercel timeout)
            const sourceImages = sourceImageList.map((img: any) => ({
                listing_image_id: img.listing_image_id,
                url_fullxfull: img.url_fullxfull,
                rank: img.rank,
            }));

            // Send response first so UI opens instantly
            res.status(201).json({
                success: true,
                source_listing_id: parseInt(source_listing_id),
                new_listing_id: newListing.listing_id,
                title: newListing.title,
                state: newListing.state,
                url: newListing.url,
                source_images: sourceImages,
            });

            // Best-effort: copy personalization (images are copied by frontend to avoid Vercel timeout)
            try {
                const sourcePersonalization = await callEtsyAPI(
                    `/listings/${source_listing_id}/personalization?supports_multiple_personalization_questions=true`,
                    accessToken
                );
                if (sourcePersonalization.personalization_questions?.length > 0) {
                    const questionsForCopy = sourcePersonalization.personalization_questions.map((q: any) => {
                        const { question_id, ...rest } = q;
                        return rest;
                    });
                    await callEtsyAPI(
                        `/shops/${shopId}/listings/${newListing.listing_id}/personalization?supports_multiple_personalization_questions=true`,
                        accessToken,
                        { method: 'POST', body: JSON.stringify({ personalization_questions: questionsForCopy }) }
                    );
                }
            } catch {
                // Non-critical
            }
            return;
        }

        // POST /api/clawd/etsy?action=upload_image&listing_id=XXXXX - Upload image to listing
        // Accepts EITHER:
        //   - image_url (string): publicly accessible URL to fetch image from
        //   - image_base64 (string) + image_content_type (string): base64-encoded image data
        // Optional: rank (number), overwrite (bool), is_watermarked (bool), alt_text (string)
        if (req.method === 'POST' && action === 'upload_image' && listing_id) {
            const {
                image_url,
                image_base64,
                image_content_type,
                image_filename,
                rank = 1,
                overwrite = true,
                is_watermarked = false,
                alt_text,
            } = req.body;

            if (!image_url && !image_base64) {
                return res.status(400).json({
                    error: 'Either image_url or image_base64 is required. Provide a publicly accessible image URL or base64-encoded image data.'
                });
            }

            let imageBuffer: ArrayBuffer;
            let contentType: string;

            if (image_base64) {
                // Decode base64 image data
                logger.info('Uploading base64 image to Etsy listing', {
                    listing_id,
                    content_type: image_content_type || 'image/jpeg',
                    rank,
                    has_alt_text: !!alt_text,
                });

                const buffer = Buffer.from(image_base64, 'base64');
                imageBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
                contentType = image_content_type || 'image/jpeg';
            } else {
                // Fetch image from URL (existing flow)
                logger.info('Uploading image to Etsy listing from URL', {
                    listing_id,
                    image_url: image_url.substring(0, 100),
                    rank,
                    has_alt_text: !!alt_text,
                });

                const imageResponse = await fetch(image_url);
                if (!imageResponse.ok) {
                    return res.status(400).json({
                        error: `Failed to fetch image from URL: ${imageResponse.status} ${imageResponse.statusText}`
                    });
                }

                imageBuffer = await imageResponse.arrayBuffer();
                contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
            }

            // Determine file extension from content type
            const extMap: Record<string, string> = {
                'image/jpeg': 'jpg',
                'image/jpg': 'jpg',
                'image/png': 'png',
                'image/gif': 'gif',
                'image/webp': 'webp',
            };
            const ext = extMap[contentType] || 'jpg';
            const filename = image_filename || `listing_${listing_id}_${rank}.${ext}`;

            // Create multipart form data
            const boundary = '----EtsyImageUpload' + Date.now();
            const formDataParts: string[] = [];

            // Add image file part
            formDataParts.push(`--${boundary}`);
            formDataParts.push(`Content-Disposition: form-data; name="image"; filename="${filename}"`);
            formDataParts.push(`Content-Type: ${contentType}`);
            formDataParts.push('');

            // Build the multipart body manually with binary image
            const textEncoder = new TextEncoder();
            const headerPart = formDataParts.join('\r\n') + '\r\n';
            const headerBytes = textEncoder.encode(headerPart);

            // Build footer with additional fields
            let footerPart = '\r\n';
            footerPart += `--${boundary}\r\n`;
            footerPart += `Content-Disposition: form-data; name="rank"\r\n\r\n${rank}\r\n`;
            footerPart += `--${boundary}\r\n`;
            footerPart += `Content-Disposition: form-data; name="overwrite"\r\n\r\n${overwrite}\r\n`;
            footerPart += `--${boundary}\r\n`;
            footerPart += `Content-Disposition: form-data; name="is_watermarked"\r\n\r\n${is_watermarked}\r\n`;
            if (alt_text) {
                footerPart += `--${boundary}\r\n`;
                footerPart += `Content-Disposition: form-data; name="alt_text"\r\n\r\n${alt_text}\r\n`;
            }
            footerPart += `--${boundary}--\r\n`;
            const footerBytes = textEncoder.encode(footerPart);

            // Combine all parts
            const bodyParts = new Uint8Array(headerBytes.length + imageBuffer.byteLength + footerBytes.length);
            bodyParts.set(headerBytes, 0);
            bodyParts.set(new Uint8Array(imageBuffer), headerBytes.length);
            bodyParts.set(footerBytes, headerBytes.length + imageBuffer.byteLength);

            // Upload to Etsy
            const uploadUrl = `${ETSY_API_BASE}/shops/${shopId}/listings/${listing_id}/images`;
            const uploadResponse = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                },
                body: bodyParts,
            });

            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text();
                logger.error('Etsy image upload failed', new Error(errorText), {
                    listing_id,
                    status: uploadResponse.status,
                });
                return res.status(uploadResponse.status).json({
                    error: `Image upload failed: ${uploadResponse.status}`,
                    details: errorText,
                });
            }

            const uploadResult = await uploadResponse.json();

            return res.status(200).json({
                success: true,
                listing_id,
                listing_image_id: uploadResult.listing_image_id,
                rank: uploadResult.rank,
                url_fullxfull: uploadResult.url_fullxfull,
                alt_text: uploadResult.alt_text || alt_text || null,
                message: 'Image uploaded successfully',
            });
        }

        // POST /api/clawd/etsy?action=publish&listing_id=XXXXX - Publish draft listing
        if (req.method === 'POST' && action === 'publish' && listing_id) {
            logger.info('Publishing Etsy listing', { listing_id });

            // First check if listing has at least one image
            try {
                const images = await callEtsyAPI(
                    `/listings/${listing_id}/images`,
                    accessToken
                );

                if (!images.results || images.results.length === 0) {
                    return res.status(400).json({
                        error: 'Cannot publish listing without at least one image',
                        listing_id,
                    });
                }
            } catch (imgError) {
                logger.warn('Could not verify listing images', { listing_id, error: imgError });
            }

            // Activate the listing
            const result = await callEtsyAPI(
                `/listings/${listing_id}`,
                accessToken,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ state: 'active' }),
                }
            );

            return res.status(200).json({
                success: true,
                listing_id: result.listing_id,
                state: result.state,
                title: result.title,
                url: result.url,
                message: 'Listing published successfully',
            });
        }

        // GET /api/clawd/etsy?action=drafts - List draft listings
        if (req.method === 'GET' && action === 'drafts') {
            const limit = parseInt((req.query.limit as string) || '25');
            const offset = parseInt((req.query.offset as string) || '0');

            // Etsy v3 uses findAllListingsByShop with state filter
            const data = await callEtsyAPI(
                `/shops/${shopId}/listings?state=draft&limit=${limit}&offset=${offset}`,
                accessToken
            );

            const drafts = (data.results || []).map((listing: any) => ({
                listing_id: listing.listing_id,
                title: listing.title || '',
                state: listing.state,
                price: listing.price,
                quantity: listing.quantity,
                created_timestamp: listing.created_timestamp,
                updated_timestamp: listing.updated_timestamp,
            }));

            return res.status(200).json({
                count: data.count || drafts.length,
                drafts,
            });
        }

        // GET /api/clawd/etsy?action=get_shipping_profiles - Get shop shipping profiles
        if (req.method === 'GET' && action === 'get_shipping_profiles') {
            const data = await callEtsyAPI(
                `/shops/${shopId}/shipping-profiles`,
                accessToken
            );

            const profiles = (data.results || []).map((profile: any) => ({
                shipping_profile_id: profile.shipping_profile_id,
                title: profile.title || '',
                user_id: profile.user_id,
                min_processing_days: profile.min_processing_days,
                max_processing_days: profile.max_processing_days,
                processing_days_display_label: profile.processing_days_display_label,
                origin_country_iso: profile.origin_country_iso,
                is_deleted: profile.is_deleted || false,
                // Include destination info if available
                shipping_profile_destinations: profile.shipping_profile_destinations || [],
                shipping_profile_upgrades: profile.shipping_profile_upgrades || [],
            }));

            return res.status(200).json({
                count: data.count || profiles.length,
                shipping_profiles: profiles,
            });
        }

        // GET /api/clawd/etsy?action=get_return_policies - Get shop return policies
        if (req.method === 'GET' && action === 'get_return_policies') {
            const data = await callEtsyAPI(
                `/shops/${shopId}/policies/return`,
                accessToken
            );

            const policies = (data.results || []).map((policy: any) => ({
                return_policy_id: policy.return_policy_id,
                accepts_returns: policy.accepts_returns,
                accepts_exchanges: policy.accepts_exchanges,
                return_deadline: policy.return_deadline,
            }));

            return res.status(200).json({
                count: data.count || policies.length,
                return_policies: policies,
            });
        }

        // GET /api/clawd/etsy?action=get_shop_sections - Get shop sections (categories)
        if (req.method === 'GET' && action === 'get_shop_sections') {
            const data = await callEtsyAPI(
                `/shops/${shopId}/sections`,
                accessToken
            );

            const sections = (data.results || []).map((section: any) => ({
                shop_section_id: section.shop_section_id,
                title: section.title || '',
                rank: section.rank,
                active_listing_count: section.active_listing_count,
            }));

            return res.status(200).json({
                count: data.count || sections.length,
                shop_sections: sections,
            });
        }

        // GET /api/clawd/etsy?action=get_readiness_states - Get processing/readiness state definitions
        if (req.method === 'GET' && action === 'get_readiness_states') {
            const data = await callEtsyAPI(
                `/shops/${shopId}/readiness-state-definitions`,
                accessToken
            );

            const states = (data.results || []).map((state: any) => ({
                readiness_state_id: state.readiness_state_id,
                readiness_state: state.readiness_state,
                min_processing_time: state.min_processing_time,
                max_processing_time: state.max_processing_time,
                processing_time_unit: state.processing_time_unit,
            }));

            return res.status(200).json({
                count: data.count || states.length,
                readiness_states: states,
                note: 'Use readiness_state_id when creating listings. readiness_state values: ready_to_ship, made_to_order',
            });
        }

        // POST /api/clawd/etsy?action=create_readiness_state - Create a new processing profile
        if (req.method === 'POST' && action === 'create_readiness_state') {
            const {
                readiness_state,  // "ready_to_ship" or "made_to_order"
                min_processing_time = 1,
                max_processing_time = 3,
                processing_time_unit = 'business_days',  // "business_days" or "weeks"
            } = req.body;

            if (!readiness_state) {
                return res.status(400).json({
                    error: 'readiness_state is required ("ready_to_ship" or "made_to_order")'
                });
            }

            if (!['ready_to_ship', 'made_to_order'].includes(readiness_state)) {
                return res.status(400).json({
                    error: 'readiness_state must be "ready_to_ship" or "made_to_order"'
                });
            }

            logger.info('Creating Etsy readiness state definition', {
                shopId,
                readiness_state,
                min_processing_time,
                max_processing_time,
            });

            const result = await callEtsyAPI(
                `/shops/${shopId}/readiness-state-definitions`,
                accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        readiness_state,
                        min_processing_time,
                        max_processing_time,
                        processing_time_unit,
                    }),
                }
            );

            return res.status(201).json({
                success: true,
                readiness_state_id: result.readiness_state_id,
                readiness_state: result.readiness_state,
                min_processing_time: result.min_processing_time,
                max_processing_time: result.max_processing_time,
                processing_time_unit: result.processing_time_unit,
                message: 'Processing profile created. Use this readiness_state_id when creating listings.',
            });
        }

        // GET /api/clawd/etsy?action=get_listing_videos - Get videos for a listing
        if (req.method === 'GET' && action === 'get_listing_videos' && listing_id) {
            const videos = await callEtsyAPI(
                `/listings/${listing_id}/videos`,
                accessToken
            );

            return res.status(200).json({
                count: videos.count || 0,
                videos: (videos.results || []).map((v: any) => ({
                    video_id: v.video_id,
                    video_url: v.video_url,
                    thumbnail_url: v.thumbnail_url,
                    height: v.height,
                    width: v.width,
                    video_state: v.video_state,
                })),
            });
        }

        // POST /api/clawd/etsy?action=upload_video&listing_id=XXX - Upload video to listing
        if (req.method === 'POST' && action === 'upload_video' && listing_id) {
            const { video_url, video_id, name } = req.body;

            // Option 1: Link existing video by ID
            if (video_id) {
                logger.info('Linking existing video to listing', { listing_id, video_id });

                const uploadUrl = `${ETSY_API_BASE}/shops/${shopId}/listings/${listing_id}/videos`;
                const response = await fetch(uploadUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({ video_id: String(video_id) }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    return res.status(response.status).json({
                        error: `Video link failed: ${response.status}`,
                        details: errorText,
                    });
                }

                const result = await response.json();
                return res.status(200).json({
                    success: true,
                    listing_id,
                    video_id: result.video_id,
                    message: 'Video linked to listing successfully',
                });
            }

            // Option 2: Upload video from URL
            if (!video_url) {
                return res.status(400).json({
                    error: 'Either video_url or video_id is required',
                    usage: {
                        video_url: 'URL to fetch and upload video (MP4, MOV, max 100MB, 5-60 seconds)',
                        video_id: 'Existing Etsy video ID to link to listing',
                    },
                });
            }

            logger.info('Uploading video to Etsy listing', {
                listing_id,
                video_url: video_url.substring(0, 100),
            });

            // Fetch the video from URL
            const videoResponse = await fetch(video_url);
            if (!videoResponse.ok) {
                return res.status(400).json({
                    error: `Failed to fetch video from URL: ${videoResponse.status} ${videoResponse.statusText}`
                });
            }

            const videoBuffer = await videoResponse.arrayBuffer();
            const contentType = videoResponse.headers.get('content-type') || 'video/mp4';

            // Check file size (max 100MB)
            if (videoBuffer.byteLength > 100 * 1024 * 1024) {
                return res.status(400).json({
                    error: 'Video file too large. Maximum size is 100MB.',
                    size: `${(videoBuffer.byteLength / 1024 / 1024).toFixed(2)}MB`,
                });
            }

            // Determine file extension
            const extMap: Record<string, string> = {
                'video/mp4': 'mp4',
                'video/quicktime': 'mov',
                'video/x-msvideo': 'avi',
                'video/mpeg': 'mpeg',
                'video/x-flv': 'flv',
            };
            const ext = extMap[contentType] || 'mp4';
            const filename = name || `listing_${listing_id}_video.${ext}`;

            // Create multipart form data for video upload
            const boundary = '----EtsyVideoUpload' + Date.now();
            const videoName = name || `Video for listing ${listing_id}`;

            // Build multipart body with name field and video file
            const textEncoder = new TextEncoder();

            // Part 1: name field (required by Etsy)
            let namePart = `--${boundary}\r\n`;
            namePart += `Content-Disposition: form-data; name="name"\r\n\r\n`;
            namePart += `${videoName}\r\n`;
            const nameBytes = textEncoder.encode(namePart);

            // Part 2: video file
            let videoPart = `--${boundary}\r\n`;
            videoPart += `Content-Disposition: form-data; name="video"; filename="${filename}"\r\n`;
            videoPart += `Content-Type: ${contentType}\r\n\r\n`;
            const videoHeaderBytes = textEncoder.encode(videoPart);

            const footerPart = `\r\n--${boundary}--\r\n`;
            const footerBytes = textEncoder.encode(footerPart);

            // Combine all parts
            const totalLength = nameBytes.length + videoHeaderBytes.length + videoBuffer.byteLength + footerBytes.length;
            const bodyParts = new Uint8Array(totalLength);
            let offset = 0;
            bodyParts.set(nameBytes, offset); offset += nameBytes.length;
            bodyParts.set(videoHeaderBytes, offset); offset += videoHeaderBytes.length;
            bodyParts.set(new Uint8Array(videoBuffer), offset); offset += videoBuffer.byteLength;
            bodyParts.set(footerBytes, offset);

            // Upload to Etsy
            const uploadUrl = `${ETSY_API_BASE}/shops/${shopId}/listings/${listing_id}/videos`;
            const uploadResponse = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                },
                body: bodyParts,
            });

            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text();
                logger.error('Etsy video upload failed', new Error(errorText), {
                    listing_id,
                    status: uploadResponse.status,
                });
                return res.status(uploadResponse.status).json({
                    error: `Video upload failed: ${uploadResponse.status}`,
                    details: errorText,
                });
            }

            const uploadResult = await uploadResponse.json();

            return res.status(200).json({
                success: true,
                listing_id,
                video_id: uploadResult.video_id,
                video_state: uploadResult.video_state,
                message: 'Video uploaded successfully. Etsy will process and strip audio automatically.',
            });
        }

        // GET /api/clawd/etsy?action=conversations - List shop conversations
        if (req.method === 'GET' && action === 'conversations') {
            const limit = parseInt((req.query.limit as string) || '25');
            const offset = parseInt((req.query.offset as string) || '0');

            const data = await callEtsyAPI(
                `/shops/${shopId}/conversations?limit=${limit}&offset=${offset}`,
                accessToken
            );

            const conversations = (data.results || []).map((conv: any) => ({
                conversation_id: conv.conversation_id,
                subject: conv.subject,
                last_message_time: conv.last_message_time,
                created_timestamp: conv.created_timestamp,
                update_timestamp: conv.update_timestamp,
                buyer_user_id: conv.buyer_user_id,
                seller_user_id: conv.seller_user_id,
                message_count: conv.message_count,
                unread: conv.unread,
                has_attachments: conv.has_attachments,
            }));

            return res.status(200).json({
                count: data.count || conversations.length,
                conversations,
            });
        }

        // GET /api/clawd/etsy?action=conversation&conversation_id=XXX - Get conversation details
        const conversation_id = req.query.conversation_id as string;
        if (req.method === 'GET' && action === 'conversation' && conversation_id) {
            const data = await callEtsyAPI(
                `/shops/${shopId}/conversations/${conversation_id}`,
                accessToken
            );

            // Format messages if included
            const messages = (data.messages || []).map((msg: any) => ({
                message_id: msg.message_id,
                sender_user_id: msg.sender_user_id,
                message: msg.message,
                created_timestamp: msg.created_timestamp,
            }));

            return res.status(200).json({
                conversation_id: data.conversation_id,
                subject: data.subject,
                buyer_user_id: data.buyer_user_id,
                seller_user_id: data.seller_user_id,
                created_timestamp: data.created_timestamp,
                update_timestamp: data.update_timestamp,
                message_count: data.message_count,
                unread: data.unread,
                messages,
            });
        }

        // POST /api/clawd/etsy?action=send_message&conversation_id=XXX - Send message in conversation
        if (req.method === 'POST' && action === 'send_message' && conversation_id) {
            const { message } = req.body;

            if (!message) {
                return res.status(400).json({ error: 'message is required' });
            }

            logger.info('Sending Etsy message', {
                shopId,
                conversation_id,
                message_length: message.length,
            });

            const result = await callEtsyAPI(
                `/shops/${shopId}/conversations/${conversation_id}/messages`,
                accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify({ message }),
                }
            );

            return res.status(200).json({
                success: true,
                conversation_id,
                message_id: result.message_id,
                message: 'Message sent successfully',
            });
        }

        // GET /api/clawd/etsy?action=get_listing_inventory&listing_id=XXXXX - Get listing inventory
        if (req.method === 'GET' && action === 'get_listing_inventory' && listing_id) {
            logger.info('Fetching inventory for listing', { listing_id });

            const data = await callEtsyAPI(
                `/listings/${listing_id}/inventory`,
                accessToken
            );

            return res.status(200).json({
                listing_id: parseInt(listing_id),
                products: data.products || [],
                listing_offering_id: data.listing_offering_id,
            });
        }

        // PUT /api/clawd/etsy?action=update_listing_inventory&listing_id=XXXXX - Update listing inventory
        if (req.method === 'PUT' && action === 'update_listing_inventory' && listing_id) {
            const { products } = req.body;

            if (!products || !Array.isArray(products)) {
                return res.status(400).json({
                    error: 'products array is required',
                });
            }

            logger.info('Updating inventory for listing', {
                listing_id,
                product_count: products.length,
            });

            const result = await callEtsyAPI(
                `/listings/${listing_id}/inventory`,
                accessToken,
                {
                    method: 'PUT',
                    body: JSON.stringify({ products }),
                }
            );

            return res.status(200).json({
                success: true,
                listing_id: parseInt(listing_id),
                products: result.products || [],
                message: 'Listing inventory updated',
            });
        }

        // DELETE /api/clawd/etsy?action=delete_listing&listing_id=XXXXX
        if (req.method === 'DELETE' && action === 'delete_listing' && listing_id) {
            logger.info('Deleting Etsy listing', { listing_id, shopId });
            await callEtsyAPI(
                `/shops/${shopId}/listings/${listing_id}`,
                accessToken,
                { method: 'DELETE' }
            );
            return res.status(200).json({ success: true, listing_id, message: 'Listing deleted' });
        }

        // DELETE /api/clawd/etsy?action=delete_image&listing_id=XXXXX&image_id=YYYYY
        if (req.method === 'DELETE' && action === 'delete_image' && listing_id && image_id) {
            logger.info('Deleting image from listing', { listing_id, image_id, shopId });
            await callEtsyAPI(
                `/shops/${shopId}/listings/${listing_id}/images/${image_id}`,
                accessToken,
                { method: 'DELETE' }
            );
            return res.status(200).json({ success: true, listing_id, image_id, message: 'Image deleted' });
        }

        // DELETE /api/clawd/etsy?action=delete_video&listing_id=XXXXX&video_id=YYYYY
        if (req.method === 'DELETE' && action === 'delete_video' && listing_id && video_id) {
            logger.info('Deleting video from listing', { listing_id, video_id, shopId });
            await callEtsyAPI(
                `/shops/${shopId}/listings/${listing_id}/videos/${video_id}`,
                accessToken,
                { method: 'DELETE' }
            );
            return res.status(200).json({ success: true, listing_id, video_id, message: 'Video deleted' });
        }

        // GET /api/clawd/etsy?action=all_listings&state=active|draft|inactive|expired
        if (req.method === 'GET' && action === 'all_listings') {
            const limit = parseInt((req.query.limit as string) || '100');
            const offset = parseInt((req.query.offset as string) || '0');
            const state = (req.query.state as string) || 'active';

            const endpoint = `/shops/${shopId}/listings?state=${state}&limit=${limit}&offset=${offset}`;

            const data = await callEtsyAPI(endpoint, accessToken);

            const listings = (data.results || []).map((listing: any) => ({
                listing_id: listing.listing_id,
                title: listing.title || '',
                description: listing.description || '',
                tags: listing.tags || [],
                materials: listing.materials || [],
                price: listing.price ? {
                    amount: listing.price.amount,
                    divisor: listing.price.divisor,
                    currency_code: listing.price.currency_code,
                } : null,
                views: listing.views || 0,
                num_favorers: listing.num_favorers || 0,
                quantity: listing.quantity || 0,
                state: listing.state || '',
                url: listing.url || '',
                taxonomy_id: listing.taxonomy_id,
                shop_section_id: listing.shop_section_id,
                who_made: listing.who_made,
                when_made: listing.when_made,
                is_supply: listing.is_supply,
                created_timestamp: listing.created_timestamp,
                updated_timestamp: listing.updated_timestamp,
                original_creation_timestamp: listing.original_creation_timestamp,
            }));

            return res.status(200).json({
                count: data.count || listings.length,
                listings,
            });
        }

        // GET /api/clawd/etsy?action=listings_with_images
        if (req.method === 'GET' && action === 'listings_with_images') {
            const limit = parseInt((req.query.limit as string) || '100');
            const offset = parseInt((req.query.offset as string) || '0');
            const state = (req.query.state as string) || 'active';

            // Use /listings?state= (not /listings/active) because only the former supports includes=images
            const endpoint = `/shops/${shopId}/listings?state=${state}&limit=${limit}&offset=${offset}&includes=images`;

            const data = await callEtsyAPI(endpoint, accessToken);

            const listings = (data.results || []).map((listing: any) => {
                const firstImage = listing.images && listing.images.length > 0 ? listing.images[0] : null;
                return {
                    listing_id: listing.listing_id,
                    title: listing.title || '',
                    description: listing.description || '',
                    tags: listing.tags || [],
                    materials: listing.materials || [],
                    price: listing.price ? {
                        amount: listing.price.amount,
                        divisor: listing.price.divisor,
                        currency_code: listing.price.currency_code,
                    } : null,
                    views: listing.views || 0,
                    num_favorers: listing.num_favorers || 0,
                    quantity: listing.quantity || 0,
                    state: listing.state || '',
                    url: listing.url || '',
                    taxonomy_id: listing.taxonomy_id,
                    shop_section_id: listing.shop_section_id,
                    who_made: listing.who_made,
                    when_made: listing.when_made,
                    is_supply: listing.is_supply,
                    created_timestamp: listing.created_timestamp,
                    updated_timestamp: listing.updated_timestamp,
                    thumbnail: firstImage ? {
                        listing_image_id: firstImage.listing_image_id,
                        url_75x75: firstImage.url_75x75,
                        url_170x135: firstImage.url_170x135,
                        url_570xN: firstImage.url_570xN,
                    } : null,
                    image_count: listing.images ? listing.images.length : 0,
                };
            });

            res.setHeader('Cache-Control', 'private, max-age=300');
            return res.status(200).json({
                count: data.count || listings.length,
                listings,
            });
        }

        // POST /api/clawd/etsy?action=create_shop_section
        if (req.method === 'POST' && action === 'create_shop_section') {
            const { title } = req.body;
            if (!title) return res.status(400).json({ error: 'title is required' });
            const result = await callEtsyAPI(
                `/shops/${shopId}/sections`,
                accessToken,
                { method: 'POST', body: JSON.stringify({ title }) }
            );
            return res.status(201).json({ success: true, section: result });
        }

        // PUT /api/clawd/etsy?action=update_shop_section&section_id=XXXXX
        if (req.method === 'PUT' && action === 'update_shop_section' && section_id) {
            const { title } = req.body;
            if (!title) return res.status(400).json({ error: 'title is required' });
            const result = await callEtsyAPI(
                `/shops/${shopId}/sections/${section_id}`,
                accessToken,
                { method: 'PUT', body: JSON.stringify({ title }) }
            );
            return res.status(200).json({ success: true, section: result });
        }

        // DELETE /api/clawd/etsy?action=delete_shop_section&section_id=XXXXX
        if (req.method === 'DELETE' && action === 'delete_shop_section' && section_id) {
            await callEtsyAPI(
                `/shops/${shopId}/sections/${section_id}`,
                accessToken,
                { method: 'DELETE' }
            );
            return res.status(200).json({ success: true, section_id, message: 'Section deleted' });
        }

        // GET /api/clawd/etsy?action=taxonomy
        if (req.method === 'GET' && action === 'taxonomy') {
            const data = await callEtsyAPI('/seller-taxonomy/nodes', accessToken);
            return res.status(200).json({
                count: data.count || (data.results || []).length,
                categories: data.results || [],
            });
        }

        // GET /api/clawd/etsy?action=get_listing_images&listing_id=xxx
        if (req.method === 'GET' && action === 'get_listing_images' && listing_id) {
            const data = await callEtsyAPI(
                `/listings/${listing_id}/images`,
                accessToken
            );
            return res.status(200).json({
                count: data.count || (data.results || []).length,
                images: (data.results || []).map((img: any) => ({
                    listing_image_id: img.listing_image_id,
                    listing_id: img.listing_id,
                    url_75x75: img.url_75x75,
                    url_170x135: img.url_170x135,
                    url_570xN: img.url_570xN,
                    url_fullxfull: img.url_fullxfull,
                    rank: img.rank,
                    alt_text: img.alt_text || '',
                })),
            });
        }

        // PATCH /api/clawd/etsy?action=update_listing_image&listing_id=xxx&image_id=xxx
        if (req.method === 'PATCH' && action === 'update_listing_image' && listing_id && image_id) {
            const { alt_text, rank } = req.body || {};
            const updateBody: Record<string, any> = {};
            if (alt_text !== undefined) updateBody.alt_text = alt_text;
            if (rank !== undefined) updateBody.rank = rank;

            const data = await callEtsyAPI(
                `/shops/${shopId}/listings/${listing_id}/images/${image_id}`,
                accessToken,
                {
                    method: 'PATCH',
                    body: JSON.stringify(updateBody),
                    headers: { 'Content-Type': 'application/json' },
                }
            );
            return res.status(200).json({ success: true, image: data });
        }

        // POST /api/clawd/etsy?action=renew_listing&listing_id=xxx
        if (req.method === 'POST' && action === 'renew_listing' && listing_id) {
            const data = await callEtsyAPI(
                `/shops/${shopId}/listings/${listing_id}`,
                accessToken,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ state: 'active' }),
                    headers: { 'Content-Type': 'application/json' },
                }
            );
            return res.status(200).json({ success: true, listing: data });
        }

        // --- Shipping Profile CRUD ---

        // POST /api/clawd/etsy?action=create_shipping_profile
        if (req.method === 'POST' && action === 'create_shipping_profile') {
            const { title, origin_country_iso, primary_cost, secondary_cost, min_processing_days, max_processing_days, destination_country_iso, mail_class } = req.body || {};
            const payload: Record<string, any> = {
                title, origin_country_iso, primary_cost, secondary_cost,
                min_processing_days, max_processing_days,
            };
            if (destination_country_iso) payload.destination_country_iso = destination_country_iso;
            if (mail_class) payload.mail_class = mail_class;

            const data = await callEtsyAPI(
                `/shops/${shopId}/shipping-profiles`,
                accessToken,
                { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }
            );
            return res.status(200).json({ success: true, shipping_profile: data });
        }

        // PATCH /api/clawd/etsy?action=update_shipping_profile&shipping_profile_id=xxx
        if (req.method === 'PATCH' && action === 'update_shipping_profile') {
            const spId = req.query.shipping_profile_id as string;
            if (!spId) return res.status(400).json({ error: 'shipping_profile_id is required' });

            const { title, min_processing_days, max_processing_days, primary_cost, secondary_cost } = req.body || {};
            const payload: Record<string, any> = {};
            if (title !== undefined) payload.title = title;
            if (min_processing_days !== undefined) payload.min_processing_days = min_processing_days;
            if (max_processing_days !== undefined) payload.max_processing_days = max_processing_days;
            if (primary_cost !== undefined) payload.primary_cost = primary_cost;
            if (secondary_cost !== undefined) payload.secondary_cost = secondary_cost;

            const data = await callEtsyAPI(
                `/shops/${shopId}/shipping-profiles/${spId}`,
                accessToken,
                { method: 'PUT', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }
            );
            return res.status(200).json({ success: true, shipping_profile: data });
        }

        // DELETE /api/clawd/etsy?action=delete_shipping_profile&shipping_profile_id=xxx
        if (req.method === 'DELETE' && action === 'delete_shipping_profile') {
            const spId = req.query.shipping_profile_id as string;
            if (!spId) return res.status(400).json({ error: 'shipping_profile_id is required' });

            await callEtsyAPI(
                `/shops/${shopId}/shipping-profiles/${spId}`,
                accessToken,
                { method: 'DELETE' }
            );
            return res.status(200).json({ success: true });
        }

        // --- Return Policy CRUD ---

        // POST /api/clawd/etsy?action=create_return_policy
        if (req.method === 'POST' && action === 'create_return_policy') {
            const { accepts_returns, accepts_exchanges, return_deadline } = req.body || {};
            const payload: Record<string, any> = { accepts_returns, accepts_exchanges };
            if (return_deadline !== undefined) payload.return_deadline = return_deadline;

            const data = await callEtsyAPI(
                `/shops/${shopId}/policies/return`,
                accessToken,
                { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }
            );
            return res.status(200).json({ success: true, return_policy: data });
        }

        // PUT /api/clawd/etsy?action=update_return_policy&return_policy_id=xxx
        if (req.method === 'PUT' && action === 'update_return_policy') {
            const rpId = req.query.return_policy_id as string;
            if (!rpId) return res.status(400).json({ error: 'return_policy_id is required' });

            const { accepts_returns, accepts_exchanges, return_deadline } = req.body || {};
            const payload: Record<string, any> = {};
            if (accepts_returns !== undefined) payload.accepts_returns = accepts_returns;
            if (accepts_exchanges !== undefined) payload.accepts_exchanges = accepts_exchanges;
            if (return_deadline !== undefined) payload.return_deadline = return_deadline;

            const data = await callEtsyAPI(
                `/shops/${shopId}/policies/return/${rpId}`,
                accessToken,
                { method: 'PUT', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }
            );
            return res.status(200).json({ success: true, return_policy: data });
        }

        // DELETE /api/clawd/etsy?action=delete_return_policy&return_policy_id=xxx
        if (req.method === 'DELETE' && action === 'delete_return_policy') {
            const rpId = req.query.return_policy_id as string;
            if (!rpId) return res.status(400).json({ error: 'return_policy_id is required' });

            await callEtsyAPI(
                `/shops/${shopId}/policies/return/${rpId}`,
                accessToken,
                { method: 'DELETE' }
            );
            return res.status(200).json({ success: true });
        }

        // ===================================================================
        // Keyword Rank Tracking
        // ===================================================================

        // GET /api/clawd/etsy?action=check_keyword_rank&keyword=X&listing_id=Y
        if (req.method === 'GET' && action === 'check_keyword_rank') {
            const keyword = req.query.keyword as string;
            const listingId = req.query.listing_id as string;
            if (!keyword || !listingId) {
                return res.status(400).json({ error: 'keyword and listing_id are required' });
            }

            let rank: number | null = null;
            let page: number | null = null;
            let totalResults = 0;
            const maxPages = 5; // Check up to 500 results

            for (let p = 0; p < maxPages; p++) {
                const params = new URLSearchParams({
                    keywords: keyword,
                    limit: '100',
                    offset: String(p * 100),
                    sort_on: 'score',
                    sort_order: 'desc',
                });

                const data = p === 0
                    ? await callEtsyPublicAPI(`/listings/active?${params}`)
                    : await rateLimitedPublicCall(`/listings/active?${params}`);

                if (p === 0) totalResults = data.count || 0;
                const results: any[] = data.results || [];

                const idx = results.findIndex((r: any) => String(r.listing_id) === String(listingId));
                if (idx !== -1) {
                    rank = p * 100 + idx + 1;
                    page = p + 1;
                    break;
                }

                // Stop if we've exhausted results
                if (results.length < 100) break;
            }

            return res.status(200).json({ rank, page, totalResults });
        }

        // POST /api/clawd/etsy?action=add_tracked_keyword
        if (req.method === 'POST' && action === 'add_tracked_keyword') {
            const { keyword, listing_id, listing_title } = req.body;
            if (!keyword || !listing_id) {
                return res.status(400).json({ error: 'keyword and listing_id are required' });
            }

            // Get userId from shop
            const shop = await prisma.etsyShop.findFirst({ where: { shopId, isActive: true }, select: { userId: true } });
            if (!shop) return res.status(404).json({ error: 'Shop not found' });
            const userId = shop.userId;

            // Upsert the tracked keyword
            const tracked = await prisma.rankTrackedKeyword.upsert({
                where: {
                    userId_etsyListingId_keyword: {
                        userId,
                        etsyListingId: String(listing_id),
                        keyword: keyword.toLowerCase().trim(),
                    },
                },
                update: { isActive: true, listingTitle: listing_title || '' },
                create: {
                    userId,
                    etsyShopId: shopId,
                    etsyListingId: String(listing_id),
                    listingTitle: listing_title || '',
                    keyword: keyword.toLowerCase().trim(),
                },
            });

            // Immediately check rank
            let rank: number | null = null;
            let page: number | null = null;
            let totalResults = 0;

            try {
                for (let p = 0; p < 5; p++) {
                    const params = new URLSearchParams({
                        keywords: keyword,
                        limit: '100',
                        offset: String(p * 100),
                        sort_on: 'score',
                        sort_order: 'desc',
                    });
                    const data = p === 0
                        ? await callEtsyPublicAPI(`/listings/active?${params}`)
                        : await rateLimitedPublicCall(`/listings/active?${params}`);
                    if (p === 0) totalResults = data.count || 0;
                    const results: any[] = data.results || [];
                    const idx = results.findIndex((r: any) => String(r.listing_id) === String(listing_id));
                    if (idx !== -1) {
                        rank = p * 100 + idx + 1;
                        page = p + 1;
                        break;
                    }
                    if (results.length < 100) break;
                }

                await prisma.rankSnapshot.create({
                    data: {
                        keywordId: tracked.id,
                        rank,
                        page,
                        totalResults,
                    },
                });
            } catch (rankErr: any) {
                logger.error('Rank check failed on add:', rankErr);
            }

            return res.status(200).json({ tracked, rank, page, totalResults });
        }

        // POST /api/clawd/etsy?action=auto_track_listing_tags
        // Bulk-register listing tags as tracked keywords (no immediate rank check — cron handles it)
        if (req.method === 'POST' && action === 'auto_track_listing_tags') {
            const { listing_id, listing_title, tags } = req.body;
            if (!listing_id || !Array.isArray(tags) || tags.length === 0) {
                return res.status(400).json({ error: 'listing_id and tags[] are required' });
            }

            const shop = await prisma.etsyShop.findFirst({ where: { shopId, isActive: true }, select: { userId: true } });
            if (!shop) return res.status(404).json({ error: 'Shop not found' });
            const userId = shop.userId;

            // Bulk upsert all tags — skip rank check to avoid rate limits
            let added = 0;
            for (const tag of tags.slice(0, 13)) {
                const kw = tag.toLowerCase().trim();
                if (!kw || kw.length < 2) continue;
                try {
                    await prisma.rankTrackedKeyword.upsert({
                        where: {
                            userId_etsyListingId_keyword: {
                                userId,
                                etsyListingId: String(listing_id),
                                keyword: kw,
                            },
                        },
                        update: { isActive: true, listingTitle: listing_title || '' },
                        create: {
                            userId,
                            etsyShopId: shopId,
                            etsyListingId: String(listing_id),
                            listingTitle: listing_title || '',
                            keyword: kw,
                        },
                    });
                    added++;
                } catch {
                    // Skip duplicates or errors
                }
            }

            return res.status(200).json({ added, total: tags.length });
        }

        // DELETE /api/clawd/etsy?action=remove_tracked_keyword&keyword_id=X
        if (req.method === 'DELETE' && action === 'remove_tracked_keyword') {
            const keywordId = req.query.keyword_id as string;
            if (!keywordId) return res.status(400).json({ error: 'keyword_id is required' });

            await prisma.rankTrackedKeyword.update({
                where: { id: keywordId },
                data: { isActive: false },
            });
            return res.status(200).json({ success: true });
        }

        // GET /api/clawd/etsy?action=get_tracked_keywords
        if (req.method === 'GET' && action === 'get_tracked_keywords') {
            const shop = await prisma.etsyShop.findFirst({ where: { shopId, isActive: true }, select: { userId: true } });
            if (!shop) return res.status(404).json({ error: 'Shop not found' });
            const userId = shop.userId;
            // Optional: filter by listing_id
            const listingIdFilter = req.query.listing_id as string | undefined;
            const where: any = { userId, isActive: true };
            if (listingIdFilter) where.etsyListingId = String(listingIdFilter);

            const keywords = await prisma.rankTrackedKeyword.findMany({
                where,
                include: {
                    snapshots: {
                        orderBy: { checkedAt: 'asc' },
                        // Get first + last snapshots for "since added" change
                    },
                },
                orderBy: { createdAt: 'desc' },
            });

            const result = keywords.map((kw) => {
                const first = kw.snapshots[0] || null; // oldest (first tracked)
                const latest = kw.snapshots[kw.snapshots.length - 1] || null;
                // Change since first tracked: positive = improved (rank went down = better)
                const change = latest?.rank != null && first?.rank != null && kw.snapshots.length > 1
                    ? first.rank - latest.rank
                    : null;
                return {
                    id: kw.id,
                    keyword: kw.keyword,
                    etsyListingId: kw.etsyListingId,
                    listingTitle: kw.listingTitle,
                    rank: latest?.rank ?? null,
                    page: latest?.page ?? null,
                    totalResults: latest?.totalResults ?? 0,
                    change,
                    checkedAt: latest?.checkedAt ?? null,
                    firstCheckedAt: first?.checkedAt ?? null,
                    snapshotCount: kw.snapshots.length,
                };
            });

            return res.status(200).json({ keywords: result });
        }

        // GET /api/clawd/etsy?action=get_rank_history&keyword_id=X
        if (req.method === 'GET' && action === 'get_rank_history') {
            const keywordId = req.query.keyword_id as string;
            if (!keywordId) return res.status(400).json({ error: 'keyword_id is required' });

            const snapshots = await prisma.rankSnapshot.findMany({
                where: { keywordId },
                orderBy: { checkedAt: 'asc' },
                take: 60, // ~30 days at 2x/day
            });

            return res.status(200).json({ snapshots });
        }

        // POST /api/clawd/etsy?action=analyze_keyword_ranking
        // Fetches top competitors for a keyword, compares with user's listing, returns AI recommendations
        if (req.method === 'POST' && action === 'analyze_keyword_ranking') {
            const { keyword, listing_id } = req.body;
            if (!keyword || !listing_id) {
                return res.status(400).json({ error: 'keyword and listing_id are required' });
            }

            // 1. Fetch user's listing details
            const userListing = await callEtsyAPI(`/listings/${listing_id}?includes=Images`, accessToken);

            // 2. Fetch top 48 competitors for this keyword (first page of Etsy search)
            const searchParams = new URLSearchParams({
                keywords: keyword,
                limit: '48',
                offset: '0',
                sort_on: 'score',
                sort_order: 'desc',
            });
            const searchData = await callEtsyPublicAPI(`/listings/active?${searchParams}`);
            const competitors = (searchData.results || []).map((c: any) => ({
                listing_id: c.listing_id,
                title: c.title,
                tags: c.tags || [],
                views: c.views || 0,
                favorites: c.num_favorers || 0,
                price: c.price ? (c.price.amount / (c.price.divisor || 100)) : 0,
                quantity: c.quantity || 0,
                shop_id: c.shop_id,
            }));

            // 3. Find user's rank in these results
            const userIdx = competitors.findIndex((c: any) => String(c.listing_id) === String(listing_id));
            const userRank = userIdx >= 0 ? userIdx + 1 : null;

            // 4. Extract market patterns from top competitors
            const top10 = competitors.slice(0, 10);
            const allTags = competitors.flatMap((c: any) => c.tags);
            const tagCounts: Record<string, number> = {};
            allTags.forEach((t: string) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
            const topTags = Object.entries(tagCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([tag, count]) => ({ tag, pct: Math.round(count / competitors.length * 100) }));

            const allTitleWords = competitors.flatMap((c: any) =>
                c.title.toLowerCase().split(/[\s,]+/).filter((w: string) => w.length > 3)
            );
            const wordCounts: Record<string, number> = {};
            allTitleWords.forEach((w: string) => { wordCounts[w] = (wordCounts[w] || 0) + 1; });
            const topKeywords = Object.entries(wordCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 15)
                .map(([word, count]) => ({ keyword: word, pct: Math.round(count / competitors.length * 100) }));

            const avgViews = Math.round(top10.reduce((s: number, c: any) => s + c.views, 0) / (top10.length || 1));
            const avgFavorites = Math.round(top10.reduce((s: number, c: any) => s + c.favorites, 0) / (top10.length || 1));
            const avgPrice = +(top10.reduce((s: number, c: any) => s + c.price, 0) / (top10.length || 1)).toFixed(2);

            // 5. Build user listing summary
            const userPrice = userListing.price ? (userListing.price.amount / (userListing.price.divisor || 100)) : 0;
            const userViews = userListing.views || 0;
            const userFavorites = userListing.num_favorers || 0;
            const favoriteRate = userViews > 0 ? ((userFavorites / userViews) * 100).toFixed(1) : '0';

            // 6. Find missing keywords — in top competitor titles/tags but NOT in user's listing
            const userTitleWords = new Set((userListing.title || '').toLowerCase().split(/[\s,]+/).filter((w: string) => w.length > 3));
            const userTags = new Set((userListing.tags || []).map((t: string) => t.toLowerCase()));
            const missingKeywords = topKeywords.filter(k => !userTitleWords.has(k.keyword) && !userTags.has(k.keyword));
            const missingTags = topTags.filter(t => !userTags.has(t.tag.toLowerCase()) && !userTitleWords.has(t.tag.toLowerCase()));

            // 7. Call Gemini AI for analysis
            const { GoogleGenerativeAI } = await import('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
                generationConfig: { responseMimeType: 'application/json' } as any,
            });

            const aiPrompt = `You are an Etsy search ranking expert. Analyze why this listing ranks #${userRank ?? '500+'} for "${keyword}" and give SPECIFIC, ACTIONABLE steps to reach page 1 (top 48).

YOUR LISTING:
- Title: ${userListing.title}
- Tags: ${(userListing.tags || []).join(', ')}
- Price: $${userPrice}
- Views: ${userViews} | Favorites: ${userFavorites} | Favorite rate: ${favoriteRate}%
- Description length: ${(userListing.description || '').length} chars
- Images: ${userListing.images?.length || 0}

TOP 10 COMPETITORS (page 1 for "${keyword}"):
${top10.map((c: any, i: number) => `#${i + 1}: "${c.title}" | $${c.price} | ${c.views} views | ${c.favorites} favs`).join('\n')}

MARKET DATA:
- Avg views (top 10): ${avgViews} | Avg favorites (top 10): ${avgFavorites}
- Avg price (top 10): $${avgPrice}
- Total results: ${searchData.count || 0}
- Top tags: ${topTags.slice(0, 10).map(t => `${t.tag} (${t.pct}%)`).join(', ')}
- Top title keywords: ${topKeywords.slice(0, 10).map(k => `${k.keyword} (${k.pct}%)`).join(', ')}

MISSING FROM YOUR LISTING:
- Keywords in top titles you're missing: ${missingKeywords.slice(0, 8).map(k => k.keyword).join(', ') || 'None'}
- Tags used by competitors you're missing: ${missingTags.slice(0, 8).map(t => t.tag).join(', ') || 'None'}

ETSY RANKING FACTORS (2026):
1. Keyword relevance (title + tags match to search query)
2. Listing quality score (CTR from search → conversion)
3. Recency (recently updated/renewed listings get a boost)
4. Shop score (reviews, response time, star seller status)
5. Price competitiveness vs market
6. Engagement rate (favorites/views ratio, typically 2-5% for good listings)
7. Complete listings (all 13 tags, 10 images, detailed description)

Analyze each factor comparing this listing to competitors. Be SPECIFIC — reference actual competitor titles, keywords, and numbers.

Return JSON in Turkish (but keep all keywords/tags/titles in English):
{
  "overall_score": 0-100,
  "current_rank": ${userRank ?? 'null'},
  "estimated_page1_difficulty": "Kolay" | "Orta" | "Zor",
  "factors": [
    {
      "name": "factor name in Turkish",
      "score": 0-10,
      "status": "iyi" | "orta" | "zayif",
      "finding": "specific finding in Turkish — reference real data/numbers",
      "action": "specific action to take in Turkish, with English keywords where relevant"
    }
  ],
  "priority_actions": [
    "Top 3 highest-impact actions in Turkish, ordered by importance. Be very specific."
  ],
  "missing_keywords": ["keyword1", "keyword2"],
  "suggested_title": "Optimized title suggestion using research data, in English, Title Case, commas only"
}`;

            const aiResult = await model.generateContent(aiPrompt);
            const aiText = aiResult.response.text();
            const analysis = JSON.parse(aiText);

            return res.status(200).json({
                analysis,
                market: {
                    totalResults: searchData.count || 0,
                    userRank,
                    avgViews,
                    avgFavorites,
                    avgPrice,
                    topTags: topTags.slice(0, 10),
                    topKeywords: topKeywords.slice(0, 10),
                    missingKeywords: missingKeywords.slice(0, 8).map(k => k.keyword),
                    missingTags: missingTags.slice(0, 8).map(t => t.tag),
                },
            });
        }

        // Invalid request
        return res.status(400).json({ error: 'Invalid request parameters' });

    } catch (error: any) {
        logger.error('Clawd Etsy API Error:', error);
        return res.status(500).json({
            error: error.message || 'Internal server error',
            details: error.stack,
        });
    }
}

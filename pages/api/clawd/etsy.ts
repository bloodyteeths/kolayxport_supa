import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';

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

    // Update the token in database
    await prisma.etsyShop.updateMany({
        where: { shopId },
        data: {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
        },
    });

    return data.access_token;
}

async function getEtsyAccessToken(shopId: string): Promise<string> {
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

    if (!etsyShop) {
        throw new Error('Etsy shop not found or not connected');
    }

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

async function callEtsyAPI(endpoint: string, accessToken: string, options: RequestInit = {}) {
    const url = `${ETSY_API_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-api-key': process.env.ETSY_API_KEY || '',
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

    return response.json();
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    // 1. Authenticate with API Key
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const envApiKey = process.env.CLAWD_API_KEY;

    if (!envApiKey) {
        logger.error('CLAWD_API_KEY is not defined in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: API Key not set.' });
    }

    if (!apiKey || apiKey !== envApiKey) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
    }

    // Get shop ID from query parameter (default to user's shop)
    const shopId = (req.query.shop_id as string) || '54844618';

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

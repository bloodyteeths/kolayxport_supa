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
                item_dimensions_unit: listing.item_dimensions_unit,
                created_timestamp: listing.created_timestamp,
                updated_timestamp: listing.updated_timestamp,
            });
        }

        // PATCH /api/clawd/etsy?action=update_listing&listing_id=XXXXX - Update listing SEO
        if ((req.method === 'PATCH' || req.method === 'PUT') && action === 'update_listing' && listing_id) {
            const { title, description, tags } = req.body;

            // Build update payload with only provided fields
            const updatePayload: Record<string, any> = {};
            if (title !== undefined) updatePayload.title = title;
            if (description !== undefined) updatePayload.description = description;
            if (tags !== undefined) updatePayload.tags = tags;

            if (Object.keys(updatePayload).length === 0) {
                return res.status(400).json({
                    error: 'At least one field (title, description, or tags) is required'
                });
            }

            logger.info('Updating Etsy listing', {
                listing_id,
                fields: Object.keys(updatePayload),
            });

            const result = await callEtsyAPI(
                `/listings/${listing_id}`,
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
                listing: {
                    listing_id: result.listing_id,
                    title: result.title,
                    description: result.description,
                    tags: result.tags,
                },
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
            if (tags && tags.length > 0) listingPayload.tags = tags.slice(0, 13); // Etsy max 13 tags
            if (materials && materials.length > 0) listingPayload.materials = materials.slice(0, 13);
            if (shipping_profile_id) listingPayload.shipping_profile_id = shipping_profile_id;
            if (return_policy_id) listingPayload.return_policy_id = return_policy_id;
            if (shop_section_id) listingPayload.shop_section_id = shop_section_id;
            if (processing_min) listingPayload.processing_min = processing_min;
            if (processing_max) listingPayload.processing_max = processing_max;

            logger.info('Creating draft Etsy listing', {
                shopId,
                title: title.substring(0, 50),
                taxonomy_id,
            });

            const result = await callEtsyAPI(
                `/shops/${shopId}/listings`,
                accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify(listingPayload),
                }
            );

            return res.status(201).json({
                success: true,
                listing_id: result.listing_id,
                state: result.state,
                title: result.title,
                url: result.url,
                message: 'Draft listing created. Add images then publish when ready.',
            });
        }

        // POST /api/clawd/etsy?action=upload_image&listing_id=XXXXX - Upload image to listing
        if (req.method === 'POST' && action === 'upload_image' && listing_id) {
            const { image_url, rank = 1, overwrite = true, is_watermarked = false, alt_text } = req.body;

            if (!image_url) {
                return res.status(400).json({
                    error: 'image_url is required. Provide a publicly accessible image URL.'
                });
            }

            logger.info('Uploading image to Etsy listing', {
                listing_id,
                image_url: image_url.substring(0, 100),
                rank,
            });

            // Fetch the image from URL
            const imageResponse = await fetch(image_url);
            if (!imageResponse.ok) {
                return res.status(400).json({
                    error: `Failed to fetch image from URL: ${imageResponse.status} ${imageResponse.statusText}`
                });
            }

            const imageBuffer = await imageResponse.arrayBuffer();
            const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

            // Determine file extension from content type
            const extMap: Record<string, string> = {
                'image/jpeg': 'jpg',
                'image/jpg': 'jpg',
                'image/png': 'png',
                'image/gif': 'gif',
                'image/webp': 'webp',
            };
            const ext = extMap[contentType] || 'jpg';
            const filename = `listing_${listing_id}_${rank}.${ext}`;

            // Create multipart form data
            const boundary = '----EtsyImageUpload' + Date.now();
            const formDataParts: string[] = [];

            // Add image file part
            formDataParts.push(`--${boundary}`);
            formDataParts.push(`Content-Disposition: form-data; name="image"; filename="${filename}"`);
            formDataParts.push(`Content-Type: ${contentType}`);
            formDataParts.push('');

            // Add other fields
            const addField = (name: string, value: string | number | boolean) => {
                formDataParts.push(`--${boundary}`);
                formDataParts.push(`Content-Disposition: form-data; name="${name}"`);
                formDataParts.push('');
                formDataParts.push(String(value));
            };

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
                    'x-api-key': process.env.ETSY_API_KEY || '',
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

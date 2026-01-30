import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    // 1. Method support: GET
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    // 2. Authentication: API Key
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const envApiKey = process.env.CLAWD_API_KEY;

    if (!envApiKey) {
        console.error('CLAWD_API_KEY is not defined in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: API Key not set.' });
    }

    if (!apiKey || apiKey !== envApiKey) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
    }

    try {
        // 3. fetch orders
        const { id, status, limit, userId } = req.query;

        const where: any = {};

        // Optional: Filter by specific Order ID
        if (id) {
            where.id = String(id);
        }

        // Optional: Filter by Status (e.g. pending, shipped)
        if (status) {
            where.status = String(status);
        }

        // Optional: Filter by UserId if the bot needs to scope to a specific user
        // (If not provided, it might fetch ALL orders from ALL users, which might be intended for an admin bot,
        // or strictly forbidden depending on privacy. Assuming admin access for now.)
        if (userId) {
            where.userId = String(userId);
        }

        const take = limit ? parseInt(String(limit)) : 50;

        const orders = await prisma.order.findMany({
            where,
            take,
            orderBy: { createdAt: 'desc' },
            include: {
                items: true, // Include order items
                shipping: true, // Include shipping details
            }
        });

        res.status(200).json(orders);

    } catch (error: any) {
        console.error('Clawd API Error:', error);
        res.status(500).json({ error: error.message });
    }
}

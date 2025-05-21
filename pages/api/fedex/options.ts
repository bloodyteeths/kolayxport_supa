import type { NextApiRequest, NextApiResponse } from 'next';
import { fedexOptionsData } from '../../../lib/fedex/fedex.config';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  return res.status(200).json(fedexOptionsData);
} 
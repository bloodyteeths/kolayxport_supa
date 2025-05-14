import type { NextApiRequest, NextApiResponse } from 'next';
import { FedExOptions, fedexOptionsData } from '../../../lib/fedexConfig'; // Import from shared config

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<FedExOptions | { error: string }>
) {
  if (req.method === 'GET') {
    res.status(200).json(fedexOptionsData);
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
} 
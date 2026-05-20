import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../prisma';
import { getAuthUser } from '../auth';

type AdminHandler = (
  req: NextApiRequest,
  res: NextApiResponse,
  adminUser: { id: string; email: string; name: string }
) => Promise<void>;

export function withAdmin(handler: AdminHandler) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const authUser = await getAuthUser(req, res);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { role: true },
    });

    if (user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return handler(req, res, authUser);
  };
}

import prisma from '../prisma';
import { decryptIfNeeded } from '@/lib/crypto/credentials';
import type { MngCredentials } from './mng.types';

/**
 * Loads MNG/DHL eCommerce credentials for a user.
 * - appId/appSecret: platform-level from env vars (KolayXport's app)
 * - customerNumber/password: per-user from DB
 * - environment: per-user from DB (default: 'test')
 */
export async function getMngCredentialsForUser(userId: string): Promise<MngCredentials> {
  const appId = process.env.MNG_APP_ID;
  const appSecret = process.env.MNG_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error('MNG_APP_ID ve MNG_APP_SECRET ortam değişkenleri gereklidir.');
  }

  const creds = await prisma.credential.findUnique({
    where: { userId },
    select: {
      mngCustomerNumber: true,
      mngPassword: true,
      mngApiEnvironment: true,
    },
  });

  const plainPassword = decryptIfNeeded(creds?.mngPassword) as string | null;
  if (!creds?.mngCustomerNumber || !plainPassword) {
    throw new Error('DHL eCommerce müşteri numarası ve şifre ayarlardan girilmelidir.');
  }

  return {
    appId,
    appSecret,
    customerNumber: creds.mngCustomerNumber,
    customerPassword: plainPassword,
    environment: (creds.mngApiEnvironment as 'test' | 'production') || 'test',
  };
}

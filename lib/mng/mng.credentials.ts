import prisma from '../prisma';
import type { MngCredentials } from './mng.types';

/**
 * Loads MNG/DHL eCommerce credentials for a user.
 * - appId/appSecret come from env vars (platform-level, KolayXport's app)
 * - customerNumber/password come from the user's Credential table (per-merchant)
 */
export async function getMngCredentialsForUser(userId: string): Promise<MngCredentials & { customerNumber: string; customerPassword: string }> {
  const appId = process.env.MNG_APP_ID;
  const appSecret = process.env.MNG_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error('MNG_APP_ID and MNG_APP_SECRET environment variables are required.');
  }

  const creds = await prisma.credential.findUnique({
    where: { userId },
    select: {
      mngCustomerNumber: true,
      mngPassword: true,
    },
  });

  if (!creds || !creds.mngCustomerNumber || !creds.mngPassword) {
    throw new Error('DHL eCommerce müşteri numarası ve şifre ayarlardan girilmelidir.');
  }

  return {
    appId,
    appSecret,
    customerNumber: creds.mngCustomerNumber,
    customerPassword: creds.mngPassword,
  };
}

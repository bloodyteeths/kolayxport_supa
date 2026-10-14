import prisma from '../prisma';
import { decryptIfNeeded } from '@/lib/crypto/credentials';
import type { MngCredentials } from './mng.types';

/** Sandbox only when MNG_API_ENVIRONMENT=test is set server-side. */
function resolveMngEnvironment(): 'test' | 'production' {
  return process.env.MNG_API_ENVIRONMENT?.trim().toLowerCase() === 'test' ? 'test' : 'production';
}

/**
 * Loads MNG/DHL eCommerce credentials for a user.
 * - appId/appSecret: platform-level from env vars (KolayXport's app)
 * - customerNumber/password: per-user from DB
 * - environment: MNG_API_ENVIRONMENT env override, otherwise 'production'.
 *   The per-user mngApiEnvironment column is ignored: it defaults to 'test' in
 *   the schema and the settings form used to write 'test' with no way to change
 *   it, so honouring it sent real merchants to the DHL eCommerce sandbox.
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
    },
  });

  // Both are in lib/encryption.ts CREDENTIAL_FIELDS, so both are encrypted on save.
  const plainCustomerNumber = decryptIfNeeded(creds?.mngCustomerNumber) as string | null;
  const plainPassword = decryptIfNeeded(creds?.mngPassword) as string | null;
  if (!plainCustomerNumber || !plainPassword) {
    throw new Error('DHL eCommerce müşteri numarası ve şifre ayarlardan girilmelidir.');
  }

  return {
    appId,
    appSecret,
    customerNumber: plainCustomerNumber,
    customerPassword: plainPassword,
    environment: resolveMngEnvironment(),
  };
}

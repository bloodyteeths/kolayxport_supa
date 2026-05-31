import prisma from '../prisma';
import { decryptIfNeeded } from '@/lib/crypto/credentials';

export interface UpsCredentials {
  upsApiKey: string;
  upsApiSecret: string;
  upsAccountNumber: string;
}

/**
 * Loads UPS credentials for a user from the Credential table.
 * Throws if any required field is missing.
 *
 * Stored values may be plaintext (older rows), legacy base64 envelope (via the older
 * lib/encryption.ts user-settings flow), or the new `enc:v1:` envelope. `decryptIfNeeded`
 * handles all three transparently.
 */
export async function getUpsCredentialsForUser(userId: string): Promise<UpsCredentials> {
  const creds = await prisma.credential.findUnique({
    where: { userId },
    select: {
      upsApiKey: true,
      upsApiSecret: true,
      upsAccountNumber: true,
    },
  });
  const apiKey = decryptIfNeeded(creds?.upsApiKey) as string | null;
  const apiSecret = decryptIfNeeded(creds?.upsApiSecret) as string | null;
  const accountNumber = creds?.upsAccountNumber ?? null;
  if (!apiKey || !apiSecret || !accountNumber) {
    throw new Error('Missing UPS credentials for user. Please ensure upsApiKey, upsApiSecret, and upsAccountNumber are set.');
  }
  return {
    upsApiKey: apiKey,
    upsApiSecret: apiSecret,
    upsAccountNumber: accountNumber,
  };
}

import prisma from '../prisma';

export interface UpsCredentials {
  upsApiKey: string;
  upsApiSecret: string;
  upsAccountNumber: string;
}

/**
 * Loads UPS credentials for a user from the Credential table.
 * Throws if any required field is missing.
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
  if (!creds || !creds.upsApiKey || !creds.upsApiSecret || !creds.upsAccountNumber) {
    throw new Error('Missing UPS credentials for user. Please ensure upsApiKey, upsApiSecret, and upsAccountNumber are set.');
  }
  return {
    upsApiKey: creds.upsApiKey,
    upsApiSecret: creds.upsApiSecret,
    upsAccountNumber: creds.upsAccountNumber,
  };
} 
import prisma from '../prisma';
import type { MngCredentials } from './mng.types';

/**
 * Loads MNG Kargo credentials for a user from the Credential table.
 * Throws if required fields are missing.
 */
export async function getMngCredentialsForUser(userId: string): Promise<MngCredentials> {
  const creds = await prisma.credential.findUnique({
    where: { userId },
    select: {
      mngCustomerNumber: true,
      mngPassword: true,
      mngAppId: true,
      mngAppSecret: true,
      mngApiEnvironment: true,
    },
  });

  if (!creds || !creds.mngCustomerNumber || !creds.mngPassword) {
    throw new Error('Missing MNG Kargo credentials. Please configure customerNumber and password in settings.');
  }

  return {
    customerNumber: creds.mngCustomerNumber,
    password: creds.mngPassword,
    appId: creds.mngAppId || undefined,
    appSecret: creds.mngAppSecret || undefined,
    environment: (creds.mngApiEnvironment === 'production' ? 'production' : 'test') as MngCredentials['environment'],
  };
}

// FedEx sandbox for designated test accounts (e.g. the Shopify App Store review account), so reviewers can
// create real-looking test labels without a live FedEx account. Server-only; configured entirely in env:
//   FEDEX_SANDBOX_EMAILS      comma-separated account emails that ship through the sandbox
//   FEDEX_SANDBOX_API_KEY / FEDEX_SANDBOX_API_SECRET / FEDEX_SANDBOX_ACCOUNT
//   FEDEX_SANDBOX_BASE_URL    optional, defaults to https://apis-sandbox.fedex.com
// Every other account keeps its own production FedEx credentials.

export interface FedexSandboxCredentials {
  apiKey: string;
  apiSecret: string;
  accountNumber: string;
  baseUrl: string;
}

export function fedexSandboxFor(email: string | null | undefined): FedexSandboxCredentials | null {
  const emails = (process.env.FEDEX_SANDBOX_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const apiKey = process.env.FEDEX_SANDBOX_API_KEY;
  const apiSecret = process.env.FEDEX_SANDBOX_API_SECRET;
  const accountNumber = process.env.FEDEX_SANDBOX_ACCOUNT;
  if (!email || !apiKey || !apiSecret || !accountNumber || !emails.includes(email.trim().toLowerCase())) return null;
  return { apiKey, apiSecret, accountNumber, baseUrl: process.env.FEDEX_SANDBOX_BASE_URL || 'https://apis-sandbox.fedex.com' };
}

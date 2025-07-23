// Known Etsy marketplace patterns - no hardcoded store names for multitenant SaaS
const ETSY_MARKETPLACE_PATTERNS = [
  'etsy',
  'Etsy',
  'ETSY',
  'Etsy Store',
  'etsy store',
  'ETSY STORE'
];

// Cache for detected Etsy marketplaces (runtime only, not persisted)
const RUNTIME_ETSY_MARKETPLACES = new Set(ETSY_MARKETPLACE_PATTERNS);

/**
 * Server-side only: Determines if an order is from Etsy based on multiple criteria including database lookup
 * Note: This function should only be used in API routes or server-side code
 * @param marketplace - The marketplace value from the order
 * @param orderNumber - Optional order number to check for EtsyAddress record
 * @param userId - Optional user ID to check for EtsyAddress record
 * @returns Promise<boolean> - True if the order is determined to be from Etsy
 */
export async function isEtsyOrder(
  marketplace?: string | null,
  orderNumber?: string,
  userId?: string
): Promise<boolean> {
  // Use sync version first (safe for both client and server)
  return isEtsyOrderSync(marketplace);
  
  // Note: Database lookup removed to avoid bundling issues
  // The sync version should handle most cases with the known marketplaces list
}

/**
 * Synchronous version that only checks marketplace patterns
 * Use this when you can't perform async database checks
 * @param marketplace - The marketplace value from the order
 * @returns boolean - True if marketplace patterns suggest Etsy
 */
export function isEtsyOrderSync(marketplace?: string | null): boolean {
  if (!marketplace) return false;

  const marketplaceLower = marketplace.toLowerCase();

  // Rule 1: Direct marketplace match for "etsy"
  if (marketplaceLower === 'etsy') {
    return true;
  }

  // Rule 2: Marketplace contains "etsy" substring (case-insensitive)
  if (marketplaceLower.includes('etsy')) {
    return true;
  }

  // Rule 3: Marketplace is in our runtime cache
  if (RUNTIME_ETSY_MARKETPLACES.has(marketplace)) {
    return true;
  }

  return false;
}

/**
 * Adds a marketplace value to the runtime Etsy marketplaces cache
 * @param marketplace - The marketplace value to add
 */
export function addKnownEtsyMarketplace(marketplace: string): void {
  RUNTIME_ETSY_MARKETPLACES.add(marketplace);
}

/**
 * Gets all currently known Etsy marketplace values
 * @returns string[] - Array of known Etsy marketplace values
 */
export function getKnownEtsyMarketplaces(): string[] {
  return Array.from(RUNTIME_ETSY_MARKETPLACES);
}
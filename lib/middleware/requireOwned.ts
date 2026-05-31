import prisma from '@/lib/prisma';

/**
 * Tenant-owned Prisma models. Each maps to a row that carries a userId column
 * (either directly or through a single, well-defined relation such as Shipment -> Order).
 *
 * Use requireOwned() instead of an ad-hoc findFirst() so future dynamic [id] routes
 * inherit the same NOT-FOUND-on-mismatch behaviour and we don't regress multi-tenant isolation.
 */
export type OwnableModel =
  | 'order'
  | 'orderItem'
  | 'orderShipping'
  | 'shipment'
  | 'labelJob'
  | 'product'
  | 'productCost'
  | 'shipperProfile'
  | 'marketplaceConfig'
  | 'credential'
  | 'etsyShop'
  | 'etsyAddress'
  | 'etsyListing'
  | 'etsyListingDraft'
  | 'etsyDraftMedia'
  | 'etsyDraftSyncAttempt'
  | 'ebayListing'
  | 'ebayListingDraft'
  | 'ebayTrackedProduct'
  | 'ebayTrackedSeller'
  | 'ebayNicheResearch'
  | 'wixSite'
  | 'wixProduct'
  | 'shopifyShop'
  | 'shopifyProduct'
  | 'amazonTrackedProduct'
  | 'amazonPriceSnapshot'
  | 'amazonNicheResearch'
  | 'trendyolProduct'
  | 'financialTransaction'
  | 'financialSyncCursor'
  | 'arbitrageScanJob'
  | 'arbitrageResultRecord'
  | 'rankTrackedKeyword'
  | 'senkronOrderData'
  | 'trackingSubmission'
  | 'syncOperation'
  | 'syncLog';

export class OwnershipError extends Error {
  readonly status: 404 | 401 | 400;
  constructor(status: 404 | 401 | 400, message: string) {
    super(message);
    this.name = 'OwnershipError';
    this.status = status;
  }
}

interface RequireOwnedOptions<TInclude> {
  /**
   * Optional Prisma `select` or `include` clause forwarded to findFirst.
   * Provide only what the handler actually needs; less data = smaller blast radius.
   */
  select?: Record<string, any>;
  include?: TInclude;
}

/**
 * Verify that the row with `id` exists and belongs to `userId`.
 * Returns the row (typed `any` because the model union is broad).
 * Throws OwnershipError(404) if the row is missing or owned by a different user.
 *
 * The error is deliberately 404, not 403, so we don't reveal whether the id exists
 * to an attacker probing other tenants' resources.
 */
export async function requireOwned<TInclude = unknown>(
  model: OwnableModel,
  id: string,
  userId: string,
  options: RequireOwnedOptions<TInclude> = {},
): Promise<any> {
  if (!id || typeof id !== 'string') {
    throw new OwnershipError(400, 'id is required');
  }
  if (!userId || typeof userId !== 'string') {
    throw new OwnershipError(401, 'authentication required');
  }

  const delegate = (prisma as any)[model];
  if (!delegate || typeof delegate.findFirst !== 'function') {
    throw new OwnershipError(400, `Unknown ownable model: ${model}`);
  }

  // Shipment has no direct userId — join through Order.
  if (model === 'shipment') {
    const findArgs: any = {
      where: { id, order: { userId } },
    };
    if (options.select) findArgs.select = options.select;
    if (options.include) findArgs.include = options.include;
    const row = await delegate.findFirst(findArgs);
    if (!row) throw new OwnershipError(404, 'Not found');
    return row;
  }

  // OrderItem / OrderShipping have no direct userId — join through Order.
  if (model === 'orderItem' || model === 'orderShipping') {
    const findArgs: any = {
      where: { id, order: { userId } },
    };
    if (options.select) findArgs.select = options.select;
    if (options.include) findArgs.include = options.include;
    const row = await delegate.findFirst(findArgs);
    if (!row) throw new OwnershipError(404, 'Not found');
    return row;
  }

  // LabelJob has no direct userId — join through OrderItem -> Order.
  if (model === 'labelJob') {
    const findArgs: any = {
      where: { id, orderItem: { order: { userId } } },
    };
    if (options.select) findArgs.select = options.select;
    if (options.include) findArgs.include = options.include;
    const row = await delegate.findFirst(findArgs);
    if (!row) throw new OwnershipError(404, 'Not found');
    return row;
  }

  // Default: model has a direct userId column.
  const findArgs: any = { where: { id, userId } };
  if (options.select) findArgs.select = options.select;
  if (options.include) findArgs.include = options.include;
  const row = await delegate.findFirst(findArgs);
  if (!row) throw new OwnershipError(404, 'Not found');
  return row;
}

/**
 * Convenience wrapper for handlers: catches OwnershipError and writes the response.
 * Use as: `if (await sendOwnershipError(res, err)) return;`
 */
export function sendOwnershipError(res: { status: (code: number) => any }, err: unknown): boolean {
  if (err instanceof OwnershipError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

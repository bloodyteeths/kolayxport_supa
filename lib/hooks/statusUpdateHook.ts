/**
 * RETIRED (no-op). This hook used to auto-set SenkronOrderData.customStatus
 * ("shipped" / "cancelled") from the cargo status for the removed
 * "Production list" page (/app/senkron). Nothing reads that status anymore,
 * so both functions now do nothing and write nothing. Existing DB rows are
 * left untouched.
 *
 * Remaining importers (lib/orderSync.ts, lib/etsy/webhooks/processor.ts) still
 * call batchExecuteStatusUpdateHook; once those calls are removed this file
 * can be deleted.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function executeStatusUpdateHook(_orderId: string, _userId: string): Promise<void> {
  // Intentionally empty: hook retired.
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function batchExecuteStatusUpdateHook(_orderIds: string[], _userId: string): Promise<void> {
  // Intentionally empty: hook retired.
}

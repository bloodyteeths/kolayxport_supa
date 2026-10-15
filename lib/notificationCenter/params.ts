/**
 * ICU params each notification type's title needs (owner W5). ISOMORPHIC.
 *
 * Shared by the server renderer (email) and the client renderer (bell, page):
 * when a required param is missing the generic `notifications.fallback` line
 * is shown instead of a sentence with a hole in it (next-intl does not throw
 * on a missing ICU argument, it returns the key path).
 *
 * Emitters (W2–W4) must send at least these params; see
 * docs/integration/parts/W5-notifications.md for the full contract.
 */
export const REQUIRED_NOTIFICATION_PARAMS: Record<string, string[]> = {
  // existing
  draftSyncFailed: ['title'],
  draftConflict: ['title'],
  reauthRequired: ['provider'],
  orderSyncFailed: ['provider'],
  usageNearLimit: ['kind', 'used', 'limit'],
  usageLimitReached: ['kind'],
  // event-driven rebuild
  orderNew: ['orderNumber'],
  orderCanceled: ['orderNumber'],
  orderCanceledAfterLabel: ['orderNumber'],
  orderShippedExternal: ['orderNumber'],
  dispatchOverdue: ['count'],
  dispatchDueToday: ['count'],
  dispatchDueTomorrow: ['count'],
  listingDeactivated: ['title'],
  listingExpired: ['title'],
  listingDeleted: ['title'],
  listingChangedExternally: ['title'],
  stockOutOfStock: ['sku'],
  stockPushFailed: ['sku', 'channel'],
  stockDrift: ['count'],
  stockUnmatchedSale: ['count'],
  seoExperimentReady: ['title'],
  scheduledSendResult: ['marketplace', 'sent'],
  webhookBacklog: [],
};

/** Type name from a titleKey such as 'types.orderNew' (falls back to `type`). */
export function typeFromTitleKey(titleKey: string, type?: string | null): string {
  return titleKey.startsWith('types.') ? titleKey.slice(6) : type || '';
}

export function hasRequiredParams(typeName: string, params: Record<string, unknown> | null | undefined): boolean {
  const req = REQUIRED_NOTIFICATION_PARAMS[typeName];
  if (!req || req.length === 0) return true;
  const p = params || {};
  return req.every((k) => p[k] !== undefined && p[k] !== null && p[k] !== '');
}

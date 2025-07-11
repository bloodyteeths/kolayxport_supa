const labelCache: Record<string, string> = {};

export function saveUpsLabelToCache(orderId: string, base64: string) {
  labelCache[orderId] = base64;
  setTimeout(() => delete labelCache[orderId], 10 * 60 * 1000); // 10 min TTL
}

export function getUpsLabelFromCache(orderId: string): string | undefined {
  return labelCache[orderId];
} 
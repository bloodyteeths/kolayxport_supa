/** Thrown on HTTP 402; the global limit interceptor has already shown LimitReachedDialog. */
export class UsageLimitError extends Error {
  status = 402;
  constructor() {
    super('Usage limit reached');
    this.name = 'UsageLimitError';
  }
}

/**
 * fetch for metered endpoints. 402 (usage limit) is surfaced by
 * lib/http/limitInterceptor, so callers get a UsageLimitError (status 402)
 * and should not show their own error toast for it (notify.error skips 402s).
 */
export async function fetchWithLimit(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, init);
  if (res.status === 402) throw new UsageLimitError();
  return res;
}

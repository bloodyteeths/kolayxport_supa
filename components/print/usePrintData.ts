import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import { PRINT_MAX_IDS, type PrintDataResponse } from './types';

export type PrintDataState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'noIds' }
  | { status: 'tooMany' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; data: PrintDataResponse };

/** Read `?ids=a,b,c` into a stable comma-joined key (dedupes, keeps order). */
function idsKeyFromQuery(raw: string | string[] | undefined): string {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const ids = list.flatMap(v => v.split(',')).map(v => v.trim()).filter(Boolean);
  return Array.from(new Set(ids)).join(',');
}

/**
 * Loads print data for the order ids in the URL. Ownership is enforced by
 * /api/orders/print-data; this hook only handles auth/loading/error states.
 */
export function usePrintData(): { state: PrintDataState; retry: () => void } {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth() as { user: unknown; isLoading: boolean };
  // Boolean, not the session object: next-auth hands back a new object on
  // every focus refetch, which would re-fetch the print data each time.
  const signedIn = !!user;
  const idsKey = router.isReady ? idsKeyFromQuery(router.query.ids) : '';
  const [state, setState] = useState<PrintDataState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!router.isReady || authLoading) {
      setState({ status: 'loading' });
      return;
    }
    if (!signedIn) {
      setState({ status: 'unauthenticated' });
      return;
    }
    if (!idsKey) {
      setState({ status: 'noIds' });
      return;
    }
    if (idsKey.split(',').length > PRINT_MAX_IDS) {
      setState({ status: 'tooMany' });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch(`/api/orders/print-data?ids=${encodeURIComponent(idsKey)}`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async res => {
        if (res.status === 401) {
          setState({ status: 'unauthenticated' });
          return;
        }
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || !Array.isArray(body.orders)) {
          const err: any = new Error((body && typeof body.error === 'string' && body.error) || `HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        setState({ status: 'ready', data: body as PrintDataResponse });
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', error: err });
      });
    return () => controller.abort();
  }, [router.isReady, authLoading, signedIn, idsKey, attempt]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);
  return { state, retry };
}

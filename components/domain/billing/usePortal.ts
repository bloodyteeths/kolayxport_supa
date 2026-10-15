// components/domain/billing/usePortal.ts — opens the Stripe customer portal on the exact screen (settings
// §2.3 A2: body `{ flow }`). 403 → "Billing is managed elsewhere for this account."; any other failure →
// "Couldn't open Stripe. Try again." Never raw server text (§9.7). No optimistic UI: the page re-reads the
// entitlement when the user comes back (SWR revalidateOnFocus).
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ds/feedback';
import type { PortalFlow } from '@/lib/billing/types';

export const PORTAL_ENDPOINT = '/api/stripe/create-portal-session';

export type PortalResult = { ok: true; url: string } | { ok: false; reason: 'managedElsewhere' | 'failed' };

/** Pure-ish request (fetch injected in tests). */
export async function requestPortal(flow: PortalFlow | null, fetchImpl: typeof fetch = fetch): Promise<PortalResult> {
  try {
    const res = await fetchImpl(PORTAL_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flow ? { flow } : {}),
    });
    if (res.status === 403) return { ok: false, reason: 'managedElsewhere' };
    if (!res.ok) return { ok: false, reason: 'failed' };
    const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
    return typeof body?.url === 'string' && body.url ? { ok: true, url: body.url } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export function usePortal(): { open: (flow: PortalFlow | null, key?: string) => Promise<void>; pending: string | null } {
  const t = useTranslations('billing');
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const open = useCallback(
    async (flow: PortalFlow | null, key?: string) => {
      const id = key ?? flow ?? 'portal';
      setPending(id);
      const result = await requestPortal(flow);
      if (result.ok) {
        window.location.assign(result.url);
        return; // keep the button in its loading state while the browser leaves
      }
      setPending(null);
      if (result.reason === 'managedElsewhere') toast.error(t('toast.managedElsewhere'), { persist: false });
      else toast.error(t('toast.portalFailed'), { action: { onClick: () => { void open(flow, key); } } });
    },
    [t, toast],
  );

  return { open, pending };
}

// /faturalar — flag `settings` (lib/ds/uiFlags.ts): invoices live in Settings › Plan & billing
// (settings §1.1), so the route only redirects to `/ayarlar?tab=billing&invoices=all` (replace, no history
// entry; a shopify_free account lands on Billing without an invoices card). Flag off: the legacy page,
// moved unchanged to components/legacy/settings/FaturalarLegacy.tsx (deleted one release after the flip).
// The redirect is client-side because the flag has a client `?ui=` override (a server 302 could not see it).
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import FaturalarLegacy from '@/components/legacy/settings/FaturalarLegacy';
import { useUiFlag } from '@/lib/ds/uiFlags';

export const INVOICES_REDIRECT = '/ayarlar?tab=billing&invoices=all';

function InvoicesRedirect() {
  const router = useRouter();
  useEffect(() => {
    void router.replace(INVOICES_REDIRECT);
  }, [router]);
  return null;
}

export default function FaturalarPage() {
  const v2 = useUiFlag('settings');
  return v2 ? <InvoicesRedirect /> : <FaturalarLegacy />;
}

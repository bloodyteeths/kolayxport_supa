// /faturalar — invoices live in Settings › Plan & billing (settings §1.1), so the route only redirects to
// `/ayarlar?tab=billing&invoices=all` (replace, no history entry; a shopify_free account lands on Billing
// without an invoices card).
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export const INVOICES_REDIRECT = '/ayarlar?tab=billing&invoices=all';

export default function FaturalarPage() {
  const router = useRouter();
  useEffect(() => {
    void router.replace(INVOICES_REDIRECT);
  }, [router]);
  return null;
}

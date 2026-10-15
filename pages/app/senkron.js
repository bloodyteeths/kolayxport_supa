import { useEffect } from 'react';
import { useRouter } from 'next/router';

/**
 * The old "Production list" page was removed; its per-order private note now
 * lives on the labels page order cards. Kept as a redirect so old bookmarks work.
 */
export default function SenkronRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/app/labels');
  }, [router]);
  return null;
}

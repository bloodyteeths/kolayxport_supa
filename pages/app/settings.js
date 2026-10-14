import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function SettingsRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const tab = typeof router.query.tab === 'string' ? `?tab=${encodeURIComponent(router.query.tab)}` : '';
    router.replace(`/ayarlar${tab}`);
  }, [router]);

  return null;
} 
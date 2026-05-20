import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Dashboard() {
  const router = useRouter();
  useEffect(() => {
    const sessionId = router.query.session_id;
    if (sessionId) {
      router.replace(`/app?session_id=${sessionId}`);
    } else {
      router.replace('/app');
    }
  }, [router]);
  return null;
}

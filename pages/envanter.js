import { useEffect } from 'react';
import { useRouter } from 'next/router';
export default function Envanter() {
  const router = useRouter();
  useEffect(() => { router.replace('/app/etsy-listings'); }, [router]);
  return null;
}

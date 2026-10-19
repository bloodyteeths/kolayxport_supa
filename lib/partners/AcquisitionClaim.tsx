// lib/partners/AcquisitionClaim.tsx — once a session exists, POST /api/user/acquisition/claim one time per browser
// (localStorage 'kx-acq-claimed'), with the localStorage first touch as a fallback to the HttpOnly cookies.
// docs/gtm/referral-spec.md §2.3. Renders nothing.
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { readAttribution } from '@/lib/tracking/events';

const FLAG = 'kx-acq-claimed';

export function AcquisitionClaim() {
  const { status } = useSession();
  useEffect(() => {
    if (status !== 'authenticated') return;
    try {
      if (localStorage.getItem(FLAG)) return;
    } catch {
      return;
    }
    let alive = true;
    fetch('/api/user/acquisition/claim', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attribution: readAttribution() }),
    })
      .then((r) => {
        if (alive && r.ok) {
          try { localStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [status]);
  return null;
}

export default AcquisitionClaim;

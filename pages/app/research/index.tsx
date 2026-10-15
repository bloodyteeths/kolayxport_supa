// /app/research — Research Home (research.md §4). Flag `research` (lib/ds/uiFlags.ts): the hub, or the legacy
// research page for the requested marketplace while the flag is off (ResearchRouteGate).
import { useRouter } from 'next/router';
import withAuth from '@/components/withAuth';
import { ResearchRouteGate } from '@/components/domain/research/ResearchLayout';
import { ResearchHome } from '@/components/domain/research/home/ResearchHome';

const ResearchHomeWithAuth = withAuth(ResearchHome);

export default function ResearchHomeRoute() {
  const router = useRouter();
  return (
    <ResearchRouteGate mkt={router.query.mkt}>
      <ResearchHomeWithAuth />
    </ResearchRouteGate>
  );
}

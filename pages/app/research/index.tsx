// /app/research — Research Home (research.md §4). The hub is the only research UI (the `research` flag is retired;
// the old research routes redirect here, lib/research/legacyRoutes.ts).
import withAuth from '@/components/withAuth';
import { ResearchHome } from '@/components/domain/research/home/ResearchHome';

export default withAuth(ResearchHome);

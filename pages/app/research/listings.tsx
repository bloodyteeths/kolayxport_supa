// /app/research/listings — Listing doctor (research.md §7, R1-D): ResearchLayout + ListingDoctor.
import withAuth from '@/components/withAuth';
import { ResearchLayout, useResearchMkt } from '@/components/domain/research/ResearchLayout';
import { ListingDoctor } from '@/components/domain/research/listings/ListingDoctor';

function ListingDoctorPage() {
  const market = useResearchMkt('listings');
  return (
    <ResearchLayout tab="listings" market={market}>
      <ListingDoctor mkt={market.mkt} onMktChange={market.setMkt} />
    </ResearchLayout>
  );
}

export default withAuth(ListingDoctorPage);

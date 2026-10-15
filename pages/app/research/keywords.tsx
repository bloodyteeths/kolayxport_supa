// /app/research/keywords — Keyword explorer (research.md §6, R2-B): ResearchLayout + KeywordExplorer.
import withAuth from '@/components/withAuth';
import { KeywordExplorer } from '@/components/domain/research/keywords/KeywordExplorer';

function KeywordExplorerPage() {
  return <KeywordExplorer variant="page" />;
}

export default withAuth(KeywordExplorerPage);

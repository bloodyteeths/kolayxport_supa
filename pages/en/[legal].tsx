import DocPage from '@/components/site/DocPage';
import { docPaths, docProps } from '@/lib/site/pageProps';

// Legal texts from content/en/legal/*.md at /en/<slug> (e.g. /kvkk-aydinlatma-metni).
export default DocPage;

export async function getStaticPaths() {
  return docPaths('en', 'legal', 'legal');
}

export async function getStaticProps({ params }: { params: { legal: string } }) {
  return docProps('en', 'legal', params.legal);
}

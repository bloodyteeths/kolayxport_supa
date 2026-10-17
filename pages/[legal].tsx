import DocPage from '@/components/site/DocPage';
import { docPaths, docProps } from '@/lib/site/pageProps';

// Legal texts from content/tr/legal/*.md at /<slug> (e.g. /kvkk-aydinlatma-metni).
export default DocPage;

export async function getStaticPaths() {
  return docPaths('tr', 'legal', 'legal');
}

export async function getStaticProps({ params }: { params: { legal: string } }) {
  return docProps('tr', 'legal', params.legal);
}

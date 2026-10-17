import DocPage from '@/components/site/DocPage';
import { docPaths, docProps } from '@/lib/site/pageProps';

export default DocPage;

export async function getStaticPaths() {
  return docPaths('en', 'guides');
}

export async function getStaticProps({ params }: { params: { slug: string } }) {
  return docProps('en', 'guides', params.slug);
}

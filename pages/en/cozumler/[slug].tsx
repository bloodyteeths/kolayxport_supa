import DocPage from '@/components/site/DocPage';
import { docPaths, docProps } from '@/lib/site/pageProps';

export default DocPage;

export async function getStaticPaths() {
  return docPaths('en', 'cases');
}

export async function getStaticProps({ params }: { params: { slug: string } }) {
  return docProps('en', 'cases', params.slug);
}

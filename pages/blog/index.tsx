import IndexPage from '@/components/site/IndexPage';
import { indexProps } from '@/lib/site/pageProps';

export default IndexPage;

export async function getStaticProps() {
  return indexProps('tr', 'blog');
}

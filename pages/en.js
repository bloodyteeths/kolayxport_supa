import HomePage from '../components/site/HomePage';
import { homeStaticProps } from '../lib/site/homeProps';

export default function HomeEn(props) {
  return <HomePage {...props} />;
}

export async function getStaticProps() {
  return homeStaticProps('en');
}

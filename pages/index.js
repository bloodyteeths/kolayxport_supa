import HomePage from '../components/site/HomePage';
import { homeStaticProps } from '../lib/site/homeProps';

// Turkish home page. English twin: pages/en.js. Copy: messages/*.json → site.home.
export default function Home(props) {
  return <HomePage {...props} />;
}

export async function getStaticProps() {
  return homeStaticProps('tr');
}

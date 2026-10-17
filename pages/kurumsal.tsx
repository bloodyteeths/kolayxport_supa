import { AboutPage } from '@/components/site/CompanyPages';
import { siteMessageProps } from '@/lib/i18n/pageMessages';

export default function Page() {
  return <AboutPage locale="tr" />;
}

export async function getStaticProps() {
  return { props: siteMessageProps('tr') };
}

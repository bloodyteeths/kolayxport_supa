import { ToolsIndexPage } from '@/components/site/tools/ToolPages';
import { siteMessageProps } from '@/lib/i18n/pageMessages';

export default function Page() {
  return <ToolsIndexPage locale="tr" />;
}

export async function getStaticProps() {
  return { props: siteMessageProps('tr') };
}

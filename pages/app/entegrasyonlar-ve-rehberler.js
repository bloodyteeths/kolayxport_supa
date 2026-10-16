// Old integrations/guides page: its content (Veeqo-era setup) is replaced by the current guide.
export async function getServerSideProps() {
  return { redirect: { destination: '/app/nasil-kullanirim', permanent: false } };
}
export default function IntegrationsGuidesRedirect() {
  return null;
}

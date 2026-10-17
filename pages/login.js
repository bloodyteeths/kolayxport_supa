import { useTranslations } from 'next-intl';
import AuthForm from '../components/AuthForm';
import { pickMessages, SITE_NAMESPACES } from '@/lib/i18n/pageMessages';
import PublicLayout from '../components/PublicLayout';

export default function LoginPage() {
  const t = useTranslations('auth');
  return (
    <PublicLayout title={t('title')}>
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <AuthForm />
      </div>
    </PublicLayout>
  );
}

export async function getStaticProps() {
  return { props: { messages: pickMessages('tr', [...SITE_NAMESPACES, ...['auth']]), messagesLocale: 'tr' } };
}

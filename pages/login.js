import { useTranslations } from 'next-intl';
import AuthForm from '../components/AuthForm';
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

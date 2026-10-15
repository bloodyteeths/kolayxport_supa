import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PublicLayout from '@/components/PublicLayout';

export default function ErrorPage({ statusCode }) {
  const t = useTranslations('errors');
  return (
    <PublicLayout title={t('oops')} seo={{ noindex: true }}>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 py-16">
        <h1 className="text-3xl font-semibold text-slate-900 mb-3">{t('oops')}</h1>
        <p className="text-base text-slate-600 mb-6">
          {statusCode ? t('serverError', { statusCode }) : t('clientError')}
        </p>
        <Link href="/" className="text-blue-600 hover:underline">
          {t('goHome')}
        </Link>
      </div>
    </PublicLayout>
  );
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};

import React, { useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import PublicLayout from '@/components/PublicLayout';

export default function Logout() {
  const t = useTranslations('auth');
  useEffect(() => {
    signOut({ callbackUrl: '/' });
  }, []);

  return (
    <PublicLayout title={t('loggingOut')} seo={{ noindex: true }}>
      <div className="flex items-center justify-center min-h-[60vh] px-4 py-16">
        <p className="text-slate-600" role="status">{t('loggingOut')}</p>
      </div>
    </PublicLayout>
  );
}

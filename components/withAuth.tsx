import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';

/** Sign-in URL that returns to the current page. `/app` is no longer a login screen (it redirects to /app/analytics). */
export function loginUrlFor(asPath: string) {
  return `/login?callbackUrl=${encodeURIComponent(asPath || '/app/analytics')}`;
}

/**
 * Client-side auth guard for app pages. Keeps the redirect; renders nothing while the session loads or
 * while redirecting (shell-nav §5, §11): the persistent AppShell (pages/_app.tsx) shows its skeleton chrome
 * meanwhile, so there is no full-page spinner and no second layout.
 */
export default function withAuth<P extends object>(Component: React.ComponentType<P>) {
  function AuthenticatedComponent(props: P) {
    const { user, isLoading: authLoading } = useAuth();
    const router = useRouter();
    const t = useTranslations('auth');

    useEffect(() => {
      // Not loading and no user: to the sign-in page, returning here afterwards. `replace` keeps Back usable.
      if (!authLoading && !user) router.replace(loginUrlFor(router.asPath));
    }, [authLoading, user, router]);

    if (authLoading) return null;
    if (!user) {
      // Signed out the shell renders bare children, so never leave the screen blank while redirecting.
      return (
        <Typography role="status" variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
          {t('redirectingToLogin')}
        </Typography>
      );
    }
    return <Component {...props} />;
  }
  AuthenticatedComponent.displayName = `withAuth(${Component.displayName || Component.name || 'Component'})`;
  return AuthenticatedComponent;
}

import * as React from 'react';
import Head from 'next/head';
import { useTranslations } from 'next-intl';
import { usePageTitle, useShellContext, stripTitleSuffix } from '@/lib/nav/ShellContext';

export type AppLayoutProps = {
  /** Page name; a literal " - KolayXport" style suffix is stripped. */
  title?: string;
  /** Ignored (legacy prop, kept so old call sites compile). */
  simpleHeader?: boolean;
  children?: React.ReactNode;
};

/**
 * AppLayout compat shim (shell-nav §11, M2). All chrome lives in the persistent AppShell that
 * pages/_app.tsx mounts once for app routes (components/ds/shell/AppShell.tsx). Pages that still render
 * <AppLayout title> only hand their title to the shell: the TopBar never shows it (breadcrumbs only), the
 * shell writes `<title>` as "{title} · KolayXport" and the mobile TopBar uses it as its title.
 *
 * Outside the shell (no ShellContext) it writes `<title>` itself so a page rendered elsewhere still has one.
 * Deleted in M10, once every page renders <Page>.
 */
export default function AppLayout({ title, children }: AppLayoutProps) {
  const shell = useShellContext();
  const t = useTranslations('ds.page');
  const clean = typeof title === 'string' ? stripTitleSuffix(title) : '';
  usePageTitle(clean || null);
  return (
    <>
      {!shell && clean ? (
        <Head>
          <title>{t('documentTitle', { title: clean })}</title>
        </Head>
      ) : null}
      {children}
    </>
  );
}

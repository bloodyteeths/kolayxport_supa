// DS §3.2 Page template + shell-nav §6.1 contract.
import * as React from 'react';
import Head from 'next/head';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslations } from 'next-intl';
import { layout } from '@/lib/ds/tokens';
import { actionsKey, breadcrumbsKey, withLiveHandler } from './actionSignature';
import { PageContext, type PageContextValue, type PageHeaderActions, type PageShellMeta } from './PageContext';
import type { ActionSpec, DsBaseProps, PageBreadcrumb, PageWidth } from './types';

export type PageProps = DsBaseProps & {
  /** Required, translated. PageHeader title, mobile TopBar title and `<title>` ("{title} · KolayXport"). */
  title: string;
  width: PageWidth;
  breadcrumbs?: PageBreadcrumb[];
  /** Mobile back chevron (shell) and desktop PageHeader back link (when PageHeader has no own backHref). */
  backHref?: string;
  /** ≤ 1 labeled mobile TopBar action, e.g. `+ New` (CRITIQUE C2). */
  mobileAction?: ActionSpec;
  /** Set by the shell (M2) when it renders the mobile title row and ⋯. Default false. */
  shellManaged?: boolean;
  /** Receives everything the shell needs; M2 forwards it into ShellContext + usePageActions. */
  onShellMetaChange?: (meta: PageShellMeta) => void;
  /** Skip writing `<title>` (e.g. when the shell owns it). Default false. */
  disableDocumentTitle?: boolean;
  sx?: SxProps<Theme>;
  children: React.ReactNode;
};

export const PAGE_MAX_WIDTH: Record<PageWidth, number> = {
  list: layout.maxList,
  detail: layout.maxDetail,
  form: layout.maxForm,
  reading: layout.maxReading,
};

export function Page({
  title,
  width,
  breadcrumbs,
  backHref,
  mobileAction,
  shellManaged = false,
  onShellMetaChange,
  disableDocumentTitle = false,
  sx,
  className,
  children,
  ...rest
}: PageProps) {
  const t = useTranslations('ds.page');
  const [headerActions, setHeaderActions] = React.useState<PageHeaderActions | null>(null);

  const reportHeaderActions = React.useCallback((a: PageHeaderActions | null) => setHeaderActions(a), []);

  const ctx = React.useMemo<PageContextValue>(
    () => ({ title, width, backHref, shellManaged, reportHeaderActions }),
    [title, width, backHref, shellManaged, reportHeaderActions],
  );

  // Emit shell meta keyed on values, not identities: pages pass `breadcrumbs` / `mobileAction` inline,
  // and M2 stores the meta in ShellContext state, so an identity dep would re-emit on every render (and
  // loop when the page reads that context). The latest objects are read through a ref.
  const metaRef = React.useRef(onShellMetaChange);
  metaRef.current = onShellMetaChange;
  const latest = React.useRef({ breadcrumbs, mobileAction });
  latest.current = { breadcrumbs, mobileAction };
  const metaKey = `${breadcrumbsKey(breadcrumbs)}|${actionsKey([mobileAction])}`;
  React.useEffect(() => {
    if (!metaRef.current) return;
    const { breadcrumbs: crumbs, mobileAction: mAction } = latest.current;
    const primary = headerActions?.primary;
    const secondary = headerActions?.secondary ?? [];
    const overflow = headerActions?.overflow ?? [];
    const primaryInMenu = primary && headerActions?.mobilePrimary === 'menu' ? [primary] : [];
    metaRef.current({
      title,
      width,
      breadcrumbs: crumbs,
      backHref,
      mobileAction: mAction ? withLiveHandler(mAction, () => latest.current.mobileAction) : undefined,
      mobileOverflow: [...primaryInMenu, ...secondary, ...overflow],
      headerActions: [...(primary ? [primary] : []), ...secondary, ...overflow],
    });
  }, [title, width, backHref, metaKey, headerActions]);

  const centered = width !== 'list';
  return (
    <PageContext.Provider value={ctx}>
      {disableDocumentTitle ? null : (
        <Head>
          <title>{t('documentTitle', { title })}</title>
        </Head>
      )}
      <Box
        component="div"
        className={className}
        data-testid={rest['data-testid'] ?? 'ds-page'}
        data-width={width}
        sx={[
          {
            width: '100%',
            maxWidth: PAGE_MAX_WIDTH[width] + 2 * layout.gutter,
            mx: centered ? 'auto' : 0,
            px: { xs: `${layout.gutterMobile}px`, md: `${layout.gutter}px` },
            pt: { xs: '12px', md: '16px' },
            // mobile: room for a StickyActionBar (48 + 2×8) above the tab bar
            pb: { xs: 'calc(var(--kx-bottom-nav, 0px) + 80px)', md: '32px' },
            minWidth: 0,
          },
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
      >
        {children}
      </Box>
    </PageContext.Provider>
  );
}

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import PrintRoundedIcon from '@mui/icons-material/PrintRounded';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/ui/ErrorState';
import type { PrintDataState } from './usePrintData';
import type { PrintDataResponse } from './types';
import { PRINT_MAX_IDS } from './types';

/**
 * Print CSS for /app/print/* only. It is rendered as a <style> element inside
 * the page, so it exists only while a print page is mounted and never leaks
 * into the rest of the app (Pages Router forbids non-global CSS imports here).
 */
const PRINT_CSS = `
@page { size: auto; margin: 10mm; }
body { background: #eef0f3; }
.kxp-root { color: #111; font-family: inherit; }
.kxp-toolbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 16px; padding-top: calc(8px + env(safe-area-inset-top)); background: #fff; border-bottom: 1px solid #dde1e6; }
.kxp-pages { max-width: 820px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.kxp-sheet { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.12); padding: 24px; }
.kxp-thumb { width: 56px; height: 56px; flex: 0 0 56px; object-fit: cover; border-radius: 4px; border: 1px solid #e3e6ea; background: #f6f7f9; }
.kxp-thumb-empty { display: inline-block; }
.kxp-pre { white-space: pre-line; }
.kxp-row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid #e8eaed; break-inside: avoid; page-break-inside: avoid; }
.kxp-row:last-child { border-bottom: 0; }
.kxp-qty { flex: 0 0 auto; min-width: 48px; text-align: right; font-weight: 700; font-size: 1.15rem; }
.kxp-check { flex: 0 0 22px; width: 22px; height: 22px; border: 2px solid #555; border-radius: 3px; margin-top: 2px; }
.kxp-muted { color: #5f6368; }
.kxp-note { border: 1px dashed #9aa0a6; border-radius: 6px; padding: 8px 10px; margin-top: 12px; break-inside: avoid; page-break-inside: avoid; }
@media (max-width: 600px) {
  .kxp-pages { padding: 8px; gap: 8px; }
  .kxp-sheet { padding: 14px; border-radius: 6px; }
  .kxp-thumb { width: 48px; height: 48px; flex-basis: 48px; }
}
@media print {
  html, body { background: #fff !important; }
  /* Hide app-level overlays (_app's cookie banner, toaster, dialogs) so a
     fixed banner is not repeated on every printed page. */
  body * { visibility: hidden !important; }
  .kxp-root, .kxp-root * { visibility: visible !important; }
  body > *:not(#__next) { display: none !important; }
  .kxp-no-print { display: none !important; }
  .kxp-pages { max-width: none; padding: 0; gap: 0; display: block; }
  .kxp-sheet { box-shadow: none; border-radius: 0; padding: 0; }
  .kxp-break { break-after: page; page-break-after: always; }
  .kxp-break:last-child { break-after: auto; page-break-after: auto; }
  .kxp-root, .kxp-thumb { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

interface PrintShellProps {
  title: string;
  state: PrintDataState;
  retry: () => void;
  children: (data: PrintDataResponse) => React.ReactNode;
}

/** Chrome-free frame for print pages: scoped CSS, Print button, load states. */
export default function PrintShell({ title, state, retry, children }: PrintShellProps) {
  const t = useTranslations('printSlips');
  const tc = useTranslations('common');
  const router = useRouter();
  const ready = state.status === 'ready' && state.data.orders.length > 0;
  const [preparing, setPreparing] = React.useState(false);

  // Wait (briefly) for thumbnails still loading so the print snapshot does
  // not capture blank images when Print is pressed right after data loads.
  const handlePrint = React.useCallback(async () => {
    const pending = Array.from(document.images).filter(img => !img.complete);
    if (pending.length > 0) {
      setPreparing(true);
      await Promise.race([
        Promise.all(
          pending.map(
            img =>
              new Promise<void>(resolve => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              })
          )
        ),
        new Promise<void>(resolve => setTimeout(resolve, 4000)),
      ]);
      setPreparing(false);
    }
    window.print();
  }, []);

  // window.close() only works for tabs opened by script; when the page was
  // opened directly (bookmark, pasted link) go back to the labels page.
  const handleClose = React.useCallback(() => {
    window.close();
    setTimeout(() => {
      if (!window.closed) router.push('/app/labels');
    }, 150);
  }, [router]);

  return (
    <div className="kxp-root">
      <Head>
        <title>{`${title} · KolayXport`}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="kxp-toolbar kxp-no-print">
        <Typography component="h1" variant="subtitle1" fontWeight={700} sx={{ mr: 'auto' }}>
          {title}
        </Typography>
        {/* autoFocus once there is something to print, so Enter prints. */}
        <Button
          key={ready ? 'ready' : 'idle'}
          variant="contained"
          startIcon={<PrintRoundedIcon />}
          onClick={handlePrint}
          disabled={!ready || preparing}
          autoFocus={ready}
          sx={{ textTransform: 'none', minHeight: 44 }}
        >
          {preparing ? tc('loading') : t('print')}
        </Button>
        <Button
          variant="text"
          onClick={handleClose}
          sx={{ textTransform: 'none', minHeight: 44 }}
        >
          {tc('close')}
        </Button>
      </div>

      {state.status === 'loading' && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8 }}>
          <CircularProgress size={28} />
          <Typography color="text.secondary">{tc('loading')}</Typography>
        </Box>
      )}

      {state.status === 'unauthenticated' && (
        <Box className="kxp-pages">
          <Alert
            severity="warning"
            action={
              <Button component={Link} href="/app" color="inherit" sx={{ textTransform: 'none', minHeight: 44 }}>
                {t('signIn')}
              </Button>
            }
          >
            {t('notSignedIn')}
          </Alert>
        </Box>
      )}

      {state.status === 'noIds' && (
        <Box className="kxp-pages">
          <Alert severity="info">{t('noIds')}</Alert>
        </Box>
      )}

      {state.status === 'tooMany' && (
        <Box className="kxp-pages">
          <Alert severity="warning">{t('tooMany', { max: PRINT_MAX_IDS })}</Alert>
        </Box>
      )}

      {state.status === 'error' && (
        <Box className="kxp-pages">
          <ErrorState error={state.error} onRetry={retry} />
        </Box>
      )}

      {state.status === 'ready' && (
        <>
          {state.data.missingCount > 0 && (
            <Box className="kxp-pages kxp-no-print" sx={{ pb: '0 !important' }}>
              <Alert severity="warning">{t('missing', { count: state.data.missingCount })}</Alert>
            </Box>
          )}
          {state.data.orders.length === 0 ? (
            <Box className="kxp-pages">
              <Alert severity="info">{t('empty')}</Alert>
            </Box>
          ) : (
            children(state.data)
          )}
        </>
      )}
    </div>
  );
}

/** Thumbnail that degrades to an empty box when the image is missing or fails. */
export function PrintThumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) return <span className="kxp-thumb kxp-thumb-empty" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="kxp-thumb" src={src} alt={alt} loading="eager" decoding="async" onError={() => setFailed(true)} />;
}

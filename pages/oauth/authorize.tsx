// /oauth/authorize — the seller allows (or declines) an AI app connecting to their KolayXport shop over MCP.
// OAuth 2.1 authorization endpoint (lib/mcp/tokens, pages/api/mcp/oauth/*): signed-in seller only (otherwise /login
// and back here), the client must be registered and the redirect URI one it registered, PKCE S256.
import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';

export default function OAuthAuthorize() {
  const t = useTranslations('mcp.consent');
  const router = useRouter();
  const [clientName, setClientName] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'sending'>('loading');
  const [write, setWrite] = useState(true);
  const q = router.query;
  const param = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : '');

  useEffect(() => {
    if (!router.isReady) return;
    void (async () => {
      const session = await fetch('/api/auth/session', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null);
      if (!session?.user) {
        void router.replace(`/login?callbackUrl=${encodeURIComponent(router.asPath)}`);
        return;
      }
      if (param('response_type') !== 'code') { setState('invalid'); return; }
      const r = await fetch(`/api/mcp/oauth/authorize?${new URLSearchParams({ client_id: param('client_id'), redirect_uri: param('redirect_uri') })}`, { credentials: 'same-origin' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.clientName) { setState('invalid'); return; }
      setClientName(d.clientName);
      setWrite(!param('scope') || param('scope').split(/\s+/).includes('write'));
      setState('ready');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const answer = async (approve: boolean) => {
    setState('sending');
    const r = await fetch('/api/mcp/oauth/authorize', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approve, client_id: param('client_id'), redirect_uri: param('redirect_uri'), state: param('state'),
        code_challenge: param('code_challenge'), code_challenge_method: param('code_challenge_method') || 'S256',
        scope: write ? 'read write' : 'read',
      }),
    });
    const d = await r.json().catch(() => null);
    if (d?.redirect) window.location.href = d.redirect;
    else setState('invalid');
  };

  return (
    <>
      <Head>
        <title>{`${t('pageTitle')} — KolayXport`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md p-6 sm:p-8 w-full max-w-md">
          <div className="text-sm font-semibold text-blue-700 mb-4">KolayXport</div>
          {state === 'loading' ? <p className="text-sm text-gray-500">{t('loading')}</p> : null}
          {state === 'invalid' ? (
            <>
              <h1 className="text-lg font-semibold mb-2">{t('invalidTitle')}</h1>
              <p className="text-sm text-gray-600">{t('invalidBody')}</p>
            </>
          ) : null}
          {(state === 'ready' || state === 'sending') && clientName ? (
            <>
              <h1 className="text-lg font-semibold mb-1">{t('title', { app: clientName })}</h1>
              <p className="text-sm text-gray-500 mb-4">{t('subtitle')}</p>
              <div className="text-sm font-medium text-gray-800 mb-2">{t('canTitle')}</div>
              <ul className="text-sm text-gray-700 space-y-1 mb-4 list-disc pl-5">
                <li>{t('canOrders')}</li>
                <li>{t('canListings')}</li>
                <li>{t('canSales')}</li>
              </ul>
              <label className="flex gap-2 items-start text-sm text-gray-800 mb-4 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={write} onChange={(e) => setWrite(e.target.checked)} />
                <span>{t('write')}<span className="block text-xs text-gray-500">{t('writeHint')}</span></span>
              </label>
              <p className="text-xs text-gray-500 mb-5">{t('never')}</p>
              <div className="flex gap-2 justify-end">
                <button type="button" disabled={state === 'sending'} onClick={() => void answer(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">{t('deny')}</button>
                <button type="button" disabled={state === 'sending'} onClick={() => void answer(true)} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">{t('allow')}</button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

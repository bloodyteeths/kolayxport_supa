// components/domain/credits/CreditsDialog.tsx — "AI kredisi al": the seller's balance and the credit packs.
// Opens from any "Kredi al" button and, through the global 402 interceptor, whenever an image / video generation runs
// out of credits. Buying goes to Stripe Checkout (or Shopify's approval page for Shopify-billed accounts); on the way
// back `?credits=success&session_id=` is confirmed here so the credits show at once (mounted once in _app).
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Box from '@mui/material/Box';
import { useLocale, useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay';
import { useToast } from '@/components/ds/feedback';
import { useFormatters } from '@/lib/format';
import { accent, neutral as n, radius, tone } from '@/lib/ds/tokens';
import { CREDIT_PACKS, IMAGE_CREDITS, packSaving, videoCredits, type CreditPackId } from '@/lib/billing/aiCredits';
import { useCreditsDialog } from '@/lib/billing/creditsDialogStore';
import { refreshCredits, useCredits } from './useCredits';

/** A typical video for the "≈ N videos" line: 8 s, 1080p, fast, one variant. */
const TYPICAL_VIDEO = videoCredits({ quality: 'fast', resolution: '1080p', durationSec: 8 });

export function CreditsDialog() {
  const t = useTranslations('credits');
  const f = useFormatters();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { open, need, close } = useCreditsDialog();
  const { balance, currency: uiCurrency } = useCredits(open);
  const [pick, setPick] = useState<CreditPackId>('p5000');
  const [buying, setBuying] = useState(false);
  // Shopify billing charges in USD.
  const currency = balance?.channel === 'shopify' ? 'USD' : uiCurrency;

  // Back from Stripe / Shopify.
  useEffect(() => {
    if (!router.isReady) return;
    const { credits: state, session_id: sessionId, ...rest } = router.query;
    if (state !== 'success' && state !== 'cancel') return;
    const clean = () => void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    if (state === 'cancel') { clean(); return; }
    void (async () => {
      try {
        if (typeof sessionId === 'string' && sessionId) {
          const r = await fetch('/api/ai/credits/confirm', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
          const d = await r.json().catch(() => null);
          if (d?.ok) toast.success(t('added', { count: f.num(d.credits) }));
          else toast.info(t('addedSoon'));
        } else {
          toast.success(t('addedShopify'));
        }
      } finally {
        await refreshCredits();
        clean();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.credits]);

  const pack = CREDIT_PACKS.find((p) => p.id === pick) ?? CREDIT_PACKS[2];
  const canBuy = balance?.channel === 'stripe' || balance?.channel === 'shopify';

  const buy = async () => {
    setBuying(true);
    try {
      const r = await fetch('/api/ai/credits/checkout', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: pack.id, currency, locale, returnTo: router.asPath.split(/[?#]/)[0] }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.url) throw new Error(d?.code || 'checkout');
      window.location.href = d.url;
    } catch {
      toast.error(t('checkoutFailed'));
      setBuying(false);
    }
  };

  const total = balance?.total;
  if (!balance && open) return null; // never flash pack prices before we know the account may see them
  if (balance?.neutral) {
    // Shopify-connected account (App Store rule 1.2.1): its usage only — no prices, packs or buying.
    return (
      <Modal open={open} onClose={close} size="sm" title={t('neutralTitle')} primary={{ id: 'close', label: t('close'), onClick: close }} secondary={null} data-testid="credits-dialog">
        <Box sx={{ fontSize: 14, color: n[700], lineHeight: '20px' }}>
          {t('neutralBody', { date: f.date(balance.monthly.renewsAt, 'date') })}
        </Box>
      </Modal>
    );
  }
  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title={t('title')}
      description={need ? t('needLine', { need: f.num(need), have: total === null || total === undefined ? '—' : f.num(total) }) : t('subtitle')}
      primary={canBuy
        ? { id: 'buy', label: t('buy', { price: f.money(pack.price[currency], currency, { wholeIfIntegral: true }) }), onClick: () => void buy(), loading: buying }
        : { id: 'close', label: t('close'), onClick: close }}
      secondary={canBuy ? undefined : null}
      data-testid="credits-dialog"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {balance ? (
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: 13, color: n[700] }}>
            <Box sx={{ px: '10px', py: '6px', borderRadius: '8px', bgcolor: n[50], border: `1px solid ${n[200]}` }}>
              {t('balance')}: <b>{total === null ? t('unlimited') : f.num(total ?? 0)}</b>
            </Box>
            {balance.monthly.allowance !== null ? (
              <Box sx={{ px: '10px', py: '6px', borderRadius: '8px', bgcolor: n[50], border: `1px solid ${n[200]}` }}>
                {t('monthly', { left: f.num(balance.monthly.remaining ?? 0), of: f.num(balance.monthly.allowance), date: f.date(balance.monthly.renewsAt, 'date') })}
              </Box>
            ) : null}
            {balance.packs > 0 ? (
              <Box sx={{ px: '10px', py: '6px', borderRadius: '8px', bgcolor: n[50], border: `1px solid ${n[200]}` }}>{t('packs', { count: f.num(balance.packs) })}</Box>
            ) : null}
          </Box>
        ) : null}

        {canBuy ? (
          <Box role="radiogroup" aria-label={t('title')} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: '8px' }}>
            {CREDIT_PACKS.map((p) => {
              const on = p.id === pick;
              const saving = packSaving(p, currency);
              return (
                <Box key={p.id} component="button" type="button" role="radio" aria-checked={on} onClick={() => setPick(p.id)} data-testid={`credit-pack-${p.id}`}
                  sx={{ position: 'relative', textAlign: 'left', font: 'inherit', p: '12px 10px 10px', borderRadius: `${radius.md}px`, cursor: 'pointer',
                    border: `${on ? 2 : 1}px solid ${on ? accent[600] : n[200]}`, bgcolor: on ? accent[50] : n[0], display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {p.popular ? <Box sx={{ position: 'absolute', top: -9, left: 8, px: '6px', borderRadius: '6px', bgcolor: accent[600], color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '18px' }}>{t('popular')}</Box> : null}
                  <Box sx={{ fontSize: 20, fontWeight: 700, color: n[900], lineHeight: '26px' }}>{f.num(p.credits)}</Box>
                  <Box sx={{ fontSize: 11, color: n[500] }}>{t('creditsUnit')}</Box>
                  <Box sx={{ fontSize: 15, fontWeight: 600, color: on ? accent[700] : n[800], mt: '4px' }}>{f.money(p.price[currency], currency, { wholeIfIntegral: true })}</Box>
                  {saving > 0 ? <Box sx={{ fontSize: 11, fontWeight: 600, color: tone.success.fg }}>{t('saving', { percent: saving })}</Box> : <Box sx={{ fontSize: 11 }}>&nbsp;</Box>}
                  <Box sx={{ fontSize: 11, color: n[500], mt: '2px', lineHeight: '15px' }}>
                    {t('approx', { videos: Math.floor(p.credits / TYPICAL_VIDEO), images: Math.floor(p.credits / IMAGE_CREDITS) })}
                  </Box>
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box sx={{ fontSize: 13, color: n[600] }}>{t('unavailable')}</Box>
        )}

        <Box sx={{ fontSize: 12, color: n[500], lineHeight: '18px' }}>
          {t('costs', { image: IMAGE_CREDITS, video: TYPICAL_VIDEO })} {t('never')}
          {balance?.channel === 'shopify' ? ` ${t('shopifyNote')}` : ''}
        </Box>
      </Box>
    </Modal>
  );
}

export default CreditsDialog;

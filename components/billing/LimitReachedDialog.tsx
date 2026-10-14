import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Typography,
} from '@mui/material';
import LockClockRoundedIcon from '@mui/icons-material/LockClockRounded';
import { useTranslations } from 'next-intl';
import { toast } from 'react-hot-toast';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import { useLimitReachedStore, type LimitReachedInfo } from '@/lib/http/limitInterceptor';

/** Mirrors lib/middleware/withUsageLimiter.ts (trial 50/10; plans table). Keep in sync. */
const LIMITS: Record<string, { orderSync: number; label: number }> = {
  trial: { orderSync: 50, label: 10 },
  starter: { orderSync: 200, label: 100 },
  growth: { orderSync: 2000, label: 500 },
};

interface SettingsSubscription {
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  billingProvider?: string | null;
  usageResetAt?: string | null;
  orderSyncCount?: number;
  labelCount?: number;
}

const settingsFetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`settings ${r.status}`);
  return r.json();
};

function computeUsage(info: LimitReachedInfo, sub: SettingsSubscription | null) {
  if (info.limitType === 'unknown') return null;
  // Counters only explain trial / plan-limit blocks; for noSubscription etc. a bar like
  // "3 / 50" would wrongly suggest quota is left.
  if (info.reason !== 'trial' && info.reason !== 'planLimit') return null;
  const used =
    info.used ?? (info.limitType === 'label' ? sub?.labelCount : sub?.orderSyncCount) ?? undefined;
  let limit = info.limit;
  if (limit === undefined && sub) {
    const key = sub.subscriptionStatus === 'trialing' ? 'trial' : sub.subscriptionPlan || '';
    limit = LIMITS[key]?.[info.limitType];
  }
  if (typeof used !== 'number' || typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return null;
  return { used, limit };
}

/**
 * Global "usage limit reached" dialog. Mounted once in pages/_app.tsx; opened by
 * lib/http/limitInterceptor.ts on any same-origin /api 402.
 * Shopify-free accounts never see Stripe upsell: they get a neutral toast instead.
 */
export default function LimitReachedDialog() {
  const t = useTranslations('ui');
  const tc = useTranslations('common');
  const ts = useTranslations('subscription');
  const router = useRouter();
  const locale = useLocaleStore((s) => s.locale);
  const info = useLimitReachedStore((s) => s.current);
  const dismiss = useLimitReachedStore((s) => s.dismiss);

  // Same key AppLayout uses, so this also refreshes the trial banner's counts.
  const { data, error, isValidating } = useSWR(info ? '/api/user/settings' : null, settingsFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 0,
    shouldRetryOnError: false,
  });
  const sub: SettingsSubscription | null = data?.subscription ?? null;
  const isShopifyFree = sub?.billingProvider === 'shopify_free' || sub?.subscriptionPlan === 'shopify_free';
  const providerKnown = !!data || !!error;
  // If we can't tell the billing provider, never show Stripe upsell wording.
  const neutral = !!error || isShopifyFree;

  useEffect(() => {
    if (info && isShopifyFree) {
      toast.error(t('limit.neutralMessage'), { id: 'limit-reached-neutral', duration: 6000 });
      dismiss();
    }
  }, [info, isShopifyFree, dismiss, t]);

  if (!info || !providerKnown || isShopifyFree) return null;

  // The key is shared with AppLayout's long-deduped cache: wait for the fresh revalidation
  // before showing counters so they don't visibly jump (e.g. 9/10 -> 10/10) while open.
  const bodyHasUsage = info.used !== undefined && info.limit !== undefined;
  const usage = bodyHasUsage || !isValidating ? computeUsage(info, sub) : null;
  const reason = info.reason;

  const title = neutral
    ? ts('limitExceeded')
    : reason === 'trial'
      ? t('limit.trialTitle')
      : reason === 'noSubscription'
        ? t('limit.noSubscriptionTitle')
        : reason === 'invalidPlan'
          ? t('limit.invalidPlanTitle')
          : reason === 'planLimit'
            ? t('limit.planTitle')
            : ts('limitExceeded');

  const message = neutral
    ? t('limit.neutralMessage')
    : reason === 'invalidPlan'
      ? t('limit.invalidPlanMessage')
      : reason === 'noSubscription'
        ? t('limit.noSubscriptionMessage')
        : info.limitType === 'label'
          ? t('limit.labelMessage')
          : info.limitType === 'orderSync'
            ? t('limit.orderSyncMessage')
            : ts('limitExceededMessage');

  const resetAt = sub?.usageResetAt ? new Date(sub.usageResetAt) : null;
  const showReset = !neutral && reason === 'planLimit' && resetAt && !Number.isNaN(resetAt.getTime());
  const showUpgrade = !neutral && reason !== 'invalidPlan';

  const goToPricing = () => {
    dismiss();
    router.push('/fiyatlandirma');
  };

  return (
    <Dialog
      open
      onClose={dismiss}
      fullWidth
      maxWidth="xs"
      sx={{
        zIndex: 1600,
        '& .MuiDialog-paper': { m: { xs: 2, sm: 4 }, width: { xs: 'calc(100% - 32px)', sm: '100%' }, borderRadius: 3 },
      }}
      aria-labelledby="limit-reached-title"
    >
      <DialogTitle id="limit-reached-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pb: 1 }}>
        <LockClockRoundedIcon color="warning" />
        <Box component="span" sx={{ fontSize: '1rem', fontWeight: 600 }}>
          {title}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>

        {usage && !neutral && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="body2" fontWeight={500}>
                {info.limitType === 'label' ? ts('labelCreation') : ts('orderSync')}
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {t('limit.usage', { used: usage.used, limit: usage.limit })}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              color="warning"
              value={Math.min(100, (usage.used / usage.limit) * 100)}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
        )}

        {showReset && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            {t('limit.resetsOn', {
              date: resetAt!.toLocaleDateString(locale === 'en' ? 'en-US' : 'tr-TR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
            })}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: 'wrap-reverse' }}>
        <Button onClick={dismiss} color="inherit" sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }}>
          {tc('close')}
        </Button>
        {showUpgrade ? (
          <Button
            onClick={goToPricing}
            variant="contained"
            autoFocus
            sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' }, ml: '0 !important' }}
          >
            {reason === 'noSubscription' ? tc('viewPlans') : ts('upgradePlan')}
          </Button>
        ) : (
          <Button
            component="a"
            href="mailto:destek@kolayxport.com"
            onClick={dismiss}
            variant="outlined"
            sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' }, ml: '0 !important' }}
          >
            {t('limit.contactSupport')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export { LimitReachedDialog };

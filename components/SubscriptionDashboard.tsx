import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  Chip,
  Grid,
  Button,
  Alert,
  AlertTitle,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  CalendarMonth,
  Label,
  Sync,
  CheckCircle,
  Warning,
  Info,
  CreditCard,
  UpgradeOutlined,
  HelpOutline,
  Receipt,
} from '@mui/icons-material';
import { format, differenceInDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { enUS } from 'date-fns/locale';
import { useTranslations } from 'next-intl';
import useLocaleStore from '@/lib/stores/useLocaleStore';

interface SubscriptionData {
  subscriptionPlan: 'trial' | 'starter' | 'growth' | 'enterprise' | null;
  subscriptionStatus: 'trialing' | 'active' | 'canceled' | 'past_due' | null;
  billingInterval: 'month' | 'year' | null;
  trialExpiresAt: string | null;
  usageResetAt: string | null;
  orderSyncCount: number;
  labelCount: number;
}

interface PlanLimits {
  orderSyncs: number;
  labels: number;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  trial: { orderSyncs: 50, labels: 10 },
  starter: { orderSyncs: 200, labels: 100 },
  growth: { orderSyncs: 2000, labels: 500 },
  enterprise: { orderSyncs: Infinity, labels: Infinity },
};

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  trialing: 'default',
  active: 'success',
  canceled: 'warning',
  past_due: 'error',
};

interface SubscriptionDashboardProps {
  subscriptionData: SubscriptionData;
  onUpgrade?: () => void;
  onManageSubscription?: () => void;
  onViewBillingHistory?: () => void;
}

export default function SubscriptionDashboard({
  subscriptionData,
  onUpgrade,
  onManageSubscription,
  onViewBillingHistory,
}: SubscriptionDashboardProps) {
  const t = useTranslations('subscription');
  const locale = useLocaleStore((s) => s.locale);
  const dateFnsLocale = locale === 'tr' ? tr : enUS;

  try {
    const plan = subscriptionData.subscriptionPlan || 'trial';
    const status = subscriptionData.subscriptionStatus || 'trialing';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.trial;

  const orderSyncPercentage = Math.min((subscriptionData.orderSyncCount / limits.orderSyncs) * 100, 100);
  const labelPercentage = Math.min((subscriptionData.labelCount / limits.labels) * 100, 100);

  const isNearLimit = orderSyncPercentage >= 80 || labelPercentage >= 80;
  const hasReachedLimit = orderSyncPercentage >= 100 || labelPercentage >= 100;

  const daysUntilTrialEnds = subscriptionData.trialExpiresAt
    ? (() => {
        try {
          return differenceInDays(new Date(subscriptionData.trialExpiresAt), new Date());
        } catch {
          return null;
        }
      })()
    : null;

  const daysUntilReset = subscriptionData.usageResetAt
    ? (() => {
        try {
          return differenceInDays(new Date(subscriptionData.usageResetAt), new Date());
        } catch {
          return null;
        }
      })()
    : null;

  const statusKey = status === 'past_due' ? 'pastDue' : status;

  return (
    <Box sx={{ mb: 4, overflowX: 'hidden', maxWidth: '100%' }}>
      <Typography variant="h5" component="h2" gutterBottom sx={{ mb: 3, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {t('title')}
      </Typography>

      <Grid container spacing={3}>
        {/* Plan Info Card */}
        <Grid item xs={12} md={6}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" component="h3">
                  {t('currentPlan')}
                </Typography>
                <Chip
                  label={t(`statusLabels.${statusKey}`)}
                  color={STATUS_COLORS[status]}
                  size="small"
                />
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="h4" component="div" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {t(`planNames.${plan}`)}
                </Typography>
                {subscriptionData.billingInterval && plan !== 'trial' && (
                  <Typography variant="body2" color="text.secondary">
                    {subscriptionData.billingInterval === 'month' ? t('monthlySubscription') : t('yearlySubscription')}
                  </Typography>
                )}
              </Box>

              {/* Trial Warning */}
              {status === 'trialing' && daysUntilTrialEnds !== null && (
                <Alert severity={daysUntilTrialEnds <= 3 ? 'warning' : 'info'} sx={{ mb: 2 }}>
                  <AlertTitle>{t('trialVersion')}</AlertTitle>
                  {daysUntilTrialEnds > 0
                    ? t('trialExpiresIn', { days: daysUntilTrialEnds })
                    : t('trialExpiresToday')}
                </Alert>
              )}

              {/* Past Due Warning */}
              {status === 'past_due' && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <AlertTitle>{t('pastDueTitle')}</AlertTitle>
                  {t('pastDueMessage')}
                </Alert>
              )}

              <Box sx={{ mt: 3, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, overflow: 'hidden' }}>
                {(plan === 'trial' || plan === 'starter') && (
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<UpgradeOutlined />}
                    onClick={onUpgrade}
                    fullWidth
                    sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: { xs: '0.8rem', sm: '0.875rem' } }}
                  >
                    {t('upgradePlan')}
                  </Button>
                )}
                {plan !== 'trial' && (
                  <Button
                    variant="outlined"
                    startIcon={<CreditCard />}
                    onClick={onManageSubscription}
                    fullWidth
                    sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: { xs: '0.8rem', sm: '0.875rem' } }}
                  >
                    {t('manageSubscription')}
                  </Button>
                )}
              </Box>

              {plan !== 'trial' && (
                <Box sx={{ mt: 2, overflow: 'hidden' }}>
                  <Button
                    variant="text"
                    startIcon={<Receipt />}
                    onClick={onViewBillingHistory}
                    fullWidth
                    size="small"
                    sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: { xs: '0.75rem', sm: '0.8rem' } }}
                  >
                    {t('billingHistory')}
                  </Button>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Usage Stats Card */}
        <Grid item xs={12} md={6}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" component="h3">
                  {t('usageStatus')}
                </Typography>
                {daysUntilReset !== null && (
                  <Tooltip title={t('usageDaysTooltip')}>
                    <Chip
                      icon={<CalendarMonth />}
                      label={t('daysRemaining', { days: daysUntilReset })}
                      size="small"
                      variant="outlined"
                    />
                  </Tooltip>
                )}
              </Box>

              {/* Order Sync Usage */}
              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Sync fontSize="small" />
                    <Typography variant="body2">{t('orderSync')}</Typography>
                  </Box>
                  <Typography variant="body2" fontWeight="bold">
                    {subscriptionData.orderSyncCount} / {limits.orderSyncs === Infinity ? '∞' : limits.orderSyncs}
                  </Typography>
                </Box>
                {limits.orderSyncs !== Infinity && (
                  <LinearProgress
                    variant="determinate"
                    value={orderSyncPercentage}
                    color={orderSyncPercentage >= 100 ? 'error' : orderSyncPercentage >= 80 ? 'warning' : 'primary'}
                    sx={{ height: 8, borderRadius: 1 }}
                  />
                )}
              </Box>

              {/* Label Usage */}
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Label fontSize="small" />
                    <Typography variant="body2">{t('labelCreation')}</Typography>
                  </Box>
                  <Typography variant="body2" fontWeight="bold">
                    {subscriptionData.labelCount} / {limits.labels === Infinity ? '∞' : limits.labels}
                  </Typography>
                </Box>
                {limits.labels !== Infinity && (
                  <LinearProgress
                    variant="determinate"
                    value={labelPercentage}
                    color={labelPercentage >= 100 ? 'error' : labelPercentage >= 80 ? 'warning' : 'primary'}
                    sx={{ height: 8, borderRadius: 1 }}
                  />
                )}
              </Box>

              {/* Usage Warnings */}
              {hasReachedLimit && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  <AlertTitle>{t('limitExceeded')}</AlertTitle>
                  {t('limitExceededMessage')}
                </Alert>
              )}
              {!hasReachedLimit && isNearLimit && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  <AlertTitle>{t('nearingLimit')}</AlertTitle>
                  {t('nearingLimitMessage')}
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Info Alert for Trial Users */}
      {plan === 'trial' && (
        <Alert severity="info" sx={{ mt: 3 }}>
          <AlertTitle>{t('trialFeatures')}</AlertTitle>
          {t('trialFeaturesDesc')}
        </Alert>
      )}
    </Box>
  );
  } catch (error) {
    console.error('Error rendering SubscriptionDashboard:', error);
    return (
      <Box sx={{ mb: 4 }}>
        <Alert severity="warning">
          {t('loadError')}
        </Alert>
      </Box>
    );
  }
}

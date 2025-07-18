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

const PLAN_NAMES: Record<string, string> = {
  trial: 'Deneme',
  starter: 'Başlangıç',
  growth: 'Büyüme',
  enterprise: 'Kurumsal',
};

const STATUS_LABELS: Record<string, { label: string; color: 'default' | 'success' | 'warning' | 'error' }> = {
  trialing: { label: 'Deneme Sürümü', color: 'default' },
  active: { label: 'Aktif', color: 'success' },
  canceled: { label: 'İptal Edildi', color: 'warning' },
  past_due: { label: 'Ödeme Gecikmiş', color: 'error' },
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

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" component="h2" gutterBottom sx={{ mb: 3, fontWeight: 'bold' }}>
        Abonelik ve Kullanım
      </Typography>

      <Grid container spacing={3}>
        {/* Plan Info Card */}
        <Grid item xs={12} md={6}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" component="h3">
                  Mevcut Plan
                </Typography>
                <Chip
                  label={STATUS_LABELS[status].label}
                  color={STATUS_LABELS[status].color}
                  size="small"
                />
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="h4" component="div" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {PLAN_NAMES[plan]}
                </Typography>
                {subscriptionData.billingInterval && plan !== 'trial' && (
                  <Typography variant="body2" color="text.secondary">
                    {subscriptionData.billingInterval === 'month' ? 'Aylık' : 'Yıllık'} Abonelik
                  </Typography>
                )}
              </Box>

              {/* Trial Warning */}
              {status === 'trialing' && daysUntilTrialEnds !== null && (
                <Alert severity={daysUntilTrialEnds <= 3 ? 'warning' : 'info'} sx={{ mb: 2 }}>
                  <AlertTitle>Deneme Sürümü</AlertTitle>
                  {daysUntilTrialEnds > 0
                    ? `Deneme süreniz ${daysUntilTrialEnds} gün sonra sona erecek.`
                    : 'Deneme süreniz bugün sona eriyor!'}
                </Alert>
              )}

              {/* Past Due Warning */}
              {status === 'past_due' && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <AlertTitle>Ödeme Gecikmiş</AlertTitle>
                  Aboneliğinizi devam ettirmek için lütfen ödeme bilgilerinizi güncelleyin.
                </Alert>
              )}

              <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
                {(plan === 'trial' || plan === 'starter') && (
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<UpgradeOutlined />}
                    onClick={onUpgrade}
                    fullWidth
                  >
                    Plan Yükselt
                  </Button>
                )}
                {plan !== 'trial' && (
                  <Button
                    variant="outlined"
                    startIcon={<CreditCard />}
                    onClick={onManageSubscription}
                    fullWidth
                  >
                    Abonelik Yönet
                  </Button>
                )}
              </Box>
              
              {plan !== 'trial' && (
                <Box sx={{ mt: 2 }}>
                  <Button
                    variant="text"
                    startIcon={<Receipt />}
                    onClick={onViewBillingHistory}
                    fullWidth
                    size="small"
                  >
                    Fatura Geçmişi
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
                  Kullanım Durumu
                </Typography>
                {daysUntilReset !== null && (
                  <Tooltip title="Kullanım limitiniz sıfırlanana kadar kalan gün sayısı">
                    <Chip
                      icon={<CalendarMonth />}
                      label={`${daysUntilReset} gün`}
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
                    <Typography variant="body2">Sipariş Senkronizasyonu</Typography>
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
                    <Typography variant="body2">Etiket Oluşturma</Typography>
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
                  <AlertTitle>Limit Aşıldı</AlertTitle>
                  Kullanım limitinizi aştınız. Devam etmek için planınızı yükseltin.
                </Alert>
              )}
              {!hasReachedLimit && isNearLimit && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  <AlertTitle>Limite Yaklaşıyorsunuz</AlertTitle>
                  Kullanım limitinize yaklaşıyorsunuz. Kesintisiz hizmet için planınızı yükseltmeyi düşünün.
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Info Alert for Trial Users */}
      {plan === 'trial' && (
        <Alert severity="info" sx={{ mt: 3 }}>
          <AlertTitle>Deneme Sürümü Özellikleri</AlertTitle>
          Deneme sürümünde 50 sipariş senkronizasyonu ve 10 etiket oluşturma hakkınız bulunmaktadır. 
          Tüm özelliklere erişim için ücretli plana geçebilirsiniz.
        </Alert>
      )}
    </Box>
  );
  } catch (error) {
    console.error('Error rendering SubscriptionDashboard:', error);
    return (
      <Box sx={{ mb: 4 }}>
        <Alert severity="warning">
          Abonelik bilgileri yüklenirken bir hata oluştu. Lütfen sayfayı yenileyin.
        </Alert>
      </Box>
    );
  }
}
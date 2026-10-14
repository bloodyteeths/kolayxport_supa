import prisma from '@/lib/prisma';

/**
 * Pure aggregation helpers for the admin cockpit. None of these functions
 * return secrets, marketplace tokens, raw webhook payloads, or buyer PII.
 * Callers (admin route handlers) layer the `withAdmin` middleware on top.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function clampLimit(raw: unknown, def = 50, max = 200): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

function clampOffset(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export const paging = { clampLimit, clampOffset };

// --------------------------------------------------------------------------
// A. System health
// --------------------------------------------------------------------------
export async function getSystemHealth() {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return {
    app: 'ok',
    db: dbOk ? 'ok' : 'down',
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    env: process.env.NODE_ENV || 'unknown',
    commitSha: process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || null,
  };
}

// --------------------------------------------------------------------------
// B. Cron health
// --------------------------------------------------------------------------
const STALE_THRESHOLDS_MS: Record<string, number> = {
  'sync-orders': 30 * 60 * 1000,
  'reset-usage': 26 * HOUR,
  'track-ranks': 26 * HOUR,
};

export async function getCronHealth() {
  const lockDelegate = (prisma as any).cronLock;
  const latestPerJob: Array<{ jobName: string; bucket: string; createdAt: Date }> = lockDelegate
    ? await lockDelegate.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: { jobName: true, bucket: true, createdAt: true },
      })
    : [];

  // Reduce to last-seen per jobName.
  const lastByJob: Record<string, { bucket: string; createdAt: Date }> = {};
  for (const r of latestPerJob) {
    if (!lastByJob[r.jobName]) {
      lastByJob[r.jobName] = { bucket: r.bucket, createdAt: r.createdAt };
    }
  }

  const now = Date.now();
  const jobs = Object.entries(STALE_THRESHOLDS_MS).map(([jobName, thresholdMs]) => {
    const last = lastByJob[jobName] ?? null;
    const ageMs = last ? now - new Date(last.createdAt).getTime() : null;
    const stale = ageMs === null || ageMs > thresholdMs;
    return {
      jobName,
      lastRunAt: last?.createdAt ?? null,
      lastBucket: last?.bucket ?? null,
      ageMs,
      thresholdMs,
      stale,
    };
  });

  const cronEventsTail = await prisma.syncLog.findMany({
    take: 25,
    orderBy: { timestamp: 'desc' },
    where: { category: 'cron' as any } as any,
    select: {
      id: true,
      level: true,
      message: true,
      operation: true,
      userId: true,
      timestamp: true,
    },
  });

  return { jobs, recent: cronEventsTail, recentLocks: latestPerJob.slice(0, 20) };
}

// --------------------------------------------------------------------------
// C. Marketplace integration health
// --------------------------------------------------------------------------
export async function getIntegrationHealth() {
  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * DAY);

  const [
    etsyTotal,
    etsyExpired,
    etsyExpiringSoon,
    wixTotal,
    wixExpired,
    wixExpiringSoon,
    shopifyTotal,
    shopifyExpired,
    shopifyExpiringSoon,
    integrationFailures24h,
    recentIntegrationEvents,
  ] = await Promise.all([
    prisma.etsyShop.count({ where: { isActive: true } }),
    prisma.etsyShop.count({ where: { isActive: true, tokenExpiresAt: { lt: now } } }),
    prisma.etsyShop.count({
      where: { isActive: true, tokenExpiresAt: { gte: now, lt: inSevenDays } },
    }),
    prisma.wixSite.count({ where: { isActive: true } }),
    prisma.wixSite.count({ where: { isActive: true, tokenExpiresAt: { lt: now } } }),
    prisma.wixSite.count({
      where: { isActive: true, tokenExpiresAt: { gte: now, lt: inSevenDays } },
    }),
    prisma.shopifyShop.count({ where: { isActive: true } }),
    prisma.shopifyShop.count({ where: { isActive: true, tokenExpiresAt: { lt: now } } }),
    prisma.shopifyShop.count({
      where: { isActive: true, tokenExpiresAt: { gte: now, lt: inSevenDays } },
    }),
    prisma.syncLog.count({
      where: {
        category: 'integration' as any,
        level: { in: ['warn', 'error'] },
        timestamp: { gte: new Date(now.getTime() - DAY) },
      } as any,
    }),
    prisma.syncLog.findMany({
      take: 25,
      orderBy: { timestamp: 'desc' },
      where: { category: 'integration' as any } as any,
      select: {
        id: true,
        level: true,
        message: true,
        operation: true,
        userId: true,
        timestamp: true,
      },
    }),
  ]);

  return {
    marketplaces: [
      { name: 'etsy', total: etsyTotal, expired: etsyExpired, expiringSoon: etsyExpiringSoon },
      { name: 'wix', total: wixTotal, expired: wixExpired, expiringSoon: wixExpiringSoon },
      {
        name: 'shopify',
        total: shopifyTotal,
        expired: shopifyExpired,
        expiringSoon: shopifyExpiringSoon,
      },
    ],
    failuresLast24h: integrationFailures24h,
    recent: recentIntegrationEvents,
    etsyWebhooks: await getEtsyWebhookHealth(),
  };
}

// --------------------------------------------------------------------------
// C2. Etsy webhook queue health
// --------------------------------------------------------------------------
/** Counts only — never returns webhook payloads. */
export async function getEtsyWebhookHealth() {
  const now = Date.now();
  const since24h = new Date(now - DAY);
  const [byStatusAll, byStatus24h, oldestPending, recentFailed, oldestDue, lastReceived, backlog] = await Promise.all([
    prisma.webhookEvent.groupBy({ by: ['status'], where: { provider: 'etsy' }, _count: true }),
    prisma.webhookEvent.groupBy({
      by: ['status'],
      where: { provider: 'etsy', createdAt: { gte: since24h } },
      _count: true,
    }),
    prisma.webhookEvent.findFirst({
      where: { provider: 'etsy', status: { in: ['received', 'processing'] } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.webhookEvent.findMany({
      where: { provider: 'etsy', status: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, eventType: true, shopId: true, errorMessage: true, attempts: true, createdAt: true },
    }),
    prisma.webhookEvent.findFirst({
      where: { provider: 'etsy', status: 'received', nextAttemptAt: { lte: new Date(now) } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.webhookEvent.findFirst({
      where: { provider: 'etsy' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.webhookEvent.groupBy({
      by: ['shopId'],
      where: { provider: 'etsy', status: { in: ['received', 'processing', 'blocked_reauth'] } },
      _count: true,
    }),
  ]);
  const toMap = (rows: Array<{ status: string | null; _count: number }>) =>
    Object.fromEntries((rows || []).map(r => [r.status || 'unknown', r._count]));
  const counts24h = toMap(byStatus24h as any);
  const countsAll = toMap(byStatusAll as any);
  const depthByStatus: Record<string, number> = {
    received: 0, processing: 0, blocked_reauth: 0, coalesced: 0, failed: 0, done: 0, ignored: 0,
    ...countsAll,
  };
  const backlogByShop = ((backlog || []) as Array<{ shopId: string | null; _count: number }>)
    .map(r => ({ shopId: r.shopId || 'unknown', count: r._count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  let budget: unknown = null;
  let worker: unknown = null;
  let jobs: unknown[] = [];
  try {
    const { getBudgetSnapshot } = await import('@/lib/etsy/rateBudget');
    budget = getBudgetSnapshot();
  } catch { /* optional */ }
  try {
    const { getEtsyWorkerStatus } = await import('@/lib/etsy/webhooks/worker');
    worker = getEtsyWorkerStatus();
  } catch { /* optional */ }
  try {
    const { getJobStatuses } = await import('@/lib/scheduler/runs');
    jobs = await getJobStatuses();
  } catch { /* optional */ }

  return {
    byStatus: countsAll,
    byStatus24h: counts24h,
    depthByStatus,
    failed24h: counts24h.failed ?? 0,
    pending: oldestPending ? true : false,
    oldestPendingAgeMs: oldestPending ? now - new Date(oldestPending.createdAt).getTime() : null,
    oldestDueAgeMs: oldestDue ? now - new Date(oldestDue.createdAt).getTime() : null,
    lastReceivedAt: lastReceived ? new Date(lastReceived.createdAt).toISOString() : null,
    backlogByShop,
    recentFailed,
    budget,
    worker,
    jobs,
  };
}

/** Admin replay: failed Etsy events (by ids, or all for a shop) back to the queue with attempts 0. */
export async function replayFailedEtsyWebhooks(input: { ids?: unknown; shopId?: unknown }): Promise<{ replayed: number }> {
  const ids = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 191) : [];
  const shopId = typeof input.shopId === 'string' && /^\d{1,20}$/.test(input.shopId) ? input.shopId : undefined;
  if (ids.length === 0 && !shopId) return { replayed: 0 };
  const { replayFailedEtsyEvents } = await import('@/lib/etsy/webhooks/queueOps');
  return { replayed: await replayFailedEtsyEvents({ ids, shopId }) };
}

// --------------------------------------------------------------------------
// D. Shipping / label health
// --------------------------------------------------------------------------
export async function getShippingHealth() {
  const now = Date.now();
  const last24h = new Date(now - DAY);
  const last7d = new Date(now - 7 * DAY);

  const [labels24h, labels7d, failedLabels, byCarrier, trackingFailed] = await Promise.all([
    prisma.labelJob.count({ where: { createdAt: { gte: last24h } } }),
    prisma.labelJob.count({ where: { createdAt: { gte: last7d } } }),
    prisma.labelJob.count({ where: { status: 'failed' } }),
    prisma.labelJob.groupBy({ by: ['carrier', 'status'], _count: true }),
    prisma.trackingSubmission.count({ where: { status: { in: ['failed', 'needs_manual'] } } }),
  ]);

  return {
    labels24h,
    labels7d,
    failedLabels,
    byCarrier: byCarrier.map(g => ({
      carrier: g.carrier,
      status: g.status,
      count: g._count,
    })),
    trackingFailed,
  };
}

// --------------------------------------------------------------------------
// E. ETGB / invoice health
// --------------------------------------------------------------------------
export async function getEtgbHealth() {
  const now = Date.now();
  const last24h = new Date(now - DAY);
  const last7d = new Date(now - 7 * DAY);

  const [runs24h, runs7d, failures24h, recent] = await Promise.all([
    prisma.syncLog.count({
      where: {
        category: 'etgb' as any,
        timestamp: { gte: last24h },
      } as any,
    }),
    prisma.syncLog.count({
      where: {
        category: 'etgb' as any,
        timestamp: { gte: last7d },
      } as any,
    }),
    prisma.syncLog.count({
      where: {
        category: 'etgb' as any,
        level: { in: ['warn', 'error'] },
        timestamp: { gte: last24h },
      } as any,
    }),
    prisma.syncLog.findMany({
      take: 25,
      orderBy: { timestamp: 'desc' },
      where: { category: 'etgb' as any } as any,
      select: {
        id: true,
        level: true,
        message: true,
        operation: true,
        userId: true,
        timestamp: true,
      },
    }),
  ]);

  return { runs24h, runs7d, failures24h, recent };
}

// --------------------------------------------------------------------------
// F. Billing health
// --------------------------------------------------------------------------
export async function getBillingHealth() {
  const [byStatus, recentWebhookEvents, billingEventsRecent] = await Promise.all([
    prisma.user.groupBy({ by: ['subscriptionStatus'], _count: true }),
    (prisma as any).webhookEvent.findMany({
      take: 25,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        eventType: true,
        status: true,
        errorMessage: true,
        createdAt: true,
      },
    }),
    prisma.syncLog.findMany({
      take: 25,
      orderBy: { timestamp: 'desc' },
      where: { category: 'billing' as any } as any,
      select: {
        id: true,
        level: true,
        message: true,
        operation: true,
        userId: true,
        timestamp: true,
      },
    }),
  ]);

  return {
    byStatus: byStatus.map(g => ({
      status: g.subscriptionStatus || 'none',
      count: g._count,
    })),
    recentWebhookEvents,
    recent: billingEventsRecent,
  };
}

// --------------------------------------------------------------------------
// G. Users at risk
// --------------------------------------------------------------------------
export async function getUsersAtRisk() {
  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * DAY);

  // Users with active Etsy/Wix/Shopify shops whose tokens expired or expire within 7 days.
  const [etsyExpiring, wixExpiring, shopifyExpiring, recentSyncErrors] = await Promise.all([
    prisma.etsyShop.findMany({
      where: { isActive: true, tokenExpiresAt: { lt: inSevenDays } },
      select: { id: true, userId: true, shopName: true, tokenExpiresAt: true },
      take: 50,
      orderBy: { tokenExpiresAt: 'asc' },
    }),
    prisma.wixSite.findMany({
      where: { isActive: true, tokenExpiresAt: { lt: inSevenDays } },
      select: { id: true, userId: true, siteName: true, tokenExpiresAt: true },
      take: 50,
      orderBy: { tokenExpiresAt: 'asc' },
    }),
    prisma.shopifyShop.findMany({
      where: { isActive: true, tokenExpiresAt: { lt: inSevenDays } },
      select: { id: true, userId: true, shopDomain: true, tokenExpiresAt: true },
      take: 50,
      orderBy: { tokenExpiresAt: 'asc' },
    }),
    prisma.syncOperation.groupBy({
      by: ['userId'],
      where: { status: 'error', createdAt: { gte: new Date(Date.now() - 24 * HOUR) } },
      _count: true,
      orderBy: { _count: { userId: 'desc' } },
      take: 20,
    }),
  ]);

  return {
    tokensExpiring: {
      etsy: etsyExpiring,
      wix: wixExpiring,
      shopify: shopifyExpiring,
    },
    recentSyncErrorsByUser: recentSyncErrors.map(g => ({
      userId: g.userId,
      count: g._count,
    })),
  };
}

// --------------------------------------------------------------------------
// H. Security events
// --------------------------------------------------------------------------
export async function getSecurityEvents(opts: { limit?: number; offset?: number } = {}) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const last24h = new Date(Date.now() - DAY);

  const [recent, total, last24hCount, byOperation] = await Promise.all([
    prisma.syncLog.findMany({
      take: limit,
      skip: offset,
      orderBy: { timestamp: 'desc' },
      where: { category: 'security' as any } as any,
      select: {
        id: true,
        level: true,
        message: true,
        operation: true,
        userId: true,
        timestamp: true,
      },
    }),
    prisma.syncLog.count({ where: { category: 'security' as any } as any }),
    prisma.syncLog.count({
      where: { category: 'security' as any, timestamp: { gte: last24h } } as any,
    }),
    prisma.syncLog.groupBy({
      by: ['operation'],
      where: { category: 'security' as any, timestamp: { gte: last24h } } as any,
      _count: true,
      orderBy: { _count: { operation: 'desc' } },
      take: 20,
    }),
  ]);

  return {
    recent,
    pagination: { limit, offset, total },
    last24h: { total: last24hCount, byOperation: byOperation.map(g => ({ operation: g.operation, count: g._count })) },
  };
}

// --------------------------------------------------------------------------
// I.5 Auth health (verification + password reset)
// --------------------------------------------------------------------------
export async function getAuthHealth() {
  const last24h = new Date(Date.now() - DAY);

  const [
    unverifiedCredentials,
    activeTokensVerify,
    activeTokensReset,
    resetRequests24h,
    failedResetTokens24h,
    emailFailures24h,
    smtpMisconfigured24h,
    recent,
  ] = await Promise.all([
    prisma.user.count({
      where: { emailVerified: null, password: { not: null } },
    }),
    (prisma as any).authToken.count({
      where: { purpose: 'email_verify', consumedAt: null, expires: { gt: new Date() } },
    }),
    (prisma as any).authToken.count({
      where: { purpose: 'password_reset', consumedAt: null, expires: { gt: new Date() } },
    }),
    prisma.syncLog.count({
      where: {
        category: 'auth' as any,
        operation: 'password.reset_requested',
        timestamp: { gte: last24h },
      } as any,
    }),
    prisma.syncLog.count({
      where: {
        category: 'auth' as any,
        operation: 'password.reset_token_rejected',
        timestamp: { gte: last24h },
      } as any,
    }),
    prisma.syncLog.count({
      where: {
        category: 'auth' as any,
        operation: { in: ['email.postmark_failed', 'email.postmark_threw'] },
        timestamp: { gte: last24h },
      } as any,
    }),
    prisma.syncLog.count({
      where: {
        category: 'auth' as any,
        operation: 'email.config_missing',
        timestamp: { gte: last24h },
      } as any,
    }),
    prisma.syncLog.findMany({
      take: 25,
      orderBy: { timestamp: 'desc' },
      where: { category: 'auth' as any } as any,
      select: {
        id: true,
        level: true,
        message: true,
        operation: true,
        userId: true,
        timestamp: true,
      },
    }),
  ]);

  return {
    unverifiedCredentialsUsers: unverifiedCredentials,
    activeTokens: { emailVerify: activeTokensVerify, passwordReset: activeTokensReset },
    last24h: {
      passwordResetRequests: resetRequests24h,
      failedResetTokens: failedResetTokens24h,
      emailDeliveryFailures: emailFailures24h,
      smtpNeedsConfig: smtpMisconfigured24h,
    },
    recent,
  };
}

// --------------------------------------------------------------------------
// I. Chrome extension events
// --------------------------------------------------------------------------
export async function getExtensionHealth() {
  const last24h = new Date(Date.now() - DAY);
  const [acceptedTelemetry24h, rejectedTelemetry24h, trackingPush24h, trackingFailures24h, recent] = await Promise.all([
    prisma.syncLog.count({
      where: {
        category: 'extension' as any,
        operation: 'telemetry.accepted',
        timestamp: { gte: last24h },
      } as any,
    }),
    prisma.syncLog.count({
      where: {
        category: 'security' as any,
        operation: { in: ['extension.origin_rejected', 'telemetry.origin_rejected', 'telemetry.unauthenticated'] },
        timestamp: { gte: last24h },
      } as any,
    }),
    prisma.trackingSubmission.count({
      where: { etsySubmittedAt: { gte: last24h } },
    }),
    prisma.trackingSubmission.count({
      where: {
        // needs_manual = typed but not confirmed saved on Etsy — still needs a human.
        etsySubmitStatus: { in: ['failed', 'needs_manual'] },
        submittedAt: { gte: last24h },
      },
    }),
    prisma.syncLog.findMany({
      take: 25,
      orderBy: { timestamp: 'desc' },
      where: { category: 'extension' as any } as any,
      select: {
        id: true,
        level: true,
        message: true,
        operation: true,
        userId: true,
        timestamp: true,
      },
    }),
  ]);

  return {
    acceptedTelemetry24h,
    rejectedTelemetry24h,
    trackingPush24h,
    trackingFailures24h,
    recent,
  };
}

// --------------------------------------------------------------------------
// Errors feed
// --------------------------------------------------------------------------
export async function getRecentErrors(opts: { limit?: number; offset?: number; category?: string } = {}) {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const where: any = { level: { in: ['warn', 'error'] } };
  if (opts.category) where.category = opts.category;

  const [rows, total] = await Promise.all([
    prisma.syncLog.findMany({
      take: limit,
      skip: offset,
      orderBy: { timestamp: 'desc' },
      where,
      select: {
        id: true,
        level: true,
        message: true,
        operation: true,
        userId: true,
        timestamp: true,
        error: true,
      },
    }),
    prisma.syncLog.count({ where }),
  ]);

  return { rows, pagination: { limit, offset, total } };
}

// --------------------------------------------------------------------------
// Needs-attention queue
// --------------------------------------------------------------------------
export async function buildNeedsAttentionQueue() {
  const [cron, integrations, billing, recentErrors] = await Promise.all([
    getCronHealth(),
    getIntegrationHealth(),
    getBillingHealth(),
    getRecentErrors({ limit: 5 }),
  ]);

  const items: Array<{
    kind: 'cron-stale' | 'token-expired' | 'billing' | 'webhook-failed' | 'etsy-webhook' | 'recent-error';
    severity: 'warn' | 'error';
    message: string;
    meta?: Record<string, any>;
  }> = [];

  for (const job of cron.jobs) {
    if (job.stale) {
      items.push({
        kind: 'cron-stale',
        severity: 'error',
        message: `Cron job "${job.jobName}" has not run within its threshold`,
        meta: { lastRunAt: job.lastRunAt, ageMs: job.ageMs, thresholdMs: job.thresholdMs },
      });
    }
  }

  for (const m of integrations.marketplaces) {
    if (m.expired > 0) {
      items.push({
        kind: 'token-expired',
        severity: 'error',
        message: `${m.expired} ${m.name} shop(s) have expired tokens`,
        meta: { marketplace: m.name, expired: m.expired },
      });
    }
  }

  const failedWebhooks = (billing.recentWebhookEvents || []).filter(
    (w: any) => w.status === 'failed',
  );
  for (const w of failedWebhooks.slice(0, 5)) {
    items.push({
      kind: 'webhook-failed',
      severity: 'warn',
      message: `Webhook ${w.provider ?? '?'}/${w.eventType ?? '?'} failed`,
      meta: { id: w.id, errorMessage: w.errorMessage?.slice(0, 200) },
    });
  }

  const etsyWh = integrations.etsyWebhooks;
  if (etsyWh.failed24h > 0) {
    items.push({
      kind: 'etsy-webhook',
      severity: 'warn',
      message: `${etsyWh.failed24h} Etsy webhook event(s) failed in the last 24h`,
      meta: { failed24h: etsyWh.failed24h },
    });
  }
  if (etsyWh.oldestDueAgeMs !== null && etsyWh.oldestDueAgeMs > 10 * 60 * 1000) {
    items.push({
      kind: 'etsy-webhook',
      severity: 'warn',
      message: 'Etsy webhook queue has due events older than 10 minutes (is the in-process worker running? see the Etsy event backbone card)',
      meta: { oldestDueAgeMs: etsyWh.oldestDueAgeMs },
    });
  }
  if ((etsyWh.depthByStatus?.blocked_reauth ?? 0) > 0) {
    items.push({
      kind: 'etsy-webhook',
      severity: 'warn',
      message: `${etsyWh.depthByStatus.blocked_reauth} Etsy webhook event(s) parked until a shop reconnects`,
      meta: { blockedReauth: etsyWh.depthByStatus.blocked_reauth },
    });
  }

  for (const e of recentErrors.rows.slice(0, 5)) {
    items.push({
      kind: 'recent-error',
      severity: e.level === 'error' ? 'error' : 'warn',
      message: e.message,
      meta: { operation: e.operation, timestamp: e.timestamp },
    });
  }

  return { items };
}

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------
export async function getOverview() {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * DAY);
  const thirtyDaysAgo = new Date(now - 30 * DAY);

  const [
    system,
    totalUsers,
    newUsers7d,
    newUsers30d,
    totalOrders,
    totalShipments,
    needsAttention,
  ] = await Promise.all([
    getSystemHealth(),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.order.count(),
    prisma.shipment.count(),
    buildNeedsAttentionQueue(),
  ]);

  return {
    system,
    totals: { users: totalUsers, orders: totalOrders, shipments: totalShipments },
    growth: { newUsers7d, newUsers30d },
    needsAttention,
  };
}

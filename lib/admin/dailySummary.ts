import {
  getCronHealth,
  getIntegrationHealth,
  getBillingHealth,
  getSecurityEvents,
  getRecentErrors,
  buildNeedsAttentionQueue,
} from './monitoring';
import { logSystemEvent } from './events';

/**
 * Build a plain-text daily summary suitable for SMTP delivery to ADMIN_ALERT_EMAIL.
 *
 * Contains no secrets, no marketplace tokens, no buyer PII. Every counted figure
 * comes from already-redacted sources (SyncLog goes through the central redactor
 * before storage; CronLock and WebhookEvent contain only event metadata).
 */
export async function buildDailySummary(): Promise<string> {
  const [cron, integrations, billing, security, errors, needsAttention] = await Promise.all([
    getCronHealth(),
    getIntegrationHealth(),
    getBillingHealth(),
    getSecurityEvents({ limit: 10 }),
    getRecentErrors({ limit: 10 }),
    buildNeedsAttentionQueue(),
  ]);

  const lines: string[] = [];
  lines.push(`KolayXport — daily ops summary`);
  lines.push(`generated ${new Date().toISOString()}`);
  lines.push('');

  // Needs attention
  lines.push(`Needs attention: ${needsAttention.items.length} item(s)`);
  for (const it of needsAttention.items.slice(0, 10)) {
    lines.push(`  [${it.severity}] ${it.kind} — ${it.message}`);
  }
  lines.push('');

  // Cron
  lines.push('Cron:');
  for (const j of cron.jobs) {
    const ageMin = j.ageMs == null ? 'n/a' : `${Math.round(j.ageMs / 60000)}m`;
    lines.push(`  ${j.jobName}: lastRun=${j.lastRunAt ?? 'never'} age=${ageMin} stale=${j.stale}`);
  }
  lines.push('');

  // Integrations
  lines.push('Integrations (active shops / expired / expiring 7d):');
  for (const m of integrations.marketplaces) {
    lines.push(`  ${m.name}: ${m.total} / ${m.expired} / ${m.expiringSoon}`);
  }
  lines.push(`  integration failures last 24h: ${integrations.failuresLast24h}`);
  lines.push('');

  // Billing
  lines.push('Billing — users by subscription status:');
  for (const s of billing.byStatus) {
    lines.push(`  ${s.status}: ${s.count}`);
  }
  const failedWebhooks = (billing.recentWebhookEvents || []).filter(
    (w: any) => w.status === 'failed',
  );
  lines.push(`  failed webhook events stored: ${failedWebhooks.length}`);
  lines.push('');

  // Security
  lines.push(`Security events last 24h: ${security.last24h.total}`);
  for (const g of security.last24h.byOperation.slice(0, 8)) {
    lines.push(`  ${g.operation || '-'}: ${g.count}`);
  }
  lines.push('');

  // Recent errors tail
  lines.push('Recent errors (tail):');
  for (const e of errors.rows.slice(0, 8)) {
    lines.push(`  [${e.level}] ${e.timestamp} ${e.operation || '-'} — ${e.message.slice(0, 200)}`);
  }

  return lines.join('\n');
}

/**
 * Send the daily summary via SMTP IF ADMIN_ALERT_EMAIL is set AND the existing
 * ETGB_SMTP_* env vars are present (we reuse the existing nodemailer wiring rather
 * than introducing a new SMTP config). Otherwise, the summary is only logged
 * as a `system` SyncLog row.
 *
 * Returns a small status object so the cron route can surface it in its response.
 */
export async function sendDailySummary(): Promise<{
  built: true;
  sent: boolean;
  reason?: string;
  bytes: number;
}> {
  const body = await buildDailySummary();
  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!to) {
    logSystemEvent('info', {
      message: 'Daily summary built (no ADMIN_ALERT_EMAIL configured)',
      operation: 'admin.daily_summary',
      details: { bytes: body.length },
    });
    return { built: true, sent: false, reason: 'no_admin_email', bytes: body.length };
  }

  const host = process.env.ETGB_SMTP_HOST;
  const port = parseInt(process.env.ETGB_SMTP_PORT || '465', 10);
  const user = process.env.ETGB_SMTP_USER;
  const pass = process.env.ETGB_SMTP_PASS;
  const from = process.env.ETGB_SMTP_FROM || user;
  if (!host || !user || !pass || !from) {
    logSystemEvent('warn', {
      message: 'Daily summary email skipped: SMTP env incomplete',
      operation: 'admin.daily_summary',
      details: { reason: 'smtp_env_missing' },
    });
    return { built: true, sent: false, reason: 'smtp_env_missing', bytes: body.length };
  }

  try {
    // Lazy import so test envs without nodemailer don't crash on module load.
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    await transport.sendMail({
      from,
      to,
      subject: `KolayXport ops summary — ${new Date().toISOString().slice(0, 10)}`,
      text: body,
    });
    logSystemEvent('info', {
      message: 'Daily summary email sent',
      operation: 'admin.daily_summary',
      details: { to, bytes: body.length },
    });
    return { built: true, sent: true, bytes: body.length };
  } catch (err) {
    logSystemEvent('error', {
      message: 'Daily summary email failed',
      operation: 'admin.daily_summary',
      details: { reason: 'smtp_send_failed' },
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return { built: true, sent: false, reason: 'smtp_send_failed', bytes: body.length };
  }
}

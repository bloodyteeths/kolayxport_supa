// Server-side copies of funnel events (docs/gtm/tracking/README.md):
//   • Meta Conversions API   — META_PIXEL_ID + META_CAPI_TOKEN (+ META_TEST_EVENT_CODE while testing)
//   • GA4 Measurement Protocol — GA4_MEASUREMENT_ID + GA4_API_SECRET
// Sent only when the visitor's consent allows it (kx_consent cookie: marketing → Meta, analytics → GA4),
// with the same event_id as the browser event so the platforms de-duplicate.
// Never throws and never blocks the request for more than ~1.5 s.
import crypto from 'crypto';
import type { NextApiRequest } from 'next';
import { parseConsentCookie } from './consent';
import type { FunnelEvent } from './events';
import { logger } from '@/lib/logger';

export interface ServerEventContext {
  consent: { analytics: boolean; marketing: boolean };
  ip?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
  gaClientId?: string;
  pageUrl?: string;
}

export interface ServerEvent {
  name: FunnelEvent;
  eventId: string;
  email?: string | null;
  userId?: string | null;
  value?: number;
  currency?: string;
  params?: Record<string, string | number | boolean>;
}

const META_NAMES: Partial<Record<FunnelEvent, string>> = {
  sign_up: 'CompleteRegistration',
  start_trial: 'StartTrial',
  begin_checkout: 'InitiateCheckout',
  purchase: 'Purchase',
  contact_submit: 'Contact',
  view_pricing: 'ViewContent',
};

function cookie(req: NextApiRequest, name: string): string | undefined {
  const raw = req.cookies?.[name];
  return typeof raw === 'string' && raw ? raw : undefined;
}

/** Reads consent + click ids from the incoming browser request. */
export function contextFromRequest(req: NextApiRequest): ServerEventContext {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ga = cookie(req, '_ga'); // GA1.1.<client id>
  return {
    consent: parseConsentCookie(cookie(req, 'kx_consent')),
    ip: fwd || req.socket?.remoteAddress || undefined,
    userAgent: String(req.headers['user-agent'] || '') || undefined,
    fbp: cookie(req, '_fbp'),
    fbc: cookie(req, '_fbc'),
    gaClientId: ga ? ga.split('.').slice(-2).join('.') : undefined,
    pageUrl: String(req.headers.referer || '') || undefined,
  };
}

/** Compact form stored in Stripe checkout metadata so the webhook can send `purchase` later. */
export function contextToMetadata(ctx: ServerEventContext): Record<string, string> {
  return {
    kx_consent: `a${ctx.consent.analytics ? 1 : 0}m${ctx.consent.marketing ? 1 : 0}`,
    ...(ctx.fbp ? { kx_fbp: ctx.fbp } : {}),
    ...(ctx.fbc ? { kx_fbc: ctx.fbc } : {}),
    ...(ctx.gaClientId ? { kx_ga: ctx.gaClientId } : {}),
  };
}

export function contextFromMetadata(md: Record<string, string> | null | undefined): ServerEventContext {
  return {
    consent: parseConsentCookie(md?.kx_consent),
    fbp: md?.kx_fbp || undefined,
    fbc: md?.kx_fbc || undefined,
    gaClientId: md?.kx_ga || undefined,
  };
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

async function post(url: string, body: unknown) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) logger.warn('Server tracking event rejected', { url: url.split('?')[0], status: res.status });
  } finally {
    clearTimeout(timer);
  }
}

export async function sendServerEvent(ev: ServerEvent, ctx: ServerEventContext): Promise<void> {
  const jobs: Promise<unknown>[] = [];

  const pixel = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  const metaName = META_NAMES[ev.name];
  if (pixel && token && metaName && ctx.consent.marketing) {
    jobs.push(post(`https://graph.facebook.com/v21.0/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
      data: [{
        event_name: metaName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: ev.eventId,
        action_source: 'website',
        ...(ctx.pageUrl ? { event_source_url: ctx.pageUrl } : {}),
        user_data: {
          ...(ev.email ? { em: [sha256(ev.email)] } : {}),
          ...(ev.userId ? { external_id: [sha256(ev.userId)] } : {}),
          ...(ctx.ip ? { client_ip_address: ctx.ip } : {}),
          ...(ctx.userAgent ? { client_user_agent: ctx.userAgent } : {}),
          ...(ctx.fbp ? { fbp: ctx.fbp } : {}),
          ...(ctx.fbc ? { fbc: ctx.fbc } : {}),
        },
        ...(ev.value != null ? { custom_data: { value: ev.value, currency: (ev.currency || 'TRY').toUpperCase() } } : {}),
      }],
      ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
    }));
  }

  const mid = process.env.GA4_MEASUREMENT_ID;
  const secret = process.env.GA4_API_SECRET;
  if (mid && secret && ctx.consent.analytics && ctx.gaClientId) {
    jobs.push(post(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(mid)}&api_secret=${encodeURIComponent(secret)}`, {
      client_id: ctx.gaClientId,
      ...(ev.userId ? { user_id: ev.userId } : {}),
      events: [{
        name: ev.name,
        params: {
          event_id: ev.eventId,
          ...(ev.value != null ? { value: ev.value, currency: (ev.currency || 'TRY').toUpperCase() } : {}),
          ...(ev.params || {}),
        },
      }],
    }));
  }

  if (!jobs.length) return;
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') logger.warn('Server tracking event failed', { name: ev.name, error: String(r.reason) });
}

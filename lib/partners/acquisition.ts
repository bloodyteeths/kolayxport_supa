// lib/partners/acquisition.ts — writes a user's first-touch attribution once (docs/gtm/referral-spec.md §2.5).
// Called by the email signup (via 'signup'), the post-login claim endpoint (via 'claim', OAuth users) and later the
// Stripe promo-code path (via 'promo'). Sources per field: our first-party cookies (kx_ref / kx_ft) first, then the
// body copy from localStorage (lib/tracking/events.ts readAttribution()).
//
// Exclusions keep refCode for audit but leave partnerId null: the partner's own e-mail, admins, store/directory
// reviewer accounts, and Shopify-connected accounts (no referral credit there).
import prisma from '@/lib/prisma';
import {
  FT_COOKIE,
  REF_COOKIE,
  normalizeRefCode,
  parseFtCookie,
  parseRefCookie,
  sanitizeFirstTouch,
  type FirstTouch,
} from './cookies';

export type AcquisitionVia = 'signup' | 'claim' | 'promo';

/** Reviewer accounts never earn a partner anything. Env adds to these. */
const DEFAULT_REVIEW_EMAILS = ['review@kolayxport.com', 'play-review@kolayxport.com', 'mcp-review@kolayxport.com'];

export function reviewAccountEmails(): Set<string> {
  const extra = (process.env.REVIEW_ACCOUNT_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return new Set([...DEFAULT_REVIEW_EMAILS, ...extra]);
}

export interface AcquisitionInput {
  cookies?: Partial<Record<string, string>>;
  /** readAttribution() from the browser: utm_*, landing, ref, at (ms). */
  body?: unknown;
  via: AcquisitionVia;
}

export interface ResolvedTouch {
  ft: FirstTouch | null;
  refCode: string | null;
  firstSeenAt: Date | null;
}

/** Pure: merges cookie and body sources (cookie wins per field). */
export function resolveTouch(input: Pick<AcquisitionInput, 'cookies' | 'body'>): ResolvedTouch {
  const refCookie = parseRefCookie(input.cookies?.[REF_COOKIE]);
  const ftCookie = parseFtCookie(input.cookies?.[FT_COOKIE]);
  const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body) ? (input.body as Record<string, unknown>) : {};
  const bodyAtMs = typeof body.at === 'number' && Number.isFinite(body.at) ? (body.at > 1e12 ? body.at : body.at * 1000) : null;
  const ftBody = sanitizeFirstTouch({ ...body, at: bodyAtMs ? Math.floor(bodyAtMs / 1000) : undefined });
  const ft = ftCookie ?? ftBody;
  const refCode = refCookie?.code ?? normalizeRefCode(body.ref);
  const candidates = [refCookie?.at, ft?.at].filter((v): v is number => typeof v === 'number');
  const firstSeenSec = candidates.length ? Math.min(...candidates) : bodyAtMs ? Math.floor(bodyAtMs / 1000) : null;
  return { ft, refCode, firstSeenAt: firstSeenSec ? new Date(firstSeenSec * 1000) : null };
}

export type RecordResult = { status: 'created'; partnerId: string | null } | { status: 'exists' } | { status: 'no_user' };

type UserForExclusion = { email: string | null; role: string | null; billingProvider: string | null; subscriptionPlan: string | null; shopifyShops: { id: string }[] };

export const EXCLUSION_USER_SELECT = { email: true, role: true, billingProvider: true, subscriptionPlan: true, shopifyShops: { where: { isActive: true }, select: { id: true }, take: 1 } } as const;

/** Exclusion rules (§2.5): the partner's own e-mail, admins, review accounts, Shopify-connected accounts. */
export function isExcluded(user: UserForExclusion, partner: { email: string | null }): boolean {
  const email = (user.email || '').toLowerCase();
  const shopify = user.billingProvider === 'shopify' || user.billingProvider === 'shopify_free' || user.subscriptionPlan === 'shopify_free' || user.shopifyShops.length > 0;
  return Boolean(
    (partner.email && email && partner.email.toLowerCase() === email)
    || user.role === 'admin'
    || reviewAccountEmails().has(email)
    || shopify,
  );
}

/** May this user be credited to this (active) partner? Used by the promo-code path. */
export async function partnerAllowedFor(userId: string, partnerId: string): Promise<boolean> {
  const [user, partner] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: EXCLUSION_USER_SELECT }),
    prisma.partner.findFirst({ where: { id: partnerId, status: 'active' }, select: { email: true } }),
  ]);
  return Boolean(user && partner && !isExcluded(user, partner));
}

export async function recordAcquisition(userId: string, input: AcquisitionInput): Promise<RecordResult> {
  const existing = await prisma.userAcquisition.findUnique({ where: { userId }, select: { userId: true } });
  if (existing) return { status: 'exists' };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: EXCLUSION_USER_SELECT });
  if (!user) return { status: 'no_user' };

  const touch = resolveTouch(input);
  let partnerId: string | null = null;
  if (touch.refCode) {
    const partner = await prisma.partner.findFirst({ where: { code: touch.refCode, status: 'active' }, select: { id: true, email: true } });
    partnerId = partner && !isExcluded(user, partner) ? partner.id : null;
  }
  try {
    await prisma.userAcquisition.create({
      data: {
        userId,
        utmSource: touch.ft?.utm_source ?? null,
        utmMedium: touch.ft?.utm_medium ?? null,
        utmCampaign: touch.ft?.utm_campaign ?? null,
        utmContent: touch.ft?.utm_content ?? null,
        utmTerm: touch.ft?.utm_term ?? null,
        landing: touch.ft?.landing ?? null,
        refCode: touch.refCode,
        partnerId,
        via: input.via,
        firstSeenAt: touch.firstSeenAt,
      },
    });
  } catch (e) {
    // Lost a race with a parallel claim: the row exists now.
    if ((e as { code?: string })?.code === 'P2002') return { status: 'exists' };
    throw e;
  }
  return { status: 'created', partnerId };
}

// lib/account/deleteAccount.ts — permanent, self-service account deletion (SERVER ONLY). Required by Google Play
// (in-app + web deletion) and promised in the privacy policy. Order matters:
//   1. stop billing: cancel every live Stripe subscription (the Stripe customer and its invoices stay in Stripe,
//      which is where the legally retained invoice records live; nothing is charged again);
//   2. delete the rows: user-owned tables without a User relation first, then the User row, whose relations
//      cascade (orders, credentials, drafts, shops, tokens…; AiUsage keeps anonymous cost rows via SetNull);
//   3. delete the user's staged media folders on disk.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { logger } from '@/lib/logger';
import { ETSY_DRAFT_UPLOAD_ROOT } from '@/lib/etsy/mediaSafety';
import { VIDEO_UPLOAD_ROOT } from '@/lib/ai/video';

const EBAY_UPLOAD_ROOT = process.env.EBAY_IMAGE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ebay-images');

/** Stripe statuses that can still bill or be resumed. */
const LIVE_SUBSCRIPTION = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused']);

export interface DeleteAccountResult {
  subscriptionsCanceled: number;
  foldersRemoved: number;
}

async function cancelStripe(customerId: string | null): Promise<number> {
  if (!customerId || !process.env.STRIPE_SECRET_KEY) return 0;
  let canceled = 0;
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  for (const s of subs.data) {
    if (!LIVE_SUBSCRIPTION.has(s.status)) continue;
    await stripe.subscriptions.cancel(s.id, { invoice_now: false, prorate: false });
    canceled++;
  }
  return canceled;
}

async function removeFolders(userId: string): Promise<number> {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return 0;
  let removed = 0;
  for (const root of [ETSY_DRAFT_UPLOAD_ROOT, EBAY_UPLOAD_ROOT, VIDEO_UPLOAD_ROOT]) {
    const dir = path.join(root, safe);
    // Never leave the upload root (the id is sanitised, this is the belt to those braces).
    if (path.dirname(dir) !== path.resolve(root)) continue;
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      removed++;
    } catch (err) {
      logger.warn('Account deletion: could not remove upload folder', { dir, error: (err as Error).message });
    }
  }
  return removed;
}

export async function deleteUserAccount(userId: string): Promise<DeleteAccountResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, stripeCustomerId: true } });
  if (!user) return { subscriptionsCanceled: 0, foldersRemoved: 0 };

  // A Stripe failure stops the deletion: deleting the account while a subscription keeps charging is worse.
  const subscriptionsCanceled = await cancelStripe(user.stripeCustomerId);

  const where = { userId };
  await prisma.$transaction([
    // User-owned tables that carry a userId but no User relation (no cascade).
    prisma.etsyListingVersion.deleteMany({ where }),
    prisma.seoExperiment.deleteMany({ where }),
    prisma.webhookEvent.deleteMany({ where }),
    prisma.researchCache.deleteMany({ where }),
    prisma.stockLink.deleteMany({ where }),
    prisma.stockLedger.deleteMany({ where }),
    prisma.stockPush.deleteMany({ where }),
    prisma.stockObservation.deleteMany({ where }),
    prisma.stockSnapshot.deleteMany({ where }),
    prisma.mcpOAuthCode.deleteMany({ where }),
    prisma.hepsiburadaUploadBatch.deleteMany({ where }),
    // Relations without onDelete: Cascade.
    prisma.syncLog.deleteMany({ where }),
    // retryOf is ON DELETE RESTRICT (checked per row, even inside one DELETE): unlink retries first.
    prisma.syncOperation.updateMany({ where: { userId, retryOf: { not: null } }, data: { retryOf: null } }),
    prisma.syncOperation.deleteMany({ where }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  const foldersRemoved = await removeFolders(userId);
  // No userId on the log row: it would be the only thing left pointing at the person.
  const ref = crypto.createHash('sha256').update(userId).digest('hex').slice(0, 12);
  logger.info('Account deleted by its owner', { ref, subscriptionsCanceled, foldersRemoved });
  return { subscriptionsCanceled, foldersRemoved };
}

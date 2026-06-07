/**
 * Provision (or repair) the review@kolayxport.com account used by the
 * Shopify App Store reviewer.
 *
 * Run on Hetzner:
 *   cd /home/deploy/kolayxport && npx tsx scripts/provision-shopify-review-account.ts
 *
 * Idempotent: creates if missing, otherwise resets password + ensures
 * emailVerified is set + flips billing to shopify_free so the user never
 * sees the Stripe pricing page.
 */

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';

const REVIEW_EMAIL = 'review@kolayxport.com';
const REVIEW_PASSWORD = 'ShopifyReview2026!';
const REVIEW_NAME = 'Shopify App Reviewer';

async function main() {
  const hashedPassword = await bcrypt.hash(REVIEW_PASSWORD, 12);
  const now = new Date();
  const trialMs = 30 * 24 * 60 * 60 * 1000;

  const existing = await prisma.user.findUnique({ where: { email: REVIEW_EMAIL } });

  if (existing) {
    await prisma.user.update({
      where: { email: REVIEW_EMAIL },
      data: {
        password: hashedPassword,
        emailVerified: existing.emailVerified ?? now,
        name: existing.name || REVIEW_NAME,
        // Reviewer counts as a Shopify-installed merchant — free tier, no Stripe upsell.
        subscriptionPlan: 'shopify_free',
        subscriptionStatus: 'active',
        billingProvider: 'shopify_free',
        trialExpiresAt: new Date(Date.now() + trialMs),
        usageResetAt: new Date(Date.now() + trialMs),
      },
    });
    console.log(`Updated existing review account: ${REVIEW_EMAIL}`);
    console.log(`  emailVerified: ${(existing.emailVerified ?? now).toISOString()}`);
    return;
  }

  const created = await prisma.user.create({
    data: {
      id: uuidv4(),
      email: REVIEW_EMAIL,
      name: REVIEW_NAME,
      password: hashedPassword,
      emailVerified: now,
      subscriptionPlan: 'shopify_free',
      subscriptionStatus: 'active',
      billingProvider: 'shopify_free',
      trialExpiresAt: new Date(Date.now() + trialMs),
      usageResetAt: new Date(Date.now() + trialMs),
      orderSyncCount: 0,
      labelCount: 0,
    },
  });
  console.log(`Created review account: ${REVIEW_EMAIL} (id=${created.id})`);
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

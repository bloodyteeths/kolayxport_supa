/**
 * Provision (or repair) the play-review@kolayxport.com account given to the Google Play app reviewer
 * (Play Console › App content › App access).
 *
 * Run on Hetzner, password via stdin (never in git or shell history):
 *   cd /home/deploy/kolayxport && PLAY_REVIEW_PASSWORD="$(cat)" npx tsx scripts/provision-play-review-account.ts
 *
 * Idempotent: creates the account if missing, otherwise resets the password. A verified e-mail and a 90-day
 * trial (every feature on), so the reviewer can open every screen. Inside the Play app no billing is shown anyway.
 */
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';

const REVIEW_EMAIL = 'play-review@kolayxport.com';
const REVIEW_NAME = 'Google Play Reviewer';
const DAY_MS = 86_400_000;

async function main() {
  const password = (process.env.PLAY_REVIEW_PASSWORD || '').trim();
  if (password.length < 12) throw new Error('PLAY_REVIEW_PASSWORD (12+ chars) is required');
  const hashed = await bcrypt.hash(password, 12);
  const until = new Date(Date.now() + 90 * DAY_MS);
  const trial = { subscriptionPlan: 'trial', subscriptionStatus: 'trialing', trialExpiresAt: until, usageResetAt: until };

  const existing = await prisma.user.findUnique({ where: { email: REVIEW_EMAIL } });
  if (existing) {
    await prisma.user.update({
      where: { email: REVIEW_EMAIL },
      data: { password: hashed, emailVerified: existing.emailVerified ?? new Date(), ...trial },
    });
    console.log(`Updated review account: ${REVIEW_EMAIL}`);
    return;
  }
  const created = await prisma.user.create({
    data: { id: uuidv4(), email: REVIEW_EMAIL, name: REVIEW_NAME, password: hashed, emailVerified: new Date(), orderSyncCount: 0, labelCount: 0, ...trial },
  });
  console.log(`Created review account: ${REVIEW_EMAIL} (id=${created.id})`);
}

main()
  .catch((err) => {
    console.error('Failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

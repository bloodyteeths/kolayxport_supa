#!/usr/bin/env -S npx tsx
/**
 * scripts/backfill-encrypt-credentials.ts
 *
 * Walks the credential-bearing Prisma models and encrypts any column whose value
 * is plaintext (does not match the `enc:v1:` envelope).
 *
 * Usage:
 *   npx tsx scripts/backfill-encrypt-credentials.ts --dry-run
 *   npx tsx scripts/backfill-encrypt-credentials.ts --apply
 *
 * Never prints credential values. Prints per-(model, field) counts only.
 *
 * Requires CREDENTIAL_ENCRYPTION_KEY in env.
 */
import prisma from '@/lib/prisma';
import { encryptIfNeeded, isEncrypted } from '@/lib/crypto/credentials';

interface FieldPlan {
  model: keyof typeof prisma;
  fields: string[];
}

// All known secret-bearing fields. Identifiers (account numbers, supplier ids,
// shop ids) are intentionally NOT in this list — they're not secrets and
// encrypting them would break SQL-side joins/lookups.
const PLAN: FieldPlan[] = [
  {
    model: 'credential' as any,
    fields: [
      'veeqoApiKey',
      'shippoToken',
      'fedexApiKey',
      'fedexApiSecret',
      'hepsiburadaApiKey',
      'trendyolApiKey',
      'trendyolApiSecret',
      'upsApiKey',
      'upsApiSecret',
      'parasutClientSecret',
      'parasutPassword',
      'etsyAccessToken',
      'etsyRefreshToken',
      'ebayAccessToken',
      'ebayRefreshToken',
      'wixAccessToken',
      'wixRefreshToken',
      'shopifyAccessToken',
      'mngPassword',
      'mngAppSecret',
      'amazonAccessToken',
      'amazonRefreshToken',
    ],
  },
  {
    model: 'etsyShop' as any,
    fields: ['accessToken', 'refreshToken'],
  },
  {
    model: 'wixSite' as any,
    fields: ['accessToken', 'refreshToken'],
  },
  {
    model: 'shopifyShop' as any,
    fields: ['accessToken', 'refreshToken'],
  },
];

const PAGE_SIZE = 100;

interface Counter {
  rowsScanned: number;
  fieldPlaintext: Record<string, number>;
  fieldEncrypted: Record<string, number>;
  fieldNull: Record<string, number>;
  rowsUpdated: number;
}

function emptyCounter(fields: string[]): Counter {
  const c: Counter = {
    rowsScanned: 0,
    fieldPlaintext: {},
    fieldEncrypted: {},
    fieldNull: {},
    rowsUpdated: 0,
  };
  for (const f of fields) {
    c.fieldPlaintext[f] = 0;
    c.fieldEncrypted[f] = 0;
    c.fieldNull[f] = 0;
  }
  return c;
}

async function processModel(plan: FieldPlan, apply: boolean): Promise<Counter> {
  const counter = emptyCounter(plan.fields);
  const delegate: any = (prisma as any)[plan.model];
  if (!delegate || typeof delegate.findMany !== 'function') {
    console.error(`[backfill] unknown model: ${String(plan.model)}`);
    return counter;
  }

  const select: Record<string, true> = { id: true };
  for (const f of plan.fields) select[f] = true;

  let skip = 0;
  while (true) {
    const rows = await delegate.findMany({
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      skip,
      select,
    });
    if (rows.length === 0) break;
    counter.rowsScanned += rows.length;

    for (const row of rows) {
      const updates: Record<string, string> = {};
      let touched = false;
      for (const f of plan.fields) {
        const v = row[f];
        if (v == null) {
          counter.fieldNull[f]++;
          continue;
        }
        if (typeof v !== 'string') {
          // Unexpected column shape — skip; do not raise to avoid leaking values.
          continue;
        }
        if (isEncrypted(v)) {
          counter.fieldEncrypted[f]++;
          continue;
        }
        counter.fieldPlaintext[f]++;
        if (apply) {
          updates[f] = encryptIfNeeded(v) as string;
          touched = true;
        }
      }
      if (apply && touched) {
        await delegate.update({ where: { id: row.id }, data: updates });
        counter.rowsUpdated++;
      }
    }

    if (rows.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  return counter;
}

function printCounter(modelName: string, counter: Counter) {
  console.log(`\n=== ${modelName} ===`);
  console.log(`rowsScanned: ${counter.rowsScanned}`);
  console.log(`rowsUpdated: ${counter.rowsUpdated}`);
  const fields = Object.keys(counter.fieldPlaintext);
  const maxLen = fields.reduce((m, f) => Math.max(m, f.length), 0);
  for (const f of fields) {
    const plain = counter.fieldPlaintext[f];
    const enc = counter.fieldEncrypted[f];
    const nul = counter.fieldNull[f];
    console.log(
      `  ${f.padEnd(maxLen, ' ')}  plaintext=${plain.toString().padStart(5, ' ')}  encrypted=${enc
        .toString()
        .padStart(5, ' ')}  null=${nul.toString().padStart(5, ' ')}`,
    );
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const dryRun = args.has('--dry-run') || !apply;

  if (apply && dryRun && process.argv.includes('--apply')) {
    // explicit --apply wins
  }

  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    console.error('[backfill] CREDENTIAL_ENCRYPTION_KEY is not set; refusing to run.');
    process.exit(2);
  }

  console.log(`[backfill] mode=${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log('[backfill] values are never printed.');

  const totals: Array<{ name: string; counter: Counter }> = [];
  for (const plan of PLAN) {
    const counter = await processModel(plan, apply);
    totals.push({ name: String(plan.model), counter });
    printCounter(String(plan.model), counter);
  }

  // Summary
  let totalPlain = 0;
  let totalEnc = 0;
  let totalNull = 0;
  let totalUpdated = 0;
  for (const t of totals) {
    for (const f of Object.keys(t.counter.fieldPlaintext)) {
      totalPlain += t.counter.fieldPlaintext[f];
      totalEnc += t.counter.fieldEncrypted[f];
      totalNull += t.counter.fieldNull[f];
    }
    totalUpdated += t.counter.rowsUpdated;
  }
  console.log('\n=== TOTAL ===');
  console.log(`plaintext columns:  ${totalPlain}`);
  console.log(`encrypted columns:  ${totalEnc}`);
  console.log(`null columns:       ${totalNull}`);
  console.log(`rows updated:       ${totalUpdated}`);
  console.log(`mode:               ${apply ? 'APPLY' : 'DRY-RUN'}`);

  await prisma.$disconnect();
}

main().catch(async err => {
  console.error('[backfill] fatal:', err instanceof Error ? err.message : err);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});

/**
 * Safe DB harness for one-off W4 maintenance scripts.
 *
 * Rules (enforced here, not by convention):
 *  - Never loads .env.local (which points at production on dev machines).
 *    Only the process env is used; if DATABASE_URL is unset, `.env` in the
 *    current directory is read explicitly (on the VPS that is the prod .env).
 *  - Prints the target host before doing anything.
 *  - Dry-run by default. `--apply` additionally requires KX_ALLOW_PROD_WRITE=1
 *    AND `--db-host=<host>` matching the host parsed from DATABASE_URL.
 *  - Scripts print counts only — never buyer PII.
 *
 * Usage: npx tsx scripts/<script>.ts [--apply --db-host=<host>] [--user=<userId>] [--limit=N]
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

export type SafeDbArgs = { apply: boolean; dbHost: string | null; userId: string | null; limit: number | null; flags: Record<string, string | true> };

export function parseArgs(argv: string[]): SafeDbArgs {
  const flags: Record<string, string | true> = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq === -1) flags[a.slice(2)] = true;
    else flags[a.slice(2, eq)] = a.slice(eq + 1);
  }
  const limit = typeof flags.limit === 'string' ? Number(flags.limit) : NaN;
  return {
    apply: flags.apply === true,
    dbHost: typeof flags['db-host'] === 'string' ? (flags['db-host'] as string) : null,
    userId: typeof flags.user === 'string' ? (flags.user as string) : null,
    limit: Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : null,
    flags,
  };
}

export function parseDbHost(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname || null;
  } catch {
    const m = /@([^:/?]+)/.exec(url);
    return m ? m[1] : null;
  }
}

/** Pure: may this run write? */
export function checkApplyAllowed(a: { apply: boolean; envAllow: string | undefined; dbHostArg: string | null; actualHost: string | null }): { write: boolean; error?: string } {
  if (!a.apply) return { write: false };
  if (a.envAllow !== '1') return { write: false, error: '--apply requires KX_ALLOW_PROD_WRITE=1' };
  if (!a.dbHostArg) return { write: false, error: '--apply requires --db-host=<host of DATABASE_URL>' };
  if (!a.actualHost || a.dbHostArg !== a.actualHost) return { write: false, error: `--db-host=${a.dbHostArg} does not match DATABASE_URL host ${a.actualHost ?? '(unparsable)'}` };
  return { write: true };
}

/** Read KEY=VALUE pairs from ./.env without overriding existing env (never .env.local). */
function loadDotEnvIfNeeded() {
  if (process.env.DATABASE_URL) return;
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

export type SafeDbContext = {
  prisma: PrismaClient;
  /** true only when --apply passed every check */
  write: boolean;
  host: string;
  args: SafeDbArgs;
  count: (key: string, n?: number) => void;
};

export async function runSafeDbScript(name: string, fn: (ctx: SafeDbContext) => Promise<void>): Promise<void> {
  loadDotEnvIfNeeded();
  const args = parseArgs(process.argv.slice(2));
  const host = parseDbHost(process.env.DATABASE_URL);
  console.log(`[${name}] target DB host: ${host ?? '(DATABASE_URL not set)'}`);
  if (!host) {
    console.error(`[${name}] DATABASE_URL is not set — aborting.`);
    process.exit(2);
  }
  const allowed = checkApplyAllowed({ apply: args.apply, envAllow: process.env.KX_ALLOW_PROD_WRITE, dbHostArg: args.dbHost, actualHost: host });
  if (allowed.error) {
    console.error(`[${name}] refusing to write: ${allowed.error}`);
    process.exit(2);
  }
  console.log(`[${name}] mode: ${allowed.write ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);

  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  const counts = new Map<string, number>();
  const ctx: SafeDbContext = {
    prisma,
    write: allowed.write,
    host,
    args,
    count: (key, n = 1) => counts.set(key, (counts.get(key) || 0) + n),
  };
  try {
    await fn(ctx);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    console.log(`[${name}] counts:`);
    for (const [k, v] of [...counts.entries()].sort()) console.log(`  ${k}: ${v}`);
  }
}

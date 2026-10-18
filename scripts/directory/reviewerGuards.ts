/**
 * Guard logic for scripts/directory/seed-reviewer-account.ts (pure, unit-tested in
 * test/scripts/directory/reviewerGuards.test.ts).
 *
 * The seed refuses to run unless:
 *   - REVIEWER_EMAIL is set (a plain e-mail address), AND
 *   - the database is a local throwaway one (host localhost / 127.0.0.1 / ::1, database not "kolayxport", NODE_ENV
 *     not production), OR
 *     `--production` is passed together with CONFIRM=seed-reviewer-<REVIEWER_EMAIL>.
 * `--remove` deletes the account instead of seeding it (same guards).
 * `--dry-run` plans everything and writes nothing.
 */

import path from 'path';

export type ReviewerMode = 'seed' | 'remove';

export interface ReviewerArgs {
  dryRun: boolean;
  production: boolean;
  remove: boolean;
  rotatePassword: boolean;
  unknown: string[];
}

export interface GuardInput {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  /** The repository / app directory: the password file must live outside it (never committed, never deployed). */
  cwd: string;
}

export type GuardResult =
  | {
      ok: true;
      mode: ReviewerMode;
      dryRun: boolean;
      rotatePassword: boolean;
      email: string;
      dbUrl: string;
      dbVar: string;
      dbHost: string;
      dbName: string;
      local: boolean;
      secretOut: string | null;
    }
  | { ok: false; reason: string };

const KNOWN_FLAGS = new Set(['--dry-run', '--production', '--remove', '--rotate-password']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Database names that are production even on localhost (the VPS runs Postgres locally). */
export const PROTECTED_DB_NAMES = new Set(['kolayxport']);
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export function parseArgs(argv: readonly string[]): ReviewerArgs {
  const flags = argv.filter((a) => a.startsWith('--'));
  return {
    dryRun: flags.includes('--dry-run'),
    production: flags.includes('--production'),
    remove: flags.includes('--remove'),
    rotatePassword: flags.includes('--rotate-password'),
    unknown: argv.filter((a) => !KNOWN_FLAGS.has(a)),
  };
}

/** Host of a postgres URL ('' when unparseable). Exported for tests. */
export function dbHostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Database name of a postgres URL ('' when unparseable). */
export function dbNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')).toLowerCase();
  } catch {
    return '';
  }
}

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.toLowerCase());
}

/** The exact CONFIRM value a production run needs. */
export function confirmTokenFor(email: string): string {
  return `seed-reviewer-${email}`;
}

export function normalizeEmail(raw: string | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

/** Decides whether the seed may run, and with what. Pure: reads only its input. */
export function checkGuards(input: GuardInput): GuardResult {
  const args = parseArgs(input.argv);
  if (args.unknown.length) return { ok: false, reason: `Unknown argument(s): ${args.unknown.join(' ')}. Allowed: ${Array.from(KNOWN_FLAGS).join(' ')}` };
  if (args.remove && args.rotatePassword) return { ok: false, reason: '--remove and --rotate-password cannot be combined' };

  const email = normalizeEmail(input.env.REVIEWER_EMAIL);
  if (!email) return { ok: false, reason: 'REVIEWER_EMAIL is not set' };
  if (!EMAIL_RE.test(email)) return { ok: false, reason: `REVIEWER_EMAIL is not a valid e-mail address: ${email}` };

  // The same URL the app's Prisma client uses (lib/prisma.ts), so the account lands in the database the app reads.
  const dbVar = (['DIRECT_URL', 'DATABASE_URL_NOPREP', 'DATABASE_URL'] as const).find((k) => String(input.env[k] ?? '').trim()) ?? null;
  if (!dbVar) return { ok: false, reason: 'DATABASE_URL is not set' };
  const dbUrl = String(input.env[dbVar]).trim();
  const dbHost = dbHostOf(dbUrl);
  if (!dbHost) return { ok: false, reason: `${dbVar} cannot be parsed` };
  const dbName = dbNameOf(dbUrl);
  // Production's Postgres runs on the VPS itself (host localhost, database "kolayxport"): a local host alone does
  // not make a database a throwaway one.
  const local = isLocalHost(dbHost) && !PROTECTED_DB_NAMES.has(dbName) && input.env.NODE_ENV !== 'production';

  if (!local || args.production) {
    // A non-local database (or an explicit --production) needs BOTH the flag and the exact confirmation.
    if (!args.production) {
      return { ok: false, reason: `Database ${dbHost}/${dbName} is not a local throwaway database: pass --production and CONFIRM=${confirmTokenFor(email)}` };
    }
    if (input.env.CONFIRM !== confirmTokenFor(email)) {
      return { ok: false, reason: `--production needs CONFIRM=${confirmTokenFor(email)} (exactly)` };
    }
  }

  const rawSecret = String(input.env.REVIEWER_SECRET_OUT ?? '').trim();
  const secretOut = rawSecret ? path.resolve(input.cwd, rawSecret) : null;
  if (secretOut) {
    const root = path.resolve(input.cwd);
    if (secretOut === root || secretOut.startsWith(root + path.sep)) {
      return { ok: false, reason: `REVIEWER_SECRET_OUT must be outside ${root} (the password file must never land in the app directory or the repo)` };
    }
  }
  // A real (non dry-run) seed may have to write a new password: it needs somewhere safe to put it.
  if (!args.remove && !args.dryRun && !secretOut) {
    return { ok: false, reason: 'REVIEWER_SECRET_OUT (path of the local file that receives the password, mode 600) is not set' };
  }

  return {
    ok: true,
    mode: args.remove ? 'remove' : 'seed',
    dryRun: args.dryRun,
    rotatePassword: args.rotatePassword,
    email,
    dbUrl,
    dbVar,
    dbHost,
    dbName,
    local,
    secretOut,
  };
}

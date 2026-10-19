import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { checkGuards, confirmTokenFor } from '@/scripts/directory/reviewerGuards';
import { buildReviewerDataset, reservedIdsOf, reservedIdProblems, REVIEWER_NAME } from '@/scripts/directory/reviewerData';
import { deleteOrder, generatePassword, readOnlyClient, runReviewerSeed, schemaEdges, writeSecretFile } from '@/scripts/directory/reviewerSeed';

const EMAIL = 'mcp-review@kolayxport.test';
const CWD = '/srv/app';
const LOCAL_DB = 'postgresql://postgres@localhost:5544/kx_gtm_preview';
const REMOTE_DB = 'postgresql://u:p@db.example.com:5432/kolayxport';
const guard = (argv: string[], env: Record<string, string | undefined>) => checkGuards({ argv, env, cwd: CWD });

describe('reviewer seed guards', () => {
  it('never touches the protected review accounts and only accepts mcp-review addresses', () => {
    for (const e of ['review@kolayxport.com', 'Play-Review@kolayxport.com', 'fedex-tester@kolayxport.com']) {
      expect(guard(['--dry-run'], { DATABASE_URL: LOCAL_DB, REVIEWER_EMAIL: e, FEDEX_SANDBOX_EMAILS: 'fedex-tester@kolayxport.com' }).ok).toBe(false);
    }
    expect(guard(['--dry-run'], { DATABASE_URL: LOCAL_DB, REVIEWER_EMAIL: 'demo@kolayxport.test' })).toMatchObject({ ok: false, reason: expect.stringContaining('mcp-review') });
    expect(guard(['--dry-run'], { DATABASE_URL: LOCAL_DB, REVIEWER_EMAIL: 'mcp-review@kolayxport.com' }).ok).toBe(true);
  });
  it('refuses without REVIEWER_EMAIL', () => {
    expect(guard(['--dry-run'], { DATABASE_URL: LOCAL_DB })).toMatchObject({ ok: false, reason: expect.stringContaining('REVIEWER_EMAIL') });
  });

  it('refuses a non-local host without --production and CONFIRM', () => {
    const env = { DATABASE_URL: REMOTE_DB, REVIEWER_EMAIL: EMAIL };
    expect(guard(['--dry-run'], env).ok).toBe(false);
    expect(guard(['--dry-run', '--production'], env).ok).toBe(false);
    expect(guard(['--dry-run'], { ...env, CONFIRM: confirmTokenFor(EMAIL) }).ok).toBe(false);
    expect(guard(['--dry-run', '--production'], { ...env, CONFIRM: 'seed-reviewer-someone@else.com' }).ok).toBe(false);
    expect(guard(['--dry-run', '--production'], { ...env, CONFIRM: confirmTokenFor(EMAIL) })).toMatchObject({ ok: true, local: false, dryRun: true });
  });

  it('treats the production database on localhost (database "kolayxport") and NODE_ENV=production as production', () => {
    const prodLocal = 'postgresql://kx:pw@localhost:5432/kolayxport';
    expect(guard(['--dry-run'], { DATABASE_URL: prodLocal, REVIEWER_EMAIL: EMAIL }).ok).toBe(false);
    expect(guard(['--dry-run'], { DATABASE_URL: LOCAL_DB, REVIEWER_EMAIL: EMAIL, NODE_ENV: 'production' }).ok).toBe(false);
    expect(guard(['--dry-run', '--production'], { DATABASE_URL: prodLocal, REVIEWER_EMAIL: EMAIL, CONFIRM: confirmTokenFor(EMAIL) }).ok).toBe(true);
  });

  it('checks the URL the app uses (DIRECT_URL first, like lib/prisma)', () => {
    const r = guard(['--dry-run'], { DIRECT_URL: REMOTE_DB, DATABASE_URL: LOCAL_DB, REVIEWER_EMAIL: EMAIL });
    expect(r.ok).toBe(false);
  });

  it('allows a local throwaway database without flags', () => {
    expect(guard(['--dry-run'], { DATABASE_URL: LOCAL_DB, REVIEWER_EMAIL: 'MCP-Review@KolayXport.test ' })).toMatchObject({ ok: true, local: true, email: EMAIL, mode: 'seed' });
    expect(guard(['--remove'], { DATABASE_URL: LOCAL_DB, REVIEWER_EMAIL: EMAIL })).toMatchObject({ ok: true, mode: 'remove' });
  });

  it('needs a secret file outside the app directory for a real seed', () => {
    const env = { DATABASE_URL: LOCAL_DB, REVIEWER_EMAIL: EMAIL };
    expect(guard([], env).ok).toBe(false);
    expect(guard([], { ...env, REVIEWER_SECRET_OUT: 'reviewer.txt' }).ok).toBe(false);
    expect(guard([], { ...env, REVIEWER_SECRET_OUT: '/srv/app/tmp/reviewer.txt' }).ok).toBe(false);
    expect(guard([], { ...env, REVIEWER_SECRET_OUT: '/home/deploy/reviewer.txt' })).toMatchObject({ ok: true, secretOut: '/home/deploy/reviewer.txt' });
  });

  it('rejects unknown arguments and bad combinations', () => {
    const env = { DATABASE_URL: LOCAL_DB, REVIEWER_EMAIL: EMAIL };
    expect(guard(['--dryrun'], env).ok).toBe(false);
    expect(guard(['--remove', '--rotate-password'], env).ok).toBe(false);
  });
});

/** A fake Prisma client: reads return nothing, every write is recorded. */
function fakeDb(user: Record<string, unknown> | null) {
  const writes: string[] = [];
  const delegate = (name: string) => new Proxy({}, {
    get(_t, method: string) {
      if (['findMany'].includes(method)) return async () => [];
      if (['count'].includes(method)) return async () => 0;
      if (['findFirst'].includes(method)) return async () => null;
      if (method === 'findUnique') return async () => (name === 'user' ? user : null);
      return async () => { writes.push(`${name}.${method}`); return { count: 0 }; };
    },
  });
  const client: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop.startsWith('$')) return async () => { writes.push(prop); };
      return delegate(prop);
    },
  });
  // Delegates must look like Prisma delegates for readOnlyClient (they have findMany).
  return { client, writes };
}

describe('reviewer seed dry-run', () => {
  const base = { dryRun: true, rotatePassword: false, email: EMAIL, secretOut: null, imageBase: 'https://example.test', appUrl: 'https://example.test', log: () => undefined };

  it('writes nothing for a new account', async () => {
    const { client, writes } = fakeDb(null);
    const r = await runReviewerSeed(client, { ...base, mode: 'seed' });
    expect(r.action).toBe('dry-run');
    expect(r.created.find((c) => c.table === 'Order')?.count).toBeGreaterThan(0);
    expect(writes).toEqual([]);
  });

  it('writes nothing when refreshing or removing an existing reviewer', async () => {
    const user = { id: 'rev-1', email: EMAIL, name: REVIEWER_NAME, role: 'user' };
    for (const mode of ['seed', 'remove'] as const) {
      const { client, writes } = fakeDb(user);
      const r = await runReviewerSeed(client, { ...base, mode, rotatePassword: mode === 'seed' });
      expect(r.action).toBe('dry-run');
      expect(writes).toEqual([]);
    }
  });

  it('refuses an existing account that is not a seeded reviewer', async () => {
    const { client, writes } = fakeDb({ id: 'u-1', email: EMAIL, name: 'Real Seller', role: 'user' });
    await expect(runReviewerSeed(client, { ...base, mode: 'remove', dryRun: false })).rejects.toThrow(/not a seeded reviewer/);
    expect(writes).toEqual([]);
  });

  it('the read-only wrapper blocks writes', async () => {
    const seen: string[] = [];
    const { client } = fakeDb(null);
    const ro = readOnlyClient(client, (w) => seen.push(w));
    expect(() => ro.order.deleteMany({ where: {} })).toThrow(/dry-run/);
    expect(() => ro.$transaction(async () => undefined)).toThrow(/dry-run/);
    expect(await ro.order.count({})).toBe(0);
    expect(seen).toEqual(['order.deleteMany', '$transaction']);
  });
});

describe('reviewer dataset', () => {
  const d = buildReviewerDataset({ userId: 'rev-1', now: Date.UTC(2026, 9, 18), imageBase: 'https://kolayxport.com' });

  it('uses only reserved marketplace ids', () => {
    expect(reservedIdProblems(reservedIdsOf(d))).toEqual([]);
  });

  it('has obviously fictional buyers and no tokens', () => {
    for (const o of d.orders) {
      expect(o.order.shippingAddress.email).toMatch(/@example\.com$/);
      expect(o.order.userId).toBe('rev-1');
    }
    expect(d.etsyShop.accessToken).toBe('');
    expect(d.etsyShop.refreshToken).toBeNull();
    expect(Object.keys(d.credential).sort()).toEqual(['trendyolSupplierId', 'userId']);
    expect([...d.etsyListingDrafts, ...d.ebayListingDrafts, ...d.catalogDrafts].every((x: any) => !x.scheduledSendAt)).toBe(true);
  });

  it('covers every marketplace, open / late / cancelled orders and low stock', () => {
    const sources = new Set(d.orders.map((o) => o.order.source));
    expect(sources).toEqual(new Set(['etsy-api', 'ebay-api', 'trendyol']));
    expect(d.orders.some((o) => o.order.cancelledAt)).toBe(true);
    expect(d.orders.some((o) => !o.order.shippedAt && !o.order.cancelledAt)).toBe(true);
    expect(d.etsyListings.some((l) => l.quantity <= 2 && l.state === 'active')).toBe(true);
    const etsy = d.orders.find((o) => o.order.source === 'etsy-api' && o.order.rawData.discount_amt.amount > 0);
    expect(etsy).toBeTruthy();
    // Etsy money: grandtotal = subtotal + shipping + tax + vat + gift wrap; subtotal = total_price - discount.
    const rc = etsy!.order.rawData;
    expect(rc.subtotal.amount).toBe(rc.total_price.amount - rc.discount_amt.amount);
    expect(rc.grandtotal.amount).toBe(rc.subtotal.amount + rc.total_shipping_cost.amount + rc.total_tax_cost.amount + rc.total_vat_cost.amount + rc.gift_wrap_price.amount);
  });
});

describe('helpers', () => {
  it('generates a policy-compliant password of at least 20 characters', () => {
    const pw = generatePassword({ email: EMAIL, name: REVIEWER_NAME });
    expect(pw.length).toBeGreaterThanOrEqual(20);
    expect(generatePassword({ email: EMAIL, name: REVIEWER_NAME })).not.toBe(pw);
  });

  it('writes the secret file with mode 600', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kxrev-'));
    const file = path.join(dir, 'secret.txt');
    writeSecretFile(file, 'x');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('orders deletes children first', () => {
    const order = deleteOrder(['User', 'Order', 'OrderItem', 'EtsyShop', 'EtsyListing', 'EtsyListingOffering'], schemaEdges());
    expect(order.indexOf('OrderItem')).toBeLessThan(order.indexOf('Order'));
    expect(order.indexOf('EtsyListingOffering')).toBeLessThan(order.indexOf('EtsyListing'));
    expect(order.indexOf('EtsyListing')).toBeLessThan(order.indexOf('EtsyShop'));
    expect(order[order.length - 1]).toBe('User');
  });
});

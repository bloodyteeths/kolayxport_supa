/**
 * Engine of scripts/directory/seed-reviewer-account.ts: ownership discovery, safety checks, plan, execute.
 * Takes the Prisma client as a parameter so tests can run it against a read-only fake.
 *
 * Ownership model (every delete is scoped to the reviewer):
 *   - A row is "owned" when it has `userId = <reviewer id>` (refresh mode: only in the tables this seed writes), or
 *     when it is a child, through a foreign key in prisma/schema.prisma, of a row that is owned. Children are found
 *     by walking the schema's relations (Prisma DMMF), so a table added later is covered too.
 *   - Nothing is ever deleted by a marketplace id alone: child rows are selected through the key values of owned
 *     parent rows (e.g. EtsyListing rows of the reviewer's own EtsyShop rows, found by `userId`).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { validatePassword } from '../../lib/auth/passwordPolicy';
import {
  REVIEWER_NAME, REVIEW_PREFIX, TRENDYOL_SUPPLIER_ID, buildReviewerDataset, reservedIdsOf, reservedIdProblems,
  type ReviewerDataset, type ReservedIds,
} from './reviewerData';

type Db = any; // PrismaClient or an interactive-transaction client (typed loosely: delegates are looked up by name)
type Where = Record<string, unknown>;

/** Tables the seed writes (refresh mode clears exactly these for the reviewer, plus their children). */
export const SEED_ROOT_MODELS = [
  'ShipperProfile', 'Credential', 'NotificationSettings', 'EtsyShop', 'EtsyAddress', 'Order', 'EbayListing', 'TrendyolProduct',
  'FinancialTransaction', 'FinancialSyncCursor', 'ProductCost', 'EtsyListingDraft', 'EbayListingDraft', 'CatalogDraft',
] as const;

const WRITE_METHODS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany']);
const WRITE_CLIENT_METHODS = new Set(['$transaction', '$executeRaw', '$executeRawUnsafe', '$queryRawUnsafe']);

/** Wraps a Prisma client so that any write throws (dry-run safety net; also used by the unit tests). */
export function readOnlyClient<T extends object>(db: T, onWrite?: (what: string) => void): T {
  return new Proxy(db, {
    get(target: any, prop: string | symbol) {
      const value = target[prop];
      if (typeof prop === 'string' && WRITE_CLIENT_METHODS.has(prop)) {
        return () => {
          onWrite?.(prop);
          throw new Error(`dry-run: refusing ${prop}`);
        };
      }
      if (value && typeof value === 'object' && typeof prop === 'string' && !prop.startsWith('$') && typeof value.findMany === 'function') {
        return new Proxy(value, {
          get(delegate: any, method: string | symbol) {
            if (typeof method === 'string' && WRITE_METHODS.has(method)) {
              return () => {
                onWrite?.(`${prop}.${method}`);
                throw new Error(`dry-run: refusing ${prop}.${method}`);
              };
            }
            const m = delegate[method];
            return typeof m === 'function' ? m.bind(delegate) : m;
          },
        });
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// ── Schema relations ──────────────────────────────────────────────────────────────────────────────────────────

export interface Edge { child: string; parent: string; from: string[]; to: string[]; nullable: boolean }

const delegateOf = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

export function schemaEdges(): Edge[] {
  const out: Edge[] = [];
  for (const m of Prisma.dmmf.datamodel.models) {
    for (const f of m.fields) {
      if (f.kind !== 'object' || !f.relationFromFields?.length) continue;
      out.push({ child: m.name, parent: f.type as string, from: [...f.relationFromFields], to: [...(f.relationToFields ?? [])], nullable: !f.isRequired });
    }
  }
  return out;
}

/** Models with a scalar userId column and NO foreign key on it (WebhookEvent, ResearchCache, …). */
function fkLessUserIdModels(edges: Edge[]): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'userId' && f.kind === 'scalar'))
    .filter((m) => !edges.some((e) => e.child === m.name && e.parent === 'User' && e.from.includes('userId')))
    .map((m) => m.name);
}

const keyOf = (v: unknown) => (typeof v === 'bigint' ? `${v}n` : JSON.stringify(v));

function clauseFor(e: Edge, parentRows: Array<Record<string, unknown>>): Where | null {
  const rows = parentRows.filter((r) => e.to.every((t) => r[t] !== null && r[t] !== undefined));
  if (!rows.length) return null;
  if (e.from.length === 1) {
    const seen = new Map<string, unknown>();
    for (const r of rows) seen.set(keyOf(r[e.to[0]]), r[e.to[0]]);
    return { [e.from[0]]: { in: Array.from(seen.values()) } };
  }
  return { OR: rows.map((r) => Object.fromEntries(e.from.map((f, i) => [f, r[e.to[i]]]))) };
}

export interface Ownership {
  /** model → Prisma where selecting exactly the owned rows */
  where: Map<string, Where>;
  edges: Edge[];
}

/**
 * Finds every row owned by the reviewer. `mode` 'remove' starts from the User row itself (+ FK-less userId tables);
 * 'refresh' starts from the seeded tables only (so the reviewer's own AI connections, credits and logs survive).
 */
export async function discoverOwnership(db: Db, userId: string, mode: 'refresh' | 'remove'): Promise<Ownership> {
  const edges = schemaEdges();
  const roots = new Map<string, Where>();
  if (mode === 'remove') {
    roots.set('User', { id: userId });
    for (const m of fkLessUserIdModels(edges)) roots.set(m, { userId });
  } else {
    for (const m of SEED_ROOT_MODELS) roots.set(m, { userId });
  }
  const edgeClause = new Map<string, Where>(); // `${index}` → clause for that edge
  const whereOf = (model: string): Where | null => {
    const parts: Where[] = [];
    if (roots.has(model)) parts.push(roots.get(model) as Where);
    edges.forEach((e, i) => {
      if (e.child === model && edgeClause.has(String(i))) parts.push(edgeClause.get(String(i)) as Where);
    });
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : { OR: parts };
  };

  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const pw = whereOf(e.parent);
      if (!pw) continue;
      const select = Object.fromEntries(e.to.map((t) => [t, true]));
      const parentRows = await db[delegateOf(e.parent)].findMany({ where: pw, select });
      const clause = clauseFor(e, parentRows);
      const before = edgeClause.get(String(i));
      if (!clause) {
        if (before) { edgeClause.delete(String(i)); changed = true; }
        continue;
      }
      if (!before || keyOfWhere(before) !== keyOfWhere(clause)) {
        edgeClause.set(String(i), clause);
        changed = true;
      }
    }
    if (!changed) break;
    if (pass === 19) throw new Error('ownership discovery did not converge');
  }

  const where = new Map<string, Where>();
  const models = new Set<string>([...roots.keys(), ...edges.map((e) => e.child)]);
  for (const m of models) {
    const w = whereOf(m);
    if (w) where.set(m, w);
  }
  return { where, edges };
}

function keyOfWhere(w: Where): string {
  return JSON.stringify(w, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
}

/** Children before parents (self-relations are handled by nulling the self-reference first). */
export function deleteOrder(models: string[], edges: Edge[]): string[] {
  const set = new Set(models);
  const pending = new Set(models);
  const out: string[] = [];
  while (pending.size) {
    const ready = Array.from(pending).filter((m) => !edges.some((e) => e.parent === m && e.child !== m && pending.has(e.child) && set.has(e.child)));
    if (!ready.length) throw new Error(`cyclic relations between: ${Array.from(pending).join(', ')}`);
    ready.sort();
    for (const m of ready) { out.push(m); pending.delete(m); }
  }
  return out;
}

export interface TableCount { table: string; count: number }

export async function countOwned(db: Db, own: Ownership): Promise<TableCount[]> {
  const out: TableCount[] = [];
  for (const m of deleteOrder(Array.from(own.where.keys()), own.edges)) {
    const count = await db[delegateOf(m)].count({ where: own.where.get(m) });
    if (count > 0) out.push({ table: m, count });
  }
  return out;
}

export async function deleteOwned(db: Db, own: Ownership): Promise<TableCount[]> {
  const out: TableCount[] = [];
  for (const m of deleteOrder(Array.from(own.where.keys()), own.edges)) {
    const w = own.where.get(m) as Where;
    for (const e of own.edges.filter((x) => x.child === m && x.parent === m && x.nullable)) {
      await db[delegateOf(m)].updateMany({ where: { AND: [w, ...e.from.map((f) => ({ [f]: { not: null } }))] }, data: Object.fromEntries(e.from.map((f) => [f, null])) });
    }
    const r = await db[delegateOf(m)].deleteMany({ where: w });
    if (r.count > 0) out.push({ table: m, count: r.count });
  }
  return out;
}

// ── Safety checks ─────────────────────────────────────────────────────────────────────────────────────────────

export interface Collision { table: string; ids: string[] }

/** Rows of ANOTHER user that use one of the reserved ids. Any hit aborts the seed. */
export async function findCollisions(db: Db, reviewerId: string | null, ids: ReservedIds): Promise<Collision[]> {
  const notMe = reviewerId ? { not: reviewerId } : undefined;
  const userNot = notMe ? { userId: notMe } : {};
  const orderNumbers = [...ids.etsyOrderNumbers, ...ids.ebayOrderNumbers, ...ids.trendyolOrderNumbers];
  const listingIdStrings = ids.etsyListingIds.map(String);
  const checks: Array<[string, () => Promise<Array<Record<string, unknown>>>, string]> = [
    ['EtsyShop.shopId', () => db.etsyShop.findMany({ where: { shopId: { in: ids.etsyShopIds }, ...userNot }, select: { shopId: true }, take: 20 }), 'shopId'],
    ['EtsyListing.etsyShopId', () => db.etsyListing.findMany({ where: { etsyShopId: { in: ids.etsyShopIds }, ...(notMe ? { etsyShop: { userId: notMe } } : {}) }, select: { etsyShopId: true }, take: 20 }), 'etsyShopId'],
    ['EtsyListing.etsyListingId', () => db.etsyListing.findMany({ where: { etsyListingId: { in: ids.etsyListingIds }, ...(notMe ? { etsyShop: { userId: notMe } } : {}) }, select: { etsyListingId: true }, take: 20 }), 'etsyListingId'],
    ['EtsyListingDraft', () => db.etsyListingDraft.findMany({ where: { OR: [{ etsyShopId: { in: ids.etsyShopIds } }, { etsyListingId: { in: ids.etsyListingIds } }], ...userNot }, select: { etsyListingId: true }, take: 20 }), 'etsyListingId'],
    ['Credential', () => db.credential.findMany({ where: { OR: [{ trendyolSupplierId: { in: ids.trendyolSupplierIds } }, { etsyShopId: { in: ids.etsyShopIds } }], ...userNot }, select: { trendyolSupplierId: true }, take: 20 }), 'trendyolSupplierId'],
    ['Order', () => db.order.findMany({ where: { OR: [{ orderNumber: { in: orderNumbers } }, { marketplaceKey: { in: orderNumbers } }], ...userNot }, select: { orderNumber: true }, take: 20 }), 'orderNumber'],
    ['OrderItem', () => db.orderItem.findMany({ where: { OR: [{ orderNumber: { in: orderNumbers } }, { listingRef: { in: listingIdStrings } }, { sku: { in: ids.ebaySkus } }], ...(notMe ? { order: { userId: notMe } } : {}) }, select: { orderNumber: true }, take: 20 }), 'orderNumber'],
    ['EtsyAddress', () => db.etsyAddress.findMany({ where: { OR: [{ orderNumber: { in: ids.etsyOrderNumbers } }, { etsyStoreId: { in: ids.etsyShopIds } }], ...userNot }, select: { orderNumber: true }, take: 20 }), 'orderNumber'],
    ['EbayListing', () => db.ebayListing.findMany({ where: { sku: { in: ids.ebaySkus }, ...userNot }, select: { sku: true }, take: 20 }), 'sku'],
    ['EbayListingDraft', () => db.ebayListingDraft.findMany({ where: { sku: { in: ids.ebaySkus }, ...userNot }, select: { sku: true }, take: 20 }), 'sku'],
    ['TrendyolProduct', () => db.trendyolProduct.findMany({ where: { OR: [{ barcode: { in: ids.trendyolBarcodes } }, { supplierId: { in: ids.trendyolSupplierIds } }], ...userNot }, select: { barcode: true }, take: 20 }), 'barcode'],
    ['CatalogDraft', () => db.catalogDraft.findMany({ where: { OR: [{ storeId: { in: ids.trendyolSupplierIds } }, { externalId: { in: ids.trendyolBarcodes } }], ...userNot }, select: { externalId: true }, take: 20 }), 'externalId'],
    ['FinancialTransaction', () => db.financialTransaction.findMany({ where: { OR: [{ externalId: { in: ids.financeExternalIds } }, { orderNumber: { in: orderNumbers } }], ...userNot }, select: { externalId: true }, take: 20 }), 'externalId'],
    ['ProductCost', () => db.productCost.findMany({ where: { barcode: { in: ids.productCostBarcodes.filter((b) => b.startsWith(REVIEW_PREFIX)) }, ...userNot }, select: { barcode: true }, take: 20 }), 'barcode'],
    ['StockLink', () => db.stockLink.findMany({ where: { OR: [{ externalId: { in: [...listingIdStrings, ...ids.ebaySkus, ...ids.trendyolBarcodes] } }, { accountRef: { in: [...ids.etsyShopIds, ...ids.trendyolSupplierIds] } }], ...userNot }, select: { externalId: true }, take: 20 }), 'externalId'],
    ['WebhookEvent', () => db.webhookEvent.findMany({ where: { shopId: { in: ids.etsyShopIds } }, select: { shopId: true }, take: 20 }), 'shopId'],
  ];
  const out: Collision[] = [];
  for (const [table, run, field] of checks) {
    const rows = await run();
    if (rows.length) out.push({ table, ids: Array.from(new Set(rows.map((r) => String(r[field])))).slice(0, 10) });
  }
  return out;
}

/**
 * Refuses to touch an account that is not a seeded reviewer account (a typo in REVIEWER_EMAIL must never wipe a
 * real seller). Returns the problems found; empty = it is ours.
 */
export async function foreignDataProblems(db: Db, user: Record<string, any>): Promise<string[]> {
  const p: string[] = [];
  const id = user.id as string;
  if (user.name !== REVIEWER_NAME) p.push(`name is "${user.name}", not "${REVIEWER_NAME}"`);
  if (user.role && user.role !== 'user') p.push(`role is ${user.role}`);
  if (user.stripeCustomerId) p.push('has a Stripe customer');
  if (user.shopifySubscriptionId || user.billingProvider === 'shopify' || user.billingProvider === 'shopify_free') p.push('is Shopify-billed');
  if (user.googleAccountId) p.push('is linked to a Google account');
  const reserved = /^999000\d{7}$/;
  const prefixed = (s: string | null) => typeof s === 'string' && s.startsWith(REVIEW_PREFIX);
  const [shops, orders, ebay, ty, wix, shopify, hb, cred, accounts] = await Promise.all([
    db.etsyShop.findMany({ where: { userId: id }, select: { shopId: true } }),
    db.order.findMany({ where: { userId: id }, select: { orderNumber: true } }),
    db.ebayListing.findMany({ where: { userId: id }, select: { sku: true } }),
    db.trendyolProduct.findMany({ where: { userId: id }, select: { barcode: true, supplierId: true } }),
    db.wixSite.count({ where: { userId: id } }),
    db.shopifyShop.count({ where: { userId: id } }),
    db.hepsiburadaListing.count({ where: { userId: id } }),
    db.credential.findUnique({ where: { userId: id } }),
    db.account.count({ where: { userId: id } }),
  ]);
  shops.filter((s: any) => !reserved.test(s.shopId)).forEach((s: any) => p.push(`owns a real-looking Etsy shop ${s.shopId}`));
  const badOrders = orders.filter((o: any) => !reserved.test(o.orderNumber) && !prefixed(o.orderNumber));
  if (badOrders.length) p.push(`owns ${badOrders.length} order(s) outside the reserved ranges (e.g. ${badOrders[0].orderNumber})`);
  const badEbay = ebay.filter((l: any) => !prefixed(l.sku));
  if (badEbay.length) p.push(`owns ${badEbay.length} eBay listing(s) outside the reserved prefix`);
  const badTy = ty.filter((l: any) => !prefixed(l.barcode) || l.supplierId !== TRENDYOL_SUPPLIER_ID);
  if (badTy.length) p.push(`owns ${badTy.length} Trendyol product(s) outside the reserved prefix`);
  if (wix) p.push('has a Wix site');
  if (shopify) p.push('has a Shopify shop');
  if (hb) p.push('has Hepsiburada listings');
  if (accounts) p.push('has linked OAuth accounts');
  if (cred) {
    const filled = Object.entries(cred).filter(([k, v]) => !['id', 'userId', 'createdAt', 'updatedAt', 'trendyolSupplierId', 'mngApiEnvironment', 'amazonRegion', 'amazonMarketplaceIds'].includes(k) && v !== null && !(Array.isArray(v) && v.length === 0));
    if (filled.length) p.push(`has marketplace credentials (${filled.map(([k]) => k).join(', ')})`);
    if (cred.trendyolSupplierId && cred.trendyolSupplierId !== TRENDYOL_SUPPLIER_ID) p.push(`has a real Trendyol supplier id ${cred.trendyolSupplierId}`);
  }
  return p;
}

// ── Password ──────────────────────────────────────────────────────────────────────────────────────────────────

const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%+-=?@^_~';

/** Random password (default 28 chars) from crypto.randomInt; guaranteed to pass lib/auth/passwordPolicy. */
export function generatePassword(identity: { email: string; name: string }, length = 28): string {
  if (length < 20) throw new Error('password length must be at least 20');
  for (let attempt = 0; attempt < 50; attempt++) {
    let s = '';
    for (let i = 0; i < length; i++) s += PW_ALPHABET[crypto.randomInt(PW_ALPHABET.length)];
    if (/[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s) && validatePassword(s, identity).ok) return s;
  }
  throw new Error('could not generate a password that passes the policy');
}

/** Writes the secret file with mode 600 (atomic: temp file + rename; never printed). */
export function writeSecretFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

// ── Plan + execute ────────────────────────────────────────────────────────────────────────────────────────────

export interface RunOptions {
  mode: 'seed' | 'remove';
  dryRun: boolean;
  rotatePassword: boolean;
  email: string;
  secretOut: string | null;
  imageBase: string;
  appUrl: string;
  now?: number;
  log?: (line: string) => void;
}

export interface RunResult {
  reviewerId: string | null;
  action: 'created' | 'refreshed' | 'removed' | 'nothing' | 'dry-run';
  deleted: TableCount[];
  created: TableCount[];
  passwordWritten: boolean;
}

function createCounts(d: ReviewerDataset): TableCount[] {
  return [
    { table: 'User', count: 1 },
    { table: 'ShipperProfile', count: 1 },
    { table: 'Credential', count: 1 },
    { table: 'NotificationSettings', count: 1 },
    { table: 'EtsyShop', count: 1 },
    { table: 'EtsyListing', count: d.etsyListings.length },
    { table: 'EtsyListingOffering', count: d.etsyListingOfferings.length },
    { table: 'EbayListing', count: d.ebayListings.length },
    { table: 'TrendyolProduct', count: d.trendyolProducts.length },
    { table: 'Order', count: d.orders.length },
    { table: 'OrderItem', count: d.orders.reduce((s, o) => s + o.items.length, 0) },
    { table: 'EtsyAddress', count: d.etsyAddresses.length },
    { table: 'FinancialTransaction', count: d.financialTransactions.length },
    { table: 'FinancialSyncCursor', count: d.financialSyncCursors.length },
    { table: 'ProductCost', count: d.productCosts.length },
    { table: 'EtsyListingDraft', count: d.etsyListingDrafts.length },
    { table: 'EbayListingDraft', count: d.ebayListingDrafts.length },
    { table: 'CatalogDraft', count: d.catalogDrafts.length },
  ];
}

function userFields(now: number) {
  return {
    name: REVIEWER_NAME,
    emailVerified: new Date(now),
    // Enterprise, active: every feature on, 10,000 AI credits a month (lib/billing/planLimits), no Stripe upsell,
    // no Stripe customer, not Shopify-billed. Usage counters reset monthly by the reset-usage cron (harmless).
    subscriptionPlan: 'enterprise',
    subscriptionStatus: 'active',
    billingProvider: null,
    billingInterval: 'month',
    shopifySubscriptionId: null,
    trialExpiresAt: null,
    usageResetAt: new Date(now + 30 * 86_400_000),
    onboardingStep: 99,
    labelCount: 0,
    orderSyncCount: 0,
    role: 'user',
  };
}

async function insertDataset(tx: Db, userId: string, d: ReviewerDataset): Promise<void> {
  await tx.shipperProfile.create({ data: d.shipperProfile });
  await tx.credential.create({ data: d.credential });
  // E-mail off: open demo orders raise dispatch reminders (in-app only then); no mail ever goes to the reviewer.
  await tx.notificationSettings.create({ data: { userId, emailEnabled: false, preset: 'critical', locale: 'en', timezone: 'UTC' } });
  await tx.etsyShop.create({ data: d.etsyShop });
  await tx.etsyListing.createMany({ data: d.etsyListings });
  await tx.etsyListingOffering.createMany({ data: d.etsyListingOfferings });
  await tx.ebayListing.createMany({ data: d.ebayListings });
  await tx.trendyolProduct.createMany({ data: d.trendyolProducts });
  for (const o of d.orders) await tx.order.create({ data: { ...o.order, items: { create: o.items } } });
  await tx.etsyAddress.createMany({ data: d.etsyAddresses });
  await tx.financialTransaction.createMany({ data: d.financialTransactions });
  await tx.financialSyncCursor.createMany({ data: d.financialSyncCursors });
  await tx.productCost.createMany({ data: d.productCosts });
  await tx.etsyListingDraft.createMany({ data: d.etsyListingDrafts });
  await tx.ebayListingDraft.createMany({ data: d.ebayListingDrafts });
  await tx.catalogDraft.createMany({ data: d.catalogDrafts });
}

const fmt = (rows: TableCount[]) => (rows.length ? rows.map((r) => `    ${r.table.padEnd(26)} ${String(r.count).padStart(5)}`).join('\n') : '    (none)');

export async function runReviewerSeed(prisma: Db, opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const now = opts.now ?? Date.now();
  const db = opts.dryRun ? readOnlyClient(prisma) : prisma;
  const existing = await db.user.findUnique({ where: { email: opts.email } });

  if (existing) {
    const problems = await foreignDataProblems(db, existing);
    if (problems.length) {
      throw new Error(`REFUSING: ${opts.email} exists but is not a seeded reviewer account:\n  - ${problems.join('\n  - ')}`);
    }
  }

  // ── remove ──
  if (opts.mode === 'remove') {
    if (!existing) {
      log(`[reviewer] no account with e-mail ${opts.email}: nothing to remove.`);
      return { reviewerId: null, action: 'nothing', deleted: [], created: [], passwordWritten: false };
    }
    const own = await discoverOwnership(db, existing.id, 'remove');
    const counts = await countOwned(db, own);
    log(`[reviewer] ${opts.dryRun ? 'DRY RUN: would delete' : 'Deleting'} account ${opts.email} (id ${existing.id}) and every row it owns:\n${fmt(counts)}`);
    if (opts.dryRun) return { reviewerId: existing.id, action: 'dry-run', deleted: counts, created: [], passwordWritten: false };
    const deleted = await prisma.$transaction(async (tx: Db) => {
      const fresh = await discoverOwnership(tx, existing.id, 'remove');
      return deleteOwned(tx, fresh);
    }, { timeout: 300_000, maxWait: 20_000 });
    log(`[reviewer] removed:\n${fmt(deleted)}`);
    log(`[reviewer] files are not touched: AI images the reviewers generated live under uploads/ebay-images/${existing.id}/ (EBAY_IMAGE_UPLOAD_DIR); delete that folder by hand if it exists.`);
    return { reviewerId: existing.id, action: 'removed', deleted, created: [], passwordWritten: false };
  }

  // ── seed / refresh ──
  const reviewerId: string = existing?.id ?? crypto.randomUUID();
  const dataset = buildReviewerDataset({ userId: reviewerId, now, imageBase: opts.imageBase });
  const ids = reservedIdsOf(dataset);
  const badIds = reservedIdProblems(ids);
  if (badIds.length) throw new Error(`internal: ids outside the reserved ranges: ${badIds.slice(0, 5).join(', ')}`);

  const collisions = await findCollisions(db, existing?.id ?? null, ids);
  if (collisions.length) {
    throw new Error(`ABORT: reserved ids already used by another user (nothing was written):\n${collisions.map((c) => `  - ${c.table}: ${c.ids.join(', ')}`).join('\n')}`);
  }
  log('[reviewer] collision check: none of the reserved ids is used by another user.');

  const own = existing ? await discoverOwnership(db, existing.id, 'refresh') : null;
  const deletes = own ? await countOwned(db, own) : [];
  const creates = createCounts(dataset).filter((c) => !(existing && c.table === 'User'));
  const newPassword = !existing || opts.rotatePassword;

  log([
    `[reviewer] ${opts.dryRun ? 'DRY RUN (nothing is written)' : 'Plan'} for ${opts.email} on ${opts.appUrl}:`,
    `  user: ${existing ? `UPDATE existing reviewer ${existing.id} (name, verified e-mail, enterprise plan, onboarding done)` : `CREATE ${reviewerId}`}`,
    `  password: ${newPassword ? `${existing ? 'ROTATE' : 'GENERATE'} (28 chars, bcrypt) and write to ${opts.secretOut ?? '<REVIEWER_SECRET_OUT>'} (mode 600)` : 'keep the current one (pass --rotate-password to replace it)'}`,
    '  delete (only rows owned by this reviewer):',
    fmt(deletes),
    `  ${existing ? 'update' : 'create'} User 1, create:`,
    fmt(creates.filter((c) => c.table !== 'User')),
  ].join('\n'));

  if (opts.dryRun) return { reviewerId: existing?.id ?? null, action: 'dry-run', deleted: deletes, created: creates, passwordWritten: false };

  let password: string | null = null;
  let passwordHash: string | null = null;
  if (newPassword) {
    if (!opts.secretOut) throw new Error('REVIEWER_SECRET_OUT is required to write the password');
    password = generatePassword({ email: opts.email, name: REVIEWER_NAME });
    passwordHash = await bcrypt.hash(password, 12);
  }

  const deleted = await prisma.$transaction(async (tx: Db) => {
    // Re-check inside the transaction (a row may have appeared since the plan).
    const again = await findCollisions(tx, existing?.id ?? null, ids);
    if (again.length) throw new Error(`ABORT: reserved ids already used by another user: ${again.map((c) => c.table).join(', ')}`);
    let removed: TableCount[] = [];
    if (existing) {
      removed = await deleteOwned(tx, await discoverOwnership(tx, existing.id, 'refresh'));
      await tx.user.update({ where: { id: existing.id }, data: { ...userFields(now), ...(passwordHash ? { password: passwordHash } : {}) } });
    } else {
      await tx.user.create({ data: { id: reviewerId, email: opts.email, password: passwordHash, ...userFields(now) } });
    }
    await insertDataset(tx, reviewerId, dataset);
    // Written last inside the transaction: if the file cannot be written, nothing is committed (a password that
    // exists only in the database would lock everyone out).
    if (password && opts.secretOut) {
      writeSecretFile(opts.secretOut, `KolayXport directory reviewer account\nURL: ${opts.appUrl}/login\nEmail: ${opts.email}\nPassword: ${password}\n`);
    }
    return removed;
  }, { timeout: 300_000, maxWait: 20_000 });

  const passwordWritten = Boolean(password && opts.secretOut);
  log(`[reviewer] ${existing ? 'refreshed' : 'created'} ${opts.email} (id ${reviewerId}). Deleted:\n${fmt(deleted)}\n  Created:\n${fmt(creates)}`);
  if (passwordWritten) log(`[reviewer] password written to ${opts.secretOut} (mode 600). It is not printed.`);
  return { reviewerId, action: existing ? 'refreshed' : 'created', deleted, created: creates, passwordWritten };
}

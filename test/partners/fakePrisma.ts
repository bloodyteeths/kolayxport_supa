// In-memory stand-in for the Prisma calls lib/partners/* makes (bounty, payouts, dashboard). Only the query shapes
// those modules use are supported; anything else throws so a test never passes on a silently ignored filter.
import { randomUUID } from 'crypto';

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    // Compound unique key, e.g. { userId_module: { userId, module } }.
    if (k.includes('_') && cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).every((f) => k.split('_').includes(f))) {
      if (!matches(row, cond as Row)) return false;
      continue;
    }
    if (k === 'OR') { if (!(cond as Row[]).some((c) => matches(row, c))) return false; continue; }
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      for (const [op, x] of Object.entries(cond)) {
        if (op === 'in' && !(x as unknown[]).includes(v)) return false;
        else if (op === 'not' && (x !== null && typeof x === 'object' ? (x as Row).in?.includes(v) : v === x)) return false;
        else if (op === 'lte' && !(v <= (x as any))) return false;
        else if (op === 'lt' && !(v < (x as any))) return false;
        else if (op === 'gte' && !(v >= (x as any))) return false;
        else if (op === 'startsWith' && !(typeof v === 'string' && v.startsWith(x as string))) return false;
        else if (op === 'notIn' && (x as unknown[]).includes(v)) return false;
        else if (!['in', 'not', 'notIn', 'lte', 'lt', 'gte', 'startsWith'].includes(op)) throw new Error(`fakePrisma: unsupported op ${op}`);
      }
    } else if (v !== cond) return false;
  }
  return true;
}

// Relations the partner code selects through: UserAcquisition.user (by userId).
let users: Row[] = [];
const pick = (row: Row, select?: Row) => {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [k, v] of Object.entries(select)) {
    if (v === true) out[k] = row[k];
    else if (k === 'shopifyShops') out[k] = row.shopifyShops ?? [];
    else if (k === 'user' && v && typeof v === 'object') {
      const u = users.find((x) => x.id === row.userId);
      out[k] = u ? pick(u, (v as Row).select) : null;
    } else throw new Error(`fakePrisma: unsupported select ${k}`);
  }
  return out;
};

function table(name: string, uniques: string[] = []) {
  const rows: Row[] = [];
  const unique = (data: Row) => {
    for (const u of ['id', ...uniques]) {
      if (data[u] != null && rows.some((r) => r[u] === data[u])) throw Object.assign(new Error(`unique ${name}.${u}`), { code: 'P2002' });
    }
  };
  const sortBy = (list: Row[], orderBy?: Row) => {
    if (!orderBy) return list;
    const [[k, dir]] = Object.entries(orderBy);
    return [...list].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  };
  return {
    rows,
    async findUnique({ where, select }: Row) { const r = rows.find((x) => matches(x, where)); return r ? pick(r, select) : null; },
    async findFirst({ where, select }: Row) { const r = rows.find((x) => matches(x, where)); return r ? pick(r, select) : null; },
    async findMany({ where, select, orderBy, distinct, take }: Row = {}) {
      let list = sortBy(rows.filter((x) => matches(x, where)), orderBy);
      if (distinct) { const seen = new Set(); list = list.filter((r) => { const k = distinct.map((d: string) => r[d]).join('|'); if (seen.has(k)) return false; seen.add(k); return true; }); }
      if (take) list = list.slice(0, take);
      return list.map((r) => pick(r, select));
    },
    async count({ where }: Row = {}) { return rows.filter((x) => matches(x, where)).length; },
    async create({ data }: Row) { const row = { id: randomUUID(), createdAt: new Date(), ...data }; unique(row); rows.push(row); return { ...row }; },
    async update({ where, data }: Row) { const r = rows.find((x) => matches(x, where)); if (!r) throw new Error(`fakePrisma: ${name} not found`); Object.assign(r, data); return { ...r }; },
    async upsert({ where, create, update }: Row) {
      const r = rows.find((x) => matches(x, where));
      if (r) { Object.assign(r, update); return { ...r }; }
      const row = { id: randomUUID(), createdAt: new Date(), ...create };
      unique(row);
      rows.push(row);
      return { ...row };
    },
    async updateMany({ where, data }: Row) { const list = rows.filter((x) => matches(x, where)); list.forEach((r) => Object.assign(r, data)); return { count: list.length }; },
    async aggregate({ where, _sum }: Row) { const list = rows.filter((x) => matches(x, where)); const out: Row = {}; for (const k of Object.keys(_sum)) out[k] = list.length ? list.reduce((s, r) => s + (r[k] ?? 0), 0) : null; return { _sum: out }; },
    async groupBy({ by, where, _count }: Row) {
      const groups = new Map<string, Row>();
      for (const r of rows.filter((x) => matches(x, where))) {
        const key = by.map((b: string) => r[b]).join('|');
        const g = groups.get(key) ?? { ...Object.fromEntries(by.map((b: string) => [b, r[b]])), _count: { _all: 0 } };
        g._count._all++;
        groups.set(key, g);
      }
      void _count;
      return [...groups.values()];
    },
  };
}

export function makeFakePrisma() {
  const userTable = table('user', ['email']);
  users = userTable.rows;
  const db = {
    user: userTable,
    partner: table('partner', ['code', 'userId']),
    userAcquisition: table('userAcquisition', ['userId']),
    partnerPaymentEvent: table('partnerPaymentEvent', ['objectId']),
    partnerCommission: table('partnerCommission', ['stripeObjectId']),
    partnerPayout: table('partnerPayout'),
    etsyShop: table('etsyShop'),
    shopifyShop: table('shopifyShop'),
    wixSite: table('wixSite'),
    billingModule: table('billingModule'),
    async $transaction(ops: Promise<unknown>[]) { return Promise.all(ops); },
  };
  return db;
}

export type FakePrisma = ReturnType<typeof makeFakePrisma>;

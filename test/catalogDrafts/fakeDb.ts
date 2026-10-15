/**
 * Tiny in-memory stand-in for a Prisma delegate, enough for the catalog-draft
 * service and the scheduled-send runner: equality, { in }, { not: null },
 * { lt }, { lte }, { gt } and OR in `where`.
 */
type Row = Record<string, any>;

function matchValue(v: any, cond: any): boolean {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('in' in cond && !cond.in.includes(v)) return false;
    if ('not' in cond) {
      if (cond.not === null ? v === null || v === undefined : v === cond.not) return false;
    }
    const t = (x: any) => (x instanceof Date ? x.getTime() : x);
    if ('lt' in cond && !(v != null && t(v) < t(cond.lt))) return false;
    if ('lte' in cond && !(v != null && t(v) <= t(cond.lte))) return false;
    if ('gt' in cond && !(v != null && t(v) > t(cond.gt))) return false;
    return true;
  }
  return v === cond;
}

export function matches(row: Row, where: Row = {}): boolean {
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(cond as Row[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (!matchValue(row[k], cond)) return false;
  }
  return true;
}

export function createFakeDelegate(initial: Row[] = []) {
  const rows: Row[] = initial.map((r) => ({ ...r }));
  let seq = rows.length;
  const pick = (r: Row, select?: Row) => {
    if (!select) return { ...r };
    const out: Row = {};
    for (const k of Object.keys(select)) if (select[k]) out[k] = r[k];
    return out;
  };
  const touch = (r: Row, data: Row) => Object.assign(r, data, { updatedAt: new Date() });
  return {
    rows,
    async findFirst({ where, select }: any = {}) {
      const r = rows.find((x) => matches(x, where));
      return r ? pick(r, select) : null;
    },
    async findUnique({ where, select }: any = {}) {
      const r = rows.find((x) => matches(x, where));
      return r ? pick(r, select) : null;
    },
    async findMany({ where, select, take }: any = {}) {
      return rows.filter((x) => matches(x, where)).slice(0, take ?? Infinity).map((r) => pick(r, select));
    },
    async create({ data }: any) {
      const r = { id: `d${++seq}`, createdAt: new Date(), updatedAt: new Date(), batchRequestId: null, lastSyncError: null, scheduledSendAt: null, syncedAt: null, ...data };
      rows.push(r);
      return { ...r };
    },
    async update({ where, data }: any) {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw new Error('not found');
      touch(r, data);
      return { ...r };
    },
    async updateMany({ where, data }: any) {
      const hit = rows.filter((x) => matches(x, where));
      hit.forEach((r) => touch(r, data));
      return { count: hit.length };
    },
  };
}

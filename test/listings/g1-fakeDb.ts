// In-memory stand-in for the Prisma delegates the listings engine uses. Evaluates the subset of Prisma's
// `where` / `orderBy` grammar that lib/listings/** generates, so status maps and filters are tested for real.

type Row = Record<string, any>;

function cmp(a: any, b: any): number {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    a = BigInt(a);
    b = BigInt(b);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function eq(a: any, b: any, insensitive = false): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (insensitive && typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a === 'bigint' || typeof b === 'bigint') return BigInt(a) === BigInt(b);
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}

const OPS = new Set(['equals', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'contains', 'has', 'hasSome', 'isEmpty', 'array_contains', 'mode', 'not']);

function fieldMatch(v: any, cond: any): boolean {
  if (cond === null) return v === null || v === undefined;
  if (typeof cond !== 'object' || cond instanceof Date || typeof cond === 'bigint') return eq(v, cond);
  const keys = Object.keys(cond);
  if (!keys.every((k) => OPS.has(k))) throw new Error(`fakeDb: unsupported filter ${JSON.stringify(Object.keys(cond))}`);
  const ins = cond.mode === 'insensitive';
  // SQL semantics: comparisons against NULL are false (Prisma does not add IS NULL).
  if ('equals' in cond && !eq(v, cond.equals, ins)) return false;
  if ('in' in cond && (v === null || v === undefined || !cond.in.some((x: any) => eq(v, x, ins)))) return false;
  if ('notIn' in cond && (v === null || v === undefined || cond.notIn.some((x: any) => eq(v, x, ins)))) return false;
  for (const [op, fn] of [
    ['lt', (c: number) => c < 0],
    ['lte', (c: number) => c <= 0],
    ['gt', (c: number) => c > 0],
    ['gte', (c: number) => c >= 0],
  ] as const) {
    if (op in cond) {
      if (v === null || v === undefined) return false;
      if (!fn(cmp(Number(v), Number(cond[op])))) return false;
    }
  }
  if ('contains' in cond) {
    if (typeof v !== 'string') return false;
    const hay = ins ? v.toLowerCase() : v;
    const needle = ins ? String(cond.contains).toLowerCase() : String(cond.contains);
    if (!hay.includes(needle)) return false;
  }
  if ('has' in cond && !(Array.isArray(v) && v.includes(cond.has))) return false;
  if ('hasSome' in cond && !(Array.isArray(v) && cond.hasSome.some((x: any) => v.includes(x)))) return false;
  if ('isEmpty' in cond && (Array.isArray(v) ? v.length === 0 : true) !== cond.isEmpty) return false;
  if ('array_contains' in cond && !(Array.isArray(v) && cond.array_contains.every((x: any) => v.includes(x)))) return false;
  if ('not' in cond && fieldMatch(v, cond.not)) return false;
  return true;
}

export function matches(row: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'AND') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (!list.every((w) => matches(row, w))) return false;
    } else if (k === 'OR') {
      if (!(cond as any[]).some((w) => matches(row, w))) return false;
    } else if (k === 'NOT') {
      const list = Array.isArray(cond) ? cond : [cond];
      // SQL NOT over a NULL comparison is NULL (row excluded): emulate for equality on null fields.
      if (list.some((w) => matches(row, w) || touchesNull(row, w))) return false;
    } else if (cond && typeof cond === 'object' && !Array.isArray(cond) && Object.keys(cond).length === 1 && ('some' in cond || 'none' in cond)) {
      // To-many relation filter: the fixture stores child rows inline (e.g. EtsyListing.offerings).
      const children: Row[] = Array.isArray(row[k]) ? row[k] : [];
      const hit = children.some((c) => matches(c, (cond as any).some ?? (cond as any).none));
      if ('some' in cond ? !hit : hit) return false;
    } else if (!fieldMatch(row[k], cond)) {
      return false;
    }
  }
  return true;
}

/** True when `where` compares a NULL column (so NOT(where) is NULL in SQL and excludes the row). */
function touchesNull(row: Row, where: any): boolean {
  for (const [k, cond] of Object.entries(where ?? {})) {
    if (k === 'AND' || k === 'OR' || k === 'NOT') continue;
    if (cond !== null && (row[k] === null || row[k] === undefined)) return true;
  }
  return false;
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => {
    for (const o of list) {
      const [field, spec] = Object.entries(o)[0] as [string, any];
      const dir = typeof spec === 'string' ? spec : spec.sort;
      const nullsLast = typeof spec === 'object' && spec.nulls === 'last';
      const av = a[field];
      const bv = b[field];
      const an = av === null || av === undefined;
      const bn = bv === null || bv === undefined;
      if (an || bn) {
        if (an && bn) continue;
        if (nullsLast) return an ? 1 : -1;
        return (an ? 1 : -1) * (dir === 'asc' ? 1 : -1);
      }
      const c = typeof av === 'string' && typeof bv === 'string' ? (av < bv ? -1 : av > bv ? 1 : 0) : cmp(Number(av), Number(bv));
      if (c !== 0) return dir === 'asc' ? c : -c;
    }
    return 0;
  });
}

/**
 * Applies relation sub-specs (`{ rel: { where, orderBy, take, select } }`, from `select` or `include`) to inline child
 * arrays; scalars pass.
 */
function projectRelations(row: Row, select: any): Row {
  const out: Row = { ...row };
  if (!select || typeof select !== 'object') return out;
  for (const [k, spec] of Object.entries(select)) {
    if (!spec || spec === true || typeof spec !== 'object') continue;
    let kids: Row[] = Array.isArray(row[k]) ? row[k].filter((c: Row) => matches(c, (spec as any).where)) : [];
    if ((spec as any).orderBy) kids = sortRows(kids, (spec as any).orderBy);
    if ((spec as any).take !== undefined) kids = kids.slice(0, (spec as any).take);
    const sel = (spec as any).select;
    out[k] = kids.map((c) => (sel ? Object.fromEntries(Object.keys(sel).map((f) => [f, c[f]])) : { ...c }));
  }
  return out;
}

export function makeDelegate(rows: Row[]) {
  return {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => matches(r, args.where));
      if (args.orderBy) out = sortRows(out, args.orderBy);
      if (args.skip) out = out.slice(args.skip);
      if (args.take !== undefined) out = out.slice(0, args.take);
      return out.map((r) => projectRelations(projectRelations(r, args.select), args.include));
    },
    findFirst: async (args: any = {}) => rows.find((r) => matches(r, args.where)) ?? null,
    findUnique: async (args: any = {}) => rows.find((r) => matches(r, args.where)) ?? null,
    count: async (args: any = {}) => rows.filter((r) => matches(r, args.where)).length,
    aggregate: async (args: any = {}) => {
      const m = rows.filter((r) => matches(r, args.where));
      const out: any = {};
      if (args._count) out._count = { _all: m.length };
      if (args._max) {
        out._max = {};
        for (const f of Object.keys(args._max)) {
          const vals = m.map((r) => r[f]).filter((v) => v != null);
          out._max[f] = vals.length ? vals.reduce((x, y) => (cmp(x, y) >= 0 ? x : y)) : null;
        }
      }
      return out;
    },
  };
}

export function makeDb(tables: Record<string, Row[]>): Record<string, ReturnType<typeof makeDelegate>> {
  const db: Record<string, ReturnType<typeof makeDelegate>> = {};
  for (const [k, rows] of Object.entries(tables)) db[k] = makeDelegate(rows);
  return db;
}

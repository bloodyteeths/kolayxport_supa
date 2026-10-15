// messages G3 — /api/messages/saved-replies (§6.4) against an in-memory SavedReply delegate, plus the BR-4
// guard (no delegate / table missing → 503 notReady).
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; userId: string; title: string; body: string; platform: string | null; usageCount: number; createdAt: Date; updatedAt: Date };
let rows: Row[] = [];
let seq = 0;
const match = (r: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v);
const fake = {
  findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where))),
  findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => match(r, where)) ?? null),
  count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where)).length),
  create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
    const row: Row = { id: `r${++seq}`, usageCount: 0, platform: null, createdAt: new Date(), updatedAt: new Date(), ...(data as Row) };
    rows.push(row);
    return row;
  }),
  createMany: vi.fn(async ({ data }: { data: Partial<Row>[] }) => {
    for (const d of data) rows.push({ id: `r${++seq}`, usageCount: 0, platform: null, createdAt: new Date(), updatedAt: new Date(), ...(d as Row) });
    return { count: data.length };
  }),
  update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
    const r = rows.find((x) => x.id === where.id)!;
    Object.assign(r, data, { updatedAt: new Date() });
    return r;
  }),
  updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: { usageCount?: { increment: number } } }) => {
    const hit = rows.filter((r) => match(r, where));
    for (const r of hit) r.usageCount += data.usageCount?.increment ?? 0;
    return { count: hit.length };
  }),
  deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const before = rows.length;
    rows = rows.filter((r) => !match(r, where));
    return { count: before - rows.length };
  }),
};
const prismaMock: { savedReply?: typeof fake } = { savedReply: fake };
vi.mock('@/lib/prisma', () => ({
  get default() {
    return prismaMock;
  },
}));
const authUser = vi.fn();
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: unknown[]) => authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import handler, { savedReplyDelegate } from '@/pages/api/messages/saved-replies';

async function call(method: string, query: Record<string, string> = {}, body?: unknown) {
  const res: { statusCode: number; body: unknown; headers: Record<string, string>; ended: boolean } & Record<string, unknown> = {
    statusCode: 0, body: undefined, headers: {}, ended: false,
  };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => { res.ended = true; return res; };
  await handler({ method, query, body, headers: {} } as never, res as never);
  return res;
}

beforeEach(() => {
  rows = [];
  seq = 0;
  prismaMock.savedReply = fake;
  authUser.mockResolvedValue({ id: 'u1' });
  Object.values(fake).forEach((f) => f.mockClear());
});

describe('auth and guard', () => {
  it('401 without a session', async () => {
    authUser.mockResolvedValue(null);
    expect((await call('GET')).statusCode).toBe(401);
  });
  it('503 notReady while the Prisma client has no savedReply model (BR-4 not deployed)', async () => {
    prismaMock.savedReply = undefined;
    const r = await call('GET');
    expect(r.statusCode).toBe(503);
    expect(r.body).toEqual({ code: 'notReady' });
    expect(savedReplyDelegate({})).toBeNull();
  });
  it('503 notReady when the table is missing (P2021)', async () => {
    fake.findMany.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'P2021' }));
    expect((await call('GET')).body).toEqual({ code: 'notReady' });
  });
  it('500 unavailable on other errors, never with reply text', async () => {
    fake.findMany.mockRejectedValueOnce(new Error('boom'));
    expect(await call('GET')).toMatchObject({ statusCode: 500, body: { code: 'unavailable' } });
  });
});

describe('CRUD', () => {
  it('creates, lists sorted by usage then title, scoped to the user', async () => {
    rows.push({ id: 'other', userId: 'u2', title: 'Theirs', body: 'x', platform: null, usageCount: 99, createdAt: new Date(), updatedAt: new Date() });
    expect((await call('POST', {}, { title: 'Kargo', body: 'Kargo {order}' })).statusCode).toBe(201);
    const b = await call('POST', {}, { title: 'Beden', body: 'Ölçü', platform: 'trendyol' });
    expect(b.body).toMatchObject({ reply: { title: 'Beden', platform: 'trendyol', usageCount: 0 } });
    rows.find((r) => r.title === 'Kargo')!.usageCount = 3;
    const list = await call('GET');
    expect(list.statusCode).toBe(200);
    const body = list.body as { replies: { title: string }[]; limit: number };
    expect(body.replies.map((r) => r.title)).toEqual(['Kargo', 'Beden']);
    expect(body.limit).toBe(50);
  });
  it('400 invalid with field + reason', async () => {
    expect(await call('POST', {}, { title: '', body: 'x' })).toMatchObject({ statusCode: 400, body: { code: 'invalid', field: 'title', reason: 'required' } });
  });
  it('409 duplicate title (case-insensitive) and 409 limit at 50', async () => {
    await call('POST', {}, { title: 'Kargo', body: 'a' });
    expect(await call('POST', {}, { title: 'kargo', body: 'b' })).toMatchObject({ statusCode: 409, body: { code: 'duplicate' } });
    for (let i = rows.length; i < 50; i++) rows.push({ id: `x${i}`, userId: 'u1', title: `T${i}`, body: 'b', platform: null, usageCount: 0, createdAt: new Date(), updatedAt: new Date() });
    expect(await call('POST', {}, { title: 'One more', body: 'b' })).toMatchObject({ statusCode: 409, body: { code: 'limit', max: 50 } });
  });
  it('PATCH updates own rows only; duplicate check ignores itself', async () => {
    await call('POST', {}, { title: 'Kargo', body: 'a' });
    await call('POST', {}, { title: 'Beden', body: 'b' });
    expect(await call('PATCH', { id: 'r1' }, { title: 'KARGO', body: 'new' })).toMatchObject({ statusCode: 200, body: { reply: { title: 'KARGO', body: 'new' } } });
    expect(await call('PATCH', { id: 'r1' }, { title: 'beden' })).toMatchObject({ statusCode: 409 });
    authUser.mockResolvedValue({ id: 'u2' });
    expect((await call('PATCH', { id: 'r1' }, { body: 'hack' })).statusCode).toBe(404);
  });
  it('DELETE removes own rows only', async () => {
    await call('POST', {}, { title: 'Kargo', body: 'a' });
    authUser.mockResolvedValue({ id: 'u2' });
    expect((await call('DELETE', { id: 'r1' })).statusCode).toBe(404);
    authUser.mockResolvedValue({ id: 'u1' });
    const r = await call('DELETE', { id: 'r1' });
    expect(r.statusCode).toBe(204);
    expect(rows).toHaveLength(0);
  });
  it('action=used increments usageCount', async () => {
    await call('POST', {}, { title: 'Kargo', body: 'a' });
    expect((await call('POST', { action: 'used', id: 'r1' })).statusCode).toBe(204);
    expect(rows[0].usageCount).toBe(1);
    expect((await call('POST', { action: 'used', id: 'nope' })).statusCode).toBe(404);
  });
  it('405 on other methods', async () => {
    expect((await call('PUT')).statusCode).toBe(405);
  });
});

describe('action=import', () => {
  it('imports legacy texts once (only with 0 rows)', async () => {
    const r = await call('POST', { action: 'import' }, { items: ['Merhaba, kargonuz yolda.', 'Merhaba, kargonuz yolda.', 'Teşekkürler!'] });
    expect(r.statusCode).toBe(200);
    expect((r.body as { imported: number }).imported).toBe(2);
    expect(rows.map((x) => x.title)).toEqual(['Merhaba, kargonuz yolda.', 'Teşekkürler!']);
    expect(await call('POST', { action: 'import' }, { items: ['x'] })).toMatchObject({ statusCode: 409, body: { code: 'notEmpty' } });
  });
  it('reports rows actually inserted: a racing import whose rows are all skipped answers imported=0', async () => {
    fake.count.mockResolvedValueOnce(0); // passed the empty check before the other tab's rows landed
    fake.createMany.mockResolvedValueOnce({ count: 0 });
    const r = await call('POST', { action: 'import' }, { items: ['Teşekkürler!'] });
    expect(r.statusCode).toBe(200);
    expect((r.body as { imported: number }).imported).toBe(0);
  });
});

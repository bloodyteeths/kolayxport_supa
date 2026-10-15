// lib/messages/inboxCache.ts — messages §6.2. Inbox cache + read state, and the Wix list enrichment.
//
// BR-4: the `InboxThread` model + migration `20261015140000_inbox_threads` exist, so the generated client has
// `prisma.inboxThread` and the DB store is used. The guard is kept as a safety net only: if the table is missing
// at runtime (code deployed before `prisma migrate deploy`, P2021/P2022) calls fall back to a per-process
// in-memory store with the same contract for the rest of the process.

import type { MessagePlatform } from '@/types/messages';
import { classifyPlatformError, newestWixMessage, toIso, wixContactName } from './normalize';
import { MEMORY_STORE_MAX_ROWS_PER_USER, PREVIEW_MAX, WIX_CACHE_MAX_AGE_MS, WIX_ENRICH_CONCURRENCY } from './limits';

// ─── Row + store contract ───────────────────────────────

/** Mirrors the BR-4 `InboxThread` model (messages §6.2) minus id/userId/createdAt. */
export interface InboxThreadRow {
  platform: MessagePlatform;
  /** Wix conversationId | Trendyol questionId. */
  externalId: string;
  contactId: string | null;
  customerName: string | null;
  lastMessageAt: Date | null;
  lastMessageText: string | null;
  lastFromCustomer: boolean | null;
  needsReply: boolean;
  /** Wix: 0 → hidden from the list (D4). null = unknown. */
  messageCount: number | null;
  /** Wix contact.lastActivity when the row was refreshed. */
  contactActivityAt: Date | null;
  lastOrderNumber: string | null;
  lastSeenAt: Date | null;
  updatedAt: Date;
}

export type InboxThreadPatch = Partial<Omit<InboxThreadRow, 'platform' | 'externalId' | 'updatedAt'>>;

export interface InboxStore {
  readonly kind: 'db' | 'memory';
  findByContactIds(userId: string, platform: MessagePlatform, contactIds: string[]): Promise<InboxThreadRow[]>;
  findByExternalIds(userId: string, platform: MessagePlatform, externalIds: string[]): Promise<InboxThreadRow[]>;
  /** Creates or merges `patch` into the row. */
  upsert(userId: string, platform: MessagePlatform, externalId: string, patch: InboxThreadPatch): Promise<void>;
  /** Merges `patch` only when the row exists (never creates a partial row). */
  updateExisting(userId: string, platform: MessagePlatform, externalId: string, patch: InboxThreadPatch): Promise<void>;
  updateByContact(userId: string, platform: MessagePlatform, contactId: string, patch: InboxThreadPatch): Promise<void>;
  /** Rows with needsReply, excluding Wix rows known to have 0 messages. */
  countNeedsReply(userId: string, platform: MessagePlatform): Promise<number>;
}

const EMPTY_ROW: Omit<InboxThreadRow, 'platform' | 'externalId' | 'updatedAt'> = {
  contactId: null,
  customerName: null,
  lastMessageAt: null,
  lastMessageText: null,
  lastFromCustomer: null,
  needsReply: false,
  messageCount: null,
  contactActivityAt: null,
  lastOrderNumber: null,
  lastSeenAt: null,
};

function clean(patch: InboxThreadPatch): InboxThreadPatch {
  const out: InboxThreadPatch = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  if (typeof out.lastMessageText === 'string') out.lastMessageText = out.lastMessageText.slice(0, PREVIEW_MAX);
  return out;
}

// ─── Memory store ───────────────────────────────────────

export class MemoryInboxStore implements InboxStore {
  readonly kind = 'memory' as const;
  private users = new Map<string, Map<string, InboxThreadRow>>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  private bucket(userId: string): Map<string, InboxThreadRow> {
    let b = this.users.get(userId);
    if (!b) { b = new Map(); this.users.set(userId, b); }
    return b;
  }

  private rows(userId: string, platform: MessagePlatform): InboxThreadRow[] {
    return [...this.bucket(userId).values()].filter((r) => r.platform === platform);
  }

  async findByContactIds(userId: string, platform: MessagePlatform, contactIds: string[]) {
    const set = new Set(contactIds);
    return this.rows(userId, platform).filter((r) => r.contactId != null && set.has(r.contactId)).map((r) => ({ ...r }));
  }

  async findByExternalIds(userId: string, platform: MessagePlatform, externalIds: string[]) {
    const set = new Set(externalIds);
    return this.rows(userId, platform).filter((r) => set.has(r.externalId)).map((r) => ({ ...r }));
  }

  async upsert(userId: string, platform: MessagePlatform, externalId: string, patch: InboxThreadPatch) {
    const b = this.bucket(userId);
    const key = `${platform}:${externalId}`;
    const prev = b.get(key);
    b.delete(key); // re-insert → Map order = least recently written first
    b.set(key, { ...EMPTY_ROW, ...prev, ...clean(patch), platform, externalId, updatedAt: this.now() });
    while (b.size > MEMORY_STORE_MAX_ROWS_PER_USER) {
      const oldest = b.keys().next().value;
      if (oldest === undefined) break;
      b.delete(oldest);
    }
  }

  async updateExisting(userId: string, platform: MessagePlatform, externalId: string, patch: InboxThreadPatch) {
    if (this.bucket(userId).has(`${platform}:${externalId}`)) await this.upsert(userId, platform, externalId, patch);
  }

  async updateByContact(userId: string, platform: MessagePlatform, contactId: string, patch: InboxThreadPatch) {
    for (const r of this.rows(userId, platform)) if (r.contactId === contactId) await this.upsert(userId, platform, r.externalId, patch);
  }

  async countNeedsReply(userId: string, platform: MessagePlatform) {
    return this.rows(userId, platform).filter((r) => r.needsReply && r.messageCount !== 0).length;
  }
}

// ─── DB store (active once BR-4 lands) ──────────────────

/** The subset of the generated `prisma.inboxThread` delegate we use. */
export interface InboxThreadDelegate {
  findMany(args: unknown): Promise<unknown[]>;
  upsert(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<unknown>;
  count(args: unknown): Promise<number>;
}

function fromDb(r: any): InboxThreadRow {
  return {
    platform: r.platform,
    externalId: r.externalId,
    contactId: r.contactId ?? null,
    customerName: r.customerName ?? null,
    lastMessageAt: r.lastMessageAt ?? null,
    lastMessageText: r.lastMessageText ?? null,
    lastFromCustomer: r.lastFromCustomer ?? null,
    needsReply: !!r.needsReply,
    messageCount: r.messageCount ?? null,
    contactActivityAt: r.contactActivityAt ?? null,
    lastOrderNumber: r.lastOrderNumber ?? null,
    lastSeenAt: r.lastSeenAt ?? null,
    updatedAt: r.updatedAt ?? new Date(0),
  };
}

export class DbInboxStore implements InboxStore {
  readonly kind = 'db' as const;
  constructor(private readonly d: InboxThreadDelegate) {}

  async findByContactIds(userId: string, platform: MessagePlatform, contactIds: string[]) {
    if (contactIds.length === 0) return [];
    return (await this.d.findMany({ where: { userId, platform, contactId: { in: contactIds } } })).map(fromDb);
  }

  async findByExternalIds(userId: string, platform: MessagePlatform, externalIds: string[]) {
    if (externalIds.length === 0) return [];
    return (await this.d.findMany({ where: { userId, platform, externalId: { in: externalIds } } })).map(fromDb);
  }

  async upsert(userId: string, platform: MessagePlatform, externalId: string, patch: InboxThreadPatch) {
    const data = clean(patch);
    await this.d.upsert({
      where: { userId_platform_externalId: { userId, platform, externalId } },
      create: { userId, platform, externalId, ...data },
      update: data,
    });
  }

  async updateExisting(userId: string, platform: MessagePlatform, externalId: string, patch: InboxThreadPatch) {
    await this.d.updateMany({ where: { userId, platform, externalId }, data: clean(patch) });
  }

  async updateByContact(userId: string, platform: MessagePlatform, contactId: string, patch: InboxThreadPatch) {
    await this.d.updateMany({ where: { userId, platform, contactId }, data: clean(patch) });
  }

  async countNeedsReply(userId: string, platform: MessagePlatform) {
    return this.d.count({ where: { userId, platform, needsReply: true, NOT: { messageCount: 0 } } });
  }
}

// ─── Guarded store: DB when available, memory otherwise ─

function isMissingTable(e: any): boolean {
  const code = String(e?.code || '');
  return code === 'P2021' || code === 'P2022' || /does not exist|Unknown arg|Unknown argument/i.test(String(e?.message || ''));
}

type Logger = { warn: (msg: string, meta?: Record<string, unknown>) => void };

export class GuardedInboxStore implements InboxStore {
  private dbBroken = false;
  constructor(private readonly db: InboxStore | null, private readonly memory: InboxStore, private readonly log?: Logger) {}

  get kind(): 'db' | 'memory' {
    return this.db && !this.dbBroken ? 'db' : 'memory';
  }

  private async run<T>(fn: (s: InboxStore) => Promise<T>): Promise<T> {
    if (!this.db || this.dbBroken) return fn(this.memory);
    try {
      return await fn(this.db);
    } catch (e: any) {
      if (isMissingTable(e)) {
        this.dbBroken = true;
        this.log?.warn('[MESSAGES] InboxThread table unavailable; using the in-memory inbox store', { code: e?.code });
      } else {
        this.log?.warn('[MESSAGES] InboxThread call failed; using the in-memory inbox store for this call', { code: e?.code });
      }
      return fn(this.memory);
    }
  }

  findByContactIds(u: string, p: MessagePlatform, ids: string[]) { return this.run((s) => s.findByContactIds(u, p, ids)); }
  findByExternalIds(u: string, p: MessagePlatform, ids: string[]) { return this.run((s) => s.findByExternalIds(u, p, ids)); }
  upsert(u: string, p: MessagePlatform, id: string, patch: InboxThreadPatch) { return this.run((s) => s.upsert(u, p, id, patch)); }
  updateExisting(u: string, p: MessagePlatform, id: string, patch: InboxThreadPatch) { return this.run((s) => s.updateExisting(u, p, id, patch)); }
  updateByContact(u: string, p: MessagePlatform, c: string, patch: InboxThreadPatch) { return this.run((s) => s.updateByContact(u, p, c, patch)); }
  countNeedsReply(u: string, p: MessagePlatform) { return this.run((s) => s.countNeedsReply(u, p)); }
}

/** Builds the guarded store from a Prisma client (or any object that may carry `inboxThread`). */
export function createInboxStore(prismaLike: unknown, log?: Logger): GuardedInboxStore {
  const delegate = (prismaLike as { inboxThread?: InboxThreadDelegate } | null)?.inboxThread;
  const db = delegate && typeof delegate.findMany === 'function' ? new DbInboxStore(delegate) : null;
  return new GuardedInboxStore(db, new MemoryInboxStore(), log);
}

// ─── Wix enrichment (messages §6.2) ─────────────────────

/** The subset of `WixApiClient` used here. */
export interface WixInboxClient {
  getOrCreateConversation(participantId: { contactId?: string }): Promise<any>;
  getConversationMessages(conversationId: string, params?: { cursor?: string }): Promise<any>;
}

/** Runs `fn` over `items` with at most `limit` in flight. Results keep the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function toDate(v: unknown): Date | null {
  const iso = toIso(v);
  return iso ? new Date(iso) : null;
}

/**
 * When each Wix row was last re-read from the Inbox (enrichment only). `updatedAt` cannot be used for this:
 * markSeen / orderContext writes bump it too, so opening a conversation would keep resetting the re-check.
 * Process memory, bounded; a row with no entry (e.g. after a restart) counts as never re-read.
 * BR-4 note: a `refreshedAt` column on `InboxThread` would make this survive restarts.
 */
export class WixRefreshLog {
  private at = new Map<string, Date>();
  constructor(private readonly max = 20_000) {}
  private key(userId: string, externalId: string) { return `${userId}:${externalId}`; }
  get(userId: string, externalId: string): Date | null { return this.at.get(this.key(userId, externalId)) ?? null; }
  set(userId: string, externalId: string, when: Date): void {
    const k = this.key(userId, externalId);
    this.at.delete(k);
    this.at.set(k, when);
    while (this.at.size > this.max) {
      const oldest = this.at.keys().next().value;
      if (oldest === undefined) break;
      this.at.delete(oldest);
    }
  }
}

/** Process-wide refresh log used by `enrichWixContacts` unless a test passes its own. */
export const wixRefreshLog = new WixRefreshLog();

/**
 * Whether a cached Wix row can be used without an Inbox call. `refreshedAt` is when enrichment last re-read
 * the row (never `updatedAt`, which read-state writes also bump).
 */
export function isWixRowFresh(row: InboxThreadRow, contactActivityAt: Date | null, now: Date, refreshedAt: Date | null): boolean {
  if (contactActivityAt && (!row.contactActivityAt || row.contactActivityAt.getTime() < contactActivityAt.getTime())) return false;
  // A reply sent from the Wix dashboard may not move lastActivity: re-check needs-reply rows after a while.
  if (row.needsReply && (!refreshedAt || now.getTime() - refreshedAt.getTime() > WIX_CACHE_MAX_AGE_MS)) return false;
  return true;
}

export interface EnrichedWixRow {
  row: InboxThreadRow;
  contact: any;
}

export interface WixEnrichResult {
  /** In contact order; rows with messageCount 0 are already dropped (D4). */
  rows: EnrichedWixRow[];
  /** Inbox calls made (for logs/tests). */
  fetched: number;
  /** Contacts whose Inbox call failed (non-fatal); they were skipped or shown from a stale cache row. */
  failures: number;
  /** `classifyPlatformError` of the first non-fatal failure, null when there was none. */
  failureCode: 'rateLimited' | 'unavailable' | null;
}

/**
 * For each contact: use the cache row when fresh, else get-or-create the conversation and read the first
 * messages page (newest message → preview, time, direction), then upsert the row. A 401/403 on any contact
 * aborts the platform (thrown); other per-contact failures keep the stale row or skip the contact. When
 * every Inbox call failed and nothing could be shown, the first error is thrown.
 */
export async function enrichWixContacts(opts: {
  client: WixInboxClient;
  store: InboxStore;
  userId: string;
  contacts: any[];
  now?: Date;
  concurrency?: number;
  refreshLog?: WixRefreshLog;
}): Promise<WixEnrichResult> {
  const { client, store, userId } = opts;
  const refreshLog = opts.refreshLog ?? wixRefreshLog;
  const now = opts.now ?? new Date();
  const contacts = (opts.contacts || []).filter((c) => c && c.id);
  const cached = await store.findByContactIds(userId, 'wix', contacts.map((c) => String(c.id)));
  const byContact = new Map<string, InboxThreadRow>();
  for (const r of cached) {
    const prev = r.contactId ? byContact.get(r.contactId) : undefined;
    if (r.contactId && (!prev || prev.updatedAt < r.updatedAt)) byContact.set(r.contactId, r);
  }

  let fetched = 0;
  let failures = 0;
  let firstError: unknown = null;
  let fatal: unknown = null;

  const results = await mapLimit(contacts, opts.concurrency ?? WIX_ENRICH_CONCURRENCY, async (contact): Promise<EnrichedWixRow | null> => {
    if (fatal) return null;
    const contactId = String(contact.id);
    const activityAt = toDate(contact.lastActivity?.activityDate);
    const row = byContact.get(contactId);
    if (row && isWixRowFresh(row, activityAt, now, refreshLog.get(userId, row.externalId))) return { row, contact };

    try {
      fetched++;
      const convData = await client.getOrCreateConversation({ contactId });
      const conversationId: string | undefined = convData?.conversation?.id;
      if (!conversationId) return row ? { row, contact } : null;
      const msgData = await client.getConversationMessages(conversationId);
      const newest = newestWixMessage(msgData?.messages);
      const patch = {
        contactId,
        customerName: wixContactName(contact) || null,
        lastMessageAt: newest.at ? new Date(newest.at) : null,
        lastMessageText: newest.text,
        lastFromCustomer: newest.fromCustomer,
        needsReply: newest.fromCustomer === true,
        messageCount: newest.count,
        contactActivityAt: activityAt,
      };
      await store.upsert(userId, 'wix', conversationId, patch);
      refreshLog.set(userId, conversationId, now);
      const base = row && row.externalId === conversationId ? row : { ...EMPTY_ROW, platform: 'wix' as const, externalId: conversationId, updatedAt: now };
      return { row: { ...base, ...patch, updatedAt: now }, contact };
    } catch (e) {
      const code = classifyPlatformError(e);
      if (code === 'permission' || code === 'auth') { fatal = fatal ?? e; return null; }
      failures++;
      firstError = firstError ?? e;
      return row ? { row, contact } : null;
    }
  });

  if (fatal) throw fatal;
  const rows = results.filter((r): r is EnrichedWixRow => !!r && r.row.messageCount !== 0);
  if (rows.length === 0 && failures > 0 && failures === fetched) throw firstError;
  const firstCode = failures > 0 ? classifyPlatformError(firstError) : null;
  const failureCode = firstCode === null ? null : firstCode === 'rateLimited' ? 'rateLimited' : 'unavailable';
  return { rows, fetched, failures, failureCode };
}

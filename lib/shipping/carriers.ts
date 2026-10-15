// lib/shipping/carriers.ts — orders §6.2–§6.3 / §13 G4: the carrier catalog (services, packaging, signature,
// label stock), eligibility per carrier (connection + route), the default carrier, RateList rows and the
// submit dispatcher. Pure except the localStorage helpers (try/catch) and `submitLabel` (fetch via adapters).
import { FEDEX_PACKAGING_TYPES } from '@/lib/fedex/fedex.config';
import { UPS_SERVICE_TYPES } from '@/constants/ups';
import { JSON_HEADERS, carrierMessage, splitName, type CarrierKey, type LabelDraft, type LabelStep, type LabelSubmitResult, type SubmitContext } from './labelDraft';
import { buildFedexRequest, submitFedex } from './submit/fedex';
import { submitUps } from './submit/ups';
import { submitDhl } from './submit/dhl';

export type { CarrierKey } from './labelDraft';

/** Connection provider key per carrier (`useConnections()`; DHL eCommerce is stored as `mng`). */
export const CARRIER_PROVIDER: Record<CarrierKey, 'fedex' | 'ups' | 'mng'> = { fedex: 'fedex', ups: 'ups', dhl: 'mng' };
/** Product names, never translated. */
export const CARRIER_NAME: Record<CarrierKey, string> = { fedex: 'FedEx', ups: 'UPS', dhl: 'DHL eCommerce' };
/** Settings deep link per carrier (orders §6.3). */
export const carrierSettingsHref = (c: CarrierKey) => `/ayarlar?tab=connections&provider=${CARRIER_PROVIDER[c]}`;
export const SENDER_PROFILE_HREF = '/ayarlar?tab=senderProfile';

export interface ServiceDef {
  carrier: CarrierKey;
  code: string;
  /** Product name (not translated). DHL names are i18n keys under `createLabel.dhl.service.*`. */
  name: string;
  /** Typical published transit, international from TR. Shown as "1–3 days"; never a price. */
  transitDays?: [number, number];
  /** i18n key suffix for DHL service names. */
  i18nKey?: string;
}

/**
 * FedEx: the route accepts international services only (generate-label.ts L283–296 falls back to
 * INTERNATIONAL_PRIORITY), so only those two are offered. UPS: `UPS_SERVICE_TYPES` lists 07 and 54 twice
 * under two names; deduped by code (first name wins). DHL eCommerce: MNG service types.
 */
const UPS_TRANSIT: Record<string, [number, number]> = { '65': [1, 3], '07': [1, 3], '54': [1, 2], '08': [2, 5] };
export const SERVICES: readonly ServiceDef[] = [
  { carrier: 'fedex', code: 'INTERNATIONAL_PRIORITY', name: 'FedEx International Priority', transitDays: [1, 3] },
  { carrier: 'fedex', code: 'FEDEX_INTERNATIONAL_ECONOMY', name: 'FedEx International Economy', transitDays: [2, 5] },
  ...dedupeByCode(UPS_SERVICE_TYPES).map((s) => ({ carrier: 'ups' as const, code: s.value, name: s.label, transitDays: UPS_TRANSIT[s.value] })),
  { carrier: 'dhl', code: '1', name: 'DHL eCommerce', i18nKey: 'standard' },
  { carrier: 'dhl', code: '2', name: 'DHL eCommerce Express', i18nKey: 'express' },
  { carrier: 'dhl', code: '3', name: 'DHL eCommerce Same day', i18nKey: 'sameDay' },
];

function dedupeByCode<T extends { value: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  return list.filter((s) => (seen.has(s.value) ? false : (seen.add(s.value), true)));
}

export const servicesFor = (c: CarrierKey): ServiceDef[] => SERVICES.filter((s) => s.carrier === c);
export const serviceCodes = (c: CarrierKey): string[] => servicesFor(c).map((s) => s.code);
export function findService(c: CarrierKey, code: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.carrier === c && s.code === code);
}

export interface CodeOption { value: string; label: string; i18nKey?: string }

/**
 * Packaging per carrier. UPS: `/api/labels/ups` does not read a package type (its body never had one), so UPS
 * renders no packaging control (P1: no control that does nothing); `UPS_PAK` is the stored default only.
 */
export const PACKAGING: Record<CarrierKey, readonly CodeOption[]> = {
  fedex: FEDEX_PACKAGING_TYPES.map((p) => ({ value: p.value, label: p.label.replace(/®/g, ''), ...(p.value === 'YOUR_PACKAGING' ? { i18nKey: 'packagingOwn' } : {}) })),
  ups: [{ value: 'UPS_PAK', label: 'UPS Pak' }],
  dhl: [
    { value: '1', label: 'Parcel', i18nKey: 'dhl.packaging.parcel' },
    { value: '2', label: 'Envelope / file', i18nKey: 'dhl.packaging.envelope' },
    { value: '3', label: 'Bag', i18nKey: 'dhl.packaging.bag' },
  ],
};
export const packagingCodes = (c: CarrierKey): string[] => PACKAGING[c].map((p) => p.value);
/** Whether the carrier's request carries a packaging value the user can change. */
export const hasPackagingChoice = (c: CarrierKey) => c !== 'ups';
/** Paks and envelopes need no dimensions (§2.5 "optional for paks and envelopes"). */
export const dimsOptional = (packaging: string) => /PAK|ENVELOPE/i.test(packaging) || packaging === '2';

// No FedEx signature / label-format lists: generate-label reads no `signatureType` and hardcodes the label stock,
// so the panel renders neither control (P1). The draft keeps sending the stored defaults.
export const DHL_PAYMENT_TYPES = [1, 2] as const;
export const DHL_DELIVERY_TYPES = [1, 2] as const;

// ─── Eligibility (§6.3) ──────────────────────────────────────────────────────────────────────────

export type ConnectionSnapshot =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; connected: boolean; reason?: string | null };

export type Unavailable = 'notConnected' | 'incomplete' | 'domesticOnly';
export interface Eligibility {
  carrier: CarrierKey;
  available: boolean;
  /** Why the row is disabled. */
  reason?: Unavailable;
  /** Enabled, but the connection check failed ("Couldn't check UPS"; P6: never claim "not connected"). */
  checkFailed?: boolean;
  /** Sort hint: DHL first for TR → TR, FedEx/UPS after it. */
  rank: number;
}

export function connectionSnapshot(
  entry: { connected: boolean; reason?: string | null } | undefined,
  opts: { loading: boolean; error: unknown },
): ConnectionSnapshot {
  if (entry) return { state: 'ready', connected: !!entry.connected, reason: entry.reason ?? null };
  if (opts.loading) return { state: 'loading' };
  return { state: 'error' };
}

export function carrierEligibility(
  carrier: CarrierKey,
  conn: ConnectionSnapshot,
  route: { senderCountry: string; recipientCountry: string },
): Eligibility {
  const domestic = route.senderCountry === 'TR' && route.recipientCountry === 'TR';
  const rank = carrier === 'dhl' ? (domestic ? 0 : 3) : domestic ? (carrier === 'fedex' ? 1 : 2) : carrier === 'fedex' ? 0 : 1;
  if (carrier === 'dhl' && !domestic) return { carrier, available: false, reason: 'domesticOnly', rank };
  if (conn.state === 'error') return { carrier, available: true, checkFailed: true, rank };
  if (conn.state === 'loading') return { carrier, available: true, rank };
  if (conn.reason === 'incomplete_credentials') return { carrier, available: false, reason: 'incomplete', rank };
  if (!conn.connected) return { carrier, available: false, reason: 'notConnected', rank };
  return { carrier, available: true, rank };
}

export function eligibilityAll(
  conns: Record<CarrierKey, ConnectionSnapshot>,
  route: { senderCountry: string; recipientCountry: string },
): Eligibility[] {
  return (['fedex', 'ups', 'dhl'] as CarrierKey[])
    .map((c) => carrierEligibility(c, conns[c], route))
    .sort((a, b) => a.rank - b.rank);
}

/** True when no carrier is connected at all (EmptyState first-use). Unknown connections never count as "none". */
export function noCarrierConnected(conns: Record<CarrierKey, ConnectionSnapshot>): boolean {
  return (['fedex', 'ups', 'dhl'] as CarrierKey[]).every((c) => {
    const s = conns[c];
    return s.state === 'ready' && !s.connected && s.reason !== 'incomplete_credentials';
  });
}

/**
 * §6.1 carrier default: TR → TR uses DHL when connected; otherwise the last international carrier (if
 * still available), otherwise the first available of FedEx → UPS. `defaultCarrier` (prop) wins when available.
 */
export function pickDefaultCarrier(
  elig: readonly Eligibility[],
  opts: { domestic: boolean; lastCarrier?: CarrierKey | null; preferred?: CarrierKey | null },
): CarrierKey {
  const ok = (c: CarrierKey | null | undefined) => !!c && elig.some((e) => e.carrier === c && e.available);
  if (ok(opts.preferred)) return opts.preferred as CarrierKey;
  if (opts.domestic && ok('dhl')) return 'dhl';
  if (ok(opts.lastCarrier) && opts.lastCarrier !== 'dhl') return opts.lastCarrier as CarrierKey;
  if (ok('fedex')) return 'fedex';
  if (ok('ups')) return 'ups';
  if (ok('dhl')) return 'dhl';
  return 'fedex';
}

// ─── RateList rows ───────────────────────────────────────────────────────────────────────────────

export const rateId = (c: CarrierKey, code: string) => `${c}:${code}`;
export function parseRateId(id: string): { carrier: CarrierKey; service: string } | null {
  const i = id.indexOf(':');
  if (i < 0) return null;
  const c = id.slice(0, i) as CarrierKey;
  if (c !== 'fedex' && c !== 'ups' && c !== 'dhl') return null;
  return { carrier: c, service: id.slice(i + 1) };
}

export interface RateRow {
  id: string;
  carrier: CarrierKey;
  service: ServiceDef;
  eligibility: Eligibility;
}

/** Every service of every carrier, ordered by carrier rank; unavailable rows stay listed with their reason. */
export function rateRows(elig: readonly Eligibility[], opts: { allowDhlAll?: boolean } = {}): RateRow[] {
  const rows: RateRow[] = [];
  for (const e of elig) {
    const svcs = servicesFor(e.carrier);
    // DHL eCommerce shows one row when unavailable (the reason is per carrier, not per service).
    const list = e.carrier === 'dhl' && !e.available && !opts.allowDhlAll ? svcs.slice(0, 1) : svcs;
    for (const s of list) rows.push({ id: rateId(e.carrier, s.code), carrier: e.carrier, service: s, eligibility: e });
  }
  return rows;
}

// ─── Per-viewer memory (try/catch: storage may be blocked) ───────────────────────────────────────────

const LAST_CARRIER_KEY = 'kx.createLabel.lastCarrier';
const SEND_TRACKING_KEY = 'kx.createLabel.sendTracking';

export function readLastCarrier(): CarrierKey | null {
  try {
    const v = window.localStorage.getItem(LAST_CARRIER_KEY);
    return v === 'fedex' || v === 'ups' || v === 'dhl' ? v : null;
  } catch {
    return null;
  }
}
export function rememberCarrier(c: CarrierKey): void {
  try {
    if (c !== 'dhl') window.localStorage.setItem(LAST_CARRIER_KEY, c);
  } catch {
    /* ignore */
  }
}
export function readSendTracking(): boolean {
  try {
    return window.localStorage.getItem(SEND_TRACKING_KEY) !== '0';
  } catch {
    return true;
  }
}
export function rememberSendTracking(v: boolean): void {
  try {
    window.localStorage.setItem(SEND_TRACKING_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

// ─── Submit dispatcher ────────────────────────────────────────────────────────────────────────────

/** One entry point for the three adapters; `fetchImpl` is injectable for tests. */
export function submitLabel(draft: LabelDraft, ctx: SubmitContext = {}, fetchImpl?: typeof fetch): Promise<LabelSubmitResult> {
  switch (draft.carrier) {
    case 'ups':
      return submitUps(draft, ctx, fetchImpl);
    case 'dhl':
      return submitDhl(draft, ctx, fetchImpl);
    default:
      return submitFedex(draft, ctx, fetchImpl);
  }
}

// ─── Bulk runner (orders §2.6: sequential, concurrency 1, stop after current, retry failed) ────────────

export interface LabelJob { id: string; draft: LabelDraft }
export type JobOutcome = LabelSubmitResult | { ok: false; kind: 'running' };

export interface RunQueueOptions {
  /** Defaults to `submitLabel`. */
  submit?: (draft: LabelDraft, ctx: SubmitContext) => Promise<LabelSubmitResult>;
  /** Called with `{kind:'running'}` before each job and with the result after it. */
  onUpdate: (id: string, outcome: JobOutcome) => void;
  /** Checked before every job after the first: "Stop after current". */
  shouldStop?: () => boolean;
  /** Orders confirmed as "Create anyway" after the cancelled-order guard: sent with `forceCancelled`. */
  forceIds?: ReadonlySet<string>;
  userId?: string;
}

export interface QueueSummary {
  created: string[];
  failed: string[];
  /** Ids never started (stopped, or the usage limit was reached). */
  notStarted: string[];
  /** The usage limit (402) stopped the queue. */
  limitReached: boolean;
  stopped: boolean;
}

export async function runLabelQueue(jobs: readonly LabelJob[], opts: RunQueueOptions): Promise<QueueSummary> {
  const submit = opts.submit ?? ((d: LabelDraft, c: SubmitContext) => submitLabel(d, c));
  const summary: QueueSummary = { created: [], failed: [], notStarted: [], limitReached: false, stopped: false };
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (summary.limitReached || (i > 0 && opts.shouldStop?.())) {
      summary.stopped = summary.stopped || !summary.limitReached;
      summary.notStarted.push(...jobs.slice(i).map((j) => j.id));
      break;
    }
    opts.onUpdate(job.id, { ok: false, kind: 'running' });
    let result: LabelSubmitResult;
    try {
      result = await submit(job.draft, { forceCancelled: opts.forceIds?.has(job.id) || undefined, userId: opts.userId });
    } catch (e) {
      result = { ok: false, kind: 'error', message: e instanceof Error ? e.message.slice(0, 200) : 'Error' };
    }
    opts.onUpdate(job.id, result);
    if (result.ok) summary.created.push(job.id);
    else {
      summary.failed.push(job.id);
      if (result.kind === 'limit') summary.limitReached = true;
    }
  }
  return summary;
}

// ─── Save details without creating (⋯) ──────────────────────────────────────────────────────────────

/**
 * FedEx: the two legacy prepare calls (order update + update-options), unchanged. UPS / DHL eCommerce: one
 * `PATCH update-options` with the address and package only (no FedEx codes, which that route validates).
 */
export function buildSaveDetailsSteps(draft: LabelDraft): LabelStep[] {
  if (draft.carrier === 'fedex') return buildFedexRequest(draft).filter((s) => s.kind === 'prepare');
  const { first, last } = splitName(draft.shipTo.name);
  const s = draft.shipTo;
  const body = {
    orderId: draft.orderId,
    shippingAddress: {
      firstName: first, lastName: last, street1: s.street1, street2: s.street2, city: s.city, state: s.state,
      postal: s.postal, country: s.country, phone: s.phone, email: s.email,
      ...(s.district ? { district: s.district } : {}), ...(s.neighbourhood ? { neighbourhood: s.neighbourhood } : {}),
    },
    weightKg: draft.pkg.weightKg > 0 ? draft.pkg.weightKg : undefined,
    packageLength: draft.pkg.lengthCm || undefined,
    packageWidth: draft.pkg.widthCm || undefined,
    packageHeight: draft.pkg.heightCm || undefined,
    dimensionUnits: draft.pkg.lengthCm || draft.pkg.widthCm || draft.pkg.heightCm ? 'CM' : undefined,
  };
  return [{
    kind: 'prepare',
    url: `/api/orders/${encodeURIComponent(draft.orderId)}/update-options`,
    init: { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) },
  }];
}

/** Runs the save steps; resolves `{ ok }` or the first error message. */
export async function saveDetails(draft: LabelDraft, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const step of buildSaveDetailsSteps(draft)) {
    try {
      const res = await fetchImpl(step.url, step.init);
      if (!res.ok) {
        let body: unknown = null;
        try { body = await res.json(); } catch { body = null; }
        return { ok: false, message: carrierMessage(body, `HTTP ${res.status}`) };
      }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message.slice(0, 200) : 'Network error' };
    }
  }
  return { ok: true };
}

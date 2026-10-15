// Research display types (research.md §10). lib/research/types.ts (R1) carries the same shapes for the API;
// these are the props-side mirror so the DS does not depend on the research track.
export type MetricKind = 'measured' | 'estimate' | 'signal' | 'user';

/** An i18n message reference: `key` is a full path from the root, rendered with `params`. */
export interface Fact {
  key: string;
  params?: Record<string, string | number>;
}

export interface MetricGuard {
  ok: boolean;
  /** Already-translated reason ("small sample: 7 listings"). */
  reason?: string;
  /** Or an i18n key + params (API `Guarded.guard`). */
  reasonKey?: string;
  reasonParams?: Record<string, string | number>;
}

export interface Guarded<T> {
  value: T | null;
  kind: MetricKind;
  guard: MetricGuard;
}

export type SampleUnit = 'listings' | 'keywords' | 'shops' | 'orders' | 'items';

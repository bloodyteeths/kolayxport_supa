// Pure helpers shared by FilterBar, FiltersSheet and chips.
import type { DateRangeValue, FilterDef, FilterValue, FilterValues, NumberRangeValue, PresetKey } from './types';

export function isActiveValue(def: FilterDef, v: FilterValue): boolean {
  if (v == null) return false;
  switch (def.type) {
    case 'select':
      return typeof v === 'string' && v !== '';
    case 'multiselect':
      return Array.isArray(v) && v.length > 0;
    case 'boolean':
      return v === true;
    case 'range': {
      const r = v as NumberRangeValue;
      return typeof r === 'object' && (r.min != null || r.max != null);
    }
    case 'daterange': {
      const r = v as DateRangeValue;
      return typeof r === 'object' && Boolean(asDate(r.from) || asDate(r.to) || (r.preset && r.preset !== 'custom'));
    }
  }
}

export function countActive(filters: FilterDef[], values: FilterValues): number {
  return filters.filter((f) => isActiveValue(f, values[f.key])).length;
}

export type ValueLabels = {
  yes: string;
  /** "{a} – {b}" */
  between: (a: string, b: string) => string;
  atLeast: (a: string) => string;
  atMost: (a: string) => string;
  /** "Etsy +2" */
  andMore: (first: string, more: number) => string;
  formatNumber: (n: number) => string;
  /** Translated preset label (M1-b `ds.inputs.dateRange.preset.*`): "Last 30 days" / "Son 30 gün". */
  datePreset: (key: PresetKey) => string;
  /** lib/format date range: "1–14 Oct 2026" / "1–14 Eki 2026"; one day when both ends are equal. */
  dateRange: (from: Date, to: Date) => string;
};

/** Accepts M1-b Date values and, defensively, ISO strings (e.g. read back from the URL). */
function asDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function optionLabel(def: FilterDef, value: string): string {
  return def.options?.find((o) => o.value === value)?.label ?? value;
}

/** Short human value used on the FilterButton ("Etsy +2") and in chips. */
export function formatFilterValue(def: FilterDef, v: FilterValue, labels: ValueLabels): string {
  if (!isActiveValue(def, v)) return '';
  switch (def.type) {
    case 'select':
      return optionLabel(def, v as string);
    case 'multiselect': {
      const arr = v as string[];
      const firstLabel = optionLabel(def, arr[0]);
      return arr.length === 1 ? firstLabel : labels.andMore(firstLabel, arr.length - 1);
    }
    case 'boolean':
      return labels.yes;
    case 'range': {
      const r = v as NumberRangeValue;
      const u = def.unit ? ` ${def.unit}` : '';
      if (r.min != null && r.max != null) return labels.between(labels.formatNumber(r.min) + u, labels.formatNumber(r.max) + u);
      if (r.min != null) return labels.atLeast(labels.formatNumber(r.min) + u);
      return labels.atMost(labels.formatNumber(r.max as number) + u);
    }
    case 'daterange': {
      const r = v as DateRangeValue;
      if (r.preset && r.preset !== 'custom') return labels.datePreset(r.preset);
      const from = asDate(r.from);
      const to = asDate(r.to);
      if (from && to) return labels.dateRange(from, to);
      if (from) return labels.atLeast(labels.dateRange(from, from));
      return to ? labels.atMost(labels.dateRange(to, to)) : '';
    }
  }
}

/** Empty value for a filter type (what "remove chip" / "Clear" writes). */
export function emptyValue(def: FilterDef): FilterValue {
  return def.type === 'multiselect' ? [] : undefined;
}

/** Which filters get a visible FilterButton: pinned first, then declaration order, capped at `max`. */
export function pickVisibleFilters(filters: FilterDef[], max: number): FilterDef[] {
  if (max <= 0) return [];
  const pinned = filters.filter((f) => f.pinned);
  const rest = filters.filter((f) => !f.pinned);
  return [...pinned, ...rest].slice(0, max);
}

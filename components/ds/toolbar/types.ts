// DS §4.3 toolbar types.
import type * as React from 'react';
import type { DateRangeValue, PresetKey } from '../inputs/DateRangeField';

/** M1-b's DateRangeField value (`{ from: Date | null; to: Date | null; preset?: PresetKey }`), re-exported. */
export type { DateRangeValue, PresetKey };

export type FilterOption = {
  value: string;
  /** Translated label (brand names are proper nouns). */
  label: string;
  /** Leading visual, e.g. a <LogoTile size={16}/>. */
  leading?: React.ReactNode;
  /** Shown right-aligned and tabular, e.g. "Sale (603)". */
  count?: number;
  /** Disabled option with its reason (P1), e.g. research marketplace eligibility. */
  disabledReason?: string;
};

export type NumberRangeValue = { min?: number; max?: number };

export type FilterValue = string | string[] | boolean | DateRangeValue | NumberRangeValue | undefined;
export type FilterValues = Record<string, FilterValue>;

export type FilterDef = {
  key: string;
  label: string;
  type: 'select' | 'multiselect' | 'daterange' | 'boolean' | 'range';
  options?: FilterOption[];
  /** Pinned filters are the first candidates for the ≤ 3 visible FilterButtons. */
  pinned?: boolean;
  /** Search box inside the option list (auto when there are more than 8 options). */
  searchable?: boolean;
  /** Label of the empty value; default `ds.toolbar.all` ("All"). */
  allLabel?: string;
  /** Unit after a range input (e.g. "$"). */
  unit?: string;
  /**
   * Custom control. Required for `daterange` (pass M1-b's <DateRangeField/>); optional otherwise.
   * `placement` tells you whether it is drawn in the toolbar row or inside the FiltersSheet.
   */
  render?: (args: { value: FilterValue; onChange: (v: FilterValue) => void; placement: 'toolbar' | 'sheet' }) => React.ReactNode;
  /**
   * Chip text for an active value; default "{label}: {value}". A daterange value reads as its preset
   * label ("Order date: Last 30 days") or the DS range format ("Order date: 1–14 Oct 2026").
   */
  formatChip?: (value: FilterValue) => string;
};

export type SavedView = {
  id: string;
  label: string;
  /** The query this view applies (page-defined; the DS only stores and returns it). */
  query?: Record<string, string | string[]>;
  /** Built-in unless explicitly `false` (user-saved views); only user views can be deleted. */
  builtIn?: boolean;
  count?: number;
  countTone?: 'neutral' | 'danger';
};

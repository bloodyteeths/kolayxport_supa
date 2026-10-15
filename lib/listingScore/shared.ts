// lib/listingScore/shared.ts: small pure helpers shared by the marketplace scorers.
import type { Check, CheckFix, CheckStatus } from './types';

export const NA = 'listingScore.na';
export const FIX = 'listingScore.fix';

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(s: string): number {
  return stripHtml(s).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Visible text length (HTML removed, whitespace collapsed). */
export function textLength(s: string): number {
  return stripHtml(s).length;
}

export function naCheck(id: string, impact: number, label: string, naReason: string, fix?: CheckFix): Check {
  return { id, label, status: 'na', impact, naReason, fix };
}

export function check(
  id: string,
  impact: number,
  status: Exclude<CheckStatus, 'na'>,
  label: string,
  params?: Check['params'],
  fix?: CheckFix,
): Check {
  return { id, label, status, impact, ...(params ? { params } : {}), ...(fix ? { fix } : {}) };
}

/** Number from a Prisma Decimal, string or number; null when absent or not finite. */
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(typeof v === 'object' && v !== null && 'toString' in v ? String(v) : v);
  return Number.isFinite(n) ? n : null;
}

/** Length of a JSON array column; null when the column is not an array (unknown). */
export function jsonArrayLength(v: unknown): number | null {
  return Array.isArray(v) ? v.length : null;
}

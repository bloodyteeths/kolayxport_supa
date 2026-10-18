// lib/ebay/byteRange.ts — HTTP `Range: bytes=` parsing for staged media previews (iPhone Safari plays a <video> only
// from a server that answers byte ranges). ISOMORPHIC, pure.

/** `bytes=a-b` → inclusive [start, end] within `size`, or null when unsatisfiable / absent. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (!m[1] && !m[2]) || size <= 0) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

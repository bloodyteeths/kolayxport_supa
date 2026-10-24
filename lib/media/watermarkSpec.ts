// lib/media/watermarkSpec.ts — the watermark settings every channel's photo editor shares (pure; client + server).
// A text or logo mark, its size (share of the image width), one of nine positions or tiled, margin and opacity.
// The server applies it (lib/media/watermark.ts); the result is staged through each channel's own photo path.

export const WATERMARK_POSITIONS = ['tl', 'tc', 'tr', 'ml', 'c', 'mr', 'bl', 'bc', 'br', 'tile'] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export interface WatermarkSpec {
  kind: 'text' | 'logo';
  /** kind 'text': at most WATERMARK_TEXT_MAX characters. */
  text?: string;
  /** kind 'text': #rrggbb. */
  color?: string;
  /** kind 'logo': id of a logo the seller uploaded (POST /api/media/watermark-logo). */
  logoId?: string;
  position: WatermarkPosition;
  /** Mark width as % of the image width. */
  sizePct: number;
  /** 10–100. */
  opacityPct: number;
  /** Distance from the edges as % of the shorter side. */
  marginPct: number;
}

export const WATERMARK_TEXT_MAX = 60;
export const WATERMARK_LIMITS = { size: [5, 60], opacity: [10, 100], margin: [0, 15] } as const;
// Dark text by default (readable on the light backgrounds most product photos have); the outline is the opposite
// tone (markOutline), so a mark stays legible on any photo. 3c, 24 Oct: white at 60 % vanished on a beige towel.
export const WATERMARK_DEFAULT: WatermarkSpec = { kind: 'text', text: '', color: '#1f2937', position: 'br', sizePct: 25, opacityPct: 70, marginPct: 4 };

/** Outline colour for a text mark: light around dark text, dark around light text. Pure. */
export function markOutline(color: string | undefined): { rgb: string; alpha: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color ?? '');
  const [r, g, b] = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.5 ? { rgb: '255,255,255', alpha: 0.55 } : { rgb: '0,0,0', alpha: 0.35 };
}

const clamp = (v: unknown, [lo, hi]: readonly [number, number], dflt: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

/** Validates and clamps anything a client sent; null when it cannot describe a usable mark. Pure. */
export function normalizeWatermarkSpec(raw: unknown): WatermarkSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind === 'logo' ? 'logo' : r.kind === 'text' ? 'text' : null;
  if (!kind) return null;
  const position = (WATERMARK_POSITIONS as readonly string[]).includes(String(r.position)) ? (r.position as WatermarkPosition) : WATERMARK_DEFAULT.position;
  const base = {
    kind,
    position,
    sizePct: clamp(r.sizePct, WATERMARK_LIMITS.size, WATERMARK_DEFAULT.sizePct),
    opacityPct: clamp(r.opacityPct, WATERMARK_LIMITS.opacity, WATERMARK_DEFAULT.opacityPct),
    marginPct: clamp(r.marginPct, WATERMARK_LIMITS.margin, WATERMARK_DEFAULT.marginPct),
  } as WatermarkSpec;
  if (kind === 'text') {
    const text = typeof r.text === 'string' ? r.text.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, WATERMARK_TEXT_MAX) : '';
    if (!text) return null;
    const color = typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color.toLowerCase() : WATERMARK_DEFAULT.color!;
    return { ...base, text, color };
  }
  const logoId = typeof r.logoId === 'string' && /^[a-f0-9]{16,64}$/.test(r.logoId) ? r.logoId : null;
  return logoId ? { ...base, logoId } : null;
}

/** Top-left of a w×h mark on a W×H image for a non-tiled position (pure; clamped inside the image). */
export function markOrigin(position: Exclude<WatermarkPosition, 'tile'>, W: number, H: number, w: number, h: number, margin: number): { left: number; top: number } {
  const col = position.endsWith('l') ? 0 : position.endsWith('r') ? 2 : 1;
  const row = position.startsWith('t') ? 0 : position.startsWith('b') ? 2 : 1;
  const x = col === 0 ? margin : col === 2 ? W - w - margin : (W - w) / 2;
  const y = row === 0 ? margin : row === 2 ? H - h - margin : (H - h) / 2;
  return { left: Math.round(Math.min(Math.max(0, x), Math.max(0, W - w))), top: Math.round(Math.min(Math.max(0, y), Math.max(0, H - h))) };
}

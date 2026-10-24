// components/domain/media/WatermarkPreview.tsx — instant watermark preview in the browser (founder: the server-rendered
// preview was slow: ~1.3 s and ~470 KB per slider change). The photo is loaded once at ~800 px (browser-cached) and
// the mark is drawn on top with CSS, using the same geometry as the server (lib/media/watermark.ts: mark width =
// size % of the image width, nine positions or tiled, margin % of the shorter side, opacity). The full-resolution
// copy is rendered by the server only when staging.
import * as React from 'react';
import Box from '@mui/material/Box';
import { WATERMARK_DEFAULT, markOrigin, type WatermarkSpec } from '@/lib/media/watermarkSpec';
import { watermarkLogoUrl } from '@/lib/media/watermarkClient';

/** A ~800 px variant of a marketplace photo URL where the CDN offers one (Etsy il_fullxfull → il_794xN). Pure. */
export function previewSizedUrl(url: string): string {
  return url.replace(/\/il_fullxfull\.(\d+)/, '/il_794xN.$1');
}

type Props = { src: string; spec: WatermarkSpec; alt: string };

export function WatermarkPreview({ src, spec, alt }: Props) {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const markRef = React.useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const [mark, setMark] = React.useState<{ w: number; h: number } | null>(null);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [natural]);

  const W = size?.w ?? 0;
  const H = size?.h ?? 0;
  const markW = Math.max(4, (W * spec.sizePct) / 100);
  const maxH = H * (spec.position === 'tile' ? 0.35 : 0.6);
  // Text is measured at a base size, then scaled to exactly the mark width (capped by maxH) — the server resizes its
  // rendered text the same way, so the footprint does not depend on the font the browser or the server has.
  const BASE = 100;
  const [natText, setNatText] = React.useState<{ w: number; h: number } | null>(null);
  const textScale = natText && natText.w > 0 ? Math.min(markW / natText.w, maxH / Math.max(1, natText.h)) : 0;
  const fontSize = BASE * textScale;
  const margin = (Math.min(W, H) * spec.marginPct) / 100;

  // Text: natural size at BASE px (then scaled). Logo: measured as rendered.
  const measureRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const el = measureRef.current;
    if (el) setNatText({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height });
  }, [spec.text]);
  React.useLayoutEffect(() => {
    const el = markRef.current;
    if (!el) return;
    if (spec.kind === 'text') setMark(natText ? { w: natText.w * textScale, h: natText.h * textScale } : null);
    else setMark({ w: el.offsetWidth, h: el.offsetHeight });
  }, [spec.kind, spec.logoId, natText, textScale, markW, maxH]);

  const markNode = (key?: React.Key, style?: React.CSSProperties, ref?: React.Ref<HTMLDivElement>) =>
    spec.kind === 'logo' && spec.logoId ? (
      <Box key={key} ref={ref} component="img" src={watermarkLogoUrl(spec.logoId)} alt=""
        sx={{ position: 'absolute', width: markW, maxHeight: maxH, objectFit: 'contain', opacity: spec.opacityPct / 100, pointerEvents: 'none' }} style={style} />
    ) : (
      <Box key={key} ref={ref}
        sx={{
          position: 'absolute', whiteSpace: 'nowrap', lineHeight: 1, fontWeight: 700, pointerEvents: 'none',
          fontFamily: '"DejaVu Sans", "Liberation Sans", Arial, Helvetica, sans-serif', fontSize,
          color: spec.color ?? WATERMARK_DEFAULT.color, opacity: spec.opacityPct / 100,
          WebkitTextStroke: `${Math.max(0.5, fontSize * 0.04)}px rgba(0,0,0,0.35)`, paintOrder: 'stroke',
        }}
        style={style}
      >
        {spec.text}
      </Box>
    );

  const layers: React.ReactNode[] = [];
  if (W && H && mark) {
    if (spec.position === 'tile') {
      const gapX = Math.max(mark.w * 0.6, 24 * (W / 800));
      const gapY = Math.max(mark.h * 1.6, 24 * (W / 800));
      let row = 0;
      for (let y = margin; y < H && layers.length < 240; y += mark.h + gapY, row += 1) {
        const shift = row % 2 ? (mark.w + gapX) / 2 : 0;
        for (let x = margin - shift; x < W && layers.length < 240; x += mark.w + gapX) {
          if (x < 0 || x + mark.w > W || y + mark.h > H) continue;
          layers.push(markNode(`${row}:${Math.round(x)}`, { left: x, top: y }));
        }
      }
    } else {
      const o = markOrigin(spec.position, W, H, Math.min(mark.w, W), Math.min(mark.h, H), margin);
      layers.push(markNode('one', { left: o.left, top: o.top }));
    }
  }

  return (
    <Box sx={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', aspectRatio: natural ? `${natural.w} / ${natural.h}` : '1 / 1', overflow: 'hidden' }} ref={boxRef} data-testid="watermark-preview-live">
      <Box component="img" src={src} alt={alt} onLoad={(e: React.SyntheticEvent<HTMLImageElement>) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
      {/* Invisible copies, only to measure: the text at BASE px, and the mark (logo) as rendered. */}
      {spec.kind === 'text' ? (
        <Box ref={measureRef} sx={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', lineHeight: 1, fontWeight: 700, fontSize: BASE,
          fontFamily: '"DejaVu Sans", "Liberation Sans", Arial, Helvetica, sans-serif', left: 0, top: 0 }}>{spec.text}</Box>
      ) : null}
      {markNode('measure', { visibility: 'hidden', left: 0, top: 0 }, markRef)}
      {layers}
    </Box>
  );
}

export default WatermarkPreview;

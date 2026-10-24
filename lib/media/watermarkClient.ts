// lib/media/watermarkClient.ts — browser helpers for the shared watermark op. Each channel stages the returned File
// through its own photo path (Etsy draft media, eBay/Shopify/Wix/Trendyol signed upload), so the original photo stays
// until the seller sends, and can be restored.
import type { WatermarkSpec } from '@/lib/media/watermarkSpec';

export type WatermarkPreset = { id: string; name: string; spec: WatermarkSpec };

async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as { code?: string } | null;
  throw new Error(body?.code || `http_${res.status}`);
}

/** The watermarked copy of one photo as a File (same format; name gets "-wm"). */
export async function watermarkPhoto(imageUrl: string, spec: WatermarkSpec, name = 'photo', signal?: AbortSignal): Promise<File> {
  const res = await fetch('/api/media/watermark', {
    method: 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl, spec }),
  });
  if (!res.ok) return fail(res);
  const blob = await res.blob();
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `${name.replace(/\.[a-z0-9]+$/i, '')}-wm.${ext}`, { type: blob.type || 'image/jpeg' });
}

export async function uploadWatermarkLogo(file: File): Promise<{ id: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('logo_unreadable'));
    r.readAsDataURL(file);
  });
  const res = await fetch('/api/media/watermark-logo', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
  if (!res.ok) return fail(res);
  return res.json();
}

export const watermarkLogoUrl = (id: string) => `/api/media/watermark-logo?id=${encodeURIComponent(id)}`;

export async function listWatermarkPresets(): Promise<WatermarkPreset[]> {
  const res = await fetch('/api/media/watermark-presets', { credentials: 'same-origin' });
  if (!res.ok) return [];
  return ((await res.json()) as { presets?: WatermarkPreset[] }).presets ?? [];
}

export async function saveWatermarkPreset(name: string, spec: WatermarkSpec): Promise<WatermarkPreset> {
  const res = await fetch('/api/media/watermark-presets', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, spec }) });
  if (!res.ok) return fail(res);
  return ((await res.json()) as { preset: WatermarkPreset }).preset;
}

export async function deleteWatermarkPreset(id: string): Promise<void> {
  await fetch(`/api/media/watermark-presets?id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
}

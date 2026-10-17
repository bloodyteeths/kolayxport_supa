// lib/ai/safeUrl.ts — SSRF guard for reference media the server fetches (https only, no internal hosts). Pure.
export function isUnsafeUrl(url: string): boolean {
  if (typeof url !== 'string' || !url.startsWith('https://')) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.startsWith('10.') || host.startsWith('192.168.') ||
      host.startsWith('0.') || host.endsWith('.local') || host.endsWith('.internal') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
    );
  } catch {
    return true;
  }
}

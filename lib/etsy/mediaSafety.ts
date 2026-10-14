// Filesystem + network guards for staged Etsy draft media.
//
// EtsyDraftMedia.localPath / sourceUrl end up being read, unlinked and fetched
// by the sync engine. Both must therefore be treated as untrusted:
//   - localPath may only point inside the draft upload root and is only ever
//     written by the server-side upload helper (createDraftMediaFile).
//   - sourceUrl may only be https, and is fetched through a resolver that
//     refuses private / loopback / link-local / metadata addresses on every
//     hop (including redirects), with size and time caps.

import fs from 'fs';
import path from 'path';
import https from 'https';
import dns from 'dns';
import net from 'net';
import type { LookupFunction } from 'net';
import { EtsyDraftError } from './draftErrors';

export const ETSY_DRAFT_UPLOAD_ROOT = path.resolve(
  process.env.ETSY_DRAFT_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'etsy-drafts'),
);

/** Returns the absolute path when `p` is strictly inside the upload root, else null. */
export function resolveDraftUploadPath(p: unknown): string | null {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  const abs = path.resolve(p);
  if (!abs.startsWith(ETSY_DRAFT_UPLOAD_ROOT + path.sep)) return null;
  return abs;
}

async function realUploadRoot(): Promise<string> {
  try {
    return await fs.promises.realpath(ETSY_DRAFT_UPLOAD_ROOT);
  } catch {
    return ETSY_DRAFT_UPLOAD_ROOT;
  }
}

/** Resolve symlinks too, so a link planted inside the root can't escape it. */
async function guardedRealPath(p: unknown): Promise<string | null> {
  const abs = resolveDraftUploadPath(p);
  if (!abs) return null;
  let real: string;
  try {
    real = await fs.promises.realpath(abs);
  } catch {
    return null;
  }
  const root = await realUploadRoot();
  return real.startsWith(root + path.sep) ? real : null;
}

export async function readDraftUploadFile(p: unknown): Promise<Buffer> {
  const real = await guardedRealPath(p);
  if (!real) {
    throw new EtsyDraftError('MEDIA_PATH_REJECTED', 'Staged media file is missing or outside the upload directory', {
      status: 400,
      key: 'draftSync.mediaFileMissing',
    });
  }
  return fs.promises.readFile(real);
}

/** Best-effort delete; silently ignores anything outside the upload root. */
export async function unlinkDraftUploadFile(p: unknown): Promise<void> {
  const real = await guardedRealPath(p);
  if (!real) return;
  await fs.promises.unlink(real).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Remote source URLs
// ---------------------------------------------------------------------------

/** Hosts we fully trust as media sources (Etsy CDN + our own domain). */
export function isTrustedMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return (
    h === 'etsystatic.com' || h.endsWith('.etsystatic.com') ||
    h === 'kolayxport.com' || h.endsWith('.kolayxport.com')
  );
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inV4Range(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** True for any address that must never be fetched server-side. */
export function isPrivateAddress(address: string): boolean {
  let ip = address;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7); // IPv4-mapped IPv6
  if (net.isIPv4(ip)) {
    const blocked: Array<[string, number]> = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4],
    ];
    return blocked.some(([base, bits]) => inV4Range(ip, base, bits));
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === '::' || lower === '::1' ||
      lower.startsWith('fc') || lower.startsWith('fd') || // unique local
      lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || // link-local
      lower.startsWith('ff') || // multicast
      lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8')
    );
  }
  return true;
}

/**
 * Static check at staging time. Throws EtsyDraftError on anything that is not
 * a plain public https URL. DNS is re-checked at fetch time.
 */
export function assertAllowedSourceUrl(raw: unknown): string {
  const reject = () => {
    throw new EtsyDraftError('MEDIA_URL_REJECTED', 'Media URL must be a public https:// address', {
      status: 400,
      key: 'draftSync.mediaUrlRejected',
    });
  };
  if (typeof raw !== 'string' || raw.length > 2048) return reject();
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return reject();
  }
  if (url.protocol !== 'https:') return reject();
  if (url.username || url.password) return reject();
  if (url.port && url.port !== '443') return reject();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return reject();
  if (net.isIP(host) && isPrivateAddress(host)) return reject();
  return url.toString();
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...(options as dns.LookupOptions), all: true }, (err, addresses) => {
    if (err) return (callback as any)(err);
    const list = (Array.isArray(addresses) ? addresses : [addresses]) as dns.LookupAddress[];
    const firstPublic = list.find((a) => !isPrivateAddress(a.address));
    if (!firstPublic || list.some((a) => isPrivateAddress(a.address))) {
      return (callback as any)(new Error(`Refusing to fetch private address for ${hostname}`));
    }
    if ((options as any)?.all) return (callback as any)(null, [firstPublic]);
    return (callback as any)(null, firstPublic.address, firstPublic.family);
  });
};

/**
 * Download a staged media source URL with SSRF protection: https only,
 * public IPs only (validated inside the socket lookup, so DNS rebinding can't
 * swap in a private address after the check), at most 3 redirects (each
 * re-validated), a byte cap and a timeout.
 */
export async function fetchSourceUrlSafely(
  rawUrl: string,
  opts: { maxBytes: number; timeoutMs?: number; expect?: 'image' | 'video' },
): Promise<{ buffer: Buffer; contentType: string | null }> {
  let current = assertAllowedSourceUrl(rawUrl);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  for (let hop = 0; hop < 4; hop++) {
    const result = await new Promise<{ redirect?: string; buffer?: Buffer; contentType: string | null }>((resolve, reject) => {
      const req = https.get(current, { lookup: safeLookup, timeout: timeoutMs, headers: { 'User-Agent': 'KolayXport-MediaFetcher/1.0' } }, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: new URL(res.headers.location, current).toString(), contentType: null });
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`Media download failed: HTTP ${status}`));
          return;
        }
        const contentType = (res.headers['content-type'] || null) as string | null;
        if (opts.expect && contentType && !contentType.toLowerCase().startsWith(`${opts.expect}/`) && !contentType.toLowerCase().startsWith('application/octet-stream')) {
          res.resume();
          reject(new Error(`Media download returned unexpected content-type ${contentType}`));
          return;
        }
        const declared = Number(res.headers['content-length'] || 0);
        if (declared && declared > opts.maxBytes) {
          res.destroy();
          reject(new Error(`Media download too large (${declared} bytes)`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            res.destroy(new Error(`Media download too large (> ${opts.maxBytes} bytes)`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Media download timed out')));
      req.on('error', reject);
    });
    if (result.redirect) {
      current = assertAllowedSourceUrl(result.redirect);
      continue;
    }
    return { buffer: result.buffer as Buffer, contentType: result.contentType };
  }
  throw new Error('Media download failed: too many redirects');
}

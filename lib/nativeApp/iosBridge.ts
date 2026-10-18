// lib/nativeApp/iosBridge.ts — glue between kolayxport.com and the App Store app (mobile/ios-app, Capacitor).
// Runs only when the page is inside that app (the native Capacitor bridge is injected into the remote page).
//  - Downloads: WKWebView cannot save a blob / data: / attachment download, so label PDFs, CSV and Excel exports
//    go to a temp file and open the native Share sheet (Save to Files, Print, AirDrop, Mail...).
//  - Push: after sign-in, asks for notification permission once, registers the APNs token with the server
//    (/api/user/push-devices) and opens the notification's link when it is tapped.
type Plugin = Record<string, (...args: any[]) => Promise<any>> & {
  addListener?: (event: string, cb: (data: any) => void) => Promise<unknown>;
};
type CapacitorGlobal = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, Plugin>;
  registerPlugin?: (name: string) => Plugin;
};

function cap(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  const c = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return c && c.getPlatform?.() === 'ios' && c.isNativePlatform?.() !== false ? c : null;
}

function plugin(name: string): Plugin | null {
  const c = cap();
  if (!c) return null;
  return c.Plugins?.[name] ?? c.registerPlugin?.(name) ?? null;
}

export function isNativeIos(): boolean {
  return cap() !== null;
}

// ── Downloads → Share sheet ─────────────────────────────────────────────────────────────────────

const DOWNLOADABLE_API = /^\/api\/.*(pdf|label|export|download|csv|xlsx|invoice|etgb)/i;

function isDownloadUrl(href: string, hasDownloadAttr: boolean): boolean {
  if (!href) return false;
  if (href.startsWith('blob:') || href.startsWith('data:')) return true;
  try {
    const u = new URL(href, window.location.href);
    if (u.origin !== window.location.origin) return /\.pdf($|\?)/i.test(u.pathname);
    return hasDownloadAttr || DOWNLOADABLE_API.test(u.pathname) || /\.(pdf|csv|xlsx|zip)$/i.test(u.pathname);
  } catch {
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'text/csv': 'csv', 'image/png': 'png', 'image/gif': 'gif', 'application/zip': 'zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };

export async function saveAndShare(href: string, suggestedName?: string): Promise<void> {
  const fs = plugin('Filesystem');
  const share = plugin('Share');
  if (!fs || !share) {
    window.location.href = href;
    return;
  }
  const res = await fetch(href, { credentials: 'include' });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1];
  const type = (blob.type || '').split(';')[0];
  let name = (suggestedName || (fromHeader ? decodeURIComponent(fromHeader) : '') || `kolayxport-${Date.now()}`).replace(/[\\/:*?"<>|]/g, '_');
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += `.${EXT[type] || 'pdf'}`;
  const data = await blobToBase64(blob);
  const written = await fs.writeFile({ path: name, data, directory: 'CACHE' });
  await share.share({ title: name, files: [written.uri] });
}

function installDownloadInterceptors() {
  const handle = (href: string, name?: string) => {
    void saveAndShare(href, name).catch((err) => console.warn('[ios] share failed', err));
  };
  // Links in the page (and programmatic a.click() on detached anchors, the usual blob-download pattern).
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null;
    if (!a || !isDownloadUrl(a.getAttribute('href') || '', a.hasAttribute('download'))) return;
    e.preventDefault();
    e.stopPropagation();
    handle(a.href, a.getAttribute('download') || undefined);
  }, true);
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedClick(this: HTMLAnchorElement) {
    if (!this.isConnected && isDownloadUrl(this.getAttribute('href') || '', this.hasAttribute('download'))) {
      handle(this.href, this.getAttribute('download') || undefined);
      return;
    }
    origClick.call(this);
  };
  const origOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url ? String(url) : '';
    if (href && isDownloadUrl(href, false)) {
      handle(href);
      return null;
    }
    return origOpen(url as string, target, features);
  }) as typeof window.open;
}

// ── Push ─────────────────────────────────────────────────────────────────────────────────────────

const ASKED_KEY = 'kx_push_asked';

async function signedIn(): Promise<boolean> {
  try {
    const s = await (await fetch('/api/auth/session', { credentials: 'include' })).json();
    return Boolean(s?.user);
  } catch {
    return false;
  }
}

async function setupPush() {
  const push = plugin('PushNotifications');
  if (!push || !(await signedIn())) return;
  await push.addListener?.('registration', (t: { value?: string }) => {
    if (!t?.value) return;
    void fetch('/api/user/push-devices', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t.value, platform: 'ios' }),
    }).catch(() => {});
  });
  await push.addListener?.('pushNotificationActionPerformed', (a: { notification?: { data?: { link?: string } } }) => {
    const link = a?.notification?.data?.link;
    if (typeof link === 'string' && link.startsWith('/')) window.location.href = link;
  });
  let perm = await push.checkPermissions();
  if (perm?.receive === 'prompt' || perm?.receive === 'prompt-with-rationale') {
    let asked = false;
    try { asked = localStorage.getItem(ASKED_KEY) === '1'; } catch { /* storage blocked */ }
    if (asked) return;
    try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* ignore */ }
    perm = await push.requestPermissions();
  }
  if (perm?.receive === 'granted') await push.register();
}

let installed = false;

/** Called once from pages/_app.tsx. No-op outside the iOS app. */
export function installIosBridge(): void {
  if (installed || !isNativeIos()) return;
  installed = true;
  installDownloadInterceptors();
  void setupPush().catch((err) => console.warn('[ios] push setup failed', err));
}

// lib/push/apns.ts — Apple Push Notification service sender (SERVER ONLY), token-based (.p8) auth over HTTP/2.
// Used by the 'push' notification channel for the App Store app (mobile/ios-app).
//
// Env: APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY (the .p8 contents; literal "\n" accepted), APNS_BUNDLE_ID
//      (default com.kolayxport.app), APNS_SANDBOX=1 for development builds (Xcode debug runs).
import http2 from 'http2';
import crypto from 'crypto';

export function apnsConfigured(): boolean {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_KEY);
}

let jwtCache: { token: string; at: number } | null = null;

/** Provider token; Apple accepts one between 20 and 60 minutes old, so it is refreshed every 40 minutes. */
function providerToken(now = Date.now()): string {
  if (jwtCache && now - jwtCache.at < 40 * 60_000) return jwtCache.token;
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc({ alg: 'ES256', kid: process.env.APNS_KEY_ID })}.${enc({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(now / 1000) })}`;
  const key = crypto.createPrivateKey((process.env.APNS_KEY || '').replace(/\\n/g, '\n'));
  const sig = crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  jwtCache = { token: `${input}.${sig.toString('base64url')}`, at: now };
  return jwtCache.token;
}

export interface ApnsMessage {
  title: string;
  body?: string;
  /** In-app path opened when the notification is tapped. */
  link?: string | null;
  /** Collapses repeats of the same notification on the device. */
  collapseId?: string;
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  /** The token is dead (app removed / token rotated): delete it. */
  unregistered: boolean;
  reason?: string;
}

const host = () => (process.env.APNS_SANDBOX === '1' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');

/** Sends one notification to each device token over a single HTTP/2 session. */
export async function sendApns(tokens: string[], msg: ApnsMessage): Promise<Map<string, ApnsResult>> {
  const results = new Map<string, ApnsResult>();
  if (!tokens.length || !apnsConfigured()) return results;
  const session = http2.connect(host());
  session.on('error', () => { /* surfaced per request */ });
  const payload = JSON.stringify({
    aps: { alert: { title: msg.title, ...(msg.body ? { body: msg.body } : {}) }, sound: 'default' },
    ...(msg.link ? { link: msg.link } : {}),
  });
  try {
    await Promise.all(tokens.map((token) => new Promise<void>((resolve) => {
      const req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${providerToken()}`,
        'apns-topic': process.env.APNS_BUNDLE_ID || 'com.kolayxport.app',
        'apns-push-type': 'alert',
        'apns-priority': '10',
        ...(msg.collapseId ? { 'apns-collapse-id': msg.collapseId.slice(0, 64) } : {}),
      });
      let status = 0;
      let body = '';
      const timer = setTimeout(() => req.close(http2.constants.NGHTTP2_CANCEL), 10_000);
      req.on('response', (h) => { status = Number(h[':status']) || 0; });
      req.on('data', (c) => { body += c; });
      const done = (reason?: string) => {
        clearTimeout(timer);
        let apnsReason = reason;
        try { apnsReason = (JSON.parse(body) as { reason?: string }).reason ?? reason; } catch { /* empty body on 200 */ }
        results.set(token, {
          ok: status === 200,
          status,
          unregistered: status === 410 || apnsReason === 'BadDeviceToken' || apnsReason === 'Unregistered',
          reason: apnsReason,
        });
        resolve();
      };
      req.on('end', () => done());
      req.on('error', (e) => done(e.message.slice(0, 120)));
      req.end(payload);
    })));
  } finally {
    session.close();
  }
  return results;
}

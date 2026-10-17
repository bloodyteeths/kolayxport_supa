/**
 * Branded HTML shell for every outbound email (Blade logo, docs/brand.md).
 *
 * Mail clients: table layout, inline styles only, PNG logo hosted on the site (no SVG, no web fonts),
 * 600 px column, dark-mode safe (no pure-white text on transparent backgrounds).
 * The plain-text body is converted: blank lines = paragraphs, URLs = links, and a paragraph that is
 * exactly the `action.url` becomes a button (with the raw link below for clients that block buttons).
 */
import { COMPANY, SITE_URL } from '@/lib/site/company';

export const EMAIL_LOGO_URL = `${SITE_URL}/brand/email/kolayxport-logo.png`;

const C = { ink: '#0B1220', soft: '#3A465A', mute: '#6B7588', line: '#E3E7EF', ground: '#F2F4F8', blue: '#2F5BFF' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface EmailAction {
  url: string;
  label: string;
}

export interface RenderEmailArgs {
  /** Plain-text body (the same text sent as TextBody). */
  text: string;
  /** Optional heading above the body. */
  title?: string;
  /** Primary button; the paragraph equal to `url` is replaced by it. */
  action?: EmailAction;
  /** Inbox preview line. */
  preheader?: string;
  lang?: 'tr' | 'en';
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]/g, (u) =>
    `<a href="${u}" style="color:${C.blue};text-decoration:underline;word-break:break-all">${u}</a>`);
}

function button(a: EmailAction): string {
  const url = escapeHtml(a.url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 6px"><tr>
<td bgcolor="${C.blue}" style="border-radius:999px">
<a href="${url}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:999px">${escapeHtml(a.label)}</a>
</td></tr></table>
<p style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.mute}">${linkify(url)}</p>`;
}

function paragraphs(text: string, action?: EmailAction): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const trimmed = block.trim();
      if (action && trimmed === action.url) return `<div style="margin:0 0 18px">${button(action)}</div>`;
      if (/^[—–-]{1,2}\s*KolayXport$/.test(trimmed)) return ''; // the header logo signs the email
      if (/^[-—]{3,}$/.test(trimmed)) return `<hr style="border:0;border-top:1px solid ${C.line};margin:22px 0">`;
      return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.soft}">${linkify(escapeHtml(trimmed)).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

export function renderEmailHtml({ text, title, action, preheader, lang = 'tr' }: RenderEmailArgs): string {
  const pre = preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>` : '';
  const heading = title
    ? `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:800;letter-spacing:-.01em;color:${C.ink}">${escapeHtml(title)}</h1>`
    : '';
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>KolayXport</title></head>
<body style="margin:0;padding:0;background:${C.ground}">${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ground}" style="background:${C.ground}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
<tr><td style="padding:4px 8px 20px"><a href="${SITE_URL}" style="text-decoration:none"><img src="${EMAIL_LOGO_URL}" width="160" height="38" alt="KolayXport" style="display:block;border:0;width:160px;height:auto"></a></td></tr>
<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ${C.line};border-radius:16px;padding:32px 30px 18px">
${heading}
${paragraphs(text, action)}
</td></tr>
<tr><td style="padding:18px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.mute}">
<a href="${SITE_URL}" style="color:${C.mute};text-decoration:none;font-weight:600">kolayxport.com</a> · ${escapeHtml(COMPANY.legalName)}
</td></tr>
</table></td></tr></table></body></html>`;
}

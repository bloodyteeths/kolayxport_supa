// scripts/ebay-legacy-description-test.ts — can KolayXport edit a legacy (Trading API) eBay listing's description?
// Founder request 2026-10-17: "on ebay side make small changes to descriptions to see if it works".
//
// One listing only. Saves the original description to a backup file, appends an invisible HTML comment via
// ReviseFixedPriceItem, reads it back, then restores the original byte for byte and reads it back again.
//
//   tsx scripts/ebay-legacy-description-test.ts            # dry run: GetItem only, prints what it would do
//   tsx scripts/ebay-legacy-description-test.ts --write    # the revise + restore round trip
//   tsx scripts/ebay-legacy-description-test.ts --restore <itemId>   # put the backup back (if a run was cut off)
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { getUserAccessToken } from '../lib/integrations/ebayClient';
import { initEncryptionKey } from '../lib/crypto/credentials';

const TRADING_URL = 'https://api.ebay.com/ws/api.dll';
const MARKER = '<!-- kx-edit-test -->';
const BACKUP_DIR = process.env.EBAY_TEST_BACKUP_DIR || path.join(process.cwd(), '..', 'ebay-desc-backups');

async function trading(token: string, call: string, body: string): Promise<string> {
  const res = await fetch(TRADING_URL, {
    method: 'POST',
    headers: {
      'X-EBAY-API-IAF-TOKEN': token,
      'X-EBAY-API-CALL-NAME': call,
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1193',
      'Content-Type': 'text/xml',
    },
    body: `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${call}Request>`,
  });
  return res.text();
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? null;
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const cdata = (s: string) => `<![CDATA[${s.split(']]>').join(']]]]><![CDATA[>')}]]>`;
const errors = (xml: string) => [...xml.matchAll(/<LongMessage>([\s\S]*?)<\/LongMessage>/g)].map((m) => unescape(m[1]));

async function getDescription(token: string, itemId: string): Promise<{ ack: string | null; desc: string | null; title: string | null; status: string | null; errs: string[] }> {
  const xml = await trading(token, 'GetItem', `<ItemID>${itemId}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>false</IncludeItemSpecifics>`);
  const d = tag(xml, 'Description');
  return { ack: tag(xml, 'Ack'), desc: d === null ? null : unescape(d), title: tag(xml, 'Title'), status: tag(xml, 'ListingStatus'), errs: errors(xml) };
}

async function revise(token: string, itemId: string, desc: string) {
  const xml = await trading(token, 'ReviseFixedPriceItem', `<Item><ItemID>${itemId}</ItemID><Description>${cdata(desc)}</Description></Item>`);
  return { ack: tag(xml, 'Ack'), errs: errors(xml) };
}

async function main() {
  await initEncryptionKey();
  const write = process.argv.includes('--write');
  const restoreIdx = process.argv.indexOf('--restore');
  const candidates = await prisma.ebayListing.findMany({
    where: { sku: { startsWith: 'legacy-' }, listingId: { not: null }, ...(restoreIdx > 0 ? { listingId: process.argv[restoreIdx + 1] } : {}) },
    orderBy: { id: 'desc' },
    select: { userId: true, listingId: true, sku: true, title: true },
  });
  if (!candidates.length) throw new Error('no legacy eBay listing found');
  const token = await getUserAccessToken(candidates[0].userId);
  // Ended listings cannot be revised: take the first one eBay reports as Active.
  let itemId = candidates[0].listingId as string;
  if (restoreIdx < 0) {
    let found = false;
    for (const c of candidates) {
      const g = await getDescription(token, c.listingId as string);
      if (g.status === 'Active') { itemId = c.listingId as string; found = true; break; }
    }
    if (!found) throw new Error(`none of ${candidates.length} legacy listings is Active on eBay`);
  }
  const backupFile = path.join(BACKUP_DIR, `${itemId}.html`);

  if (restoreIdx > 0) {
    const original = fs.readFileSync(backupFile, 'utf8');
    console.log('restore', itemId, await revise(token, itemId, original));
    return;
  }

  const before = await getDescription(token, itemId);
  console.log(JSON.stringify({ itemId, title: before.title, status: before.status, getItem: before.ack, descLength: before.desc?.length ?? null, errs: before.errs }));
  if (before.ack !== 'Success' && before.ack !== 'Warning') throw new Error('GetItem failed');
  if (before.desc === null) throw new Error('no description returned');
  if (!write) { console.log('dry run: would append', MARKER, 'then restore'); return; }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(backupFile, before.desc, 'utf8');
  console.log('backup saved', backupFile);

  const edited = await revise(token, itemId, before.desc + MARKER);
  console.log('revise (+marker):', JSON.stringify(edited));
  const afterEdit = await getDescription(token, itemId);
  const markerLive = !!afterEdit.desc?.includes(MARKER);
  console.log('marker visible on eBay:', markerLive);

  if (edited.ack === 'Success' || edited.ack === 'Warning') {
    const restored = await revise(token, itemId, before.desc);
    console.log('restore:', JSON.stringify(restored));
    const final = await getDescription(token, itemId);
    console.log('restored exactly:', final.desc === before.desc, 'marker gone:', !final.desc?.includes(MARKER));
  }
}

main().catch((e) => { console.error('FAILED', e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());

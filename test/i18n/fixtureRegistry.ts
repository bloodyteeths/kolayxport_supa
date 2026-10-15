// Every test fixture that carries EN/TR UI strings, mounted at the exact path its tests merge it into the
// messages tree. Shared by test/i18n/fixtures-in-messages.test.ts, which asserts that every fixture leaf
// also exists in messages/en.json and messages/tr.json: fixtures are only a test overlay, so a key that
// lives only here renders as a raw key in production. A new fixture file must be registered below.
import { dEn, dTr } from '../billing/d-messages';
import { E_EN as PRICING_EN, E_TR as PRICING_TR } from '../billing/e-messages';
import { C_EN as BULK_C_EN, C_TR as BULK_C_TR } from '../bulk/c-messages';
import { D_EN as BULK_D_EN, D_TR as BULK_D_TR } from '../bulk/d-messages';
import { m1aMessages } from '../ds/m1a-i18n';
import { m1bInputs } from '../ds/m1b-messages';
import { M1C_EN, M1C_TR } from '../ds/m1c-messages';
import { m1dEn, m1dTr } from '../ds/m1d-messages';
import { m1eMessagesEn, m1eMessagesTr } from '../ds/m1e-messages';
import { m6sKeys } from '../ds/m6s-harness';
import { m7aEn, m7aTr } from '../ds/m7a-messages';
import { desktopMessagesEn, desktopMessagesTr } from '../ds/shell/desktop-messages';
import { SHELL_D_EN, SHELL_D_TR } from '../ds/shell/mobile-messages';
import { aEn, aTr } from '../listingEditor/a-messages';
import { bListingEditor } from '../listingEditor/b-messages';
import { cKeys } from '../listingEditor/c-messages';
import { dListingEditor } from '../listingEditor/d-messages';
import { eEn, eTr } from '../listingEditor/e-messages';
import { fKeys } from '../listingEditor/f-messages';
import { H_EN, H_TR } from '../listingEditor/h-messages';
import { M6BC_KEYS } from '../listingEditor/m6b-c-messages';
import { M6BE_EN, M6BE_TR } from '../listingEditor/m6b-e-messages';
import { m6bdKeys } from '../listingEditor/m6bd-messages';
import { G5_EN as LISTINGS_G5_EN, G5_TR as LISTINGS_G5_TR } from '../listings/g5-messages';
import { G6_EN as LISTINGS_G6_EN, G6_TR as LISTINGS_G6_TR } from '../listings/tools/g6-messages';
import { G3_EN as MSG_G3_EN, G3_TR as MSG_G3_TR } from '../messages/g3-messages';
import { G5_EN as MSG_G5_EN, G5_TR as MSG_G5_TR } from '../messages/g5-messages';
import { G6_EN as MSG_G6_EN, G6_TR as MSG_G6_TR } from '../messages/g6-messages';
import { G2_EN as ORD_G2_EN, G2_TR as ORD_G2_TR } from '../orders/g2-messages';
import { G3_EN as ORD_G3_EN, G3_TR as ORD_G3_TR } from '../orders/g3-messages';
import { G4_EN as ORD_G4_EN, G4_TR as ORD_G4_TR } from '../orders/g4-messages';
import { G5_EN as ORD_G5_EN, G5_TR as ORD_G5_TR } from '../orders/g5-messages';
import { G6_EN as OVERVIEW_EN, G6_TR as OVERVIEW_TR } from '../overview/g6-messages';
import { psEn, psTr, psPendingEn, psPendingTr } from '../photoStudio/messages';
import { C_EN as REP_C_EN, C_TR as REP_C_TR } from '../reports/c-messages';
import { D_EN as REP_D_EN, D_TR as REP_D_TR, FRAME_EN, FRAME_TR } from '../reports/d-messages';
import { ETSY_PORT_EN, ETSY_PORT_TR } from '../listings/etsy-port-messages';
import { PORT_EN as RESEARCH_PORT_EN, PORT_TR as RESEARCH_PORT_TR } from '../research/legacy-port-messages';
import { E_EN as REP_E_EN, E_TR as REP_E_TR } from '../reports/e-messages';
import { DOCTOR_EN, DOCTOR_TR } from '../research/listings-doctor/messages';
import { R1C_EN, R1C_TR } from '../research/r1c-messages';
import { R2B_EN, R2B_TR } from '../research/r2b-messages';
import { R4_EN, R4_TR } from '../research/r4-messages';
import { SHOPS_EN, SHOPS_TR } from '../research/shop-tracker/messages';
import { groupA } from '../settings/a-messages';
import { settingsBEn, settingsBTr } from '../settings/b-messages';
import { groupC } from '../settings/c-messages';
import listingScoreKeys from '../listingScore/newI18nKeys.json';
import marketplaceActionKeys from '../marketplaceActions/newI18nKeys.json';

export type Tree = { [k: string]: unknown };
export interface Fixture {
  name: string;
  en: Tree;
  tr: Tree;
}

/** Wrap a subtree at a dotted mount path (`''` = root). */
function at(path: string, tree: unknown): Tree {
  if (!path) return tree as Tree;
  return path.split('.').reduceRight<Tree>((acc, seg) => ({ [seg]: acc }), tree as Tree);
}

function fx(name: string, en: unknown, tr: unknown, mount = ''): Fixture {
  return { name, en: at(mount, en), tr: at(mount, tr) };
}

function nestFlat(keys: Record<string, [string, string]>, i: 0 | 1): Tree {
  const out: Tree = {};
  for (const [key, pair] of Object.entries(keys)) {
    const parts = key.split('.');
    let node = out;
    for (const p of parts.slice(0, -1)) node = (node[p] = (node[p] as Tree) ?? {}) as Tree;
    node[parts[parts.length - 1]] = pair[i];
  }
  return out;
}

export const FIXTURES: Fixture[] = [
  fx('billing/d-messages', dEn, dTr),
  fx('billing/e-messages', PRICING_EN, PRICING_TR),
  fx('bulk/c-messages', BULK_C_EN, BULK_C_TR),
  fx('bulk/d-messages', BULK_D_EN, BULK_D_TR),
  fx('ds/m1a-i18n', m1aMessages('en'), m1aMessages('tr')),
  fx('ds/m1b-messages', m1bInputs.en, m1bInputs.tr, 'ds.inputs'),
  fx('ds/m1c-messages', M1C_EN, M1C_TR),
  fx('ds/m1d-messages', m1dEn, m1dTr),
  fx('ds/m1e-messages', m1eMessagesEn, m1eMessagesTr),
  fx('ds/m6s-harness', m6sKeys.en.sectionNav, m6sKeys.tr.sectionNav, 'ds.page.sectionNav'),
  fx('ds/m6s-harness(images)', m6sKeys.en.images, m6sKeys.tr.images, 'ds.inputs.images'),
  fx('ds/m7a-messages', m7aEn, m7aTr),
  fx('ds/shell/desktop-messages', desktopMessagesEn, desktopMessagesTr),
  fx('ds/shell/mobile-messages', SHELL_D_EN, SHELL_D_TR),
  fx('listingEditor/a-messages', aEn, aTr),
  fx('listingEditor/b-messages', bListingEditor.en, bListingEditor.tr, 'listingEditor'),
  fx('listingEditor/c-messages', cKeys.en, cKeys.tr, 'listingEditor'),
  fx('listingEditor/d-messages', dListingEditor.en, dListingEditor.tr, 'listingEditor'),
  fx('listingEditor/e-messages', eEn, eTr),
  fx('listingEditor/f-messages', fKeys.en, fKeys.tr),
  fx('listingEditor/h-messages', H_EN, H_TR),
  fx('listingEditor/m6b-c-messages', nestFlat(M6BC_KEYS, 0), nestFlat(M6BC_KEYS, 1)),
  fx('listingEditor/m6b-e-messages', M6BE_EN, M6BE_TR),
  fx('listingEditor/m6bd-messages', m6bdKeys.en, m6bdKeys.tr, 'listingEditor'),
  fx('listings/g5-messages', LISTINGS_G5_EN, LISTINGS_G5_TR),
  fx('listings/tools/g6-messages', LISTINGS_G6_EN, LISTINGS_G6_TR),
  fx('messages/g3-messages', MSG_G3_EN, MSG_G3_TR),
  fx('messages/g5-messages', MSG_G5_EN, MSG_G5_TR),
  fx('messages/g6-messages', MSG_G6_EN, MSG_G6_TR),
  fx('orders/g2-messages', ORD_G2_EN, ORD_G2_TR),
  fx('listings/etsy-port-messages', ETSY_PORT_EN, ETSY_PORT_TR),
  fx('research/legacy-port-messages', RESEARCH_PORT_EN, RESEARCH_PORT_TR),
  fx('orders/g3-messages', ORD_G3_EN, ORD_G3_TR),
  fx('orders/g4-messages', ORD_G4_EN, ORD_G4_TR),
  fx('orders/g5-messages', ORD_G5_EN, ORD_G5_TR),
  fx('overview/g6-messages', OVERVIEW_EN, OVERVIEW_TR),
  fx('photoStudio/messages', psEn, psTr),
  fx('photoStudio/messages(pending)', psPendingEn, psPendingTr),
  fx('reports/c-messages', REP_C_EN, REP_C_TR),
  fx('reports/d-messages', REP_D_EN, REP_D_TR),
  fx('reports/d-messages(frame)', FRAME_EN, FRAME_TR),
  fx('reports/e-messages', REP_E_EN, REP_E_TR),
  fx('research/listings-doctor/messages', DOCTOR_EN, DOCTOR_TR),
  fx('research/r1c-messages', R1C_EN, R1C_TR),
  fx('research/r2b-messages', R2B_EN, R2B_TR),
  fx('research/r4-messages', R4_EN, R4_TR),
  fx('research/shop-tracker/messages', SHOPS_EN, SHOPS_TR),
  fx('settings/a-messages', groupA.en, groupA.tr),
  fx('settings/b-messages', settingsBEn, settingsBTr, 'settings'),
  fx('settings/c-messages', groupC.en, groupC.tr, 'settings'),
  fx('listingScore/newI18nKeys.json', listingScoreKeys.en, listingScoreKeys.tr),
  fx('marketplaceActions/newI18nKeys.json', marketplaceActionKeys.en, marketplaceActionKeys.tr),
];

/** Leaf paths (strings, numbers, arrays are leaves) of a tree, with their values. */
export function leaves(tree: Tree, prefix = '', out: Array<[string, unknown]> = []): Array<[string, unknown]> {
  for (const [k, v] of Object.entries(tree)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v as Tree, p, out);
    else out.push([p, v]);
  }
  return out;
}

/** Value at a dotted path, or `undefined` when missing. */
export function get(tree: Tree, path: string): unknown {
  let node: unknown = tree;
  for (const seg of path.split('.')) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as Tree)[seg];
  }
  return node;
}

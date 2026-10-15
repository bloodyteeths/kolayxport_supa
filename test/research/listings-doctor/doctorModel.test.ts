// research R1-D: Listing doctor pure model (research.md §7) — fix routing, proposals → one draft patch,
// bulk suggested prices (median only, variation/currency guards), AI title cleaning, score fallback, links, keys.
import { describe, expect, it } from 'vitest';
import {
  DOCTOR_ISSUE_IDS,
  buildDoctorScore,
  bulkGridHref,
  cleanAiTitle,
  editorHref,
  fixKindFor,
  fixLabelKeyFor,
  hasDoctorFilters,
  healthFallbackResult,
  issueIdsFor,
  keywordExplorerHref,
  notSentHref,
  photoFixHref,
  proposalsToPatch,
  removeProposal,
  suggestedPriceProposal,
  upsertProposal,
  usablePeerMedian,
  type DoctorProposal,
} from '@/components/domain/research/listings/doctorModel';
import { doctorListUrl, doctorPeersUrl, isBudgetError, sectionError } from '@/lib/research/hooks/useDoctor';
import { peersUnavailableKey } from '@/components/domain/research/listings/PeerChecks';
import type { Check } from '@/lib/listingScore/types';
import { listingRow } from './fixtures';

describe('fix routing', () => {
  it.each([
    ['price_vs_peers', 'price'],
    ['price_market', 'price'],
    ['title_length', 'title'],
    ['title_vs_peers', 'title'],
    ['title_format', 'title'],
    ['tags_count', 'tags'],
    ['tags_vs_peers', 'tags'],
    ['photos_count', 'photos'],
    ['video', 'photos'],
    ['photos_vs_peers', 'photos'],
    ['description', 'editor'],
    ['shipping_ready', 'editor'],
  ])('%s → %s', (id, kind) => {
    expect(fixKindFor({ id })).toBe(kind);
  });

  it('keeps the scorer fix label and gives peer checks the research wording', () => {
    expect(fixLabelKeyFor({ id: 'photos_count', fix: { label: 'listingScore.fix.addPhotos' } })).toBe('listingScore.fix.addPhotos');
    expect(fixLabelKeyFor({ id: 'price_vs_peers' })).toBe('research.doc.fix.setPrice');
    expect(fixLabelKeyFor({ id: 'title_vs_peers' })).toBe('research.doc.fix.suggestTitle');
    expect(fixLabelKeyFor({ id: 'tags_vs_peers' })).toBe('listingScore.fix.getTagIdeas');
  });

  it('issue options are listing checks per marketplace (peer checks are not filterable)', () => {
    expect(issueIdsFor('etsy')).toContain('photos_count');
    expect(issueIdsFor('etsy')).not.toContain('price_vs_peers');
    expect(issueIdsFor('ebay')).not.toContain('price_vs_peers');
    expect(issueIdsFor('ebay')).toContain('aspects_required');
    expect(new Set(DOCTOR_ISSUE_IDS).size).toBe(DOCTOR_ISSUE_IDS.length);
  });
});

describe('proposals → one draft per listing', () => {
  const price: DoctorProposal = { field: 'price', checkId: 'price_vs_peers', from: 58, to: 42.004, currency: 'USD' };
  const title: DoctorProposal = { field: 'title', checkId: 'title_length', from: 'Old', to: 'Personalized Baby Name Puzzle, Wooden Toy' };

  it('one proposal per field; the newer replaces the older', () => {
    const list = upsertProposal(upsertProposal([price], title), { ...price, to: 45 });
    expect(list.map((p) => p.field)).toEqual(['title', 'price']);
    expect(proposalsToPatch(list)).toEqual({ title: title.to, price: 45 });
  });

  it('rounds prices to cents and removes by field', () => {
    expect(proposalsToPatch([price])).toEqual({ price: 42 });
    expect(removeProposal([price, title], 'price')).toEqual([title]);
    expect(proposalsToPatch([])).toEqual({});
  });
});

describe('suggestedPriceProposal (bulk "Apply suggested prices")', () => {
  const peers = { price: { median: 42, quality: 'ok' as const, currency: 'USD' } };
  const failing: Pick<Check, 'id' | 'status'>[] = [{ id: 'price_vs_peers', status: 'fail' }];

  it('uses the peer median for a failing price check', () => {
    expect(suggestedPriceProposal(listingRow(), peers, failing)).toMatchObject({ field: 'price', from: 58, to: 42, currency: 'USD' });
  });

  it('skips passing checks, variation listings, other currencies and thin samples', () => {
    expect(suggestedPriceProposal(listingRow(), peers, [{ id: 'price_vs_peers', status: 'pass' }])).toBeNull();
    // warn = per-listing review in the panel, never a one-click bulk change
    expect(suggestedPriceProposal(listingRow(), peers, [{ id: 'price_vs_peers', status: 'warn' }])).toBeNull();
    expect(suggestedPriceProposal(listingRow({ editable: { price: false, qty: false, reason: 'variations' } }), peers, failing)).toBeNull();
    expect(suggestedPriceProposal(listingRow(), { price: { ...peers.price, currency: 'EUR' } }, failing)).toBeNull();
    expect(suggestedPriceProposal(listingRow(), { price: { ...peers.price, quality: 'insufficient' } }, failing)).toBeNull();
    expect(suggestedPriceProposal(listingRow(), { price: { ...peers.price, quality: 'implausible' } }, failing)).toBeNull();
    expect(suggestedPriceProposal(listingRow({ price: { amount: 42, currency: 'USD' } }), peers, failing)).toBeNull();
  });

  it('never invents a median', () => {
    expect(usablePeerMedian({ median: null, quality: 'ok', currency: 'USD' })).toBeNull();
    expect(usablePeerMedian({ median: 41.999, quality: 'small', currency: 'USD' })).toBe(42);
  });
});

describe('cleanAiTitle', () => {
  it('accepts a clean one-line string and strips quotes', () => {
    expect(cleanAiTitle('"Personalized Baby Name Puzzle, Wooden Toy"')).toBe('Personalized Baby Name Puzzle, Wooden Toy');
    expect(cleanAiTitle('Line one\nline two of the title')).toBe('Line one line two of the title');
  });
  it('rejects arrays, objects, too short and too long output (Gemini garbage guard)', () => {
    expect(cleanAiTitle(['a title'])).toBeNull();
    expect(cleanAiTitle({ title: 'x' })).toBeNull();
    expect(cleanAiTitle('short')).toBeNull();
    expect(cleanAiTitle('x'.repeat(141))).toBeNull();
    expect(cleanAiTitle('x'.repeat(81), 80)).toBeNull();
  });
});

describe('buildDoctorScore', () => {
  const peer: Check = { id: 'price_vs_peers', label: 'research.doc.check.priceVsPeers', status: 'fail', impact: 0, group: 'peers' };

  it('server listing checks + peer checks → finalizeScore (peers never in the denominator)', () => {
    const listing: Check[] = [
      { id: 'photos_count', label: 'listingScore.etsy.photosCount.low', status: 'fail', impact: 50, params: { count: 5, missing: 5 } },
      { id: 'video', label: 'listingScore.etsy.video.pass', status: 'pass', impact: 50 },
    ];
    const { result, fromServer } = buildDoctorScore(listingRow(), [...listing, peer]);
    expect(fromServer).toBe(true);
    expect(result.score).toBe(50);
    expect(result.checksUsed).toBe(2);
    expect(result.checks.find((c) => c.id === 'price_vs_peers')?.group).toBe('peers');
  });

  it('falls back to the stored health when the server sent only peer checks', () => {
    const { result, fromServer } = buildDoctorScore(listingRow(), [peer]);
    expect(fromServer).toBe(false);
    expect(result.score).toBe(45);
    expect(result.checksUsed).toBe(11);
    expect(result.checksTotal).toBe(12);
    expect(result.checks.map((c) => c.id)).toEqual(['photos_count', 'tags_quality', 'price_vs_peers']);
    expect(result.checks[0].label).toBe('research.doc.issue.photos_count');
  });

  it('unscored listing → "not enough data" (checksUsed 0)', () => {
    expect(healthFallbackResult({ score: null, used: 0, total: 12, fails: [] }).checksUsed).toBe(0);
  });
});

describe('links (staging and navigation only, never a send)', () => {
  it('builds the editor, explorer, studio, grid and not-sent links', () => {
    expect(editorHref('etsy', '149', 'S1', true, 'photos')).toBe('/app/etsy-listings/149?shop=S1#photos');
    expect(editorHref('etsy', '149', 'S1', false)).toBe('/app/etsy-listings?shop=S1&open=149');
    expect(editorHref('ebay', 'SKU 1', null, true)).toBe('/app/ebay-listings/SKU%201');
    expect(keywordExplorerHref('etsy', '149', 'S1')).toBe('/app/research/keywords?listing=149&shop=S1&mkt=etsy');
    expect(photoFixHref('etsy', '149', 'S1', { photoStudio: true, editorFlag: false })).toBe('/app/etsy-listings/photos?ids=149&shop=S1');
    expect(photoFixHref('etsy', '149', 'S1', { photoStudio: false, editorFlag: true })).toBe('/app/etsy-listings/149?shop=S1#photos');
    expect(bulkGridHref('etsy', ['1', '2'], 'S1')).toBe('/app/etsy-listings/bulk?shop=S1&ids=1%2C2');
    expect(notSentHref('etsy', 'S1')).toBe('/app/etsy-listings?shop=S1&view=not_sent');
    expect(notSentHref('ebay', 'x')).toBe('/app/ebay-listings?view=not_sent');
  });
});

describe('API keys and errors', () => {
  it('list URL: fixed order, defaults omitted', () => {
    expect(doctorListUrl({ mkt: 'etsy', sort: 'opportunity', page: 1, size: 50 })).toBe('/api/research/listings?mkt=etsy');
    expect(doctorListUrl({ mkt: 'ebay', shop: 'S', sort: 'views', issue: 'photos_count', health: 'lt50', q: 'box', page: 2, size: 100 })).toBe(
      '/api/research/listings?mkt=ebay&shop=S&sort=views&issue=photos_count&health=lt50&q=box&page=2&size=100',
    );
    expect(doctorPeersUrl('149', { shop: 'S', keyword: 'baby puzzle' })).toBe('/api/research/listings/149/peers?shop=S&keyword=baby+puzzle');
  });

  it('budget and section errors; peers n/a reason', () => {
    const errors = [{ section: 'peers', key: 'research.error.budget' }];
    expect(isBudgetError(errors)).toBe(true);
    expect(sectionError(errors, 'peers')?.key).toBe('research.error.budget');
    expect(peersUnavailableKey({ state: 'ready', errors }, true)).toBe('research.error.budget');
    expect(peersUnavailableKey({ state: 'error', errors: [] }, true)).toBe('research.error.etsy');
    expect(peersUnavailableKey({ state: 'ready', errors: [] }, false)).toBe('research.doc.peersEtsyOnly');
    expect(peersUnavailableKey({ state: 'ready', errors: [] }, true)).toBeNull();
  });

  it('filters', () => {
    expect(hasDoctorFilters({ q: undefined, 'f.issue': undefined, 'f.health': undefined })).toBe(false);
    expect(hasDoctorFilters({ q: undefined, 'f.issue': 'video', 'f.health': undefined })).toBe(true);
  });
});

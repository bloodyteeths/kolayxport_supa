import { describe, expect, it } from 'vitest';
import { foldText, guardTagFacts } from '@/lib/etsy/tagFacts';

const PESTAMAL = {
  title: 'İndigo Çizgili Peştamal, %100 Pamuk Hamam Havlusu',
  description: 'Yüzde yüz pamuk indigo çizgili peştamal. Hafif, çabuk kurur.',
  tags: ['peştamal', 'plaj havlusu', 'pamuk havlu', 'hamam havlusu'],
};
const BOWL = {
  title: 'El Yapımı İznik Çini Kase, Kobalt Mavi Lale Desenli, 20 cm',
  description: 'El yapımı İznik çini kase, kobalt mavisi lale deseniyle tek tek elde boyanır.',
  tags: ['iznik kase', 'el yapımı çini', 'kobalt mavi', 'türk seramik'],
};

describe('fact guard for translated tags (3c re-test, 24 Oct)', () => {
  it('folds Turkish letters', () => {
    expect(foldText('İndigo Çizgili Peştamal')).toBe('indigo cizgili pestamal');
    expect(foldText('Ağaç IŞIK')).toBe('agac isik');
  });
  it('drops an invented material on the cotton peshtemal, keeps the true ones', () => {
    const r = guardTagFacts(['natural fiber linen', 'cotton beach towel', 'turkish towel', 'peshtemal', 'blue lines tapestry'], PESTAMAL);
    expect(r.tags).toEqual(['cotton beach towel', 'turkish towel', 'peshtemal', 'blue lines tapestry']);
    expect(r.dropped).toEqual([{ tag: 'natural fiber linen', kind: 'material', term: 'linen' }]);
  });
  it('drops a religious term the seller never used on the Iznik bowl, keeps iznik / turkish / ceramic', () => {
    const r = guardTagFacts(['islamic accents', 'iznik bowl', 'turkish ceramic', 'cobalt blue bowl', 'vintage pottery', 'moroccan bowl'], BOWL);
    expect(r.tags).toEqual(['iznik bowl', 'turkish ceramic', 'cobalt blue bowl']);
    expect(r.dropped.map((d) => [d.tag, d.kind])).toEqual([['islamic accents', 'religion'], ['vintage pottery', 'style'], ['moroccan bowl', 'origin']]);
  });
  it('keeps a guarded term when the source states it (any language)', () => {
    expect(guardTagFacts(['linen napkins'], { title: 'Keten Peçete Seti' }).tags).toEqual(['linen napkins']);
    expect(guardTagFacts(['ramadan decor'], { description: 'Ramazan için masa süsü' }).tags).toEqual(['ramadan decor']);
    expect(guardTagFacts(['sterling silver ring'], { tags: ['925 ayar gümüş yüzük'] }).tags).toEqual(['sterling silver ring']);
  });
  it('matches whole words only', () => {
    expect(guardTagFacts(['crossbody bag', 'goldfish bowl'], { title: 'Bag' }).tags).toEqual(['crossbody bag', 'goldfish bowl']);
  });
});

describe('title units stay lowercase', () => {
  it('20 cm, 8 inch, 350 ml', async () => {
    const { normalizeTitle } = await import('@/lib/etsy/seoRules');
    expect(normalizeTitle('Handmade Iznik Ceramic Bowl, Cobalt Blue Tulip Pattern, 20 Cm')).toBe('Handmade Iznik Ceramic Bowl, Cobalt Blue Tulip Pattern, 20 cm');
    expect(normalizeTitle('copper cezve 350ml, 8 inch tray')).toBe('Copper Cezve 350ml, 8 inch Tray');
    expect(normalizeTitle('Turkish Towel, 90 X 180 Cm Hammam Sheet')).toBe('Turkish Towel, 90 x 180 cm Hammam Sheet');
  });
});

describe('translate: no title-word overlap (founder rule) + fact guard (client)', () => {
  it('peshtemal: title words stay out of tags, invented linen dropped and reported', async () => {
    const { guardAiTextItem } = await import('@/lib/bulk/aiText');
    const input = { id: 'p', title: PESTAMAL.title, description: PESTAMAL.description, tags: PESTAMAL.tags, unsent: [] };
    const r = guardAiTextItem(
      { title: 'Indigo Striped Peshtemal, 100% Cotton Turkish Hammam Towel', tags: ['peshtemal', 'turkish towel', 'quick dry wrap', 'pool sheet', 'natural fiber linen'] },
      input, ['title', 'tags'], 'translate',
    );
    expect(r?.title).toContain('Peshtemal'); // the core term is searchable through the title
    expect(r?.tags).toEqual(['quick dry wrap', 'pool sheet']);
    expect(r?.droppedTags).toEqual([{ tag: 'natural fiber linen', kind: 'material', term: 'linen' }]);
  });
});

describe('hybrid rule (Orchestrator 24 Oct): own translated tags may repeat title words, AI-added may not', () => {
  const TITLE = 'Indigo Striped Peshtemal, 100% Cotton Turkish Hammam Towel';
  it('mergeTranslatedTags keeps own tags first, drops overlapping added tags, then the fact guard', async () => {
    const { mergeTranslatedTags } = await import('@/lib/etsy/tagFacts');
    const m = mergeTranslatedTags(['peshtemal', 'beach towel', 'cotton towel', 'hammam towel'], ['striped towel', 'pool sheet', 'gift for traveler', 'natural fiber linen'], TITLE, PESTAMAL);
    expect(m.tags).toEqual(['peshtemal', 'beach towel', 'cotton towel', 'hammam towel', 'pool sheet', 'gift for traveler']);
    expect(m.own).toEqual(['peshtemal', 'beach towel', 'cotton towel', 'hammam towel']);
    expect(m.dropped.map((d) => d.tag)).toEqual(['natural fiber linen']);
  });
  it('client: tags the server marks as own survive the overlap filter; others do not', async () => {
    const { guardAiTextItem } = await import('@/lib/bulk/aiText');
    const input = { id: 'p', title: PESTAMAL.title, description: PESTAMAL.description, tags: PESTAMAL.tags, unsent: [] };
    const r = guardAiTextItem({ title: TITLE, tags: ['peshtemal', 'turkish towel', 'striped towel', 'pool sheet'], ownTags: ['peshtemal', 'turkish towel'] }, input, ['title', 'tags'], 'translate');
    expect(r?.tags).toEqual(['peshtemal', 'turkish towel', 'pool sheet']);
  });
});

describe('3c re-check 2: çini is not "tile", % stays', () => {
  it('drops "tile" unless the source says karo / pano', async () => {
    const { guardTagFacts } = await import('@/lib/etsy/tagFacts');
    expect(guardTagFacts(['handmade tile', 'ceramic tile bowl', 'iznik bowl'], BOWL).tags).toEqual(['iznik bowl']);
    expect(guardTagFacts(['iznik tile'], { title: 'El Yapımı İznik Çini Pano, Duvar Karosu' }).tags).toEqual(['iznik tile']);
  });
  it('restores the % the AI dropped when the source has it', async () => {
    const { restorePercent } = await import('@/lib/etsy/tagFacts');
    expect(restorePercent('Turkish Peshtemal Towel, 100 Cotton Bath Sheet', PESTAMAL.title)).toBe('Turkish Peshtemal Towel, 100% Cotton Bath Sheet');
    expect(restorePercent('Peshtemal, 100 Percent Cotton Beach Towel', PESTAMAL.title)).toBe('Peshtemal, 100% Cotton Beach Towel');
    expect(restorePercent('Peshtemal, 100% Cotton', PESTAMAL.title)).toBe('Peshtemal, 100% Cotton');
    expect(restorePercent('Bowl 20 cm', 'Kase %20 indirim')).toBe('Bowl 20 cm'); // a measurement is not a percentage
  });
  it('a translated title that calls the bowl a tile is withheld and explained (client)', async () => {
    const { guardAiTextItem } = await import('@/lib/bulk/aiText');
    const input = { id: 'b', title: BOWL.title, description: BOWL.description, tags: BOWL.tags, unsent: [] };
    const r = guardAiTextItem({ title: 'Handmade Iznik Tile Bowl, Cobalt Blue Tulip Pottery', description: 'A hand painted Iznik ceramic bowl.' }, input, ['title', 'description'], 'translate');
    expect(r?.title).toBeUndefined();
    expect(r?.description).toBe('A hand painted Iznik ceramic bowl.');
    expect(r?.droppedTags).toEqual([{ tag: 'Handmade Iznik Tile Bowl', kind: 'product', term: 'tile', field: 'title' }]);
  });
});

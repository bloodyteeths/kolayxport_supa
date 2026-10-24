// lib/etsy/tagFacts.ts — fact guard for AI-written English tags (translate mode). Pure; shared by the server
// (pages/api/ai/etsy.ts bulk_optimize) and the review dialog.
//
// A translated tag must never state a fact the seller's own listing does not: a material ("linen" on a cotton
// towel), an origin, a religious or cultural term, or a style. That is an Etsy misrepresentation risk for the
// seller. Each guarded English term lists the words that justify it in the SOURCE listing (usually Turkish); a tag
// that names a guarded term with none of its justifications in the source title, description or tags is dropped and
// reported, never silently kept.

export type TagFactKind = 'material' | 'origin' | 'religion' | 'style';

type FactTerm = { kind: TagFactKind; en: string[]; src: string[] };

// `en`: how the term shows up in an English tag (whole words, folded). `src`: what justifies it in the source
// listing (folded; Turkish and English). Matching is on whole words after folding (ş→s, ı→i, …).
const TERMS: FactTerm[] = [
  // materials
  { kind: 'material', en: ['linen'], src: ['linen', 'keten'] },
  { kind: 'material', en: ['cotton'], src: ['cotton', 'pamuk', 'pamuklu'] },
  { kind: 'material', en: ['bamboo'], src: ['bamboo', 'bambu'] },
  { kind: 'material', en: ['silk'], src: ['silk', 'ipek', 'ipekli'] },
  { kind: 'material', en: ['wool', 'woolen', 'woollen'], src: ['wool', 'yun', 'yunlu'] },
  { kind: 'material', en: ['cashmere'], src: ['cashmere', 'kasmir'] },
  { kind: 'material', en: ['velvet'], src: ['velvet', 'kadife'] },
  { kind: 'material', en: ['satin'], src: ['satin', 'saten'] },
  { kind: 'material', en: ['leather'], src: ['leather', 'deri', 'derı'] },
  { kind: 'material', en: ['suede'], src: ['suede', 'suet', 'sut deri'] },
  { kind: 'material', en: ['silver', 'sterling'], src: ['silver', 'sterling', 'gumus', '925'] },
  { kind: 'material', en: ['gold'], src: ['gold', 'altin', '14k', '18k', '22k'] },
  { kind: 'material', en: ['brass'], src: ['brass', 'pirinc'] },
  { kind: 'material', en: ['copper'], src: ['copper', 'bakir'] },
  { kind: 'material', en: ['bronze'], src: ['bronze', 'bronz'] },
  { kind: 'material', en: ['wood', 'wooden', 'oak', 'walnut'], src: ['wood', 'wooden', 'ahsap', 'tahta', 'mese', 'ceviz', 'oak', 'walnut'] },
  { kind: 'material', en: ['glass'], src: ['glass', 'cam'] },
  { kind: 'material', en: ['crystal'], src: ['crystal', 'kristal'] },
  { kind: 'material', en: ['porcelain'], src: ['porcelain', 'porselen'] },
  { kind: 'material', en: ['ceramic', 'ceramics', 'stoneware', 'pottery'], src: ['ceramic', 'ceramics', 'stoneware', 'pottery', 'seramik', 'cini', 'comlek', 'tasarim seramik'] },
  { kind: 'material', en: ['marble'], src: ['marble', 'mermer'] },
  { kind: 'material', en: ['pearl', 'pearls'], src: ['pearl', 'inci', 'incili'] },
  { kind: 'material', en: ['turquoise'], src: ['turquoise', 'turkuaz', 'firuze'] },
  { kind: 'material', en: ['resin', 'epoxy'], src: ['resin', 'epoxy', 'recine', 'epoksi'] },
  { kind: 'material', en: ['plastic', 'acrylic'], src: ['plastic', 'acrylic', 'plastik', 'akrilik'] },
  // origins
  { kind: 'origin', en: ['turkish', 'turkey', 'ottoman', 'anatolian'], src: ['turkish', 'turkey', 'turk', 'turkiye', 'istanbul', 'osmanli', 'ottoman', 'anadolu', 'iznik', 'kapadokya', 'pestamal', 'cezve', 'telkari', 'nazar'] },
  { kind: 'origin', en: ['moroccan', 'morocco'], src: ['moroccan', 'morocco', 'fas'] },
  { kind: 'origin', en: ['persian', 'iranian'], src: ['persian', 'iran', 'acem'] },
  { kind: 'origin', en: ['indian'], src: ['indian', 'india', 'hint'] },
  { kind: 'origin', en: ['mexican'], src: ['mexican', 'mexico', 'meksika'] },
  { kind: 'origin', en: ['japanese'], src: ['japanese', 'japan', 'japon'] },
  { kind: 'origin', en: ['greek'], src: ['greek', 'greece', 'yunan'] },
  { kind: 'origin', en: ['scandinavian', 'nordic'], src: ['scandinavian', 'nordic', 'iskandinav'] },
  { kind: 'origin', en: ['african'], src: ['african', 'africa', 'afrika'] },
  // religion / culture
  { kind: 'religion', en: ['islamic', 'islam', 'muslim', 'quran', 'koran', 'ramadan', 'eid', 'arabic'], src: ['islamic', 'islam', 'islami', 'muslim', 'musluman', 'kuran', 'quran', 'ramazan', 'ramadan', 'bayram', 'eid', 'arapca', 'arabic', 'hat sanati', 'dua'] },
  { kind: 'religion', en: ['christian', 'bible', 'christ', 'jesus', 'catholic'], src: ['christian', 'bible', 'hristiyan', 'incil', 'isa', 'hac', 'cross', 'katolik'] },
  { kind: 'religion', en: ['jewish', 'judaica', 'hanukkah', 'menorah'], src: ['jewish', 'judaica', 'yahudi', 'hanuka', 'menora'] },
  { kind: 'religion', en: ['buddha', 'buddhist', 'zen'], src: ['buddha', 'buddhist', 'buda', 'budist', 'zen'] },
  { kind: 'religion', en: ['hindu', 'hamsa'], src: ['hindu', 'hamsa', 'fatma ana eli'] },
  { kind: 'religion', en: ['spiritual', 'sacred', 'prayer'], src: ['spiritual', 'sacred', 'prayer', 'manevi', 'kutsal', 'dua'] },
  // style claims
  { kind: 'style', en: ['vintage', 'antique', 'retro'], src: ['vintage', 'antique', 'retro', 'antika', 'eski', 'nostaljik'] },
  { kind: 'style', en: ['boho', 'bohemian'], src: ['boho', 'bohemian', 'bohem'] },
  { kind: 'style', en: ['organic'], src: ['organic', 'organik'] },
];

/** Lowercase + fold Turkish/European diacritics so "Peştamal" and "pestamal", "İznik" and "iznik" compare. Pure. */
export function foldText(s: string): string {
  return (s || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const hasWords = (hay: string, needle: string) => ` ${hay} `.includes(` ${needle} `);

export type DroppedFactTag = { tag: string; kind: TagFactKind; term: string };

/**
 * Keeps the tags whose guarded terms are justified by the source listing; returns the rest as `dropped`.
 * `source` is the original (pre-translation) title, description and tags. Pure.
 */
export function guardTagFacts(tags: readonly string[], source: { title?: string; description?: string; tags?: readonly string[] }): { tags: string[]; dropped: DroppedFactTag[] } {
  const hay = foldText([source.title ?? '', source.description ?? '', ...(source.tags ?? [])].join(' \n '));
  const kept: string[] = [];
  const dropped: DroppedFactTag[] = [];
  for (const tag of tags) {
    const t = foldText(tag);
    let violation: DroppedFactTag | null = null;
    for (const term of TERMS) {
      const hit = term.en.find((w) => hasWords(t, w));
      if (!hit) continue;
      if (term.src.some((w) => hasWords(hay, w))) continue;
      violation = { tag, kind: term.kind, term: hit };
      break;
    }
    if (violation) dropped.push(violation);
    else kept.push(tag);
  }
  return { tags: kept, dropped };
}

// test/listingEditor/m6b-e-messages.ts — M6b-E i18n fragment (listingEditor.ai.*, listingScore.trendyol.*), EN + TR.
// The single source for the keys returned as `newI18nKeys`; tests merge it over messages/{en,tr}.json until the
// integrator merges it. (listingScore.trendyol.attributes.requiredMissing is also in test/listingScore/newI18nKeys.json
// so the scorer key test sees it.)
type Tree = { [k: string]: string | Tree };

export const M6BE_EN: Tree = {
  listingEditor: {
    ai: {
      attributesNeedCategory: 'Choose a category first: attributes depend on it',
      noAttributeIdeas: 'No confident values for the remaining attributes. Fill them yourself',
    },
  },
  listingScore: {
    trendyol: {
      attributes: {
        requiredMissing: '{count, plural, one {# required attribute is} other {# required attributes are}} empty',
      },
    },
  },
};

export const M6BE_TR: Tree = {
  listingEditor: {
    ai: {
      attributesNeedCategory: 'Önce kategori seçin: özellikler kategoriye göre değişir',
      noAttributeIdeas: 'Kalan özellikler için emin olunan bir değer yok. Bunları kendiniz doldurun',
    },
  },
  listingScore: {
    trendyol: {
      attributes: {
        requiredMissing: '{count} zorunlu özellik boş',
      },
    },
  },
};

/**
 * Synthetic product catalogue shared by the local demo seed (scripts/demo/seed-demo-account.ts) and the
 * directory reviewer seed (scripts/directory/seed-reviewer-account.ts). Pure data: no I/O, no randomness.
 * Product names are generic handmade goods; nothing here refers to a real shop or person.
 */
export type Cat = 'ceramics' | 'silver' | 'towel' | 'leather' | 'decor';
export interface Product { sku: string; title: string; image: string; price: number; cost: number; cat: Cat; trTitle: string; personalizable?: boolean }

export const PRODUCTS: Product[] = [
  { sku: 'KX-IZB-01', cat: 'ceramics', image: 'iznik-bowl-blue', price: 48, cost: 14, title: 'Handmade Iznik Ceramic Bowl, Cobalt Blue Tulip Pattern, Turkish Pottery Serving Bowl, 8 Inch', trTitle: 'El Yapımı İznik Çini Kase, Kobalt Mavi Lale Desenli, 20 cm' },
  { sku: 'KX-IZB-02', cat: 'ceramics', image: 'iznik-bowl-turquoise', price: 46, cost: 13, title: 'Turquoise Iznik Ceramic Bowl, Hand Painted Turkish Pottery, Fruit Bowl, Housewarming Gift', trTitle: 'Turkuaz İznik Çini Kase, El Boyaması Meyve Kasesi' },
  { sku: 'KX-MUG-01', cat: 'ceramics', image: 'ceramic-mug-terracotta', price: 32, cost: 8, title: 'Terracotta Ceramic Coffee Mug, Handmade Stoneware Mug with Dot Pattern, 12 oz', trTitle: 'Terrakota Seramik Kupa, El Yapımı Puantiyeli, 350 ml' },
  { sku: 'KX-MUG-02', cat: 'ceramics', image: 'ceramic-mug-sage', price: 32, cost: 8, title: 'Sage Green Handmade Mug, Speckled Stoneware Coffee Cup, Minimalist Pottery Gift', trTitle: 'Adaçayı Yeşili El Yapımı Kupa, Taş Seramik Kahve Fincanı' },
  { sku: 'KX-IZP-01', cat: 'ceramics', image: 'iznik-plate-tulip', price: 58, cost: 16, title: 'Iznik Tulip Decorative Plate, Hand Painted Turkish Ceramic Wall Plate, 10 Inch', trTitle: 'İznik Lale Desenli Dekoratif Tabak, El Boyaması Duvar Tabağı 25 cm' },
  { sku: 'KX-IZP-02', cat: 'ceramics', image: 'iznik-plate-green', price: 54, cost: 15, title: 'Green Iznik Ceramic Plate, Turkish Floral Wall Decor, Hand Painted Serving Plate', trTitle: 'Yeşil İznik Çini Tabak, Çiçek Desenli Servis Tabağı' },
  { sku: 'KX-TLK-N01', cat: 'silver', image: 'telkari-necklace-turquoise', price: 89, cost: 27, title: 'Telkari Filigree Necklace, 925 Sterling Silver Lotus Pendant with Turquoise, Handmade in Turkey', trTitle: 'Telkari Gümüş Kolye, 925 Ayar Turkuaz Taşlı Lotus Kolye' },
  { sku: 'KX-TLK-N02', cat: 'silver', image: 'telkari-necklace-garnet', price: 92, cost: 28, title: 'Silver Filigree Flower Necklace with Garnet, Telkari Sterling Pendant, Anniversary Gift for Her', trTitle: 'Telkari Gümüş Çiçek Kolye, Lal Taşlı 925 Ayar' },
  { sku: 'KX-TLK-E01', cat: 'silver', image: 'telkari-earrings', price: 64, cost: 19, title: 'Telkari Filigree Earrings, Sterling Silver Drop Earrings with Turquoise Stone, Boho Jewelry', trTitle: 'Telkari Gümüş Küpe, Turkuaz Taşlı Sallantılı Küpe' },
  { sku: 'KX-TLK-E02', cat: 'silver', image: 'telkari-earrings-pearl', price: 68, cost: 20, title: 'Pearl Filigree Earrings, 925 Silver Telkari Dangle Earrings, Bridal Jewelry Gift', trTitle: 'İncili Telkari Küpe, 925 Ayar Gümüş Gelin Küpesi' },
  { sku: 'KX-RNG-01', cat: 'silver', image: 'silver-ring-amethyst', price: 56, cost: 16, title: 'Amethyst Silver Ring, Handmade 925 Sterling Statement Ring, February Birthstone', trTitle: 'Ametist Taşlı Gümüş Yüzük, El Yapımı 925 Ayar' },
  { sku: 'KX-PST-01', cat: 'towel', image: 'peshtemal-indigo', price: 29, cost: 7, title: 'Turkish Peshtemal Towel, Indigo Striped Cotton Beach Towel, Lightweight Hammam Towel', trTitle: 'İndigo Çizgili Peştamal, %100 Pamuk Hamam Havlusu' },
  { sku: 'KX-PST-02', cat: 'towel', image: 'peshtemal-terracotta', price: 29, cost: 7, title: 'Terracotta Turkish Towel, 100% Cotton Peshtemal, Quick Dry Bath and Beach Towel', trTitle: 'Kiremit Rengi Peştamal, Pamuk Plaj ve Banyo Havlusu' },
  { sku: 'KX-PST-03', cat: 'towel', image: 'peshtemal-sage', price: 34, cost: 9, title: 'Sage Green Peshtemal, Turkish Cotton Hand Towel Set of 2, Spa Bathroom Decor', trTitle: 'Adaçayı Yeşili Peştamal El Havlusu, 2\'li Set' },
  { sku: 'KX-PST-04', cat: 'towel', image: 'peshtemal-indigo', price: 38, cost: 9, personalizable: true, title: 'Personalized Turkish Beach Towel, Monogram Peshtemal, Bridesmaid Gift, Indigo', trTitle: 'Kişiye Özel İsimli Peştamal, Nakışlı Plaj Havlusu' },
  { sku: 'KX-LTH-W01', cat: 'leather', image: 'leather-wallet-cognac', price: 52, cost: 15, personalizable: true, title: 'Personalized Leather Wallet, Cognac Bifold Wallet for Men, Engraved Initials Gift', trTitle: 'Kişiye Özel Deri Cüzdan, Taba Renk, İsim Baskılı' },
  { sku: 'KX-LTH-W02', cat: 'leather', image: 'leather-wallet-black', price: 39, cost: 11, title: 'Black Leather Card Holder, Minimalist Slim Wallet, Hand Stitched Full Grain Leather', trTitle: 'Siyah Deri Kartlık, El Dikimi İnce Cüzdan' },
  { sku: 'KX-LTH-T01', cat: 'leather', image: 'leather-tote-tan', price: 165, cost: 48, title: 'Leather Tote Bag, Tan Full Grain Leather Shoulder Bag, Handmade Work Tote for Women', trTitle: 'Hakiki Deri Omuz Çantası, Taba El Yapımı Tote' },
  { sku: 'KX-NZR-01', cat: 'decor', image: 'evil-eye-hanging', price: 24, cost: 5, title: 'Evil Eye Wall Hanging, Turkish Nazar Glass Bead Decor, Protection Amulet Gift', trTitle: 'Nazar Boncuklu Duvar Süsü, El Yapımı Cam Nazarlık' },
  { sku: 'KX-CZV-01', cat: 'decor', image: 'copper-cezve', price: 42, cost: 12, title: 'Hammered Copper Turkish Coffee Pot, Handmade Cezve with Wooden Handle, 10 oz', trTitle: 'Dövme Bakır Cezve, Ahşap Saplı El Yapımı, 300 ml' },
  { sku: 'KX-LMP-01', cat: 'decor', image: 'mosaic-lamp', price: 79, cost: 24, title: 'Turkish Mosaic Lamp, Handmade Glass Hanging Lantern, Moroccan Style Ceiling Light', trTitle: 'Mozaik Avize, El Yapımı Cam Tavan Lambası' },
  { sku: 'KX-MUG-03', cat: 'ceramics', image: 'ceramic-mug-terracotta', price: 58, cost: 15, title: 'Set of 2 Handmade Ceramic Mugs, Terracotta and Sage Stoneware, Couples Coffee Gift', trTitle: '2\'li El Yapımı Seramik Kupa Seti, Terrakota ve Yeşil' },
  { sku: 'KX-IZB-03', cat: 'ceramics', image: 'iznik-bowl-blue', price: 44, cost: 12, title: 'Small Iznik Ceramic Dipping Bowls, Set of 4, Hand Painted Turkish Tapas Bowls', trTitle: '4\'lü İznik Çini Çerezlik Seti, El Boyaması' },
  { sku: 'KX-TLK-N03', cat: 'silver', image: 'telkari-necklace-turquoise', price: 72, cost: 21, title: 'Dainty Filigree Necklace, Sterling Silver Telkari Pendant, Minimalist Everyday Jewelry', trTitle: 'İnce Telkari Gümüş Kolye, Minimal Günlük Takı' },
  { sku: 'KX-PST-05', cat: 'towel', image: 'peshtemal-terracotta', price: 68, cost: 19, title: 'Turkish Cotton Throw Blanket, Terracotta Peshtemal Sofa Throw, Boho Bedspread', trTitle: 'Pamuk Peştamal Koltuk Şalı, Kiremit Rengi Yatak Örtüsü' },
];

export const TAGS: Record<Cat, string[]> = {
  ceramics: ['turkish ceramic', 'iznik pottery', 'handmade bowl', 'housewarming gift', 'ceramic gift', 'hand painted', 'kitchen decor', 'boho kitchen', 'pottery gift', 'serving bowl', 'stoneware', 'gift for mom', 'table decor'],
  silver: ['telkari jewelry', 'filigree necklace', 'sterling silver', '925 silver', 'turkish jewelry', 'gift for her', 'boho jewelry', 'handmade jewelry', 'anniversary gift', 'dainty pendant', 'turquoise stone', 'bridal jewelry', 'birthday gift'],
  towel: ['turkish towel', 'peshtemal', 'beach towel', 'cotton towel', 'hammam towel', 'bath towel', 'quick dry towel', 'spa gift', 'boho decor', 'pool towel', 'bridesmaid gift', 'travel towel', 'bathroom decor'],
  leather: ['leather wallet', 'mens wallet', 'personalized gift', 'gift for him', 'engraved wallet', 'card holder', 'full grain leather', 'minimalist wallet', 'anniversary gift', 'groomsmen gift', 'handmade leather', 'fathers day gift', 'slim wallet'],
  decor: ['turkish decor', 'evil eye', 'nazar boncuk', 'wall hanging', 'boho home decor', 'housewarming gift', 'copper cezve', 'turkish coffee', 'mosaic lamp', 'handmade gift', 'protection amulet', 'moroccan lamp', 'home decor'],
};
export const MATERIALS: Record<Cat, string[]> = {
  ceramics: ['ceramic', 'glaze', 'clay'], silver: ['925 sterling silver', 'turquoise'], towel: ['cotton'], leather: ['full grain leather', 'waxed thread'], decor: ['glass', 'copper', 'brass'],
};
export const SECTION: Record<Cat, number> = { ceramics: 51001, silver: 51002, towel: 51003, leather: 51004, decor: 51005 };
export const TAXONOMY: Record<Cat, number> = { ceramics: 1052, silver: 1222, towel: 1031, leather: 2009, decor: 1037 };

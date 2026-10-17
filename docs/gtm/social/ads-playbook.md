# Reklam oyun kitabı / Ads playbook

Tarih: 2026-10-17. Kapsam: ilk ay (lansman) ücretli sosyal reklam testi. **Her reklam ve bütçe değişikliği kurucu onayına tabidir** (README §5).

## 1. Reklam açmadan önce kontrol listesi (hepsi "evet" olmalı)

Bunlar `roadmap.md` §2.A "Must-have before ads" listesiyle aynıdır. Biri eksikse reklam açılmaz.

- [ ] `gtm/overhaul` canlıda (14 gün deneme her yerde, kayıt formu doğrudan açılıyor, Pro satın alınabiliyor, kurucu üye sayacı çalışıyor, LCP düzeltmesi yayında).
- [ ] **GA4 + Meta piksel/Conversions API + TikTok piksel** canlıda (dalda GTM yükleyici ve olay şeması hazır, `d03421a`; `NEXT_PUBLIC_GTM_ID` ayarlanmalı ve etiketler GTM'de kurulmalı); `sign_up` (kayıt) ve `begin_checkout` olayları Meta Olay Yöneticisi'nde test edildi (site-audit P0-3).
- [ ] **Çerez onayı** banner'ı canlıda: Kabul / Yalnızca gerekli / Kategori bazında; onay olmadan piksel yüklenmiyor; Çerez Politikası sayfası var (dalda hazır, `d03421a`; P0-4, legal-notes.md §6).
- [ ] İlk temas UTM'i (tarayıcıda kaydediliyor, `d03421a`) kayıt anında kullanıcı kaydına da yazılıyor, böylece "deneme→ücretli" kanal bazında okunabiliyor (roadmap G2).
- [ ] Sahte/doğrulanamayan iddialar canlı sitede kaldırıldı: anonim 5★ yorumlar, maket "$18.4K / 4.9★", Hepsiburada/N11/WooCommerce, "7/24 telefon desteği", "video rehberler" (P0-5; dalda site yeniden yazıldı, `d03421a`, `npm run gtm:check-claims` temiz olmalı).
- [ ] KVKK aydınlatma metni, gizlilik politikası, mesafeli satış/ön bilgilendirme, şirket kimlik bloğu canlıda (P0-12; metinler dalda `content/tr/legal/`, şirket bilgileri company.md'de kurucu teyidi bekliyor).
- [ ] Geçerli OG görseli ve favicon canlıda (P0-6, P0-7; dalda hazır, `83f8e43`).
- [ ] Reklamın gideceği açılış sayfası canlı ve mobilde 3 saniyenin altında açılıyor.
- [ ] Meta Business hesabı doğrulanmış, ödeme yöntemi kurucunun kartı, reklam hesabı para birimi TRY, saat dilimi İstanbul.

## 2. Bütçe / Budget (ilk ay önerisi: ₺24.000)

Brif aralığı ₺15–30 bin. Öneri **₺24.000**, çünkü 8 konsepti 4 kitlede anlamlı okumak için konsept başına en az ~₺900 (aşağıdaki "hedef deneme maliyeti"nin 2 katı) harcamak gerekiyor; ₺15 bin ile ancak 4–5 konsept test edilebilir. Kurucu ₺15 bin derse: konsept 1, 2, 4, 6 ve 8 ile başla.

| Kalem | Tutar | Pay | Neden |
|---|---|---|---|
| Meta (Instagram + Facebook), test fazı (Gün 1–10) | ₺8.000 | %33 | En büyük Türk KOBİ/satıcı kitlesi; Reels + carousel; ilgi alanı hedeflemesi en zengin |
| Meta, ölçek fazı (Gün 11–30) | ₺10.000 | %42 | Yalnızca kazanan konseptlere |
| TikTok, test | ₺3.500 | %15 | 2 konsept (C2, C6), genç Etsy/POD meraklıları; dönüşüm beklentisi düşük, yaratıcı öğrenme. TikTok Ads Manager'daki asgari günlük reklam grubu bütçesi bu tutarı aşarsa payı Meta'ya aktar |
| Organik "boost" / içerik üreticisi Spark Ads rezervi | ₺2.500 | %10 | Organikte en iyi giden 2 paylaşımı öne çıkarmak veya iş birliği yapılan üreticinin videosunu (izinle) reklam olarak kullanmak |
| **Toplam** | **₺24.000** | | Günlük ortalama ≈ ₺800 |

X, LinkedIn ve YouTube reklamı ilk ay yok: X'te kitle küçük, LinkedIn TBM'si bu bütçe için yüksek, YouTube için önce eğitim videoları birikmeli. 2. ayda en iyi YouTube eğitim videosu "in-feed" reklamla denenebilir.

## 3. Birim ekonomi ve karar eşikleri / Unit economics & decision thresholds

Rakamlar **varsayımdır**; ilk haftanın gerçek verisiyle kurucuyla birlikte güncelle. Formülü değiştirme, varsayımı değiştir.

| Varsayım | Değer | Kaynak / not |
|---|---|---|
| Ücretliye geçen kullanıcının ilk planı | Starter, kurucu üye fiyatıyla ₺2.499 × 0,60 ≈ ₺1.499/ay | Fiyatlar brif; KDV durumu teyit edilmeli |
| Kabul edilebilir geri ödeme süresi | 3 ay | Kurucu kararı |
| → Ücretli müşteri başına azami edinme maliyeti (CAC) | 3 × ₺1.499 ≈ **₺4.500** | |
| Deneme → ücretli oranı | %10 | Varsayım; Ay 2'de gerçek kohortla değiştir |
| → **Hedef deneme (kayıt) maliyeti** | ₺4.500 × 0,10 = **₺450** | Ana karar metriği |
| Açılış sayfası → kayıt oranı | %6 | Varsayım |
| → Azami açılış sayfası ziyareti maliyeti | ₺450 × 0,06 = **₺27** | |
| Tıklama → sayfa görüntüleme oranı | %80 | Mobilde LCP düzeldiyse |
| → Azami bağlantı tıklaması maliyeti (CPC) | ₺27 × 0,80 ≈ **₺22** | |

**Kapat (kill) kuralları** — reklam (ad) düzeyinde:
1. Harcama ≥ ₺900 (hedef deneme maliyetinin 2 katı) ve **0 kayıt** → kapat.
2. 3.000 gösterimden sonra **bağlantı TO (link CTR) < %0,7** → kapat (hook çalışmıyor).
3. Video: **3 sn izlenme / gösterim < %20** → ilk 2 saniyeyi değiştirip yeni varyasyon aç, eskisini kapat.
4. **TBM (CPM)** reklam setinin ilk 3 günlük ortalamasının 1,5 katını geçerse ve TO düşüyorsa → yaratıcı yorgunluğu; yeni varyasyon.
5. **CPC > ₺22** üç gün üst üste → kapat veya kitleyi değiştir.

**Ölçekle (scale) kuralları:**
1. Deneme maliyeti ≤ ₺450, en az 5 kayıtla, 3 gün üst üste → reklam setinin bütçesini **2–3 günde bir %20** artır (tek seferde ikiye katlama yok).
2. Kazanan reklamı geniş kitleye (Advantage+ kitle) kopyala.
3. Kazanan konseptin 2 yeni varyasyonunu üret (aynı acı, farklı hook/ekran).

**Açılış sayfası alarmı:** Bir sayfada ≥ 150 sayfa görüntüleme ve **kayıt oranı < %4** → sorun reklamda değil sayfada; kurucuya bildir (sayfa hızı, mesaj uyumu, kayıt formu).

**Deneme → ücretli:** Kayıt + 14 gün + 3 gün ek süre sonra okunur. İlk ay ölçek kararı deneme maliyetiyle verilir; Ay 2 başında kanal/konsept bazında deneme→ücretli oranıyla doğrulanır. Oran %5'in altındaysa hedef deneme maliyeti yarıya iner.

**Nereden okunur:** Meta Ads Manager (TBM, TO, CPC, 3 sn izlenme, sonuç başına maliyet), TikTok Ads Manager, GA4 (UTM bazında oturum ve `sign_up`), kurucunun haftalık Stripe raporu (ücretliye geçiş, kurucu kuponu kullanımı).

## 4. Test yapısı / Test structure

**Kampanya A · "Test" (Gün 1–10)**, hedef: *Potansiyel müşteri / Satış → "CompleteRegistration"* olayı (piksel kayıt olayını gönderiyorsa). Kayıt sayısı Meta'nın öğrenme eşiğinin (haftada ~50 sonuç) altında kalacağı için "öğrenme sınırlı" uyarısı normaldir. Piksel henüz veri biriktirmediyse ilk 3 gün *Açılış sayfası görüntüleme* ile optimize et, sonra kayda geç.

Reklam seti başına bütçe (ABO, eşit): ₺200/gün × 4 set ≈ ₺800/gün.

| Reklam seti | Kitle | Konseptler |
|---|---|---|
| A1 · Etsy / el yapımı | Türkiye, 22–55, Türkçe. İlgi alanı fikirleri: Etsy, el sanatları (handicraft), takı yapımı, seramik, el yapımı ürünler, print on demand, Pinterest. Ads Manager'da mevcut olanları seç | C1, C2, C3, C8 |
| A2 · E-ihracat / KOBİ | Türkiye, 25–55. İlgi alanı fikirleri: ihracat, uluslararası ticaret, e-ticaret, küçük işletme, girişimcilik; davranış: "küçük işletme sahipleri", "Facebook sayfa yöneticileri" | C4, C5 *(kapılı)* |
| A3 · Pazaryeri satıcıları | Türkiye, 22–50. İlgi alanı fikirleri: Trendyol, eBay, Amazon (şirket), Shopify, dropshipping, e-ticaret | C6, C7 |
| A4 · Geniş | Türkiye, 22–55, Türkçe, ilgi alanı yok (Advantage+ kitle) | Gün 4'te A1–A3'ün en iyi 2 reklamı |

- **Yerleşim:** Advantage+ yerleşim, **Audience Network hariç** (düşük kalite tıklama).
- **Hariç tut:** Mevcut kullanıcılar (piksel "kayıt olanlar" özel kitlesi, 180 gün) — piksel verisi oluşunca.
- **Varyasyon:** Her konsept için 2 varyasyon: V1 = video (Reels 9:16), V2 = carousel veya statik (1:1 + 4:5).
- **Adlandırma:** `ads_launch_2026q4 | A1 | C1-V1 | reels` ; reklam URL'sinde `utm_content=ad-c1-v1`.

**Kampanya B · "Ölçek" (Gün 11–30):** Kazanan 2–3 reklam, CBO, ₺500/gün başlangıç, kurallar §3.

**Kampanya C · "Yeniden hedefleme" (Gün 15+, piksel ve çerez onayı varsa):** Son 30 günde siteyi ziyaret edip kayıt olmayanlar. Yaratıcı: C8 (kurucu üye + SSS carousel'i, takvim Gün 28). Bütçe ₺100/gün, ölçek bütçesinden.

**Benzer kitleler (lookalike) — sonra:** Piksel "kayıt" özel kitlesi **en az 100 kişiye** ulaşınca (Meta'nın kaynak kitle alt sınırı), Türkiye %1 benzer kitle. Müşteri listesi (e-posta) yükleme yapılmaz: KVKK yurt dışı aktarım ve açık rıza gerektirir (legal-notes.md §6); piksel tabanlı kitle kullan.

**TikTok:** Tek kampanya, tek reklam grubu (Türkiye, 18–40, otomatik hedefleme), C2 ve C6 dikey videoları, optimizasyon "Complete Registration" (piksel varsa) yoksa "Landing page view". Aynı kapat/ölçekle kuralları.

## 5. Sekiz reklam konsepti / Eight ad concepts

Kurallar (her konsept için geçerli):
- Ses: kendi cümlelerimiz **"siz"** (docs/brand.md §7); satıcı alıntıları kendi sözleriyle aynen.
- Alıntılar **aynen** kullanılır, kaynağıyla. Görselin altında küçük yazı: *"Bir satıcının herkese açık paylaşımından. Bu kişi KolayXport kullanıcısı değildir."* Alıntı, KolayXport'u öven bir tanıklık gibi sunulmaz. Alıntı kartı kâğıt zeminde (`#FAF7F0`), yaşam tarzı fotoğrafının üstüne **konmaz** (brand.md §6).
- Marka/rakip adı geçen alıntılar kullanılmaz (aşağıdakilerin hiçbiri rakip adı içermez).
- Etsy/eBay/Amazon/Trendyol **logosu ve renkleri yok**; isimler düz metin.
- Gelir, satış artışı, "zarar ediyor musunuz?" gibi kişisel/finansal durum ima eden soru **yok** (Meta "kişisel özellikler" politikası, legal-notes.md §4).
- Her reklamın sonunda: "14 gün ücretsiz, kredi kartı gerekmez."
- Görüntüler demo hesaptan (`public/marketing/screens/*` veya aynı hesapla video); ekranda "Demo veri" yazısı.

### C1 · "134 ürün, 4 satış" → İlan Doktoru

- **Acı (aynen):** "4 aylık Etsy mağazam, 134 ürün, 4 satış — bu normal mi?" — Etsy Community, "Etsy Türk Satıcıları" forumu (~Eylül 2026) (pain-points.md A4).
- **Hook (ilk 2 sn):** Alıntı kâğıt zeminde, daktilo efektiyle.
- **Ana metin:**
```
"4 aylık Etsy mağazam, 134 ürün, 4 satış — bu normal mi?"

Bu soruyu bir Türk satıcı Etsy forumunda sordu. Çoğu zaman sorun ürün sayısında değil, ilanın kendisinde: başlık, etiketler, fotoğraf.

KolayXport İlan Doktoru ilanınıza SEO notu verir, benzer ilanlarla karşılaştırır, eksikleri gösterir. Düzeltmeyi yapay zekâyla taslağa alırsınız; siz "Gönder" demeden Etsy'de hiçbir şey değişmez.

14 gün ücretsiz, kredi kartı gerekmez.
```
- **Başlık:** `İlanınızdaki eksiği görün`
- **CTA:** Kaydol
- **Açılış:** `/cozumler/etsy-satici?utm_source=instagram&utm_medium=paid&utm_campaign=launch_2026q4_etsy_seo&utm_content=ad-c1-v1` (Meta'da `utm_source={{site_source_name}}` dinamik parametresi kullanılabilir)
- **Kitle:** A1
- **Format:** V1 Reels 20 sn; V2 carousel (alıntı → İlan Doktoru skoru → eksik etiketler → AI önerisi → "taslakta" rozeti → CTA).
- **Yaratıcı brif:** Takvim Gün 2 videosunun 20 sn reklam kesiti. Skor ekranı yakın plan; satış rakamı yok.

### C2 · "SEO ve profesyonel çekim" → AI başlık/etiket + AI görsel

- **Acı (aynen):** "etsy'nin doğru kullanımı seo ve ürünlerin profesyonel çekimidir." — Ekşi Sözlük, "etsy" başlığı, 05.12.2025 (A4).
- **Hook:** Bölünmüş ekran: solda sade ürün fotoğrafı + kısa Türkçe başlık; sağda AI görseli + İngilizce başlık. Üstte alıntı.
- **Ana metin:**
```
"etsy'nin doğru kullanımı seo ve ürünlerin profesyonel çekimidir."

İkisini de tek panelde hızlandırın:
• Yapay zekâ ile İngilizce başlık, açıklama ve 13 etiket önerisi
• Ürününüzü sahnede gösteren AI görseli, Etsy için alt metniyle

Önerileri siz düzenlersiniz; onaylamadan hiçbir şey Etsy'ye gitmez.

14 gün ücretsiz, kredi kartı gerekmez.
```
- **Başlık:** `Etsy ilanınız İngilizce ve görselli`
- **CTA:** Kaydol
- **Açılış:** `/cozumler/ai-ilan-optimizasyonu?utm_source=instagram&utm_medium=paid&utm_campaign=launch_2026q4_ai_photo&utm_content=ad-c2-v1`
- **Kitle:** A1; TikTok testi.
- **Format:** V1 Reels/TikTok 15 sn; V2 statik önce/sonra 4:5.
- **Yaratıcı brif:** Demo "İznik kâse" fotoğrafı ve uygulamanın gerçek AI çıktısı. AI görselinde ürün değişmemiş olmalı; köşede "AI ile üretilmiştir". Önce/sonra yalnızca ilan görünümünü karşılaştırır, satış/gelir sonucu ima etmez.

### C3 · "Reklam yapıyorum ama tıklamalar satışa dönüşmüyor" → önce ilanı güçlendirin

- **Acı (aynen):** "37 ürünüm aktif, reklam yapıyorum ama tıklamalar satışa dönüşmüyor." — Etsy Community TR, "19 Gündür Satış Yok" başlığı (A4).
- **Hook:** Ekranda alıntı, altında "Reklama para vermeden önce ilanınıza bakın."
- **Ana metin:**
```
"37 ürünüm aktif, reklam yapıyorum ama tıklamalar satışa dönüşmüyor."

Reklam ilanınıza ziyaretçi getirir; ilan zayıfsa ziyaretçi satın almadan çıkar.

Reklamı artırmadan önce KolayXport'ta:
• İlan Doktoru ile başlık, etiket ve fotoğraf eksiklerini görün
• Anahtar Kelime Gezgini ile alıcının gerçekten aradığı İngilizce ifadeleri bulun
• Değişiklikleri taslakta toplayın, kontrol edin, sonra gönderin

14 gün ücretsiz, kredi kartı gerekmez.
```
- **Başlık:** `Reklamdan önce ilanınızı güçlendirin`
- **CTA:** Daha Fazla Bilgi Al
- **Açılış:** `/cozumler/etsy-satici?utm_source=instagram&utm_medium=paid&utm_campaign=launch_2026q4_etsy_seo&utm_content=ad-c3-v1`
- **Kitle:** A1
- **Format:** V1 carousel 5 kart; V2 Reels 20 sn.
- **Yaratıcı brif:** `research` + İlan Doktoru ekranları. "Reklam bütçenizi kurtarın" gibi finansal sonuç vaadi yok.

### C4 · "4 dolara sattım, 99 lira kaldı" → net kâr raporu (Pro)

- **Acı (aynen):** "bir takvim yaptım, 4 dolara sattım. yaklaşık 200 tl gibi bir ücret almış etsy alıcıdan." … "bana 99 lira kalmış." — Ekşi Sözlük, "etsy üzerinden satış yapmak", 15.03.2026 (A9).
- **Hook:** Kâğıt zeminde büyük: "4 dolar → 99 lira?" + alıntı.
- **Ana metin:**
```
"bir takvim yaptım, 4 dolara sattım … bana 99 lira kalmış."

Etsy, eBay, Amazon ve Trendyol'da komisyon, kargo, iade, reklam ve ürün maliyetinden sonra elinizde ne kaldığını sipariş bazında görün. Dolar ve TL olarak.

KolayXport kâr raporu Pro planda; 14 günlük ücretsiz denemede açık, kredi kartı gerekmez.
```
- **Başlık:** `Cirodan değil, net kârdan bakın`
- **CTA:** Kaydol
- **Açılış:** `/fiyatlandirma?utm_source=instagram&utm_medium=paid&utm_campaign=launch_2026q4_finance&utm_content=ad-c4-v1` (blog `/blog/etsy-kar-hesaplama` yayındaysa B testi)
- **Kitle:** A2
- **Format:** V1 Reels 20 sn; V2 statik 1:1.
- **Yaratıcı brif:** `profit` ekranı (demo veri), pazaryeri kırılımı. "Zarar ediyor musunuz?" gibi soru **yok**. Shopify/Wix finansı yok; bahsetmeyin.

### C5 · "kafam karıştı" → ETGB dosyası *(kapılı)*

- **Kapı:** Yalnızca ETGB düzeltmesi canlıdaysa **ve** kurucu onaylarsa. Değilse C5 yerine C7'nin ikinci varyasyonu.
- **Acı (aynen):** "şimdi ben bir de buna fatura keseceğim, muhasebeci 4 dolar + kdv üzerinden keseceksin diyor, ama bana 99 lira gelecek. kdv'si de 35 lira yapıyor. kafam karıştı." — Ekşi Sözlük, 15.03.2026 (A10).
- **Hook:** "kafam karıştı" + üst üste binen evrak ikonları → tek Excel dosyası (lucide ikonları, brand.md §6).
- **Ana metin:**
```
Mikro ihracatta evrak kafa karıştırıyor. Vergi sorusunu müşaviriniz cevaplar; dosyayı hazırlamak bize kalsın.

KolayXport'ta yurt dışı siparişlerinizi seçin: firma bilgileriniz, GTİP kodları ve sipariş bilgileriyle ETGB Excel dosyası hazırlanır, müşavirinize e-postayla gider. Etiketi kendi FedEx/UPS hesabınızla basarsınız, ticari fatura elektronik gider.

KolayXport gümrük beyanı yapmaz; beyanı müşaviriniz yapar.

14 gün ücretsiz, kredi kartı gerekmez.
```
- **Başlık:** `Etiket, ticari fatura, ETGB dosyası`
- **CTA:** Daha Fazla Bilgi Al
- **Açılış:** `/cozumler/mikro-ihracat-kargo-etgb?utm_source=instagram&utm_medium=paid&utm_campaign=launch_2026q4_export_ops&utm_content=ad-c5-v1`
- **Kitle:** A2
- **Format:** V1 carousel; V2 Reels 25 sn.
- **Yaratıcı brif:** Takvim Gün 25 görselleri. "Otomatik beyan", "e-Fatura otomatik" **yok**.

### C6 · "20'de 1 fiyatına üretiyoruz" → Trendyol'dan dünyaya

- **Acı (aynen):** "tamamen kendimize özgü ürünlerimiz var. bu sitede satılan fiyatın 20'de 1 fiyatına üretiyoruz." — Ekşi Sözlük, "etsy üzerinden satış yapmak", 27.05.2026 (A5).
- **Hook:** "Türkiye'de ürettiğiniz ürün yurt dışında başka fiyattan satılıyor olabilir."
- **Ana metin:**
```
"tamamen kendimize özgü ürünlerimiz var. bu sitede satılan fiyatın 20'de 1 fiyatına üretiyoruz."

Trendyol'da sattığınız ürünün yurt dışında da alıcısı olabilir. KolayXport'ta:
• Trendyol ile eBay arasındaki fiyat farkına veriyle bakın (fark net kâr değildir; kargo, komisyon ve gümrük ayrıca hesaplanır)
• Ürünlerinizi yapay zekâyla İngilizce Etsy/eBay ilanına çevirin
• Stoğu Trendyol, Etsy, eBay ve Shopify arasında tek yerden eşitleyin (beta)

Hepsiburada/N11 henüz yok; yurt içi entegratörünüzün yanına eklenir.

14 gün ücretsiz, kredi kartı gerekmez.
```
- **Başlık:** `Trendyol'dan dünyaya`
- **CTA:** Kaydol
- **Açılış:** `/cozumler/trendyoldan-dunyaya?utm_source=instagram&utm_medium=paid&utm_campaign=launch_2026q4_trendyol_dunya&utm_content=ad-c6-v1`
- **Kitle:** A3; TikTok testi.
- **Format:** V1 Reels/TikTok 25 sn; V2 carousel 5 kart.
- **Yaratıcı brif:** `arbitrage` ("örnek tarama" etiketi), eBay ilan stüdyosu AI, `stock-sync`. "%95 ROI" gibi kâr yüzdesine yakın plan **yok**.

### C7 · "435 ürünü tek tek" → toplu düzenleme + taslak güvenliği

- **Acı (aynen):** "Tüm sorunun çözümünü bizim 435 ürünü tek tek inceleyip fiyatları manuel olarak düzeltmemize bırakmış durumdalar." — Şikayetvar, 17 Haziran 2026 (B1). **Şikâyetin konusu olan firmanın adı reklamda geçmez.**
- **Hook:** Ekranda sayaç "1/435 … 2/435 …" hızla akıyor, sonra tek tablo.
- **Ana metin:**
```
"…435 ürünü tek tek inceleyip fiyatları manuel olarak düzeltmemize bırakmış durumdalar."

Toplu fiyat değişikliği hızlı olmalı, ama geri dönüşü de olmalı.

KolayXport'ta Etsy, eBay ve Trendyol ilanlarınızı tablo gibi toplu düzenleyin. Değişiklikler önce taslakta kalır; kontrol eder, sonra gönderirsiniz. İlan pazaryerinde sonradan değiştirildiyse gönderim durur ve sizi uyarır. Etsy'de önceki sürüme dönebilirsiniz.

14 gün ücretsiz, kredi kartı gerekmez.
```
- **Başlık:** `Toplu düzenleyin, göndermeden kontrol edin`
- **CTA:** Kaydol
- **Açılış:** `/cozumler/ai-ilan-optimizasyonu?utm_source=instagram&utm_medium=paid&utm_campaign=launch_2026q4_bulk_edit&utm_content=ad-c7-v1`
- **Kitle:** A3
- **Format:** V1 Reels 20 sn; V2 statik 1:1 (tablo ekranı + "Taslakta 435 değişiklik" rozeti, demo).
- **Yaratıcı brif:** `bulk-editor` ve Trendyol toplu (`/app/trendyol-urunler/bulk`) demo. eBay toplu yalnızca başlık/fiyat/adet: fazlasını göstermeyin.

### C8 · "Danışmana değil, araca" → kendiniz yapın + kurucu üye

- **Acı (aynen):** "Toplamda yaklaşık 70.000 TL'ye ulaşan bu ödemeler karşılığında 8 ay sürecek bir çalışma vaadinde bulundu." — Şikayetvar, 15 Eylül 2026, sahte Etsy danışmanlığı şikâyeti (A11).
- **Hook:** "Etsy danışmanına para göndermeden önce…"
- **Ana metin:**
```
"Toplamda yaklaşık 70.000 TL'ye ulaşan bu ödemeler karşılığında 8 ay sürecek bir çalışma vaadinde bulundu."

Etsy ilanınızı geliştirmek için kimseye şifrenizi vermeniz gerekmiyor. KolayXport'ta İlan Doktoru, yapay zekâ ile İngilizce başlık/etiket ve anahtar kelime araştırması sizin elinizde.

14 gün ücretsiz, kredi kartı gerekmez. İlk 20 ücretli aboneye ömür boyu %40 indirim; koşullar fiyatlandırma sayfasında.
```
- **Başlık:** `Şifrenizi değil, aracı kullanın`
- **CTA:** Kaydol
- **Açılış:** `/fiyatlandirma?utm_source=instagram&utm_medium=paid&utm_campaign=launch_2026q4_founding&utm_content=ad-c8-v1`
- **Kitle:** A1 + yeniden hedefleme (Kampanya C).
- **Format:** V1 Reels 15 sn (yüz + yazı); V2 statik 1:1.
- **Yaratıcı brif:** Kurucu kameraya; kişi/firma adı **yok**; "dolandırıcı" kelimesi bir kişiye yöneltilmez. Kurucu üye cümlesinde kalan yer sayısı **yok**.

## 6. FOMO ve aciliyet kuralları / FOMO rules

Yalnızca **gerçek** iki kıtlık kullanılabilir:
1. **Kurucu üye kontenjanı:** "İlk 20 ücretli aboneye ömür boyu %40 indirim." Kalan sayı reklamda veya paylaşımda **yazılmaz**; sayfadaki canlı sayaca link verilir. Kontenjan dolunca (sayaç 0 / ödeme sayfası `founding_full` döndürüyor) aynı gün bütün reklam ve paylaşımlardan bu cümle çıkarılır.
2. **Gerçek lansman tarihleri:** Lansman günü, canlı yayın tarihi gibi gerçekleşecek olaylar.

**Yasak:** Sahte geri sayım, "son 3 yer", "bugün bitiyor" (bitmiyorsa), "fiyatlar yarın artıyor" (kurucu yazılı karar ve tarih vermediyse), "sınırlı süre" (süre yoksa), stok/kontenjan uydurma. Dayanak: legal-notes.md §3 ve Meta/TikTok yanıltıcı içerik politikaları.

## 7. Haftalık reklam raporu şablonu

| Konsept | Set | Harcama | Gösterim | TBM | Link TO | CPC | Sayfa görüntüleme | Kayıt | Deneme maliyeti | Karar |
|---|---|---|---|---|---|---|---|---|---|---|
| C1-V1 | A1 | | | | | | | | | devam / kapat / ölçekle |

Raporu her cuma kurucuya gönder; "Karar" sütunundaki değişiklikler kurucu onayıyla uygulanır.

# 30 günlük lansman takvimi / 30-day launch calendar

Tarih: 2026-10-17. **Gün 1 bir Pazartesidir** ve kurucunun "ön koşullar canlıda" onayını verdiği haftaya denk gelir (§0). Tarihleri onay geldiğinde Gün 1'den itibaren doldurun.

**Ses (docs/brand.md §7):** Kendi cümlelerimiz **"siz"** ile yazılır, sıcak ve somut. Satıcı alıntıları kendi sözleriyle (gerekirse "sen") aynen kalır. "En iyi", "tek", "#1", "garantili satış", "çözüm", "inovatif", "devrim" yok; "tek tık" yalnızca gerçekten tek tıksa. "Türkiye" yazılır. Ürün adı her zaman **KolayXport**.

## 0. Başlamadan önce (Gün 1'in ön koşulları)

Takvim, aşağıdakiler **canlı sitede** doğrulanmadan başlamaz. Biri eksikse kurucuya yazın, Gün 1'i erteleyin.

- [ ] `gtm/overhaul` canlıda: sitede her yerde "14 gün ücretsiz" (30 gün yazan yer kalmadı), "Ücretsiz deneyin" butonu kayıt formunu açıyor.
- [ ] /fiyatlandirma'da kurucu üye satırı ve canlı sayaç görünüyor.
- [ ] Şu linkler açılıyor: `/cozumler/etsy-satici`, `/cozumler/ebay-satici`, `/cozumler/trendyoldan-dunyaya`, `/cozumler/mikro-ihracat-kargo-etgb`, `/cozumler/ai-ilan-optimizasyonu`, `/cozumler/urun-arastirma-arbitraj` (içerikleri `content/tr/cases/` altında taslak). Açılmayan sayfa için aynı UTM ile `/fiyatlandirma` kullanın.
- [ ] Sosyal hesaplar açık, profil görselleri ve kapaklar `public/brand/social/` dosyalarından (avatar, Facebook kapağı, LinkedIn/X/YouTube bannerları). Bio: "Yurt dışına satışın tek paneli · Etsy · eBay · Trendyol'dan dünyaya · 14 gün ücretsiz, kart gerekmez". YouTube kanal adresini kurucuya bildirin (site footer'ındaki kırık YouTube linki düzeltilecek).
- [ ] Ekran görüntüleri `scripts/gtm/capture-screens.ts` ile demo hesaptan alındı (`public/marketing/screens/<id>.webp`: `orders`, `labels`, `etsy-listings`, `listing-editor`, `bulk-editor`, `research`, `arbitrage`, `profit`, `inbox`, `stock-sync`, mobil sürümler). Video kayıtları da aynı demo hesapla (kurgusal ürünler: İznik kâse, telkari kolye, peştamal, deri cüzdan, bakır cezve, mozaik lamba). Gerçek müşteri verisi görünmez.
- [ ] Kurucu bu dosyayı bir kez okudu ve "Onay: gerekli" yazanlar dışındakileri toplu onayladı.

## 1. Nasıl okunur / How to read a day

- **ID:** `d02` gibi. `utm_content` = ID + kanal kısaltması + format (ör. `d02-ig-reel`).
- **Link:** Instagram linki tam yazılıdır. Başka kanalda: `utm_source=instagram` → `facebook` / `x` / `tiktok` / `youtube` / `linkedin`; `utm_content` içindeki `ig` → `fb` / `x` / `tt` / `yt` / `li`.
- **Metin blokları** aynen kopyalanır. `[köşeli parantez]` alanları doldurulur.
- **Hashtag setleri** (A–E): channel-strategy.md §8.
- **Görsel kuralları (docs/brand.md):** Alıntı kartları kâğıt zemin `#FAF7F0`, mürekkep yazı `#0E1A2B`, başlık Fraunces, metin Instrument Sans, vurgu `#2B45E0`. Ekran görüntüleri 20 px köşeli, ince mürekkep çerçeveli, sahte tarayıcı çerçevesi yok. Yaşam tarzı (lifestyle) fotoğrafları **asla** bir alıntı veya müşteri adıyla aynı karede kullanılmaz. Pazaryeri/kargo logosu ve renkleri (Etsy turuncusu, Amazon sarısı, eBay dört rengi, Trendyol turuncusu) yok.
- **Tutorial videoları** `V01…V12` (channel-strategy.md §4).
- **Onay:** "gerekli" yazan paylaşım kurucu tekrar bakmadan çıkmaz.

## 2. 30 gün bir bakışta / Overview

| Gün | Hafta günü | ID | Sütun | Tema (`utm_campaign` soneki) | Ana kanal(lar) | Kapı / onay |
|---|---|---|---|---|---|---|
| 1 | Pzt | d01 | P6 Kurucu | `brand` | IG, FB, LI, X, TT | Gerekli (lansman, kurucu üye) |
| 2 | Sal | d02 | P1 Dert→ekran | `etsy_seo` | IG, FB, TT, YT Shorts | — |
| 3 | Çar | d03 | P4 İpucu + V01 | `etsy_seo` | YT, IG carousel, X | — |
| 4 | Per | d04 | P2 Önce/sonra | `etsy_seo` | IG carousel, FB, LI | — |
| 5 | Cum | d05 | P4 İpucu | `etsy_seo` | X flood, FB grupları | — |
| 6 | Cmt | d06 | P3 Ürün bulma | `research` | IG, TT, YT Shorts | — |
| 7 | Paz | d07 | Etkileşim | `brand` | IG/FB hikâye | — |
| 8 | Pzt | d08 | P1 + V02 | `etsy_seo` | YT, IG, TT | — |
| 9 | Sal | d09 | P2 + V04 | `ai_photo` | IG, TT, FB | — |
| 10 | Çar | d10 | P1 Kampanya açılışı | `trendyol_dunya` | IG carousel, FB, LI, X | — |
| 11 | Per | d11 | P3 + V06 | `arbitrage` | YT, IG, TT | — |
| 12 | Cum | d12 | P6 Kurucu | `brand` | LI, X flood | Gerekli (rakam/rakip) |
| 13 | Cmt | d13 | P4 İpucu | `trendyol_dunya` | TT, IG, YT Shorts | — |
| 14 | Paz | d14 | Kurucu üye | `founding` | IG/FB hikâye, X | — |
| 15 | Pzt | d15 | P1 + V03 | `bulk_edit` | YT, IG, TT, FB | — |
| 16 | Sal | d16 | P1 Çapraz ilan | `crosslist` | IG, TT, X | — |
| 17 | Çar | d17 | P3 + V05 | `research` | YT, IG carousel, LI | — |
| 18 | Per | d18 | P1 + V07 | `export_ops` | YT, IG, FB | — |
| 19 | Cum | d19 | P4 İpucu (ETGB) | `export_ops` | LI, X flood, FB grupları | Gerekli (vergi/gümrük) |
| 20 | Cmt | d20 | P4 İpucu (AB €3) | `export_ops` | TT, IG | Gerekli (vergi/gümrük) |
| 21 | Paz | d21 | Canlı yayın duyurusu | `brand` | IG/FB hikâye, X | — |
| 22 | Pzt | d22 | P1 + V10 | `finance` | YT, IG, TT, LI | — |
| 23 | Sal | d23 | P1 + V09 (Beta) | `stock_sync` | YT, IG, FB | Gerekli (beta) |
| 24 | Çar | d24 | Canlı demo | `brand` | IG Live + YT | Gerekli (canlı) |
| 25 | Per | d25 | P1 + V08 *(kapılı)* | `export_ops` | YT, IG, LI | Gerekli (ETGB canlı mı?) |
| 26 | Cum | d26 | P1 + V11 (Beta) | `inbox` | IG, TT, X | Gerekli (beta) |
| 27 | Cmt | d27 | P4 Uyarı | `etsy_seo` | TT, IG, FB | — |
| 28 | Paz | d28 | SSS / kurucu üye | `founding` | IG carousel, FB | — |
| 29 | Pzt | d29 | P1 + V12 *(kapılı)* | `extension` | YT, IG | Gerekli (Web Mağazası?) |
| 30 | Sal | d30 | P5 Güncelleme | `brand` | IG, LI, X, FB | Gerekli (changelog) |

Haftalık dağılım: Instagram 4 akış + günlük hikâye; TikTok 4; YouTube 2–3 eğitim + 4 Shorts; X 5; LinkedIn 2; Facebook sayfa 3 + gruplar her gün.

---

## Hafta 1: "Yurt dışına satışın tek paneli" + Etsy dertleri

### Gün 1 · Pazartesi · `d01` · P6 Kurucu hikâyesi · `brand` · Onay: **gerekli**

- **Kanallar / format:** Instagram Reel (45 sn, kurucu kameraya konuşuyor) · Facebook Reel · TikTok · LinkedIn (kurucu profili, metin + aynı video) · X (tek tweet + video).
- **Hook (ekranda ilk 2 sn):** "Yurt dışına satan satıcı için aradığım paneli bulamadım. Biz yaptık."
- **Instagram / Facebook metni:**
```
Merhaba, ben Atilla. KolayXport'u Adana'dan geliştiriyoruz.

Yurt dışına satan bir satıcının günü çoğu zaman şöyle geçiyor: Etsy'de bir ilan, eBay'de başka bir ilan, araştırma için İngilizce bir araç, kargo için ayrı bir panel, ETGB için Excel, kâr için bir hesap tablosu.

KolayXport bunları tek panelde topluyor:
• Etsy ve eBay ilanlarınızı tek ekrandan düzenleyin; başlık, açıklama ve etiketleri yapay zekâyla İngilizce yazın
• Ne satacağınızı veriyle bulun: anahtar kelime, ürün bulucu, Trendyol→eBay fiyat farkı
• Siparişlerinizi tek listede görün, kendi FedEx/UPS hesabınızla etiketinizi basın

Değişiklikleriniz önce taslakta kalır; siz "Gönder" demeden Etsy'ye hiçbir şey gitmez.

14 gün ücretsiz deneyin, kredi kartı gerekmez.
İlk 20 ücretli aboneye ömür boyu %40 indirim: koşullar fiyatlandırma sayfasında.

Link profilde.
```
- **TikTok açıklaması:** `Yurt dışına satan satıcı için tek panel. 14 gün ücretsiz, kart gerekmez. #KolayXport #etsytürkiye #eihracat #etsysatıcısı #yapayzeka`
- **LinkedIn (kurucu profili):**
```
Bugün KolayXport'u herkese açıyoruz.

Türkiye'den Etsy, eBay ve Amazon'a satan küçük işletmeler genelde dört beş ayrı araçla çalışıyor: ilan düzenleme, İngilizce SEO araştırması, kargo, ETGB dosyası ve kâr hesabı ayrı ayrı yerlerde.

KolayXport'ta bunları tek panelde topladık:
1. Etsy ve eBay ilanları için yapay zekâ destekli İngilizce başlık, açıklama ve etiket; tekli ve toplu düzenleme.
2. Etsy, eBay ve Trendyol verisiyle ürün ve anahtar kelime araştırması; Trendyol→eBay fiyat farkı taraması.
3. Sipariş listesi, kendi FedEx/UPS hesabıyla yurt dışı etiket ve elektronik ticari fatura.

Ne yapmadığımızı da açıkça söyleyelim: Hepsiburada ve N11 henüz yok; yurt içinde yalnızca DHL eCommerce (MNG) etiketi basıyoruz. Önce yurt dışı satışı iyi yapmaya odaklandık.

Mali müşavir, gümrük müşaviri veya e-ihracat danışmanıysanız ve müşterileriniz için konuşmak isterseniz mesaj atın.

14 gün ücretsiz deneme, kredi kartı gerekmez: [LinkedIn linki]
```
- **X:** `KolayXport bugün açık. Etsy ve eBay ilanlarınız, araştırmanız, siparişleriniz ve yurt dışı etiketiniz tek panelde. Değişiklikler siz "Gönder" demeden pazaryerine gitmez. 14 gün ücretsiz, kart gerekmez. [X linki]`
- **Hashtag:** E + A + B: `#KolayXport #etsytürkiye #eihracat #mikroihracat #etsysatıcısı #kadıngirişimci`
- **Görsel brief:** Kurucu, ışık alan bir masada; arkada paketlenmiş kargo kutuları (adres etiketi görünmüyor). 0–8 sn yüz; 8–35 sn ekran kaydı hızlı geçiş: `orders` → `listing-editor` → AI butonu → `research` → `labels` (demo hesap); 35–45 sn yüz + "14 gün ücretsiz · kart gerekmez" kartı (kâğıt zemin, Fraunces). Altyazı her zaman açık.
- **Link (IG profil):** `https://kolayxport.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_brand&utm_content=d01-ig-reel`
- **Onay notu:** Lansman günü ve "ömür boyu %40" koşulları kurucu onayıyla; koşullar /fiyatlandirma'da yazılı olmalı.

### Gün 2 · Salı · `d02` · P1 Dert→ekran · `etsy_seo`

- **Kanallar / format:** IG Reel (30 sn) · FB Reel · TikTok · YouTube Shorts.
- **Hook:** Kâğıt zeminde büyük yazı: **"4 aylık Etsy mağazam, 134 ürün, 4 satış — bu normal mi?"** Alt satır: "Etsy forumunda bir Türk satıcının sorusu".
- **Instagram / Facebook metni:**
```
"4 aylık Etsy mağazam, 134 ürün, 4 satış — bu normal mi?"

Bu soruyu Etsy forumunda bir Türk satıcı sordu. Cevap çoğu zaman ürünlerde değil, ilanın kendisinde: başlık, etiketler, fotoğraflar.

KolayXport İlan Doktoru ilanınıza bir SEO notu verir, benzer ilanlarla karşılaştırır ve eksikleri gösterir. Düzeltmeyi yapay zekâyla taslağa alırsınız; siz "Gönder" demeden Etsy'de hiçbir şey değişmez.

Satış garantisi vermiyoruz. Ama neyin eksik olduğunu görmeden 135. ürünü eklemek de işe yaramayabilir.

14 gün ücretsiz deneyin, kart gerekmez. Link profilde.
```
- **TikTok / Shorts:** `134 ürün, 4 satış. Önce ilanınıza bakın. #etsy #etsyseo #etsytürkiye #KolayXport`
- **Hashtag:** `#KolayXport #etsy #etsyseo #etsytürkiye #etsysatıcısı #elyapımı #yapayzeka`
- **Görsel brief:** 0–3 sn alıntı kartı. 3–25 sn: Araştırma › İlanlar (İlan Doktoru), demo peştamal ilanının skoru, eksik etiket uyarıları, "AI ile başlık öner", taslağa ekle, "1 değişiklik taslakta" rozeti. 25–30 sn kapanış kartı. Seslendirme kurucu.
- **Link:** `https://kolayxport.com/cozumler/etsy-satici?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_etsy_seo&utm_content=d02-ig-reel`

### Gün 3 · Çarşamba · `d03` · P4 İpucu + V01 · `etsy_seo`

- **Kanallar / format:** YouTube **V01 "Etsy mağazanızı KolayXport'a bağlayın (3 dk)"** · IG carousel (7 kart) · X.
- **YouTube başlığı:** `Etsy mağazası nasıl bağlanır? Siparişler, ilanlar ve araştırma tek panelde | KolayXport`
- **YouTube açıklaması:**
```
Bu videoda Etsy mağazanızı KolayXport'a nasıl bağlayacağınızı gösteriyoruz:
00:00 Ne göreceksiniz
00:20 Ayarlar › Bağlantılar › Etsy
01:10 Birden fazla Etsy mağazası
01:45 İlanların ve siparişlerin gelmesi
02:30 Sonraki adım: İlan Doktoru

14 gün ücretsiz deneme, kredi kartı gerekmez: [YouTube linki]

The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy.
```
- **IG carousel kartları:**
  1. "Etsy'de satış yoksa önce bu 5 şeye bakın"
  2. "1 · Başlık: ilk 40 karakter alıcının aradığı kelimeyle mi başlıyor?"
  3. "2 · Etiketler: 13 etiketin hepsi dolu mu? Her biri en fazla 20 karakter."
  4. "3 · Başlıktaki kelimeyi etikette aynen tekrar etmek bir hakkı boşa harcar."
  5. "4 · İlk fotoğraf: küçük ekranda ürün net seçiliyor mu?"
  6. "5 · Kategori ve özellikler (renk, malzeme) dolu mu?"
  7. "KolayXport'ta İlan Doktoru bu kontrolleri sizin için yapar. 14 gün ücretsiz, kart gerekmez."
- **IG açıklaması:**
```
Etsy'de satış gelmiyorsa yeni ürün eklemeden önce ilanlarınıza bu 5 gözle bakın. Kaydedin, bir sonraki ilanınızda kullanın.

Daha uzun liste profildeki linkte: "Etsy'de satış yok: 10 kontrol".
```
- **X:** `Etsy'de satış yoksa yeni ürün eklemeden önce 5 kontrol: başlığın ilk 40 karakteri, 13 etiketin tamamı, başlık-etiket tekrarı, ilk fotoğraf, kategori özellikleri. Uzun liste: [X linki]`
- **Hashtag:** `#KolayXport #etsy #etsyseo #etsytürkiye #etsysatıcısı #elyapımı`
- **Görsel brief:** V01 ekran kaydı, demo hesap. Etsy'nin kendi izin (OAuth) sayfası görünürse Etsy logosunu **bulanıklaştırın**. Carousel: kâğıt zemin, büyük Fraunces numaralar, vurgu rengi tek.
- **Link (IG):** `https://kolayxport.com/blog/etsy-satis-yok-10-kontrol?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_etsy_seo&utm_content=d03-ig-carousel` (yayında değilse `/cozumler/etsy-satici`)

### Gün 4 · Perşembe · `d04` · P2 Önce/sonra · `etsy_seo`

- **Kanallar / format:** IG carousel (6 kart) · FB · LinkedIn (kurucu, tek görsel).
- **Kartlar:**
  1. Kapak: "Aynı peştamal, iki başlık" (alt not: "Demo ilan, gerçek mağaza değildir.")
  2. **Önce:** demo ilanın kısa başlığı ve 6 etiketi (`listing-editor` ekranından)
  3. **Sonra:** uygulamanın ürettiği başlık (Title Case, virgülle ayrılmış, 100–140 karakter) ve 13 etiket
  4. İlan Doktoru notu: önce / sonra (uygulamanın gösterdiği gerçek skor)
  5. "Yapay zekâ önerir, siz düzenlersiniz. Siz 'Gönder' demeden Etsy'ye gitmez."
  6. "14 gün ücretsiz · kart gerekmez · kolayxport.com"
- **Metin:**
```
Aynı demo peştamal ilanı: önce ve KolayXport'ta yapay zekâ önerisinden sonra.

Neler değişti?
• Başlık, alıcının aradığı İngilizce kelimelerle başlıyor
• 13 etiketin hepsi kullanılıyor, başlıkla tekrar eden etiket yok
• İlan Doktoru notu yükseldi

Satış rakamı paylaşmıyoruz; satış, ilanın yanında fotoğrafa, fiyata ve kargoya da bağlı. Ama Etsy aramasında görünmenin ilk adımı doğru kelimeler.

Önerileri siz düzenlersiniz; siz "Gönder" demeden hiçbir şey Etsy'ye gitmez.
```
- **LinkedIn:** `Etsy'de Türk satıcıların en sık sorduğu soru: "Neden satış yok?" Cevabın bir kısmı İngilizce SEO'da. Demo bir ilanla önce/sonra: [görsel]. Yapay zekâ öneriyor, satıcı onaylıyor. [LinkedIn linki]`
- **Hashtag:** `#KolayXport #etsyseo #etsy #etsytürkiye #yapayzeka #seo`
- **Görsel brief:** "Sonra" metni **uygulamanın gerçekten ürettiği çıktı** olmalı (elle yazılmaz). Etsy logosu yok.
- **Link (IG):** `https://kolayxport.com/cozumler/ai-ilan-optimizasyonu?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_etsy_seo&utm_content=d04-ig-carousel`

### Gün 5 · Cuma · `d05` · P4 İpucu · `etsy_seo`

- **Kanallar / format:** X flood (6 tweet) · Facebook gruplarında **linksiz** faydalı paylaşım (yalnızca kuralları izin veren 2 grupta).
- **X flood:**
```
1/ Etsy etiketlerinde Türk satıcıların en sık yaptığı 5 hata 🧵

2/ 13 etiket hakkının hepsini kullanmamak. Her boş etiket, görünmediğiniz bir arama demek.

3/ 20 karakteri aşan etiketi anlamsız kesmek: "handmade turkish tow" gibi. Kısa ve tam bir ifade seçin.

4/ Türkçe etiket. Alıcı çoğunlukla İngilizce arıyor: "peştamal" değil "turkish towel", "beach towel".

5/ Başlıktaki kelimeyi etikette aynen tekrar etmek. O hakkı yeni bir arama ifadesine verin.

6/ Etiketi tahminle seçmek. Hangi ifadenin arandığını veriyle kontrol edin. KolayXport'ta Anahtar Kelime Gezgini bunun için var, 14 gün ücretsiz: [X linki]
```
- **Facebook grup paylaşımı (link yok):**
```
Etsy'de yeni başlayan arkadaşlar için etiketlerle ilgili kendi notlarım:
1. 13 etiketin hepsini doldurun.
2. Her etiket en fazla 20 karakter; kesik kelime bırakmayın.
3. Alıcılar İngilizce arıyor: "peştamal" yerine "turkish towel" gibi.
4. Başlıkta geçen kelimeyi etikette tekrar etmek yerine yeni bir ifade deneyin.
5. Tahmin değil, arama verisine bakın.
Sorusu olan olursa yorumda yardımcı olmaya çalışırım.
```
- **Görsel brief:** X için tek görsel: `research` ekranı (demo arama "turkish towel"). Grup paylaşımında görsel yok.
- **Link (X):** `https://kolayxport.com/cozumler/etsy-satici?utm_source=x&utm_medium=social&utm_campaign=launch_2026q4_etsy_seo&utm_content=d05-x-thread`

### Gün 6 · Cumartesi · `d06` · P3 Ürün bulma · `research`

- **Kanallar / format:** IG Reel (35 sn) · TikTok · YouTube Shorts.
- **Hook:** "Etsy'de ne satılır? Tahmin etmeyin, 60 saniyede veriye bakın."
- **Metin:**
```
"Etsy'de ne satılır?" sorusuna herkes farklı cevap veriyor. Biz veriye bakmayı öneriyoruz.

KolayXport Ürün Bulucu'da bir kelime yazın (ör. "ceramic bowl"); Etsy ve eBay'deki ilanları fiyat ve rekabetle birlikte görün. Beğendiğiniz fikri kaydedin, anahtar kelimelerini Anahtar Kelime Gezgini'nde kontrol edin.

Kesin kazanç yok; ama hangi ürünün kalabalık, hangisinin boş olduğunu görmeden üretime başlamamak iyi bir alışkanlık.

14 gün ücretsiz, kart gerekmez. Link profilde.
```
- **TikTok:** `Etsy'de ne satılır? Tahmin değil, veri. #etsy #etsytürkiye #eticaret #KolayXport #ürünaraştırması`
- **Hashtag:** `#KolayXport #etsy #etsytürkiye #eticaret #eihracat #yapayzeka`
- **Görsel brief:** `/app/research/products` ekran kaydı, demo arama "ceramic bowl", fiyat aralığı ve rekabet sütunları, kaydetme; ardından `research` (anahtar kelime). Amazon sekmesi görünürse tıklamayın (kapalı).
- **Link:** `https://kolayxport.com/cozumler/urun-arastirma-arbitraj?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_research&utm_content=d06-ig-reel`

### Gün 7 · Pazar · `d07` · Etkileşim · `brand`

- **Kanallar / format:** IG + FB hikâyeleri (4 kare).
- **Kareler:**
  1. Anket: "En çok hangi pazaryerinde satıyorsunuz? Etsy / eBay / Amazon / Trendyol"
  2. Soru kutusu: "Yurt dışına satışta sizi en çok ne yoruyor?"
  3. "Bu hafta: İlan Doktoru, Etsy etiket hataları, Ürün Bulucu. Hepsi profilde."
  4. Link çıkartması: "14 gün ücretsiz deneyin"
- **Link (çıkartma):** `https://kolayxport.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_brand&utm_content=d07-ig-story`
- **Not:** Soru kutusu cevaplarını kurucuya iletin (yeni hook ve roadmap girdisi).

---

## Hafta 2: Yapay zekâ araçları + "Trendyol'dan dünyaya" kampanyası

### Gün 8 · Pazartesi · `d08` · P1 + V02 · `etsy_seo`

- **Kanallar / format:** YouTube **V02 "Yapay zekâ ile Etsy ilanı optimizasyonu (6 dk)"** · IG Reel (40 sn kesit) · TikTok.
- **YouTube başlığı:** `Etsy SEO: Yapay zekâ ile İngilizce başlık, açıklama ve etiket nasıl yazılır? | KolayXport`
- **YouTube açıklaması:**
```
Etsy ilanında başlık, açıklama ve etiketleri yapay zekâyla İngilizce optimize etmek:
00:00 Sonuç
00:30 İlan düzenleyiciyi açmak
01:15 AI başlık önerisi ve düzenleme
02:40 AI etiketler (13 etiket, 20 karakter)
03:50 AI açıklama
04:40 Taslak ve "Gönder": Etsy'ye ne zaman gider?
05:30 Toplu AI optimizasyon (sonraki video)

14 gün ücretsiz, kredi kartı gerekmez: [YouTube linki]

The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy.
```
- **IG / TikTok metni:**
```
"etsy'nin doğru kullanımı seo ve ürünlerin profesyonel çekimidir." (Ekşi Sözlük'te bir satıcı)

SEO kısmını yapay zekâyla hızlandırın: KolayXport'ta ilanı açın, İngilizce başlık, açıklama ve 13 etiket önerisi alın, beğenmediğinizi düzeltin, taslağa kaydedin. Siz "Gönder" demeden Etsy'de hiçbir şey değişmez.

Tam video YouTube'da. 14 gün ücretsiz, kart gerekmez.
```
- **Hashtag:** `#KolayXport #etsyseo #etsy #yapayzeka #etsytürkiye #etsysatıcısı`
- **Görsel brief:** Demo "telkari kolye" ya da "İznik kâse" ilanı (`listing-editor`). AI butonları, önerinin yüklenmesi (beklemeyi kesin), bir kelimeyi elle düzeltme, "Taslakta 3 değişiklik" rozeti; Gönder'e **basmadan** bitirin.
- **Link:** `https://kolayxport.com/cozumler/ai-ilan-optimizasyonu?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_etsy_seo&utm_content=d08-ig-reel`

### Gün 9 · Salı · `d09` · P2 + V04 · `ai_photo`

- **Kanallar / format:** IG Reel (25 sn) · TikTok · FB Reel · (YouTube V04 aynı gün).
- **Hook:** "Ürün fotoğrafı stüdyonuz yok mu? Önce / sonra."
- **Metin:**
```
Elinizde sade bir ürün fotoğrafı var, ilanınız için ise ürünü sahnede gösteren bir görsel istiyorsunuz.

KolayXport'ta ilan görsellerinin yanında "AI ile görsel üret" var: ürününüzü sahnede gösteren yeni bir görsel üretir, beğenirseniz ilana eklersiniz. Etsy için alt metni de yapay zekâ yazar.

Bir uyarı: AI görseli ürününüzü değiştirmemeli. Renk, desen ya da ölçü farklı görünüyorsa kullanmayın; alıcıya gerçeği gösterin.

14 gün ücretsiz, kart gerekmez. Link profilde.
```
- **TikTok:** `Stüdyo yok, sorun değil. Ama AI görseli ürününüzü değiştirmesin. #ürünfotoğrafı #etsy #yapayzeka #KolayXport`
- **Hashtag:** `#KolayXport #ürünfotoğrafı #yapayzeka #etsy #elyapımı #handmade`
- **Görsel brief:** Demo "İznik kâse" görseli → editörde AI görsel üretimi → yan yana. Üretilen görselde ürün **değişmemiş** olmalı; değişmişse yeniden üretin. Köşede "AI ile üretilmiştir". Toplu fotoğraf stüdyosu Pro'dur; bu videoda yalnızca tekli editör.
- **Link:** `https://kolayxport.com/cozumler/ai-ilan-optimizasyonu?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_ai_photo&utm_content=d09-ig-reel`

### Gün 10 · Çarşamba · `d10` · P1 Kampanya açılışı · `trendyol_dunya`

- **Kanallar / format:** IG carousel (7 kart) · FB · LinkedIn (kurucu) · X.
- **Kartlar:**
  1. "Trendyol'dan dünyaya"
  2. "Trendyol'da sattığınız ürünler yurt dışında da alıcı bulabilir."
  3. "1 · Ürünlerinizi yapay zekâyla İngilizce Etsy ve eBay ilanına hazırlayın."
  4. "2 · Hangi üründe yurt dışında fiyat farkı var, veriyle bakın (Trendyol→eBay)."
  5. "3 · Stoğu tek yerden yönetin: Trendyol, Etsy, eBay, Shopify (beta)."
  6. "Hepsiburada ve N11 henüz yok. Yurt içi entegratörünüzü bırakmanız gerekmez; KolayXport yurt dışı tarafını ekler."
  7. "14 gün ücretsiz · kart gerekmez"
- **Metin:**
```
Trendyol'da satıyorsunuz. Aynı ürünler Etsy'de ve eBay'de de alıcı bulabilir.

"Trendyol'dan dünyaya" ile:
• Ürünlerinizi yapay zekâyla İngilizce Etsy/eBay ilanına çevirin
• Trendyol ile eBay arasındaki fiyat farkına veriyle bakın
• Stoğu Trendyol, Etsy, eBay ve Shopify arasında tek yerden eşitleyin (beta)

Açık konuşalım: Hepsiburada ve N11 henüz yok. Yurt içi için kullandığınız entegratörü bırakmanız gerekmez; KolayXport yurt dışı tarafını ekler.

14 gün ücretsiz, kart gerekmez. Link profilde.
```
- **LinkedIn:** `"Trendyol'dan dünyaya": Trendyol satıcılarının yurt dışına açılması için KolayXport'ta İngilizce AI ilan, Trendyol→eBay fiyat farkı ve stok senkronu (beta) bir arada. Yurt içi entegratörün yerine değil, yanına. [LinkedIn linki]`
- **X:** `Trendyol'da satıyorsanız aynı ürünü Etsy ve eBay'de de satmak için: İngilizce AI ilan, Trendyol→eBay fiyat farkı, tek yerden stok (beta). Hepsiburada/N11 henüz yok; entegratörünüzün yanına eklenir. [X linki]`
- **Hashtag:** `#KolayXport #trendyolsatıcısı #eihracat #ebay #etsy #mikroihracat`
- **Görsel brief:** Kartlarda Trendyol/Etsy/eBay logosu ve renkleri yok; isimler düz metin. 3–5. kartlarda ekran: Trendyol ürünleri listesi, `arbitrage` (Price Gap, "örnek" etiketiyle), `stock-sync`.
- **Onay notu:** Trendyol **sipariş** senkronu ortam bayrağına bağlı; bu paylaşım ondan bahsetmez.
- **Link:** `https://kolayxport.com/cozumler/trendyoldan-dunyaya?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_trendyol_dunya&utm_content=d10-ig-carousel`

### Gün 11 · Perşembe · `d11` · P3 + V06 · `arbitrage`

- **Kanallar / format:** YouTube **V06 "Trendyol→eBay fiyat farkı taraması (5 dk)"** · IG Reel · TikTok.
- **YouTube başlığı:** `Trendyol'dan alıp eBay'de satmak: Fiyat farkını veriyle bulmak | KolayXport`
- **YouTube açıklaması:**
```
Trendyol ile eBay arasındaki fiyat farkını KolayXport'ta nasıl tarayacağınızı gösteriyoruz.
00:00 Ne göreceksiniz
00:30 Araştırma › Ürünler › Trendyol'dan
01:30 Fiyat farkı tablosunu okumak
03:00 Kargo, komisyon ve gümrüğü unutmayın
04:15 Beğendiğiniz ürünü listeye almak

Fiyat farkı taraması Pro planda; 14 günlük ücretsiz denemede açık. Kredi kartı gerekmez: [YouTube linki]

Bu video yatırım veya kazanç tavsiyesi değildir. Tabloda görünen fark net kâr değildir; kargo, pazaryeri komisyonu ve gümrük ayrıca hesaplanmalıdır.
```
- **IG / TikTok metni:**
```
"Trendyol'dan alıp eBay'de satmak" mantıklı mı? Önce farka bakın.

KolayXport'ta Trendyol→eBay fiyat farkı taraması, aynı ürünün iki pazaryerindeki fiyatını yan yana getirir.

Dikkat: Gördüğünüz fark net kâr değildir. Kargo, eBay komisyonu ve alıcının ülkesindeki gümrük ayrıca düşülmeli.

Pro planda; 14 günlük denemede açık, kart gerekmez.
```
- **Hashtag:** `#KolayXport #ebay #trendyol #eihracat #ürünaraştırması #mikroihracat`
- **Görsel brief:** `arbitrage` ekranı (Price Gap tablosu, demo havlu kategorisi). Ekranda "örnek tarama, [tarih]". Site ana sayfasındaki eski "₺459 → $38.50, ROI +95%" kartı **kullanılmaz**; kâr/ROI yüzdesine yakın plan yok.
- **Link:** `https://kolayxport.com/cozumler/urun-arastirma-arbitraj?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_arbitrage&utm_content=d11-ig-reel`

### Gün 12 · Cuma · `d12` · P6 Kurucu · `brand` · Onay: **gerekli**

- **Kanallar / format:** LinkedIn (kurucu, metin + basit tablo görseli) · X flood (5 tweet).
- **LinkedIn:**
```
Türkiye'den Etsy ve eBay'e satan küçük bir işletme bugün kaç araç kullanıyor?

Konuştuğumuz satıcıların çoğunda tablo şöyle:
• Bir entegratör (sipariş, stok, fatura)
• Bir İngilizce SEO/araştırma aracı
• Bir toplu ilan düzenleme aracı
• Kargo paneli
• Kâr hesabı için bir tablo

Her biri ayrı giriş, ayrı fatura, ayrı dil. Bir kısmı yalnızca yıllık ödeme alıyor.

KolayXport'u bu parçaları yurt dışı satıcısı için tek panelde toplamak için yaptık; aylık ödeme, 14 gün ücretsiz deneme.

Merak ediyorum: Siz kaç araç kullanıyorsunuz, hangisinden vazgeçemezsiniz?
```
- **X flood:**
```
1/ Türkiye'den Etsy/eBay'e satan küçük işletmenin araç yığını: entegratör + İngilizce SEO aracı + toplu düzenleme + kargo paneli + Excel. 🧵
2/ Sorun yalnızca fiyat değil: 4-5 giriş, 3 dil, 2 para birimi.
3/ İngilizce araçlar Trendyol'u, ETGB'yi, Paraşüt'ü bilmiyor. Türk entegratörlerin çoğu Etsy'de ilan düzenlemiyor.
4/ KolayXport'ta ilan + araştırma + sipariş + yurt dışı etiket + kâr aynı panelde. Aylık ödeme.
5/ Hepsiburada/N11 henüz yok; yurt dışına odaklıyız. 14 gün ücretsiz, kart gerekmez: [X linki]
```
- **Görsel brief:** Sade tablo, kâğıt zemin: "Bugün" (5 kutu, yalnızca kategori adı; **rakip adı yok**) → "KolayXport" (tek kutu). Fiyat yok.
- **Onay notu:** Rakamlı "≈₺5.700/ay araç yığını" hesabı (competitors.md §4) yalnızca kurucu onayıyla, kaynak ve tarihle kullanılabilir; bu taslakta bilerek yok.
- **Link (LinkedIn):** `https://kolayxport.com/?utm_source=linkedin&utm_medium=social&utm_campaign=launch_2026q4_brand&utm_content=d12-li-post`

### Gün 13 · Cumartesi · `d13` · P4 İpucu · `trendyol_dunya`

- **Kanallar / format:** TikTok (30 sn, yüz + ekran) · IG Reel · YouTube Shorts.
- **Hook:** "Trendyol'dan alıp eBay'de satmadan önce 3 hata."
- **Metin:**
```
Trendyol'dan alıp eBay'de satmadan önce 3 hata:

1. Fiyat farkını net kâr sanmak. Kargo, eBay komisyonu ve alıcı ülkenin gümrüğü düşülmeden hesap bitmez.
2. Türkçe başlıkla ilan açmak. Alıcı İngilizce arar.
3. Stoğu takip etmemek. Trendyol'da biten ürün eBay'de satılırsa iptal ve kötü puan gelir.

KolayXport'ta fiyat farkını tarayın, ilanı yapay zekâyla İngilizce hazırlayın, stoğu tek yerden eşitleyin (beta).

Rehber yazımız profildeki linkte.
```
- **Hashtag:** `#KolayXport #ebay #trendyolsatıcısı #eihracat #eticaret #mikroihracat`
- **Görsel brief:** Yüz + arkada 3 ekran: `arbitrage`, eBay ilan stüdyosu AI doldurma, `stock-sync`. Telifsiz müzik.
- **Link:** `https://kolayxport.com/blog/trendyoldan-ebaye-urun-arastirmasi?utm_source=tiktok&utm_medium=social&utm_campaign=launch_2026q4_trendyol_dunya&utm_content=d13-tt-video` (yayında değilse `/cozumler/trendyoldan-dunyaya`)

### Gün 14 · Pazar · `d14` · Kurucu üye · `founding`

- **Kanallar / format:** IG + FB hikâye (3 kare) · X.
- **Kareler:**
  1. "Kurucu üye fırsatı"
  2. "İlk 20 ücretli aboneye ömür boyu %40 indirim (abonelik sürdükçe; koşullar fiyatlandırma sayfasında)."
  3. "Önce 14 gün ücretsiz deneyin, kart gerekmez." + link çıkartması
- **X:** `KolayXport kurucu üye fırsatı: ilk 20 ücretli aboneye ömür boyu %40 indirim. Durumu fiyatlandırma sayfasındaki canlı sayaçtan görebilirsiniz. Önce 14 gün ücretsiz deneyin: [X linki]`
- **Kural:** Kalan yer sayısı **yazılmaz**; "son fırsat/son günler" **yazılmaz**.
- **Link:** `https://kolayxport.com/fiyatlandirma?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_founding&utm_content=d14-ig-story`

---

## Hafta 3: Toplu işler, çapraz ilan, yurt dışı operasyon

### Gün 15 · Pazartesi · `d15` · P1 + V03 · `bulk_edit`

- **Kanallar / format:** YouTube **V03 "Etsy toplu düzenleme (5 dk)"** · IG Reel · TikTok · FB Reel.
- **Hook:** Kâğıt zeminde: **"…435 ürünü tek tek inceleyip fiyatları manuel olarak düzeltmemize bırakmış durumdalar."** Alt satır: "Şikayetvar'da bir satıcı".
- **Metin:**
```
"…435 ürünü tek tek inceleyip fiyatları manuel olarak düzeltmemize bırakmış durumdalar." (Şikayetvar'da bir satıcı)

Toplu değişiklik iki şey ister: hız ve geri dönebilmek.

KolayXport'ta Etsy toplu düzenleyicide başlık, fiyat, adet, bölüm ve etiketleri tablo gibi düzenleyin. Değişiklikler önce taslakta kalır; kontrol eder, sonra gönderirsiniz. İlan Etsy'de sonradan değiştirildiyse gönderim durur ve sizi uyarır. Yanlış mı oldu? İlanın önceki sürümüne dönebilirsiniz.

Tam video YouTube'da. 14 gün ücretsiz, kart gerekmez.
```
- **YouTube başlığı:** `Etsy toplu düzenleme: Fiyat, başlık ve etiketleri tek ekrandan güncelleyin (taslakla, güvenle) | KolayXport`
- **YouTube açıklaması:** bölümler (00:00 Sonuç · 00:40 Toplu düzenleyiciyi açmak · 01:30 Fiyat ve adet · 02:30 Etiketler ve bölüm · 03:30 Toplu AI optimizasyon · 04:20 Taslak, çakışma uyarısı ve gönderim · 05:00 Sürüm geçmişi) + UTM linki + Etsy API satırı.
- **Hashtag:** `#KolayXport #etsy #toplufiyat #etsysatıcısı #verimlilik #eticaret`
- **Görsel brief:** `bulk-editor` (demo, 20 ilan), fiyatta toplu %10, etiket düzenleme, "Taslakta 20 değişiklik", gönderim özeti, Editör › Geçmiş. Şikâyetin konusu olan firmanın adı **hiçbir yerde geçmez**.
- **Link:** `https://kolayxport.com/cozumler/ai-ilan-optimizasyonu?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_bulk_edit&utm_content=d15-ig-reel`

### Gün 16 · Salı · `d16` · P1 Çapraz ilan · `crosslist`

- **Kanallar / format:** IG Reel (25 sn) · TikTok · X (video).
- **Hook:** "Etsy ilanınızı eBay'e taşımak."
- **Metin:**
```
Etsy'de iyi giden ürün eBay'de de olsun mu?

KolayXport'ta ilan listesinde "eBay'e kopyala"yı seçin: fotoğrafları ve varyasyonlarıyla bir eBay taslağı oluşur. Para birimi farklıysa fiyatı siz girersiniz, sonra yayınlarsınız. Tersi de var: eBay'den Etsy'ye.

İkinci bir Etsy mağazanız varsa ilanları oraya da kopyalayabilirsiniz.

14 gün ücretsiz, kart gerekmez. Link profilde.
```
- **X:** `Etsy ilanınızı eBay'e (ya da tersine) fotoğraf ve varyasyonlarıyla taslak olarak kopyalayın. Fiyatı siz belirleyin, sonra yayınlayın. [X linki]`
- **Hashtag:** `#KolayXport #ebay #etsy #crosslisting #eihracat #ebaysatıcısı`
- **Görsel brief:** `etsy-listings` › satır menüsü › "eBay'e kopyala" → eBay taslak düzenleyici (fiyat alanı boş, elle doldurma) → Yayınla'ya gelmeden kesin.
- **Link:** `https://kolayxport.com/cozumler/ebay-satici?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_crosslist&utm_content=d16-ig-reel`

### Gün 17 · Çarşamba · `d17` · P3 + V05 · `research`

- **Kanallar / format:** YouTube **V05 "Etsy ve eBay anahtar kelime araştırması (6 dk)"** · IG carousel · LinkedIn.
- **YouTube başlığı:** `Etsy etiket bulma: Anahtar kelime araştırması nasıl yapılır? (Türkçe anlatım) | KolayXport`
- **IG carousel:** 1 "Doğru etiketi tahmin etmeyin, bulun" · 2 `research` ekranı · 3 "Arama ilgisi ve rekabet birlikte okunur" · 4 "Uzun kuyruk ifadeler: 'turkish towel' yerine 'lightweight beach towel'" · 5 "Bulduğunuz ifadeyi ilanınıza taslak olarak ekleyin" · 6 "14 gün ücretsiz · kart gerekmez".
- **Metin:**
```
Etsy'de etiket seçerken en sık hata: kendi aklımızdaki kelimeyi yazmak.

KolayXport Anahtar Kelime Gezgini'nde bir ifade yazın; Etsy ve eBay'de nasıl arandığını ve ne kadar kalabalık olduğunu görün. Uzun kuyruk ifadeleri bulun, ilanınıza taslak olarak ekleyin.

Kaydedin, bir sonraki ilanınızda kullanın.
```
- **LinkedIn:** `Türk satıcıların yurt dışı pazaryerlerinde en büyük açığı İngilizce arama dili. KolayXport'ta Etsy ve eBay için anahtar kelime gezgini, Türkçe arayüzle. Eğitim videosu: [LinkedIn linki]`
- **Hashtag:** `#KolayXport #etsyseo #etiket #anahtarkelime #etsy #ebay`
- **Görsel brief:** `research` ekranı (demo aramalar "turkish towel", "iznik bowl"). Sonuç gecikirse kesip hızlandırın.
- **Link:** `https://kolayxport.com/cozumler/urun-arastirma-arbitraj?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_research&utm_content=d17-ig-carousel`

### Gün 18 · Perşembe · `d18` · P1 + V07 · `export_ops`

- **Kanallar / format:** YouTube **V07 "Kendi FedEx/UPS hesabınızla yurt dışı etiket (6 dk)"** · IG Reel · FB Reel.
- **Hook:** "Yurt dışı kargoda dert yalnızca fiyat değil: etiket, ticari fatura, GTİP."
- **Metin:**
```
Yurt dışı siparişte etiket, ticari fatura ve GTİP kodu ayrı ayrı iş.

KolayXport'ta Etsy, eBay ve Amazon siparişleriniz tek listede. Kendi FedEx veya UPS hesabınızı bağlayın, etiketi siparişten panelde basın; ticari fatura etiketle birlikte elektronik gider (FedEx'te ETD, UPS'te EDI). Toplu seçerseniz yurt içi siparişler DHL eCommerce'e, yurt dışı olanlar FedEx/UPS'e ayrılır.

Kargo satmıyoruz: fiyat, sizin FedEx/UPS anlaşmanızdır. FedEx ve UPS yalnızca yurt dışı için.

14 gün ücretsiz, kart gerekmez.
```
- **YouTube başlığı:** `FedEx ve UPS etiket oluşturma: Etsy/eBay siparişine yurt dışı etiket ve elektronik ticari fatura | KolayXport`
- **YouTube açıklaması:** bölümler (Gönderici profili · FedEx/UPS API bilgileri · GTİP ve İngilizce açıklama · Etiket basma · Toplu etiket · İptal: FedEx/UPS portalından) + "KolayXport kargo satmaz; etiket kendi FedEx/UPS hesabınızla basılır. FedEx/UPS gönderi durumu panelde izlenmez."
- **Hashtag:** `#KolayXport #mikroihracat #fedex #ups #eihracat #yurtdışıkargo`
- **Görsel brief:** Gönderici profili (kurgusal firma, **kurgusal vergi no**), Bağlantılar (FedEx API alanları boş/bulanık), Sipariş › Etiket › Gümrük bölümü, `labels` ekranı, etiket PDF önizlemesi (demo adres). Taşıyıcı logoları küçük resimde ve reklamda yok.
- **Kural:** "Ucuz", "indirimli", "ShipEntegra alternatifi" yazılmaz.
- **Link:** `https://kolayxport.com/cozumler/mikro-ihracat-kargo-etgb?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_export_ops&utm_content=d18-ig-reel`

### Gün 19 · Cuma · `d19` · P4 İpucu (ETGB) · `export_ops` · Onay: **gerekli**

- **Kanallar / format:** LinkedIn (kurucu) · X flood · Facebook gruplarında linksiz özet.
- **X flood:**
```
1/ ETGB nedir, mikro ihracatta ne işe yarar? Kısa özet 🧵 (Vergi/gümrük tavsiyesi değildir; kendi müşavirinize danışın.)
2/ ETGB: Elektronik Ticaret Gümrük Beyannamesi. E-ticaretle yurt dışına giden gönderilerde kullanılan basitleştirilmiş beyan.
3/ Beyanı gümrük müşaviriniz veya ETGB yetkisi olan kargo firması yapar. Sizden sipariş, fatura ve ürün bilgisi (GTİP, değer, ağırlık) ister.
4/ Sınırlar ve şartlar değişebiliyor; Ticaret Bakanlığı duyurularını ve müşavirinizi takip edin.
5/ KolayXport'un yaptığı kısım: seçtiğiniz yurt dışı siparişlerden ETGB için Excel dosyası hazırlamak ve müşavirinize e-postayla göndermek. Beyanı biz yapmıyoruz.
6/ Mikro ihracat rehberimiz: [X linki]
```
- **LinkedIn:** aynı içerik paragraf halinde; son cümle: "Mali müşavir ve gümrük müşavirlerinin geri bildirimine açığız: dosya formatında eksik gördüğünüz alan var mı?"
- **Kapı:** 5. tweet yalnızca **ETGB düzeltmesi canlıdaysa** (ihracatçı adı, VKN ve varsayılan GTİP satıcının gönderici profilinden geliyor). Canlı değilse 5. tweeti çıkarın.
- **Görsel brief:** Tek "ETGB 101" kartı (kâğıt zemin, manifest çizgileri motifi). Ürün ekranı yok.
- **Link (X):** `https://kolayxport.com/blog/mikro-ihracat-rehberi-2026?utm_source=x&utm_medium=social&utm_campaign=launch_2026q4_export_ops&utm_content=d19-x-thread`

### Gün 20 · Cumartesi · `d20` · P4 İpucu (AB €3) · `export_ops` · Onay: **gerekli**

- **Kanallar / format:** TikTok (35 sn, yüz) · IG Reel.
- **Hook:** "1 Temmuz 2026'dan beri AB'ye giden küçük paketlerde yeni bir ücret var."
- **Metin:**
```
AB'ye giden düşük değerli e-ticaret gönderilerinde 1 Temmuz 2026'dan itibaren paketteki her farklı ürün kalemi için 3 € tutarında yeni bir gümrük ücreti uygulanıyor (AB Konseyi Tüzüğü 2026/382). Fransa ayrıca 1 Mart 2026'dan beri 2 € ücret alıyor.

Ne yapmalı?
• Fiyatınızı ve kargo politikanızı gözden geçirin
• Bu ücreti kimin ödeyeceğini ilanınızda açıkça yazın
• Kargo firmanıza ve müşavirinize danışın

Bu bir vergi tavsiyesi değildir; ayrıntılar için resmi kaynaklara ve müşavirinize başvurun.
```
- **Kaynak:** pain-points.md A7 (Etsy Community TR çevirisi, Council Reg. 2026/382). **Kurucu, paylaşımdan önce tutarı ve tarihi resmi kaynaktan teyit etmeli.**
- **Not:** KolayXport gümrük vergisi/DDP **hesaplamaz**; ürün iddiası yok, CTA yalnızca kaydet/takip et.
- **Hashtag:** `#KolayXport #eihracat #mikroihracat #gümrük #etsy #avrupa`
- **Link:** yok (bilgilendirici).

### Gün 21 · Pazar · `d21` · Canlı yayın duyurusu · `brand`

- **Kanallar / format:** IG + FB hikâye (3 kare, geri sayım çıkartması) · X.
- **Kareler:** 1 "Çarşamba [saat] canlı: Etsy ilanlarını birlikte optimize ediyoruz" · 2 "İlanınızın linkini soru kutusuna bırakın; izin verirseniz canlıda birkaçına bakalım" · 3 Geri sayım çıkartması.
- **X:** `Çarşamba [saat]'te canlı yayın: Etsy ilanlarını birlikte optimize ediyoruz. İlanınızı göstermek isterseniz yanıtlayın, canlıda bakalım (yalnızca izin verenler). [X linki]`
- **Onay:** Canlıda gösterilecek ilanlar için yazılı izin (DM'de "evet, gösterebilirsiniz" yeterli; ekran görüntüsünü saklayın).
- **Link:** `https://kolayxport.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_brand&utm_content=d21-ig-story`

---

## Hafta 4: Kâr, stok, canlı demo, dönüşüm

### Gün 22 · Pazartesi · `d22` · P1 + V10 · `finance`

- **Kanallar / format:** YouTube **V10 "Net kâr raporu: Etsy, eBay, Amazon, Trendyol (6 dk)"** · IG Reel · TikTok · LinkedIn.
- **Hook:** Kâğıt zeminde: **"…4 dolara sattım … bana 99 lira kalmış."** Alt: "Ekşi Sözlük'te bir Etsy satıcısı".
- **Metin:**
```
"bir takvim yaptım, 4 dolara sattım … bana 99 lira kalmış." (Ekşi Sözlük'te bir satıcı)

Satış fiyatı ile cebinize kalan arasındaki farkı görmeden fiyat belirlemek zor.

KolayXport kâr raporu Etsy, eBay, Amazon ve Trendyol siparişlerinden komisyonu, kargoyu, iadeleri, indirimleri, reklam harcamasını ve girdiğiniz ürün maliyetini düşer; net kârı dolar ve TL olarak gösterir.

Kâr raporu Pro planda; 14 günlük ücretsiz denemede açık, kart gerekmez.
```
- **LinkedIn:** `E-ihracatta ciro değil net kâr önemli. KolayXport'ta Etsy/eBay/Amazon/Trendyol için komisyon, kargo, reklam ve maliyet düşülmüş kâr raporu. Shopify/Wix finansı henüz yok. [LinkedIn linki]`
- **Hashtag:** `#KolayXport #etsy #kârhesabı #eihracat #eticaret #ebay`
- **Görsel brief:** `profit` ekranı (demo veri), pazaryeri kırılımı, ürün maliyeti girişi, TL/USD. Ekranda "Demo veri".
- **Link:** `https://kolayxport.com/blog/etsy-kar-hesaplama?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_finance&utm_content=d22-ig-reel` (yayında değilse `/fiyatlandirma`)

### Gün 23 · Salı · `d23` · P1 + V09 (Beta) · `stock_sync` · Onay: **gerekli**

- **Kanallar / format:** YouTube **V09 "Stok senkronu (Beta) kurulumu (7 dk)"** · IG Reel · FB Reel.
- **Hook:** Kâğıt zeminde: **"herhangi bir işlem yapmadığımız halde bazı ürünlerin stokları kendiliğinden sıfırlanıyor."** Alt: "Şikayetvar'da bir satıcı".
- **Metin:**
```
Birden fazla pazaryerinde aynı ürünü satıyorsanız en büyük korku: biten ürünün başka yerde satılması.

KolayXport Stok Senkronu (Beta) Etsy, eBay, Trendyol ve Shopify arasında stoğu tek havuzdan yönetir. Sihirbaz SKU'ları eşleştirir; canlıya almadan önce deneme çalıştırmasıyla ne olacağını görürsünüz. Etsy değişiklikleri yaklaşık 1 dakikada, Trendyol birkaç dakikada yansır.

Beta: Amazon ve Hepsiburada stoğu yazılmıyor; Wix varsayılan olarak yalnızca okunuyor.

14 gün ücretsiz, kart gerekmez.
```
- **YouTube başlığı:** `Etsy, eBay, Trendyol ve Shopify stok senkronu kurulumu (Beta) | KolayXport`
- **Hashtag:** `#KolayXport #stoktakibi #trendyolsatıcısı #etsy #ebay #shopify`
- **Görsel brief:** `stock-sync` sihirbazı: mağaza seçimi, SKU eşleştirme önerileri, deneme çalıştırması, canlıya alma. Başlıkta ve videoda "(Beta)".
- **Onay notu:** Kurucu canlıda açık ve sorunsuz olduğunu teyit etmezse yedek havuzdan "Zamanlanmış gönderim" (§4) paylaşılır.
- **Link:** `https://kolayxport.com/cozumler/trendyoldan-dunyaya?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_stock_sync&utm_content=d23-ig-reel`

### Gün 24 · Çarşamba · `d24` · Canlı demo · `brand` · Onay: **gerekli**

- **Kanallar / format:** Instagram Live (40 dk), sonra YouTube'a yükleme. Facebook sayfasında etkinlik.
- **Akış:** 0–5 dk tanışma · 5–25 dk izin veren 3 katılımcının Etsy ilanına İlan Doktoru + AI öneri (Gönder'e **basmadan**, yalnızca taslak) · 25–35 dk soru-cevap · 35–40 dk "14 gün ücretsiz; kurucu üye fırsatı (ilk 20 abone, koşullar fiyatlandırma sayfasında)".
- **YouTube açıklaması:** `Canlı yayında izin veren satıcıların Etsy ilanlarını KolayXport İlan Doktoru ve yapay zekâ önerileriyle inceledik. Hiçbir değişiklik satıcının onayı olmadan Etsy'ye gönderilmedi. [YouTube linki]` + Etsy API satırı.
- **Kurallar:** Katılımcının mağaza adı/ürünü yalnızca yazılı izinle; kazanç rakamı konuşulmaz; vergi/gümrük sorusuna "müşavirinize danışın" denir.
- **Link:** `https://kolayxport.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_brand&utm_content=d24-ig-live`

### Gün 25 · Perşembe · `d25` · P1 + V08 *(kapılı)* · `export_ops` · Onay: **gerekli**

- **Kapı:** Yalnızca ETGB düzeltmesi **canlıda** ise. Değilse **yedek içerik** (aşağıda).
- **Kanallar / format:** YouTube **V08 "ETGB dosyası ve Paraşüt (5 dk)"** · IG Reel · LinkedIn.
- **Hook:** Kâğıt zeminde: **"…muhasebeci 4 dolar + kdv üzerinden keseceksin diyor … kafam karıştı."** Alt: "Ekşi Sözlük'te bir satıcı".
- **Metin:**
```
Mikro ihracatta evrak işi kafa karıştırıyor. Vergi sorusunu müşaviriniz cevaplar; dosyayı hazırlamayı biz kolaylaştırabiliriz.

KolayXport'ta yurt dışı siparişlerinizi seçin, "ETGB gönder"e basın: firma bilgileriniz, GTİP kodları ve sipariş bilgileriyle bir Excel dosyası hazırlanır ve Ayarlar'da belirlediğiniz müşavire e-postayla gider. Paraşüt hesabınız bağlıysa aynı adımda Paraşüt'te fatura oluşturulmaya çalışılır; faturalarınızı Paraşüt'te kontrol edin.

KolayXport ETGB beyanı yapmaz; beyanı müşaviriniz yapar.
```
- **YouTube açıklaması:** bölümler + "KolayXport gümrük beyanı yapmaz ve vergi tavsiyesi vermez." + UTM linki.
- **Görsel brief:** Gönderici profili (kurgusal firma, kurgusal VKN, varsayılan GTİP), Siparişler › toplu seçim › ETGB gönder, Excel önizlemesi (kurgusal), Ayarlar'da müşavir e-postası (kurgusal).
- **Yedek içerik (ETGB canlı değilse):**
```
Kargo günü masada 40 sipariş mi var?

KolayXport'ta siparişleri seçin, toplama listesini ve paketleme fişlerini birlikte yazdırın: hangi üründen kaç tane, hangi paket kime. Depoda karışıklık azalır.

14 gün ücretsiz, kart gerekmez.
```
  (Görsel: `orders` › toplu seçim › Yazdır › `/app/print/pick-list` ve `/app/print/packing-slips`, demo veri.)
- **Link:** `https://kolayxport.com/cozumler/mikro-ihracat-kargo-etgb?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_export_ops&utm_content=d25-ig-reel`

### Gün 26 · Cuma · `d26` · P1 + V11 (Beta) · `inbox` · Onay: **gerekli**

- **Kanallar / format:** IG Reel · TikTok · X · (YouTube V11 aynı gün).
- **Hook:** Kâğıt zeminde: **"trendyol bize kibar olun diyor sadece. … kafamıza göre cevap yazıyoruz"** Alt: "Ekşi Sözlük'te bir satıcı".
- **Metin:**
```
Trendyol'da müşteri sorularına cevap süresi mağaza puanını etkiliyor. Her soruya sıfırdan cevap yazmak da yorucu.

KolayXport Mesajlar (Beta) Trendyol müşteri sorularını ve Wix sohbetlerini tek kutuda toplar; ürün ve sipariş bilgisini yanında gösterir. "AI ile taslak"a basarsanız yapay zekâ bir cevap önerir; siz düzeltip gönderirsiniz. Hazır cevaplar da var.

Not: Etsy, eBay ve Amazon mesajları bu kutuda yok.

14 gün ücretsiz, kart gerekmez.
```
- **X:** `Trendyol müşteri soruları + Wix sohbeti tek kutuda, AI cevap taslağıyla (Beta). Etsy/eBay/Amazon mesajları dahil değil. [X linki]`
- **Hashtag:** `#KolayXport #trendyolsatıcısı #müşterihizmetleri #yapayzeka #eticaret`
- **Görsel brief:** `inbox` ekranı (demo sorular: peştamal boyutu, telkari zincir). "AI ile taslak", düzenleme; gönder **öncesi** kesin.
- **Onay notu:** Mesajlar, Trendyol/Wix ortam bayraklarına bağlı. Kurucu canlıda açık olduğunu teyit etmezse Gün 26 ile Gün 27 yer değiştirir ve Gün 27'de yedek havuzdan bir içerik kullanılır.
- **Link:** `https://kolayxport.com/cozumler/trendyoldan-dunyaya?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_inbox&utm_content=d26-ig-reel`

### Gün 27 · Cumartesi · `d27` · P4 Uyarı · `etsy_seo`

- **Kanallar / format:** TikTok (30 sn, yüz) · IG Reel · FB Reel.
- **Hook:** "Etsy danışmanına para göndermeden önce 3 soru."
- **Metin:**
```
Şikayetvar'da "Etsy danışmanlığı" adı altında on binlerce lira kaybettiğini anlatan satıcılar var.

Para göndermeden önce sorun:
1. Bu kişinin ya da firmanın ticari unvanı ve vergi numarası ne?
2. Hesabınıza şifrenizle girmek istiyor mu? (Etsy hesabınızı kimseyle paylaşmayın.)
3. "Satış garantisi" veriyor mu? Kimse veremez.

İlanınızı kendiniz ölçmek isterseniz İlan Doktoru'na bakın. 14 gün ücretsiz, kart gerekmez.
```
- **Kural:** Kişi veya firma adı **verilmez**, tutar yazılmaz.
- **Hashtag:** `#KolayXport #etsy #etsytürkiye #dolandırıcılık #etsysatıcısı`
- **Görsel brief:** Yüz + 3 madde; son 3 sn İlan Doktoru ekranı.
- **Link:** `https://kolayxport.com/cozumler/etsy-satici?utm_source=tiktok&utm_medium=social&utm_campaign=launch_2026q4_etsy_seo&utm_content=d27-tt-video`

### Gün 28 · Pazar · `d28` · SSS / kurucu üye · `founding`

- **Kanallar / format:** IG carousel (7 kart) · FB.
- **Kartlar (SSS):**
  1. "KolayXport hakkında en çok sorulan 6 soru"
  2. "Deneme ücretli mi? Hayır. 14 gün ücretsiz, kredi kartı istemiyoruz. Deneme bitince otomatik ücret alınmaz; devam etmek isterseniz plan seçersiniz."
  3. "Hangi pazaryerleri? Etsy, eBay, Amazon (sipariş), Trendyol, Shopify, Wix. Hepsiburada ve N11 henüz yok."
  4. "Etsy'deki ilanımı bozar mı? Değişiklikler önce taslakta kalır; siz 'Gönder' demeden Etsy'ye gitmez."
  5. "Kargo satıyor musunuz? Hayır. Kendi FedEx/UPS hesabınızla yurt dışı, DHL eCommerce ile yurt içi etiket basarsınız."
  6. "Kurucu üye fırsatı nedir? İlk 20 ücretli aboneye ömür boyu %40 indirim (abonelik sürdükçe). Sayaç fiyatlandırma sayfasında."
  7. "Başka sorunuz mu var? Yorumlara yazın ya da destek@kolayxport.com"
- **Metin:** `Kaydedin; aklınıza takılan olursa yorumlara yazın. Fiyatlar ve kurucu üye sayacı: profildeki link.`
- **Hashtag:** `#KolayXport #etsytürkiye #eihracat #ebay #trendyolsatıcısı`
- **Link:** `https://kolayxport.com/fiyatlandirma?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_founding&utm_content=d28-ig-carousel`

### Gün 29 · Pazartesi · `d29` · P1 + V12 *(kapılı)* · `extension` · Onay: **gerekli**

- **Kapı:** Yalnızca Chrome eklentisi **Chrome Web Mağazası'nda yayında** ve uygulamadaki kurulum linki çalışıyorsa. Değilse **yedek içerik** ve `utm_campaign=launch_2026q4_etsy_seo`.
- **Kanallar / format:** YouTube **V12 "KolayXport Chrome eklentisi (5 dk)"** · IG Reel.
- **Metin (eklenti yayındaysa):**
```
Etsy'de gezinirken bir ilanın ne kadar ilgi gördüğünü merak ediyor musunuz?

KolayXport Chrome eklentisi Etsy arama, ilan ve mağaza sayfalarında araştırma bilgisini sayfanın üstünde gösterir; eBay ve Amazon sayfalarında da tahmini veriler sunar.

Chrome Web Mağazası'ndan ücretsiz kurun, KolayXport hesabınızla kullanın.
```
- **Yedek içerik (eklenti yayında değilse):** İlan sürüm geçmişi.
```
Toplu düzenlemede bir hata mı yaptınız?

KolayXport her Etsy ilanının sürüm geçmişini tutar. Önceki sürümü seçip geri yükleyin; yine taslağa gelir, siz onaylayınca Etsy'ye gider.

14 gün ücretsiz, kart gerekmez.
```
  (Görsel: Editör › Geçmiş › Geri yükle, `/app/etsy-aktivite`.)
- **Görsel brief (eklenti):** Etsy arama sayfasında eklenti katmanı; Etsy logosu ve satıcı adları **bulanık**. eBay sitesi ekran görüntüsü **kullanılmaz** (eBay yazılı izin istiyor). Amazon verilerinin "tahmini" olduğu ekranda yazılı.
- **Link:** `https://kolayxport.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_extension&utm_content=d29-ig-reel`

### Gün 30 · Salı · `d30` · P5 Ürün güncellemesi · `brand` · Onay: **gerekli**

- **Kanallar / format:** IG carousel · LinkedIn (kurucu) · X · FB.
- **Kural:** Yalnızca son 30 günde **canlıya alınmış** değişiklikler. Kurucudan sürüm notu listesi isteyin; listede olmayanı yazmayın.
- **Şablon metin:**
```
KolayXport'ta 30 gün: ne yayınladık, ne öğrendik?

Yayına aldıklarımız:
• [canlıya alınan değişiklik 1]
• [canlıya alınan değişiklik 2]
• [canlıya alınan değişiklik 3]

Sizden en çok gelen istekler:
• [anket/soru kutusundan 1]
• [2]

Hepsine söz veremiyoruz; neyi ne zaman yapacağımızı açıkça yazacağız.

Teşekkürler. 14 gün ücretsiz deneme hâlâ kart istemiyor.
```
- **Görsel brief:** Her madde için ilgili ekranın küçük görüntüsü; son kartta kurucu fotoğrafı.
- **Link:** `https://kolayxport.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch_2026q4_brand&utm_content=d30-ig-carousel`

---

## 3. Her gün yapılanlar / Daily extras

- **Hikâye (IG/FB, 2 kare):** Günün paylaşımına yönlendirme + anket ya da soru. Link çıkartmasında günün linki, `utm_content=dXX-ig-story`.
- **Topluluk turu (30 dk):** communities.csv'deki A önceliklilerden 3'ünde soru cevaplayın, linksiz. Yalnızca soru doğrudan bir araç sorusuysa ve grup kuralları izin veriyorsa link verin (`utm_medium=community`, `utm_content=dXX-grp-<grupkısaltma>`).
- **Yorum/DM:** Yayından sonraki ilk saat + akşam. Şikâyet/ödeme/KVKK içerikliyse README §5 madde 9.

## 4. Yedek içerik havuzu / Backup posts

1. **Zamanlanmış gönderim:** "İlan güncellemelerinizi istediğiniz saate planlayın; Etsy, eBay, Trendyol, Shopify ve Wix'e kendiliğinden gitsin." (`scheduled-send`)
2. **İkinci Etsy mağazasına kopyalama:** "İkinci mağazanızı dakikalar içinde doldurun: ilanları varyasyon, fotoğraf ve videosuyla kopyalayın." (`etsy-copy-to-shop`)
3. **DHL eCommerce yurt içi etiket:** "Yurt içi siparişlerinize DHL eCommerce (MNG) etiketini kapıda ödeme seçeneğiyle panelden basın; iptal ve takip de panelde." (`label-dhl-ecommerce`)
4. **Bildirimler:** "Geciken kargo, biten stok, kapanan ilan için günlük e-posta özeti alın." (`notification-center`, `notify-email`)
5. **Amazon yorum isteği:** "Amazon siparişinden yorum isteği gönderin." (`msg-amazon-buyer`)
6. **Mobil kullanım:** "Siparişlerinize telefondan bakın, etiketinizi basın." (`mobile-shell`, ekran `orders-mobile`)

Her yedek içerik için `utm_campaign=launch_2026q4_brand`, `utm_content=bkN-ig-reel`.

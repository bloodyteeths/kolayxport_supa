# Kanal stratejisi / Channel strategy

Tarih: 2026-10-17. Konumlandırma: "Yurt dışına satışın tek paneli" (marka) + "Trendyol'dan dünyaya" (kampanya). Bütün iddialar README §3'e tabidir.

## 0. Ses ve görsel kimlik / Voice & look (docs/brand.md)

- **Ses:** Kendi cümlelerimiz **"siz"** ile, sıcak ve somut ("bağlayın, düzenleyin, gönderin, yazdırın"). Satıcı alıntıları kendi sözleriyle aynen. Yasak: "en iyi", "tek", "#1", "garantili satış", "çözüm", "inovatif", "devrim", uydurma sayı/yorum; "tek tık" yalnızca gerçekten tek tıksa; "sınırlı kontenjan" yalnızca gerçek kurucu üye sınırı için. Ne yapmadığımızı söyleriz ("Hepsiburada henüz yok.").
- **Yazım:** Her zaman **KolayXport** (K ve X büyük). "Türkiye" (Turkey değil). "yapay zekâ", "kâr".
- **Renk/yazı:** mürekkep `#0E1A2B`, kâğıt `#FAF7F0`, vurgu `#2B45E0`, kraft `#C9A57B` (yalnızca süs, yazı değil). Başlık Fraunces, metin Instrument Sans. Pazaryeri renkleri (Etsy turuncusu, Amazon sarısı, eBay dört rengi, Trendyol turuncusu) ve logoları yok.
- **Görseller:** Önce ürün ekranı (`public/marketing/screens/*`, demo hesap, 20 px köşeli çerçeve). Yaşam tarzı fotoğrafları illüstrasyondur: **asla** bir alıntı ya da müşteri adıyla aynı karede değil. Profil ve kapak görselleri `public/brand/social/`.

## 0.1 İçerik sütunları / Content pillars

Her paylaşım aşağıdaki altı sütundan birine girer. Oran 30 günlük takvimde tutturuldu.

| # | Sütun | Oran | Ne anlatır | Örnek | Kanıt kaynağı |
|---|---|---|---|---|---|
| P1 | **Dert → ekran demosu** | %35 | Satıcının kendi cümlesiyle açılış, ardından 20–40 sn ekran kaydı: KolayXport'ta o dert nasıl ele alınıyor | "134 ürün, 4 satış — bu normal mi?" → İlan doktoru | pain-points.md A4, A9, A10, B1 |
| P2 | **Önce / sonra ilan** | %15 | Aynı ilanın başlığı, etiketleri, fotoğrafı: önce ve AI sonrası. **Satış rakamı yok**, yalnızca ilan metni ve SEO notu | Etsy başlığı 62 → 138 karakter, etiketler 7 → 13 | `ai-listing-copy`, `research-listing-doctor`, `ai-image-gen` |
| P3 | **Ürün bulma / arbitraj** | %15 | Veriye bakarak ne satılır: ürün bulucu, anahtar kelime gezgini, Trendyol→eBay fiyat farkı | "Trendyol'da ₺X, eBay'de $Y: fark nereden çıkıyor?" (yalnızca demo verisi veya gerçek tarama ekranı, "örnek" etiketiyle) | `research-*`, `arbitrage-price-gap` |
| P4 | **Satıcı ipuçları** (ürün anlatmadan) | %20 | Etsy etiket kuralları, başlık yazımı, AB €3 gümrük ücreti, ETGB nedir, Etsy kesintileri. Güven kazandırır, gruplarda paylaşılabilir | "Etsy etiketinde 20 karakter sınırı: 5 hata" | pain-points.md (2) anahtar kelimeler; blog yazıları |
| P5 | **Ürün güncellemesi** | %5 | Yalnızca **canlıya alınmış** gerçek değişiklikler (changelog) | "Artık ETGB dosyasında kendi firma bilgin yazıyor" (yalnızca deploy sonrası) | git log / kurucu onayı |
| P6 | **Kurucu hikâyesi** | %10 | Neden kurduk, kendi Etsy/e-ihracat tecrübesi, Adana'dan tek kişilik ekip, ne yapamadığımızı açıkça söylemek | "Hepsiburada yok, neden? Çünkü önce yurt dışını iyi yapmak istiyoruz." | positioning.md, company.md |

**Kurucu üye fırsatı** her sütuna kapanış cümlesi olarak eklenebilir (haftada en fazla 2 kez): "İlk 20 ücretli aboneye ömür boyu %40 indirim. Ayrıntı: kolayxport.com/fiyatlandirma". Kalan kontenjan **yazılmaz**.

## 1. Instagram

- **Kitle:** 22–45 yaş, Etsy'de el yapımı / takı / tekstil / ev / POD satan veya başlamak isteyen satıcılar (ağırlıkla kadın girişimciler), Trendyol satıcılarının e-ihracat meraklısı kesimi.
- **Hedef:** Farkındalık + güven; bio linkinden kayda trafik. Reklam yaratıcılarının test alanı (organikte iyi giden Reel, reklama aday).
- **Formatlar:** Reels (15–45 sn ekran kaydı + yüz/ses), carousel (6–8 kart: ipucu, önce/sonra), hikâye (anket, soru kutusu, link çıkartması), haftalık canlı yayın (4. hafta).
- **Sıklık:** Haftada 4 akış paylaşımı (3 Reel + 1 carousel), her gün en az 2 hikâye.
- **En iyi saatler (test et):** Hafta içi 12:30 ve 20:30, hafta sonu 11:00.
- **Hashtag:** Paylaşım başına 5–8 (aşağıdaki setlerden). İlk yorumda değil, açıklamanın sonunda.
- **Yapma:** Etsy/eBay/Amazon logosu, gerçek müşteri ekranı, "satış garantisi", gelir ekran görüntüsü, sahte yorum, rakip karalama, takipçi satın alma, yorum-takip botları.

## 2. Facebook (sayfa + gruplar)

**Sayfa**
- **Kitle:** 30–55 yaş, Facebook'ta aktif kalan esnaf/tacir, e-ihracat meraklısı KOBİ sahipleri.
- **Hedef:** Instagram içeriğinin yeniden kullanımı + reklam hesabı için sosyal kanıt (sayfa boş görünmesin).
- **Formatlar:** Reels (Instagram'dan çapraz paylaşım), uzun açıklamalı link paylaşımı (blog yazıları), etkinlik (canlı demo).
- **Sıklık:** Haftada 3.

**Gruplar (asıl değer burada)**
- **Kitle:** "Etsy Türkiye", "e-ihracat", "mikro ihracat", "Trendyol satıcıları", "eBay/Amazon satıcıları" grupları (bkz. communities.csv; Facebook gruplarının çoğu arama motorunda görünmüyor, Facebook içinden aranmalı).
- **Hedef:** Güvenilir uzman kimliği → yönetici iş birliği (outreach-messages.md).
- **Format:** Önce **soru cevaplamak**. Kişisel profilden (kurucu veya sen, "KolayXport'ta çalışıyorum" bilgisi profilde açık), link vermeden, ekran görüntüsüyle yardım. Haftada 1 kez, grup kuralları izin veriyorsa, faydalı bir rehber paylaşımı (blog linki `utm_medium=community`).
- **Sıklık:** Haftada 15 faydalı cevap, en fazla 2 kendi paylaşımı (izin verilen gruplarda).
- **Yapma:** Grup kurallarını okumadan paylaşım; aynı metni birden çok gruba yapıştırmak; üyelere toplu DM; "bizim uygulama şunu yapıyor" diye her cevaba ürün sokmak (10 cevaptan en fazla 2'sinde ürün geçsin); yönetici izni olmadan indirim kodu; başka bir üyeyi/rakibi kötülemek.

## 3. X (Twitter)

- **Kitle:** E-ticaret ekosistemi (girişimciler, e-ticaret yazarları, muhasebeciler, e-ihracat danışmanları), teknoloji meraklısı satıcılar, gazeteciler.
- **Hedef:** Kurucu görünürlüğü, ekosistemde bilinirlik, haber/gündem (gümrük kuralları, Etsy değişiklikleri) üzerinden uzmanlık.
- **Formatlar:** 5–8 tweetlik flood (thread), tek görselli ipucu, kısa ekran kaydı (≤ 45 sn), gündem yorumu (yalnızca e-ticaret/e-ihracat).
- **Sıklık:** Haftada 5 (3 tekil + 2 flood). Kurucu hesabından alıntılanması tercih edilir.
- **Not:** X reklam yasağı Türkiye'de Mayıs 2024'te kalktı; reklam için ilk ayda öncelik değil (ads-playbook.md).
- **Yapma:** Siyasi gündem, kavga, rakip markayı etiketleyip laf sokmak, trend hashtag'e alakasız giriş.

## 4. YouTube

- **Kitle:** "etsy seo nasıl yapılır", "etsy'de ne satılır", "ebay'de satış", "mikro ihracat etgb" diye arayan, öğrenme modundaki satıcılar. Türkçe e-ticaret eğitimi YouTube'da çok izleniyor (communities.csv'deki eğitmen kanalları).
- **Hedef:** Arama trafiği + **video kütüphanesi** (uygulama içi yardım ve `/nasil-kullanirim/*` sayfaları bu videolara bağlanacak). Sitede kırık `youtube.com/kolayxport` linki var (site-audit S-1): kanal adresi alınınca footer düzeltilmeli.
- **Formatlar:**
  - **Eğitim serisi (12 video, 3–8 dk, yatay):** V01 Etsy mağazanı bağla · V02 AI ile ilan optimizasyonu · V03 Toplu düzenleme · V04 AI ürün fotoğrafı · V05 Anahtar kelime araştırması · V06 Arbitraj taraması (Trendyol→eBay) · V07 FedEx/UPS etiketi · V08 ETGB dosyası + Paraşüt · V09 Stok senkronu · V10 Finans paneli (net kâr) · V11 Mesaj kutusu AI yanıt · V12 Chrome eklentisi.
  - **Shorts:** Her eğitim videosundan 2 adet 30–45 sn kesit.
  - **Canlı:** 4. haftada 1 canlı demo (IG ile eş zamanlı veya ayrı).
- **Sıklık:** Haftada 2–3 eğitim videosu (30 günde 10–12), haftada 4 Shorts.
- **Video kuralları:** Başlıkta arama terimi ("Etsy SEO: yapay zekâ ile başlık ve etiket nasıl yazılır | KolayXport"), ilk 15 sn'de sonuç, bölümler (chapter), açıklamada UTM'li link + şu satır: *"The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy."* (Etsy API şartı, legal-notes.md §5).
- **Kapılı videolar (gate):** V08 yalnızca ETGB düzeltmesi **canlıya** alındıktan sonra; V12 yalnızca eklenti Chrome Web Mağazası'nda yayınlandıktan sonra; V09 ve V11 başlığında "(Beta)" yazar; V06 ve V10 "Pro planda, 14 günlük denemede açık" der.
- **Yapma:** eBay/Etsy/Amazon logosu küçük resimde (thumbnail); "ayda $10.000" gibi gelir başlıkları; tıklama tuzağı küçük resim.

## 5. TikTok

- **Kitle:** 18–34, "evden ek gelir", "Etsy'de ne satılır", "dijital ürün", "POD" meraklıları; Trendyol satıcılarının genç kesimi.
- **Hedef:** Erişim ve marka hatırlanırlığı; yaratıcı test (hangi hook tutuyor). Doğrudan kayıt beklentisi düşük.
- **Formatlar:** 15–35 sn, yüz + ekran (yeşil ekran efektiyle uygulama arkada), "3 hata", "bunu bilmeden Etsy'ye başlama", önce/sonra ilan, satıcı cümlesine "dikiş" (stitch) yerine kendi seslendirmeyle tepki.
- **Sıklık:** Haftada 4 (Instagram Reels ile aynı ham video, TikTok'a özel ilk 2 saniye ve yazı).
- **Yapma:** "Pasif gelir", "zengin ol", gelir ekranı, "kolay para" dili (TikTok ve Meta finansal iddia politikaları, legal-notes.md §4). Telif müzik (yalnızca TikTok ticari müzik kütüphanesi).

## 6. LinkedIn

- **Kitle:** E-ihracat ekosistemi: muhasebeciler/mali müşavirler, gümrük müşavirleri, e-ihracat danışmanları, kargo/lojistik firmaları (ShipEntegra, FedEx/UPS satış ekipleri), Paraşüt gibi ortak adayları, yatırımcılar, KOBİ sahipleri.
- **Hedef:** **Ortaklık ve yönlendirme** (müşavirler müşterilerine önerir), kurucu güvenilirliği, yatırımcı görünürlüğü.
- **Formatlar:** Kurucu profilinden metin + 1 görsel/belge (PDF karusel), "öğrendiklerim" yazıları, sektör verisi yorumu (ör. "Mikro ihracat 10 yılda 15 kat büyüdü" haberini kaynakla yorumlamak), ürün güncellemesi.
- **Sıklık:** Haftada 2 (kurucu profili), şirket sayfası paylaşımı yeniden paylaşır.
- **Yapma:** Bağlantı isteğiyle birlikte satış mesajı; toplu InMail; rakip karşılaştırması.

## 7. Kanallar arası akış / Repurposing flow

1. Pazartesi: 1 YouTube eğitim videosu çekilir (yatay, 3–8 dk).
2. Aynı kayıttan: 2 Reels/TikTok/Shorts (dikey kesit), 1 carousel (ekran görüntüleri), 1 X flood (adımlar), 1 LinkedIn yazısı (neden önemli).
3. Topluluklarda: o haftanın sorusuna cevap yazarken gerekiyorsa videonun ilgili dakikası (link `utm_medium=community`).

## 8. Hashtag setleri / Hashtag sets

- **A · Etsy:** `#etsy #etsytürkiye #etsysatıcısı #etsyseo #elyapımı #handmade #etsyshop #kadıngirişimci`
- **B · E-ihracat:** `#eihracat #mikroihracat #ihracat #etgb #eticaret #yurtdışınasatış #kobi`
- **C · Pazaryerleri:** `#ebay #ebaysatıcısı #trendyolsatıcısı #pazaryeri #amazonsatıcısı #crosslisting`
- **D · AI / araçlar:** `#yapayzeka #yapayzekâ #aiaraçları #ürünfotoğrafı #seo #verimlilik`
- **E · Marka (her paylaşımda 1):** `#KolayXport`

Her paylaşım: E + iki setten toplam 5–7 etiket. X'te en fazla 2 hashtag. LinkedIn'de en fazla 3.

## 9. Ne paylaşılmaz / What NOT to post (bütün kanallar)

1. README §3 "Asla söyleme" listesindeki her şey.
2. Gerçek müşteri verisi (ad, adres, sipariş, vergi no), müşteri izni olmadan mağaza adı veya ekranı.
3. Uydurma veya doğrulanmamış rakam: kullanıcı sayısı, "%X daha fazla satış", tasarruf, ROI. Site ana sayfasındaki eski "$18.4K", "4.9★", "~142 aylık satış" maket rakamları **kullanılmaz**.
4. Etsy, eBay, Amazon, Trendyol, Shopify **logoları** (reklam ve organik görsellerde). İsimler yalnızca metin olarak (legal-notes.md §5). eBay sitesinin ekran görüntüsü eBay'in yazılı izni olmadan kullanılmaz.
5. Rakip adı (kurucu onayı olmadan), rakip hakkında olumsuz sıfat, Şikayetvar'daki rakip şikâyetlerini rakip adıyla paylaşmak.
6. Kalan kurucu üye kontenjanı ("son 3 yer!"), sahte geri sayım, sahte "bugün bitiyor" (legal-notes.md §3).
7. Gelir vaadi, "pasif gelir", "evden zengin ol", gelir/ödeme ekran görüntüsü.
8. Hesap kapatma, ödeme sorunu (Etsy ödemesi, Payoneer) için çözüm vaadi: KolayXport bunları çözmez (pain-points A1–A3). Bu konularda yalnızca bilgilendirici içerik, ürün iddiası yok.
9. Siyaset, din, felaket, kriz anlarında "fırsat" paylaşımı.
10. Başka hesapların içeriği (izin ve kaynak olmadan), telifli müzik, stok görsel izinsiz.

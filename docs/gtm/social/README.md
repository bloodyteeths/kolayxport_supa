# KolayXport sosyal medya ve topluluk kiti / Social & community kit

Hazırlanma tarihi: 2026-10-17. Bu klasör, pazarlama sorumlusunun her gün açıp kullanacağı çalışma kitidir. Talimatlar İngilizce + Türkçe, paylaşılacak metinler Türkçedir.
*Prepared 2026-10-17. Instructions are bilingual; everything that gets posted is Turkish.*

## 1. Dosyalar / Files

| Dosya | Ne işe yarar | Ne zaman açılır |
|---|---|---|
| [channel-strategy.md](channel-strategy.md) | Her kanalın kitlesi, hedefi, formatları, sıklığı, içerik sütunları, **yasaklı içerik** | İlk gün baştan sona oku; sonra şüphede kaldığında |
| [calendar-30d.md](calendar-30d.md) | 30 günlük lansman takvimi: hazır Türkçe metin, hashtag, görsel brief, UTM'li link | Her sabah, o günün satırı |
| [communities.csv](communities.csv) | Türk satıcı toplulukları ve eğitmen kanalları (doğrulanmış kamuya açık bilgi) | Haftalık topluluk turu, yeni topluluk eklerken |
| [outreach-messages.md](outreach-messages.md) | Grup yöneticisi / içerik üreticisi mesaj şablonları + takip dizisi | Yeni bir yöneticiye yazmadan önce |
| [outreach-tracker.csv](outreach-tracker.csv) | Her temasın kaydı (Google Sheets'e aktar) | Her mesajdan hemen sonra |
| [ads-playbook.md](ads-playbook.md) | 8 reklam konsepti, bütçe, test yapısı, ölçekle/kapat kuralları | Reklam açmadan önce (kurucu onayıyla) |
| [legal-notes.md](legal-notes.md) | İYS, tanıklık/yorum izni, influencer etiketi, platform politikaları, marka kullanımı, KVKK | Her yeni format veya iş birliğinden önce |
| [../roadmap.md](../roadmap.md) | Ürün eksikleri ve öncelik sırası (pazarlamanın neyi vaat edemeyeceğini de gösterir) | Bir özellik "var mı?" diye sorulduğunda |

Kaynak belgeler (iddia yazmadan önce): `docs/gtm/positioning.md` (A+C kararı), `docs/gtm/feature-inventory.md` (**tek doğruluk kaynağı**), `docs/gtm/pain-points.md` (satıcıların kendi cümleleri), `docs/gtm/competitors.md`, `docs/gtm/site-audit.md`.

## 2. Tek cümlelik konumlandırma / The one-liner

- **Marka:** "Yurt dışına satışın tek paneli." Etsy, eBay ve Amazon'da satan Türk satıcı için: ilanını yapay zekâyla İngilizce optimize et, ne satacağını veriyle bul, kargonu ve ETGB dosyanı aynı yerden hazırla.
- **Kampanya (ayrı hat):** "Trendyol'dan dünyaya." Trendyol'da sattığın ürünleri Etsy ve eBay'de de sat; stok tek yerden, ilanlar yapay zekâyla İngilizce.
- **Ses (docs/brand.md §7):** Kendi cümlelerimiz **"siz"** ile, sıcak ve somut; satıcı alıntıları kendi sözleriyle aynen. Aşağıdaki tablo içerik özetidir; paylaşım metnine dönüştürürken "siz" kullanın (ör. "düzenleyin", "görün"). Logo, renk ve görsel kuralları: channel-strategy.md §0.
- **Ton:** Somut sonuç, abartı yok. "En iyi", "tek", "#1", "garanti", "satışını katla" **yok**. Satış vaadi **yok** ("satış getirir" değil, "ilanındaki eksiği gösterir").

## 3. Söylenebilir / söylenemez hızlı tablo / Claims cheat sheet

Her iddia `feature-inventory.md` içindeki bir satıra dayanmalı. Bu tablo en sık kullanılanların özeti; listede yoksa **kurucuya sor**.

### Söyleyebilirsin (dayanağıyla)

| Söylenebilir | Dayanak (inventory ID) | Dikkat |
|---|---|---|
| Etsy ve eBay ilanlarını tek yerden düzenle, toplu düzenle | `etsy-listing-editor`, `etsy-bulk-editor`, `ebay-bulk-editor` | eBay'de Seller Hub'da açılmış eski ilanlar düzenlenemez: "tüm eBay ilanların" deme |
| Değişiklikler önce taslakta kalır, sen "Gönder" demeden pazaryerine gitmez | `staged-drafts-send` | Güçlü ve doğru, sık kullan |
| Yapay zekâ ile İngilizce başlık, açıklama, etiket (Etsy, eBay) ve Türkçe (Trendyol) | `ai-listing-copy`, `ai-bulk-optimize` | Shopify/Wix için AI yok |
| AI ürün görseli üretimi | `ai-image-gen` | "Profesyonel çekim yerine geçer" deme |
| İlan doktoru: ilanına SEO notu, rakiplerle karşılaştırma, tek tıkla düzeltme | `research-listing-doctor` | Satış vaadi yok |
| Anahtar kelime gezgini, ürün bulucu (Etsy, eBay, Trendyol) | `research-keywords`, `research-product-finder` | Amazon araştırma sekmesi kapalı: "Amazon ürün araştırması" deme |
| Trendyol→eBay fiyat farkı (arbitraj) taraması | `arbitrage-price-gap` | Pro planda; 14 günlük denemede açık |
| Etsy ↔ eBay tek tıkla ilan kopyalama | `crosslist-etsy-ebay` | Para birimi farklıysa fiyat boş gelir |
| Kendi FedEx / UPS hesabınla yurt dışı etiket, elektronik ticari fatura | `label-fedex`, `label-ups`, `customs-commercial-invoice` | "Ucuz kargo" deme; KolayXport kargo satmıyor. FedEx/UPS yurt içi yok |
| Yurt içi DHL eCommerce (MNG) etiketi, kapıda ödeme | `label-dhl-ecommerce` | Yurtiçi/Aras/Sürat **yok** |
| ETGB için Excel dosyası hazırlanır, müşavirine e-postayla gider | `etgb-excel-email` | **Yalnızca gtm/overhaul canlıya alındıktan sonra** (ihracatçı bilgisi kullanıcıya özel hale geldi). "ETGB beyanı yapıyoruz" **asla** |
| Çok kanallı stok senkronu (Etsy, eBay, Trendyol, Shopify) | `stock-sync` | **Beta**. "Wix'e stok yazar" deme; Amazon ve Hepsiburada yok |
| Komisyon, kargo, reklam ve maliyet düşülmüş net kâr (Etsy, eBay, Amazon, Trendyol) | `reports-profit` | Pro plan. Shopify/Wix finansı yok |
| Trendyol müşteri soruları ve Wix sohbeti için AI yanıt taslağı | `inbox-unified`, `ai-message-draft` | **Beta**. Etsy/eBay/Amazon mesajları **yok** |
| 14 gün ücretsiz deneme, kredi kartı gerekmez | site, `af08f85` | Canlıya alındıktan sonra. Deneme bitince otomatik ücret alınmaz |
| Kurucu üye fırsatı: ilk 20 ücretli aboneye ömür boyu %40 indirim | `d446f0a` (Stripe kuponu) | **Kalan kontenjan sayısı asla yazılmaz**; "ilk 20 abone" + /fiyatlandirma linki |
| Türkçe ve İngilizce arayüz, aylık ödeme | `settings-preferences`, `billing-checkout` | |

### Asla söyleme (feature-inventory §4)

- Hepsiburada / N11 / Çiçeksepeti entegrasyonu. "Tüm pazaryerleri", "tüm Türk kargo firmaları", Yurtiçi/Aras/Sürat/PTT etiketi.
- "ETGB'yi otomatik beyan ediyoruz", "gümrük beyannamesi", "otomatik e-Fatura/e-Arşiv kesimi".
- Amazon ilan veya stok yönetimi; Amazon ürün araştırması.
- "Etsy'ye takip numarası otomatik gider" (Chrome eklentisi gerekir); Trendyol/Shopify'a takip numarası otomatik yüklenir.
- "Chrome Web Mağazası'ndan yükleyin" (eklenti henüz mağazada değil).
- "Etsy, eBay, Amazon mesajları tek kutuda"; "AI asistan / sohbet"; "Telegram bildirimi".
- FedEx/UPS kargo takibi (durum güncellemesi), yurt içi FedEx/UPS, Shippo/Veeqo üzerinden indirimli etiket.
- "X AI kredisi dahil", "N mağaza bağla" gibi plan limitleri (sayılmıyor).
- Kullanıcı sayısı, müşteri sayısı, "binlerce satıcı", uydurma yorum/yıldız, sahte "örnek" gelir rakamı.
- "Satışını artırır/katlar", "ilk satış garantisi", "ShipEntegra'dan ucuz", "Türkiye'nin tek AI entegratörü".

## 4. Haftalık rutin / Weekly routine (≈ 1 saat/gün)

| Gün | İş | Süre |
|---|---|---|
| **Pazartesi** | Haftanın 7 gününü takvimden çek; görselleri/ekran kayıtlarını hazırla; **onay gerektirenleri** (bkz. §5) tek mesajda kurucuya gönder. Geçen haftanın raporunu tamamla. | 2 saat |
| Salı–Cuma | Günün paylaşımını yayınla (Meta Business Suite'te planla). Yayından sonraki ilk 60 dakika yorumlara cevap ver. Topluluk turu: 3 topluluğa **link olmadan** faydalı cevap yaz. `outreach-tracker.csv`'yi güncelle. | 45–60 dk |
| **Cuma** | Haftalık rapor (§6 KPI'lar) + en iyi/en kötü 2 paylaşım ve nedeni. Takip mesajları (outreach dizisinin 2. ve 3. adımı). | 1,5 saat |
| Hafta sonu | Takvimde ne varsa planlanmış olarak gider; sadece DM ve yorum kontrolü (günde 2 kez, 10 dk). | 20 dk |

**Ekran kayıtları:** Her zaman **demo hesabıyla** çek (`scripts/demo/seed-demo-account.ts` ile oluşturulan, tamamen kurgusal veriler). Gerçek müşteri adı, adres, sipariş, vergi no, e-posta **asla** görünmez. Tarayıcıda yer imleri çubuğunu gizle, bildirimleri kapat, 1080×1920 (dikey) ve 1920×1080 (yatay) çek.

**Linkler:** Paylaşmadan önce linki tarayıcıda aç; sayfa 404 veriyorsa (planlanan `/cozumler/*` sayfaları henüz yayında olmayabilir) aynı UTM parametreleriyle `https://kolayxport.com/fiyatlandirma` kullan ve takvime not düş.

**Instagram/TikTok linkleri:** Açıklamada link tıklanmaz. Biyografi linkini her gün o günün UTM'li linkiyle değiştir (veya Instagram'ın çoklu link özelliğine en üste ekle). Hikâyelerde link çıkartması kullan.

## 5. Onay kuralları / Approval rules (kurucu onayı gerekenler)

Aşağıdakilerden biri varsa paylaşmadan önce kurucuya (Atilla) gönder, **yazılı onay** al (WhatsApp/e-posta yeter, ekran görüntüsünü `outreach-tracker` notuna veya onay klasörüne koy):

1. §3'teki "Söyleyebilirsin" tablosunda olmayan **her yeni özellik iddiası**.
2. **Her rakam:** fiyat, indirim, süre, yüzde, kullanıcı/sipariş sayısı, tasarruf hesabı. (Fiyatların KDV dahil mi hariç mi olduğu henüz netleşmedi: fiyat yazan her paylaşım onaya tabi.)
3. **Rakip adı** geçen her içerik (karşılaştırma reklamı kuralları, bkz. legal-notes.md §3).
4. **Müşteri yorumu, müşteri adı, mağaza adı, müşteri ekran görüntüsü** (yazılı izin şart, bkz. legal-notes.md §2).
5. ETGB, e-Fatura/e-Arşiv, gümrük vergisi, KDV, IOSS gibi **vergi/gümrük** konuları.
6. Chrome eklentisi, Trendyol sipariş senkronu, mesaj kutusu, stok senkronu (bunlar beta veya henüz dağıtılmadı).
7. **İndirim kodu**, ortaklık, sponsorlu içerik, ücretli influencer, canlı yayın konuğu.
8. **Reklam bütçesi** açma/artırma (her değişiklik), yeni reklam konsepti.
9. Şikâyet, iade, hesap kapatma, ödeme sorunu, KVKK talebi içeren yorum veya DM'ye **ilk cevap dışında** her şey (ilk cevap: "Merhaba, bunu hemen ekibimize iletiyorum, destek@kolayxport.com üzerinden size dönüş yapacağız.").
10. Siyasi, dini, felaket, gündem olaylarına değinen her şey: **paylaşma**.

Onaysız paylaşılabilir: takvimde aynen yazılı metinler (kurucu takvimi bir kez onayladıktan sonra), link içermeyen topluluk cevapları (§3'e uyan), beğeni/teşekkür yanıtları.

## 6. KPI'lar ve nereden okunur / KPIs and where to read them

| Kanal | Haftalık izlenecek | İlk 30 gün hedefi (başlangıç tahmini, 2. haftada güncelle) | Nereden okunur |
|---|---|---|---|
| Instagram | Erişim, Reels izlenme, kaydetme, paylaşım, profil ziyareti, bio link tıklaması | Kaydetme oranı ≥ %2; bio link tıklaması ≥ 150 | Meta Business Suite › Analizler (Insights) |
| Facebook sayfa | Erişim, link tıklaması | Link tıklaması ≥ 100 | Meta Business Suite › Analizler |
| Facebook grupları | Yazdığın cevap sayısı, yöneticiden olumlu dönüş, grup içi DM'ler | 15 faydalı cevap/hafta; 3 yönetici görüşmesi | `outreach-tracker.csv` (manuel) |
| X | Gösterim, etkileşim oranı, link tıklaması, takipçi | Etkileşim ≥ %1,5 | X › Analytics (profil › Analytics) |
| YouTube | İzlenme, ortalama izlenme süresi, abone, açıklama link tıklaması | 12 eğitim videosu yayında; ort. izleme ≥ %35 | YouTube Studio › Analiz |
| TikTok | İzlenme, ortalama izleme süresi, profil ziyareti | 3 video ≥ 5.000 izlenme | TikTok Studio › Analytics |
| LinkedIn | Gösterim, tıklama, takipçi (kurucu profili + şirket sayfası) | 8 paylaşım; 1 B2B ortak görüşmesi | LinkedIn sayfa analizi |
| **Hepsi (asıl hedef)** | UTM'li oturum, **kayıt (sign_up)**, denemeden ücretliye geçiş | Kanal başına kayıt; deneme→ücretli ≥ %10 | **GA4** (Kurulduğunda: Edinme › Trafik edinme, `utm_campaign` filtresi). GA4 kurulana kadar: kayıttan sonra ilk e-postada "Bizi nereden duydunuz?" sorusu + kurucudan haftalık yeni kayıt listesi |
| Ücretli dönüşüm | Yeni abonelik, kurucu üye kuponu kullanımı | — | Stripe (yalnızca kurucu). /fiyatlandirma'daki canlı sayaç |

Not: Canlı sitede (2026-10-17 denetimi) analitik ve çerez onayı yok (site-audit P0-3/P0-4). `gtm/overhaul` dalında KVKK çerez banner'ı, Consent Mode v2, GTM yükleyici (`NEXT_PUBLIC_GTM_ID`) ve ilk temas UTM kaydı hazır (commit `d03421a`); canlıya alınıp GTM içine GA4 ve Meta/TikTok pikselleri eklenince veri gelmeye başlar. O güne kadar UTM'li linkleri yine kullanın; geriye dönük okunamaz ama sonrası ölçülür. Reklam (ücretli) **GA4 + Meta piksel + çerez onayı canlıda** olmadan açılmaz (ads-playbook.md §1).

## 7. UTM kuralı / UTM rule

```
https://kolayxport.com/<sayfa>?utm_source=<kanal>&utm_medium=<social|paid|community>&utm_campaign=launch_2026q4_<tema>&utm_content=<post-id>
```

- `utm_source`: `instagram` · `facebook` · `x` · `youtube` · `tiktok` · `linkedin` (küçük harf, Türkçe karakter yok).
- `utm_medium`: `social` (kendi organik paylaşımımız) · `paid` (reklam) · `community` (grup, forum, yönetici/üretici paylaşımı).
- `utm_campaign`: `launch_2026q4_` + tema: `brand`, `founding`, `etsy_seo`, `ai_photo`, `bulk_edit`, `research`, `arbitrage`, `crosslist`, `trendyol_dunya`, `export_ops`, `stock_sync`, `finance`, `inbox`, `extension`.
- `utm_content`: post kimliği, ör. `d02-ig-reel`. Kanal kısaltmaları: `ig`, `fb`, `x`, `yt`, `tt`, `li`, `grp` (grup), `cr` (içerik üreticisi). Reklamda: `ad-c1-v1` (konsept 1, varyasyon 1).

Takvimdeki her paylaşımda Instagram linki tam yazılıdır. Aynı paylaşımı başka kanala koyarken **yalnızca** `utm_source` ve `utm_content` içindeki kanal kısaltmasını değiştir.

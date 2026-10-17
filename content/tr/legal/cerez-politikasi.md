---
title: "Çerez Politikası | KolayXport"
description: "KolayXport'ta hangi çerezlerin ve tarayıcı depolamasının kullanıldığını, analitik ve pazarlama çerezlerinin yalnızca onayınızla çalıştığını açıklar."
h1: "Çerez Politikası"
keyword: "kolayxport çerez politikası"
updated: 2026-10-17
effective: 2026-10-17
lawyerReviewed: false
inventoryRefs: []
---

Bu politika, MODSONS YAZILIM E-TİCARET İTHALAT İHRACAT LİMİTED ŞİRKETİ'nin ("KolayXport", "biz") kolayxport.com web sitesinde ve KolayXport uygulamasında kullandığı çerezleri ve benzeri teknolojileri açıklar. Kişisel verilerinizin işlenmesine ilişkin genel bilgi için [KVKK Aydınlatma Metni](/kvkk-aydinlatma-metni)'ni ve [Gizlilik Politikası](/gizlilik-politikasi)'nı inceleyebilirsiniz.

## 1. Çerez ve benzeri teknolojiler nedir?

Çerez, ziyaret ettiğiniz web sitesinin tarayıcınıza kaydettiği küçük bir metin dosyasıdır. Tarayıcının **yerel depolaması** (localStorage) ve **oturum depolaması** (sessionStorage) da benzer şekilde tarayıcınızda bilgi saklar. Bu politikada hepsine kısaca "çerez" diyoruz.

## 2. Çerez kategorileri

Çerezleri üç kategoride kullanırız:

| Kategori | Ne işe yarar | Onay gerekir mi? |
|---|---|---|
| **Zorunlu** | Giriş yapmanızı, oturumunuzun güvenle sürmesini, hesap bağlamanın güvenliğini ve tercihlerinizin hatırlanmasını sağlar. Bunlar olmadan hizmet çalışmaz. | Hayır. KVKK md. 5/2-c (sözleşmenin ifası) ve md. 5/2-f (meşru menfaat) kapsamında kullanılır. |
| **Analitik** | Sitenin nasıl kullanıldığını toplu olarak ölçer. | Evet, açık rızanız. |
| **Pazarlama** | Reklam kampanyalarımızın sonuçlarını ölçer ve reklamları ilgili kitlelere göstermemize yardım eder. | Evet, açık rızanız. |

## 3. Bugün kullandığımız zorunlu çerezler

| Ad | Tür | Amaç | Süre |
|---|---|---|---|
| `__Secure-next-auth.session-token` (yerel geliştirmede `next-auth.session-token`) | Çerez, HttpOnly | Oturumunuzu güvenli şekilde tutar | En fazla 30 gün |
| `__Host-next-auth.csrf-token` | Çerez, HttpOnly | Siteler arası istek sahteciliğine (CSRF) karşı koruma | Tarayıcı oturumu |
| `__Secure-next-auth.callback-url` | Çerez | Girişten sonra doğru sayfaya dönmenizi sağlar | Tarayıcı oturumu |
| `next-auth.state`, `next-auth.pkce.code_verifier` (güvenli önekli) | Çerez, HttpOnly | Google ile girişin güvenliği | Yaklaşık 15 dakika |
| `ebay_csrf`, `amazon_csrf` | Çerez, HttpOnly | eBay veya Amazon hesabı bağlarken güvenlik doğrulaması | 10 dakika |
| `cookie-consent` | Yerel depolama | Çerez tercihinizi hatırlar | Siz silene kadar |
| `kolayxport_locale` | Yerel depolama | Dil tercihinizi (Türkçe/İngilizce) hatırlar | Siz silene kadar |
| `kx.*`, `kx_*` ve benzeri uygulama anahtarları | Yerel / oturum depolaması | Uygulamada yaptığınız seçimleri (tablo sütunları, kayıtlı görünümler, son aramalar, kapatılan uyarılar, sipariş sesi ayarı, kaydedilmemiş taslaklar) cihazınızda hatırlar | Yerel depolamada siz silene kadar; oturum depolamasında sekme kapanana kadar |

Bu çerezler yalnızca KolayXport'un kendi alan adında çalışır ve reklam amacıyla kullanılmaz. Yerel depolamadaki uygulama tercihleri sunucumuza gönderilmez.

## 4. Analitik ve pazarlama çerezleri

Bu politikanın yürürlük tarihi itibarıyla sitede analitik veya pazarlama çerezi **kullanılmamaktadır**. İleride aşağıdaki araçları kullanmayı planlıyoruz:

- **Google Tag Manager ve Google Analytics 4** (Google LLC) — analitik,
- **Meta Pixel ve Meta Dönüşümler API'si** (Meta Platforms Ireland Ltd. / Meta Platforms, Inc.) — pazarlama,
- **X (Twitter) etiketi**, **TikTok Pixel**, **LinkedIn Insight Tag** — pazarlama.

Bu araçlar yalnızca ilgili kategoriye **açık rıza vermenizden sonra** çalışır. Google araçlarında Google'ın İzin Modu v2'sini (Consent Mode v2) kullanırız: onay vermeden önce analitik ve reklam depolama izinleri "reddedildi" durumundadır ve bu araçların etiketleri onayınız olmadan yüklenmez. [TODO(owner): Consent Mode'un "temel (basic)" modda kurulduğunu, yani onaydan önce çerezsiz ping dahil hiçbir isteğin gönderilmediğini teyit edin]

**Meta Dönüşümler API'si** sunucudan sunucuya çalışır: pazarlama çerezlerine onay verdiyseniz, kayıt veya satın alma gibi olaylar, e-posta adresiniz gibi tanımlayıcılar tek yönlü özetlenmiş (hash) hâlde Meta'ya iletilebilir. Onay vermediyseniz bu olaylar gönderilmez.

Bu araçların sağlayıcıları yurt dışında bulunduğundan, onay vermeniz yurt dışına aktarımı da kapsar. Aktarımın hukuki dayanağı [KVKK Aydınlatma Metni](/kvkk-aydinlatma-metni)'nin 7. bölümünde açıklanmıştır.

Bu araçlar devreye alındığında, her birinin çerez adı ve süresi bu tabloya eklenecektir. [TODO(owner): araçlar devreye alınınca çerez adları ve süreleri tablosunu ekleyin]

## 5. Üçüncü taraf hizmetlerin kendi çerezleri

Google ile giriş yaptığınızda, Stripe'ın ödeme sayfasında ödeme yaptığınızda veya bir pazaryeri hesabını bağlamak için o pazaryerinin giriş sayfasına yönlendirildiğinizde, bu sayfalar ilgili şirketin alan adındadır ve o şirketin kendi çerezleri ile çerez politikası geçerlidir. Bu çerezleri biz yerleştirmeyiz ve okuyamayız.

## 6. KolayXport Chrome uzantısı

Chrome uzantısını kurarsanız, uzantı KolayXport oturumunuzu tanımak ve ayarlarını saklamak için tarayıcının uzantı depolamasını ve KolayXport alan adındaki oturum çerezini kullanır. Uzantı reklam veya izleme çerezi yerleştirmez.

## 7. Tercihlerinizi nasıl değiştirirsiniz?

- **Çerez tercihleri paneli:** Siteye ilk girişinizde çıkan bildirimde zorunlu dışındaki kategorileri tek tek kabul veya reddedebilirsiniz. Kararınızı dilediğiniz zaman sitenin alt kısmındaki **"Çerez Tercihleri"** bağlantısından değiştirebilir veya onayınızı geri alabilirsiniz. [TODO(owner): kategori bazlı onay paneli ve alt bilgideki "Çerez Tercihleri" bağlantısı yayımlanmadan önce hazır olmalı; bugünkü bildirim yalnızca "Kabul et" düğmesi içeriyor]
- **Tarayıcı ayarları:** Çerezleri ve site verilerini tarayıcınızın ayarlarından silebilir veya engelleyebilirsiniz. Zorunlu çerezleri engellerseniz giriş yapamayabilir veya uygulamayı kullanamayabilirsiniz.
- **Reklam tercihleri:** Google, Meta ve diğer platformların kendi reklam ayarları sayfalarından kişiselleştirilmiş reklam tercihlerinizi yönetebilirsiniz.

Onayınızı geri almanız, geri almadan önce yapılan işlemlerin hukuka uygunluğunu etkilemez.

## 8. Değişiklikler ve iletişim

Kullandığımız çerezler değiştiğinde bu politikayı güncelleriz; sayfanın başındaki tarih son güncellemeyi gösterir. Sorularınız için destek@kolayxport.com adresine yazabilirsiniz.

---
title: Claude veya ChatGPT'yi KolayXport mağazanıza bağlayın | KolayXport
description: >-
  Claude veya ChatGPT'ye Etsy, eBay, Amazon ve Trendyol siparişlerinizi, ilanlarınızı, satış ve kesintilerinizi sorun; ilan taslaklarını ona hazırlatın.
h1: Claude veya ChatGPT'yi KolayXport mağazanıza bağlayın
keyword: claude chatgpt etsy entegrasyonu
updated: '2026-10-18'
inventoryRefs:
  - ai-connector-mcp
draft: false
order: 20
steps:
  - name: Bağlayıcıyı ekleyin
    text: >-
      Claude'da Ayarlar › Bağlayıcılar'ı açın; KolayXport'u dizinden ekleyin ya da Özel bağlayıcı ekle'yi seçip
      https://kolayxport.com/api/mcp adresini girin. ChatGPT'de KolayXport'u Ayarlar › Uygulamalar'dan ekleyin.
  - name: Giriş yapıp izin verin
    text: >-
      Claude veya ChatGPT sizi kolayxport.com'a yönlendirir. KolayXport hesabınızla giriş yapın ve yapay zekânın neler
      yapabileceğini onaylayın: mağaza verilerinizi okumak ve isterseniz ilan taslakları hazırlamak. Alıcı adlarını ve
      teslimat adreslerini paylaşmak ayrı bir onay kutusudur ve kapalı gelir.
  - name: Mağazanızı sorun
    text: >-
      Günlük dille sorun, örneğin "Son Etsy siparişim neydi, neden ilan fiyatından ucuza satıldı?" Yapay zekâ doğru
      KolayXport aracını seçer ve senkronlanmış verilerinizden yanıt verir.
  - name: Taslakları KolayXport'ta onaylayın
    text: >-
      Yapay zekâ yeni bir başlık, etiket, fiyat veya stok önerdiğinde yalnızca taslak kaydeder. İlanı KolayXport'ta açın,
      değişikliği kontrol edin ve pazaryerine kendiniz gönderin.
faq:
  - q: KolayXport hesabı gerekiyor mu?
    a: >-
      Evet. Bağlayıcı kendi KolayXport hesabınızla ve orada bağladığınız pazaryerleriyle çalışır. Ücretsiz deneme dahil
      her plan yapay zekâ bağlayabilir.
  - q: Yapay zekâ Etsy veya eBay'deki ilanımı değiştirebilir mi?
    a: >-
      Hayır. Yazma araçları yalnızca KolayXport içinde taslak oluşturur. Taslağı KolayXport'ta açıp göndermediğiniz
      sürece pazaryerinde hiçbir şey değişmez.
  - q: Yapay zekâ alıcılarımın adını ve adresini görür mü?
    a: >-
      Varsayılan olarak hayır; siparişlerde yalnızca alıcının ülkesi görünür. Bağlarken "Alıcı adlarını ve teslimat
      adreslerini paylaş" kutusunu işaretleyebilirsiniz. Amazon alıcı bilgileri, e-posta adresleri ve telefon numaraları
      hiçbir zaman paylaşılmaz.
  - q: Bağlantıyı nasıl kaldırırım?
    a: >-
      Bağlayıcıyı Claude'dan veya ChatGPT'den kaldırın ya da KolayXport'ta Ayarlar › Yapay zekâ'dan bağlantıyı iptal edin.
      İptal edilen bağlantı hemen çalışmaz hâle gelir.
---

KolayXport bağlayıcısı, Claude ve ChatGPT'nin KolayXport hesabınızdaki verilerle çalışmasını sağlar: bağladığınız tüm
pazaryerlerinden gelen siparişler, ilanlarınız ve stoklarınız, satış toplamları, pazaryeri kesintileri ve ödemeler.
KolayXport'un daha önce senkronladığı verileri okur; yanıtlar hızlıdır ve pazaryerlerinin API limitlerini harcamaz.

**Bağlayıcı adresi:** `https://kolayxport.com/api/mcp` (Streamable HTTP, OAuth 2.1). Diğer MCP istemcileri Ayarlar ›
Yapay zekâ'dan oluşturacağınız kişisel anahtarla da bağlanabilir.

## Neler sorabilirsiniz

- "Son Etsy siparişim neydi; indirim, kargo ve vergi ne kadardı?"
- "Son 30 günde hangi pazaryerinden kaç sipariş aldım, hangi ülkelerden?"
- "Etsy geçen ay ne kadar kesinti yaptı, Etsy ödeme hesabımdaki bakiye ne kadar?"
- "Hangi ilanlarımın stoğu bitmek üzere?"
- "Pembe tütü elbise ilanımı incele, daha iyi bir başlık ve etiketler öner, taslak olarak kaydet."

## Veri ve gizlilik

- Yapay zekâ yalnızca kendi hesabınızı görür; her istek giriş yaptığınız KolayXport hesabıyla sınırlıdır.
- Alıcı adları ve teslimat adresleri yalnızca bağlarken kutuyu işaretlerseniz paylaşılır. Amazon alıcı bilgileri,
  e-posta adresleri ve telefon numaraları hiçbir zaman paylaşılmaz.
- KolayXport hangi aracın ne zaman çağrıldığını kaydeder, yanıtların içeriğini kaydetmez.
- Neyi ne kadar süre sakladığımız için [gizlilik politikasına](https://kolayxport.com/gizlilik-politikasi) bakın.

## Destek

destek@kolayxport.com adresine yazın veya https://kolayxport.com/iletisim sayfasını kullanın.

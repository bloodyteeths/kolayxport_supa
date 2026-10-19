---
title: "Etsy Entegrasyonu: İlan, Sipariş, Stok | KolayXport"
description: "Etsy mağazanızı bağlayın: ilan oluşturma ve toplu düzenleme, yapay zekâ ile SEO, sipariş senkronu, stok eşitleme ve FedEx/UPS etiketi."
h1: "Etsy entegrasyonu"
keyword: "etsy entegrasyonu"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-etsy, ext-etsy-address, etsy-listing-editor, etsy-listing-create, etsy-bulk-editor, bulk-photo-studio, stock-sync, tracking-push-etsy, ext-etsy-tracking, label-fedex, label-ups, reports-profit, inbox-unified, research-keywords, ext-etsy-research, etsy-copy-to-shop]
draft: false
name: "Etsy"
kind: marketplace
status: production
setupMinutes: 3
connect: "OAuth: Ayarlar › Bağlantılar'da Etsy hesabınızla giriş yapıp izin verirsiniz. Birden fazla mağaza bağlanabilir."
capabilities:
  - label: "Sipariş senkronizasyonu"
    status: "yes"
    note: "Etsy API alıcı adresini vermez; tam adres için Chrome eklentisi gerekir"
    ref: order-sync-etsy
  - label: "İlan oluşturma ve düzenleme"
    status: "yes"
    note: "Başlık, etiket, varyasyon, kişiselleştirme, fotoğraf, video, kargo ve iade profilleri"
    ref: etsy-listing-editor
  - label: "Toplu düzenleme"
    status: "yes"
    note: "Başlık, fiyat, adet, bölüm, etiket; toplu fotoğraf stüdyosu Pro"
    ref: etsy-bulk-editor
  - label: "Stok senkronu"
    status: "yes"
    note: "Beta; Etsy değişiklikleri yaklaşık 1 dakikada gelir"
    ref: stock-sync
  - label: "Takip numarası gönderme"
    status: "partial"
    note: "Yalnızca Chrome eklentisi açıkken Etsy'ye girilir"
    ref: tracking-push-etsy
  - label: "Kargo etiketi"
    status: "yes"
    note: "Kendi FedEx/UPS hesabınızla yurt dışı, DHL eCommerce ile yurt içi; Etsy Postage yok"
    ref: label-fedex
  - label: "Finans ve kâr"
    status: "yes"
    note: "Reklam harcaması dahil; Pro özelliği"
    ref: reports-profit
  - label: "Mesajlar"
    status: "no"
    note: "Etsy mesajları panelde görünmez"
    ref: inbox-unified
  - label: "Araştırma"
    status: "yes"
    note: "Ürün bulucu, anahtar kelime, ilan doktoru, rakip takibi"
    ref: research-keywords
  - label: "Eklenti katmanı"
    status: "partial"
    note: "Etsy sayfalarında çalışır; Chrome Web Mağazası'ndan kurulur"
    ref: ext-etsy-research
faq:
  - q: "Birden fazla Etsy mağazamı bağlayabilir miyim?"
    a: "Evet. Her mağazayı ayrı ayrı bağlarsınız ve ilanları bir mağazadan diğerine varyasyon, fotoğraf ve videosuyla kopyalayabilirsiniz."
  - q: "Düzenlediğim ilan hemen Etsy'de değişir mi?"
    a: "Hayır. Değişiklikler önce taslakta kalır; 'Gönder'e bastığınızda ya da planladığınız saatte Etsy'ye gider. İlan bu arada Etsy'de değiştiyse gönderim durur."
  - q: "Etsy siparişlerinde adres neden eksik?"
    a: "Etsy API'si alıcı adresini ve e-postasını paylaşmıyor. Tam adres Chrome eklentisiyle aktarılır. Eklentiyi Chrome Web Mağazası'ndan kurabilirsiniz."
  - q: "Etsy mesajlarını yanıtlayabilir miyim?"
    a: "Şu an hayır. Mesaj kutusu yalnızca Trendyol müşteri sorularını ve Wix sohbetlerini kapsıyor."
---

## Neler çalışıyor

Etsy, KolayXport'ta en kapsamlı entegrasyon. İlanlarınızın neredeyse her alanını panelden düzenlersiniz: başlık, açıklama, etiketler, fiyat, kategori özellikleri, varyasyonlar ve varyasyon görselleri, kişiselleştirme, fotoğraf sırası ve alt metinleri, video, bölümler, kargo ve iade profilleri. Yeni ilan oluşturabilir, ilanları yenileyebilir, pasife alabilir, kopyalayabilirsiniz. Tüm değişiklikler önce taslakta durur; yanlış bir düzenlemeyi ilan sürüm geçmişinden geri alırsınız.

Siparişler diğer kanallarınızla aynı listeye gelir. Kendi FedEx veya UPS hesabınızla yurt dışı etiketi basarsınız. Finans tarafında Etsy kesintileri ve reklam harcaması kâr raporuna yansır (Pro).

## Kurulum

1. Ayarlar › Bağlantılar'da Etsy kutusundan "Bağlan"a basın.
2. Etsy'de hesabınızla giriş yapıp KolayXport'a izin verin.
3. İlanlarınız ve siparişleriniz panele gelir. Başka mağazanız varsa aynı adımları tekrarlayın.

## Sınırlar

- Etsy API'si alıcı adresi ve e-postasını vermez; bunlar ve Etsy'ye takip numarası aktarımı KolayXport Chrome eklentisine bağlıdır.
- Etsy mesajları panelde yok.
- Etsy'nin kendi kargo etiketi (Etsy Postage) desteklenmiyor.
- Stok senkronu beta aşamasında ve siz sihirbazı tamamlayıp canlıya alana kadar kapalıdır.

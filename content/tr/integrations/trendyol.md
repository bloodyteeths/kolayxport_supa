---
title: "Trendyol Entegrasyonu: Ürün, Stok, Soru-Cevap | KolayXport"
description: "Trendyol mağazanızı API anahtarıyla bağlayın: ürün oluşturma ve toplu düzenleme, Türkçe yapay zekâ, stok eşitleme, müşteri soruları ve kâr raporu."
h1: "Trendyol entegrasyonu"
keyword: "trendyol entegrasyon"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-trendyol, trendyol-products, ai-listing-copy, stock-sync, label-dhl-ecommerce, reports-profit, inbox-unified, ai-message-draft, arbitrage-price-gap, research-product-finder]
draft: false
name: "Trendyol"
kind: marketplace
status: beta
setupMinutes: 5
connect: "API bilgileri: Trendyol satıcı panelinden aldığınız API Key, API Secret ve Satıcı ID'yi Ayarlar › Bağlantılar'a girersiniz."
capabilities:
  - label: "Sipariş senkronizasyonu"
    status: "partial"
    note: "Beta; hesabınız için ayrıca açılması gerekebilir"
    ref: order-sync-trendyol
  - label: "Ürün oluşturma ve düzenleme"
    status: "yes"
    note: "Oluşturma, düzenleme, fiyat/stok, arşiv; Türkçe yapay zekâ"
    ref: trendyol-products
  - label: "Toplu düzenleme"
    status: "yes"
    note: "Başlık, fiyat ve adet"
    ref: trendyol-products
  - label: "Stok senkronu"
    status: "yes"
    note: "Beta; yaklaşık 3 dakikada bir kontrol edilir"
    ref: stock-sync
  - label: "Takip numarası gönderme"
    status: "no"
    note: "Girilen numara yalnızca KolayXport'ta saklanır"
  - label: "Kargo etiketi"
    status: "yes"
    note: "DHL eCommerce (MNG Kargo) ile yurt içi"
    ref: label-dhl-ecommerce
  - label: "Finans ve kâr"
    status: "yes"
    note: "Reklam harcaması hariç; Pro özelliği"
    ref: reports-profit
  - label: "Mesajlar"
    status: "partial"
    note: "Müşteri soruları, yapay zekâ yanıt taslağıyla; beta"
    ref: inbox-unified
  - label: "Araştırma"
    status: "partial"
    note: "Ürün bulucu ve Trendyol→eBay arbitraj kaynağı"
    ref: research-product-finder
faq:
  - q: "API bilgilerini nereden alırım?"
    a: "Trendyol satıcı panelinizdeki entegrasyon bilgileri bölümünden API Key, API Secret ve Satıcı ID'nizi kopyalayıp KolayXport'a yapıştırırsınız."
  - q: "Trendyol siparişlerine kargo takip numarası gidiyor mu?"
    a: "Hayır. Trendyol siparişine girdiğiniz numara yalnızca KolayXport'ta saklanır."
  - q: "Yeni ürün açmak için ne gerekiyor?"
    a: "Trendyol'un istediği marka, kategori, barkod, kargo firması ve sevkiyat/iade adresleri. Ürün Trendyol'a toplu iş olarak gider; sonucu arka planda tamamlanır ve panelde görünür."
  - q: "Neden beta?"
    a: "Trendyol sipariş senkronu ve mesaj kutusu sunucu tarafında ayrıca açılan özellikler. Ürün yönetimi bundan bağımsız çalışır."
---

## Neler çalışıyor

Trendyol ürünlerinizi KolayXport'ta oluşturur, düzenler, fiyat ve stoğunu günceller, arşive alırsınız. Türkçe yapay zekâ başlık ve açıklama yazar. Toplu düzenleyicide başlık, fiyat ve adedi tek tabloda değiştirirsiniz. Değişiklikler önce taslakta durur, "Gönder"e bastığınızda Trendyol'a gider.

Stok senkronu açıksa Trendyol stoğunuz Etsy, eBay ve Shopify ile aynı havuzdan beslenir. Mesaj kutusunda Trendyol müşteri sorularını yanıtlar, yapay zekâdan yanıt taslağı alırsınız. Finans senkronu Trendyol hakedişlerini ve kesintilerini kâr raporuna taşır (Pro). Trendyol ürünleri, arbitraj tablosunda eBay fiyatlarıyla karşılaştırılır.

Trendyol'da satıp yurt dışına açılmak isteyenler için Trendyol ürünlerinizi ve stoğunuzu Etsy ve eBay ile aynı yerde görmek işleri sadeleştirir. Hepsiburada, N11 ve Çiçeksepeti entegrasyonu olmadığı için mevcut entegratörünüzü bu kanallar için kullanmaya devam edebilirsiniz.

## Kurulum

1. Trendyol satıcı panelinden API Key, API Secret ve Satıcı ID'nizi alın.
2. Ayarlar › Bağlantılar › Trendyol'a bu bilgileri girip kaydedin.
3. Ürünleriniz Trendyol ürünleri sayfasında listelenir.

## Sınırlar

- Sipariş senkronu ve mesaj kutusu beta aşamasında ve hesabınız için ayrıca açılması gerekebilir.
- Trendyol'a takip numarası gönderilmez.
- Trendyol reklam harcaması kâr raporuna dahil değil.
- Yurt içi etiket yalnızca DHL eCommerce (MNG Kargo) ile; Trendyol Express, Yurtiçi, Aras etiketi yok.

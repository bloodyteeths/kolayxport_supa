---
title: "Shopify Entegrasyonu: Sipariş, Ürün, Stok | KolayXport"
description: "Shopify mağazanızı bağlayın: sipariş senkronu, ürün oluşturma ve toplu düzenleme, Etsy/eBay/Trendyol ile stok eşitleme, FedEx/UPS/DHL eCommerce etiketi."
h1: "Shopify entegrasyonu"
keyword: "shopify entegrasyonu"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-shopify, shopify-products, stock-sync, label-fedex, label-dhl-ecommerce, reports-profit, inbox-unified, ai-listing-copy, shopify-free]
draft: false
name: "Shopify"
kind: marketplace
status: partial
setupMinutes: 3
connect: "OAuth: KolayXport uygulamasını Shopify App Store'dan ya da Ayarlar › Bağlantılar'dan kurup mağazanız için izin verirsiniz."
capabilities:
  - label: "Sipariş senkronizasyonu"
    status: "yes"
    ref: order-sync-shopify
  - label: "Ürün oluşturma ve düzenleme"
    status: "partial"
    note: "Çok varyantlı ya da birden fazla lokasyonda stoklu ürünlerde fiyat/stok değiştirilemez"
    ref: shopify-products
  - label: "Toplu düzenleme"
    status: "yes"
    note: "Başlık, fiyat, adet ve etiketler"
    ref: shopify-products
  - label: "Stok senkronu"
    status: "yes"
    note: "Beta; yaklaşık 15 dakikada bir"
    ref: stock-sync
  - label: "Takip numarası gönderme"
    status: "no"
    note: "Girilen numara yalnızca KolayXport'ta saklanır"
  - label: "Kargo etiketi"
    status: "yes"
    note: "FedEx/UPS yurt dışı, DHL eCommerce yurt içi"
    ref: label-fedex
  - label: "Finans ve kâr"
    status: "no"
    note: "Shopify satışları satış raporunda görünür, kâr raporunda yok"
    ref: reports-profit
  - label: "Mesajlar"
    status: "no"
    ref: inbox-unified
  - label: "Yapay zekâ ile ilan yazımı"
    status: "no"
    ref: ai-listing-copy
faq:
  - q: "Shopify App Store'dan kurarsam ücret ödüyor muyum?"
    a: "Shopify App Store üzerinden kurulan mağazalar için KolayXport sipariş ve etiket limitleri olmadan ücretsizdir. Pro özellikleri bu kurulumda kapalıdır."
  - q: "Varyantlı ürünlerimi düzenleyebilir miyim?"
    a: "Ürün bilgilerini, görselleri ve SEO alanlarını düzenleyebilirsiniz. Çok varyantlı ürünlerde ve stoğu birden fazla lokasyona dağılmış ürünlerde fiyat ve stok değişikliği reddedilir."
  - q: "Takip numarası Shopify'a gönderiliyor mu?"
    a: "Henüz hayır. Shopify siparişine girdiğiniz numara yalnızca KolayXport'ta saklanır; gönderimi Shopify'da işaretlemeniz gerekir."
---

## Neler çalışıyor

Shopify siparişleriniz Etsy, eBay ve diğer kanallarınızla aynı listeye gelir ve FedEx, UPS ya da DHL eCommerce ile etiketlenir. Ürün tarafında yeni ürün oluşturur (taslak ya da aktif), ürün alanlarını, tek varyantlı ürünlerin fiyat, SKU ve stoğunu, görselleri ve SEO alanlarını düzenlersiniz. Toplu düzenleyicide başlık, fiyat, adet ve etiketleri tek tabloda değiştirirsiniz. Değişiklikler önce taslakta durur.

Stok senkronunu açarsanız Shopify stoğunuz Etsy, eBay ve Trendyol ile ortak havuzdan güncellenir.

Shopify'da kendi mağazası olan ve aynı ürünleri Etsy, eBay ya da Trendyol'da da satan satıcılar için uygundur. Siparişler ve stok tek listede toplanır, ürün güncellemeleri taslak olarak hazırlanıp sizin onayınızla Shopify'a gider. Shopify App Store'dan kurulan mağazalar için KolayXport sipariş ve etiket limitleri olmadan ücretsizdir.

## Kurulum

1. KolayXport'u Shopify App Store'dan kurun ya da Ayarlar › Bağlantılar'da Shopify kutusuna mağaza adresinizi (.myshopify.com) girin.
2. Shopify'ın izin ekranını onaylayın.
3. Siparişleriniz ve ürünleriniz panele gelir.

## Sınırlar

- Çok varyantlı ve çok lokasyonlu ürünlerde fiyat/stok düzenleme yok.
- Shopify ürünleri için yapay zekâ yazımı yok.
- Takip numarası Shopify'a gönderilmez.
- Shopify için finans ve kâr raporu yok.

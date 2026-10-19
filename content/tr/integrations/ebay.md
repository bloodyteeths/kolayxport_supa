---
title: "eBay Entegrasyonu: İlan, Sipariş, Takip No | KolayXport"
description: "eBay hesabınızı bağlayın: yapay zekâyla ilan oluşturma, toplu fiyat/adet, sipariş senkronu, otomatik takip numarası, stok eşitleme ve kâr raporu."
h1: "eBay entegrasyonu"
keyword: "ebay entegrasyonu"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-ebay, ebay-listing-create, ebay-listing-editor, ebay-bulk-editor, stock-sync, tracking-push-ebay, label-fedex, reports-profit, inbox-unified, research-keywords, ext-ebay-amazon-research, crosslist-etsy-ebay]
draft: false
name: "eBay"
kind: marketplace
status: production
setupMinutes: 3
connect: "OAuth: Ayarlar › Bağlantılar'da eBay hesabınızla giriş yapıp izin verirsiniz."
capabilities:
  - label: "Sipariş senkronizasyonu"
    status: "yes"
    ref: order-sync-ebay
  - label: "İlan oluşturma ve düzenleme"
    status: "partial"
    note: "Seller Hub'da açılmış eski ilanlar düzenlenemez, yalnızca yeni ilana kopyalanır"
    ref: ebay-listing-editor
  - label: "Toplu düzenleme"
    status: "yes"
    note: "Başlık, fiyat ve adet"
    ref: ebay-bulk-editor
  - label: "Stok senkronu"
    status: "yes"
    note: "Beta; Seller Hub'daki eski ilanlar hariç"
    ref: stock-sync
  - label: "Takip numarası gönderme"
    status: "yes"
    note: "UPS, FedEx, USPS, DHL, Royal Mail eşleşir; diğerleri 'Other' olarak gider"
    ref: tracking-push-ebay
  - label: "Kargo etiketi"
    status: "yes"
    note: "Kendi FedEx/UPS hesabınızla"
    ref: label-fedex
  - label: "Finans ve kâr"
    status: "yes"
    note: "Reklam harcaması dahil; Pro özelliği"
    ref: reports-profit
  - label: "Mesajlar"
    status: "no"
    ref: inbox-unified
  - label: "Araştırma"
    status: "yes"
    note: "Ürün bulucu, anahtar kelime, ilan doktoru, rakip takibi"
    ref: research-keywords
  - label: "Eklenti katmanı"
    status: "partial"
    note: "7 eBay alan adında çalışır; Chrome Web Mağazası'ndan kurulur"
    ref: ext-ebay-amazon-research
faq:
  - q: "Seller Hub'da açtığım ilanları neden düzenleyemiyorum?"
    a: "KolayXport eBay'in Inventory API'siyle çalışır ve eBay, Seller Hub'da açılmış ilanların bu yolla düzenlenmesine izin vermez. Bu ilanları yeni bir ilana kopyalayıp oradan yönetebilirsiniz."
  - q: "Etsy ilanımı eBay'e taşıyabilir miyim?"
    a: "Evet. Etsy ilan listesinde 'eBay'e kopyala' ile ilan fotoğraf ve varyasyonlarıyla eBay taslağına düşer. Para birimi farklıysa fiyatı siz girersiniz."
  - q: "Takip numarası eBay'e otomatik gider mi?"
    a: "Evet. Etiketi panelden bastığınızda ya da takip numarasını siparişe girdiğinizde eBay siparişine iletilir."
---

## Neler çalışıyor

eBay hesabınızı bağladığınızda siparişleriniz diğer kanallarınızla aynı listeye gelir. İlan stüdyosunda yapay zekâ başlığı, açıklamayı, ürün özelliklerini (item specifics) ve fiyat önerisini doldurur; ilanı yayınlar ya da eBay'de yayınlanmamış olarak kaydedersiniz. Varyasyonlu ilanlar, yayından kaldırma ve silme de panelden yapılır. Toplu düzenleyicide başlık, fiyat ve adedi tek tabloda değiştirirsiniz.

Kendi FedEx veya UPS hesabınızla bastığınız etiketin takip numarası eBay siparişine iletilir. Finans senkronu eBay satışlarınızı, kesintileri ve reklam harcamasını kâr raporuna taşır (Pro).

Etsy'de satıp eBay'e açılmak isteyen satıcılar için en kısa yol, Etsy ilanını tek tıkla eBay taslağına kopyalamaktır. Taslak doğrudan yayına girmez; kategoriyi, ürün özelliklerini ve fiyatı kontrol edip siz gönderirsiniz. Araştırma ekranındaki ürün bulucu, anahtar kelime gezgini ve ilan doktoru eBay için de çalışır.

## Kurulum

1. Ayarlar › Bağlantılar'da eBay kutusundan "Bağlan"a basın.
2. eBay'de giriş yapıp izin verin.
3. Siparişleriniz ve KolayXport'tan yönetilebilen ilanlarınız panele gelir.

## Sınırlar

- eBay Seller Hub'da açılmış eski ilanlar düzenlenemez ve stok senkronuna dahil edilmez; yeni bir ilana kopyalanabilir.
- eBay mesajları panelde yok.
- eBay ile stok güncellemesinde aynı anda gelen iki satış nadiren çakışabilir.

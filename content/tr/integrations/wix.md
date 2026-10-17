---
title: "Wix Entegrasyonu: Sipariş, Ürün, Sohbet | KolayXport"
description: "Wix mağazanızı uygulama kurulumuyla bağlayın: sipariş senkronu, ürün düzenleme, takip numarası gönderme ve Wix sohbetlerini panelden yanıtlama."
h1: "Wix entegrasyonu"
keyword: "wix entegrasyonu"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-wix, wix-products, stock-sync, tracking-push-wix, label-fedex, label-dhl-ecommerce, reports-profit, inbox-unified, ai-message-draft, ai-listing-copy]
draft: false
name: "Wix"
kind: marketplace
status: production
setupMinutes: 3
connect: "Uygulama kurulumu: Ayarlar › Bağlantılar'dan KolayXport uygulamasını Wix sitenize kurup izin verirsiniz."
capabilities:
  - label: "Sipariş senkronizasyonu"
    status: "partial"
    note: "Beta; hesabınız için ayrıca açılması gerekebilir"
    ref: order-sync-wix
  - label: "Ürün oluşturma ve düzenleme"
    status: "partial"
    note: "Varyantlı ve indirimli ürünler düzenlenemez"
    ref: wix-products
  - label: "Toplu düzenleme"
    status: "yes"
    note: "Başlık, fiyat ve adet"
    ref: wix-products
  - label: "Stok senkronu"
    status: "partial"
    note: "Varsayılan olarak yalnızca okunur; Wix stoğuna yazılmaz"
    ref: stock-sync
  - label: "Takip numarası gönderme"
    status: "yes"
    note: "Beta"
    ref: tracking-push-wix
  - label: "Kargo etiketi"
    status: "yes"
    note: "FedEx/UPS yurt dışı, DHL eCommerce yurt içi"
    ref: label-fedex
  - label: "Finans ve kâr"
    status: "no"
    note: "Wix satışları satış raporunda görünür, kâr raporunda yok"
    ref: reports-profit
  - label: "Mesajlar"
    status: "partial"
    note: "Wix sohbetleri, yapay zekâ yanıt taslağıyla; beta"
    ref: inbox-unified
  - label: "Yapay zekâ ile ilan yazımı"
    status: "no"
    ref: ai-listing-copy
faq:
  - q: "Wix stoğum diğer kanallarla eşitlenir mi?"
    a: "Wix stoğu ortak havuza okunur, ancak varsayılan olarak Wix'e geri yazılmaz. Etsy, eBay, Trendyol ve Shopify'a yazma desteklenir."
  - q: "Wix sohbetlerini panelden yanıtlayabilir miyim?"
    a: "Evet. Mesaj kutusunda Wix sohbetlerini ürün ve sipariş bağlamıyla görür, hazır yanıtlar ya da yapay zekâ taslağıyla yanıtlarsınız. Bu özellik beta."
  - q: "Hangi Wix ürünlerini düzenleyemem?"
    a: "Varyantlı ürünler ve indirimli ürünler. Stok takibini açıp kapatma da KolayXport'tan yapılamaz."
---

## Neler çalışıyor

Wix siparişleriniz diğer kanallarınızla aynı listeye gelir; FedEx, UPS ya da DHL eCommerce ile etiket basar, takip numarasını Wix'e iletirsiniz. Ürün tarafında Wix ürünlerini, koleksiyonları, görselleri ve stok bilgisini oluşturup düzenler, ürün silebilirsiniz. Toplu düzenleyicide başlık, fiyat ve adet var. Mesaj kutusunda Wix sohbetlerini yanıtlar, yapay zekâdan yanıt taslağı alırsınız.

Wix'te kendi sitesi olan ve aynı ürünleri Etsy ya da eBay'de de satan satıcılar için siparişleri ve müşteri sohbetlerini tek listede toplamak zaman kazandırır. Ürün güncellemeleri önce taslakta durur, siz gönderdiğinizde Wix'e iletilir. Wix sohbetlerine gelen soruları yapay zekâ taslağıyla daha hızlı yanıtlarsınız.

## Kurulum

1. Ayarlar › Bağlantılar'da Wix kutusundan kurulumu başlatın.
2. KolayXport uygulamasını Wix sitenize ekleyip izin verin.
3. Ürünleriniz panele gelir; sipariş senkronu ve mesajlar hesabınızda açıksa onlar da listelenir.

## Sınırlar

- Sipariş senkronu, takip numarası gönderimi ve mesajlar beta aşamasında ve hesabınız için ayrıca açılması gerekebilir.
- Varyantlı ve indirimli ürünler düzenlenemez.
- Stok senkronunda Wix varsayılan olarak yalnızca okunur.
- Wix ürünleri için yapay zekâ yazımı ve Wix için kâr raporu yok.

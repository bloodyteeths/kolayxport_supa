---
title: "Amazon Entegrasyonu: Sipariş, Takip No, Kâr | KolayXport"
description: "Amazon Seller Central hesabınızı bağlayın: sipariş senkronu, takip numarası gönderme, FedEx/UPS etiketi, yorum isteği ve reklam dahil kâr raporu."
h1: "Amazon entegrasyonu"
keyword: "amazon entegrasyonu"
updated: 2026-10-17
inventoryRefs: [settings-connections, order-sync-amazon, tracking-push-amazon, msg-amazon-buyer, label-fedex, reports-profit, listings-grid, stock-sync, ext-ebay-amazon-research, research-product-finder]
draft: false
name: "Amazon"
kind: marketplace
status: partial
setupMinutes: 5
connect: "OAuth (SP-API): Ayarlar › Bağlantılar'da pazar yerinizi seçip Seller Central hesabınızla izin verirsiniz."
capabilities:
  - label: "Sipariş senkronizasyonu"
    status: "yes"
    note: "Ürün görselleri ve alıcı bilgileri Amazon izinleri nedeniyle sınırlı olabilir"
    ref: order-sync-amazon
  - label: "İlan oluşturma ve düzenleme"
    status: "no"
    ref: listings-grid
  - label: "Stok senkronu"
    status: "no"
    note: "Amazon stoğuna yazılmaz; Amazon siparişleri ortak stok havuzunu yine düşürür"
    ref: stock-sync
  - label: "Takip numarası gönderme"
    status: "yes"
    note: "Amazon'a gönderim bildirimi olarak iletilir; Amazon'un işlemesi biraz sürebilir"
    ref: tracking-push-amazon
  - label: "Kargo etiketi"
    status: "yes"
    note: "Kendi FedEx/UPS hesabınızla"
    ref: label-fedex
  - label: "Finans ve kâr"
    status: "yes"
    note: "Reklam harcaması dahil; Pro özelliği"
    ref: reports-profit
  - label: "Mesajlar"
    status: "partial"
    note: "Alıcıya şablon mesaj ve yorum isteği gönderilir; yanıtlar okunamaz"
    ref: msg-amazon-buyer
  - label: "Araştırma"
    status: "no"
    note: "Paneldeki Amazon araştırma sekmesi kapalı"
    ref: research-product-finder
  - label: "Eklenti katmanı"
    status: "partial"
    note: "Amazon .com, .com.tr, .de, .co.uk sayfalarında tahmini değerler"
    ref: ext-ebay-amazon-research
faq:
  - q: "Amazon ilanlarımı KolayXport'tan düzenleyebilir miyim?"
    a: "Hayır. Amazon için ilan yönetimi yok; ilanlarınızı Seller Central'da yönetmeye devam edersiniz."
  - q: "Amazon stoğum diğer kanallarla eşitlenir mi?"
    a: "Hayır. Amazon stoğuna yazmıyoruz. Ancak Amazon'dan gelen siparişler stok senkronundaki ortak havuzu düşürür, böylece diğer kanallarınız güncel kalır."
  - q: "Amazon alıcısından yorum isteyebilir miyim?"
    a: "Evet. Sipariş panelindeki 'Alıcıya mesaj' ile Amazon'un izin verdiği şablon mesajları ve yorum isteğini gönderirsiniz. Alıcının yanıtları panelde görünmez."
---

## Neler çalışıyor

Amazon entegrasyonu sipariş ve gönderi tarafına odaklanır. Siparişleriniz Amazon raporları üzerinden panele gelir ve diğer kanallarınızla aynı listede görünür. Kendi FedEx veya UPS hesabınızla etiket basar, takip numarasını Amazon'a iletirsiniz. Sipariş panelinden alıcıya Amazon şablon mesajları ve yorum isteği gönderebilirsiniz. Finans senkronu satışları, kesintileri ve reklam harcamasını kâr raporuna taşır (Pro).

Amazon'da yurt dışına satan ve siparişlerini Etsy ya da eBay siparişleriyle birlikte paketleyen satıcılar için uygundur. Amazon siparişleri stok senkronundaki ortak havuzu düşürdüğü için, aynı ürünü Etsy veya eBay'de de satıyorsanız diğer kanallarınızdaki stok güncel kalır.

## Kurulum

1. Ayarlar › Bağlantılar'da Amazon kutusunu açın ve satış yaptığınız pazar yerini seçin.
2. Seller Central hesabınızla giriş yapıp KolayXport'a izin verin.
3. Siparişleriniz panele gelmeye başlar.

## Sınırlar

- Amazon ilanlarını oluşturma veya düzenleme yok.
- Amazon stoğuna yazılmaz.
- Paneldeki ürün araştırmasında Amazon yok; Chrome eklentisi Amazon sayfalarında yalnızca sayfadan okunan tahmini değerler gösterir ve eklenti henüz Chrome Web Mağazası'nda değil.
- Amazon'un izin kapsamı nedeniyle bazı siparişlerde ürün görseli ve alıcı bilgileri eksik olabilir.
- Alıcıya giden mesajlar tek yönlüdür; yanıtlar okunamaz.

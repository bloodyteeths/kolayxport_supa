---
title: "UPS Entegrasyonu: Yurt Dışı Etiket | KolayXport"
description: "Kendi UPS hesabınızla yurt dışı siparişlerinize etiket basın; ticari fatura elektronik gitsin, IOSS ve VAT bilgileri gönderimden önce kontrol edilsin."
h1: "UPS entegrasyonu"
keyword: "ups e-ihracat etiket"
updated: 2026-10-17
inventoryRefs: [settings-connections, label-ups, customs-commercial-invoice, labels-bulk, label-void, label-tracking-status, sender-profile, tracking-push-ebay, usage-meters]
draft: false
name: "UPS"
kind: carrier
status: production
setupMinutes: 15
connect: "API bilgileri: UPS geliştirici hesabınızdan aldığınız API Key ve API Secret ile UPS hesap numaranızı Ayarlar › Bağlantılar'a girersiniz."
capabilities:
  - label: "Etiket oluşturma"
    status: "yes"
    note: "UPS uluslararası servisleri; kendi UPS hesabınızla"
    ref: label-ups
  - label: "Elektronik ticari fatura"
    status: "yes"
    note: "IOSS ve VAT bilgisi kontrol edilir; ürün başına GTİP kodu gerekir"
    ref: customs-commercial-invoice
  - label: "Toplu etiket"
    status: "yes"
    ref: labels-bulk
  - label: "Takip numarasını pazaryerine iletme"
    status: "yes"
    note: "eBay, Amazon ve Wix'e; Etsy'ye Chrome eklentisiyle"
    ref: tracking-push-ebay
  - label: "Gönderi durumu takibi"
    status: "no"
    note: "Takip numarası saklanır, durum panelde güncellenmez"
    ref: label-tracking-status
  - label: "Etiket iptali"
    status: "partial"
    note: "UPS portalından elle yapılır"
    ref: label-void
  - label: "Yurt içi gönderi"
    status: "no"
    note: "Yurt içi için DHL eCommerce kullanın"
    ref: label-ups
faq:
  - q: "Ürün açıklaması neden kısa kesiliyor?"
    a: "UPS etiketinde ürün açıklaması en fazla 35 karakter olabilir. Kısa ve net bir İngilizce açıklama yazmanızı öneririz."
  - q: "UPS hesabım yoksa etiket alabilir miyim?"
    a: "Hayır. Etiketler sizin UPS hesabınızla, sizin anlaşmalı fiyatınızla basılır."
  - q: "Basılan etiketi daha sonra tekrar indirebilir miyim?"
    a: "Etiketi bastıktan hemen sonra indirip saklamanızı öneririz; UPS etiket dosyası sunucuda kalıcı olarak tutulmuyor."
---

## Neler çalışıyor

UPS entegrasyonu, yurt dışına giden siparişleriniz için kendi UPS hesabınızla uluslararası etiket basmanızı sağlar. Ticari fatura UPS'e elektronik olarak gönderilir; AB gönderilerinde IOSS ve VAT bilgileri gönderimden önce kontrol edilir. Toplu etiket ekranında birden çok siparişi seçip sırayla basabilirsiniz. Takip numarası eBay, Amazon ve Wix siparişlerine iletilir.

Kendi UPS anlaşmasıyla yurt dışına gönderi yapan satıcılar için uygundur. AB'ye giden gönderilerde IOSS numarası gibi bilgilerin eksik ya da hatalı olması paketin gümrükte beklemesine yol açabilir; KolayXport bu bilgileri etiketi basmadan önce kontrol eder. Ürünlerinizin GTİP kodu ve kısa İngilizce açıklaması siparişte doğru olmalıdır.

## Kurulum

1. Gönderici profilinizi Ayarlar'da doldurun.
2. UPS geliştirici hesabınızda bir uygulama oluşturup API Key ve API Secret alın.
3. Ayarlar › Bağlantılar › UPS'e bu bilgileri ve UPS hesap numaranızı girin.

## Sınırlar

- Yalnızca uluslararası servisler; yurt içi UPS etiketi yok.
- Ürün açıklaması 35 karakterle sınırlı.
- Gönderi durumu panelde takip edilmez; iptal UPS portalından yapılır.
- Etiket dosyasını bastıktan sonra indirip saklayın.
- Etiket basımı kullanım sayacına dahildir.

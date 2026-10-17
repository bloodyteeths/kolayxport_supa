---
title: "FedEx Entegrasyonu: Yurt Dışı Etiket ve ETD | KolayXport"
description: "Kendi FedEx hesabınızla Etsy, eBay ve Amazon siparişlerinize uluslararası etiket basın; ticari fatura ETD ile elektronik gitsin."
h1: "FedEx entegrasyonu"
keyword: "fedex etiket oluşturma"
updated: 2026-10-17
inventoryRefs: [settings-connections, label-fedex, customs-commercial-invoice, labels-bulk, label-void, label-tracking-status, sender-profile, tracking-push-ebay, usage-meters]
draft: false
name: "FedEx"
kind: carrier
status: partial
setupMinutes: 15
connect: "API bilgileri: FedEx geliştirici hesabınızdan aldığınız API Key ve API Secret ile FedEx hesap numaranızı Ayarlar › Bağlantılar'a girersiniz."
capabilities:
  - label: "Etiket oluşturma"
    status: "yes"
    note: "International Priority ve International Economy; kendi FedEx hesabınızla"
    ref: label-fedex
  - label: "Elektronik ticari fatura (ETD)"
    status: "yes"
    note: "Ürün başına GTİP kodu ve açıklama gerekir"
    ref: customs-commercial-invoice
  - label: "Toplu etiket"
    status: "yes"
    note: "Siparişler sırayla basılır, durdurup tekrar denenebilir"
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
    note: "FedEx portalından elle yapılır, panel bağlantıyı verir"
    ref: label-void
  - label: "Yurt içi gönderi"
    status: "no"
    note: "Yurt içi için DHL eCommerce kullanın"
    ref: label-fedex
faq:
  - q: "FedEx hesabım yoksa KolayXport'tan etiket alabilir miyim?"
    a: "Hayır. KolayXport kargo satmaz; etiketler sizin FedEx hesabınızla, sizin anlaşmalı fiyatınızla basılır."
  - q: "Ticari faturayı yazdırıp pakete koymam gerekiyor mu?"
    a: "ETD ile ticari fatura FedEx'e elektronik olarak gider. Her ürün için GTİP kodu ve açıklamanın doğru girilmiş olması gerekir."
  - q: "Gönderimin nerede olduğunu panelden görebilir miyim?"
    a: "Hayır. Takip numarası saklanır ve destekleyen pazaryerine iletilir, ama FedEx gönderi durumunu panelde göstermiyoruz."
---

## Neler çalışıyor

FedEx entegrasyonu, yurt dışına giden Etsy, eBay, Amazon, Shopify ve Wix siparişleriniz için kendi FedEx hesabınızla International Priority veya International Economy etiketi basmanızı sağlar. Ticari fatura FedEx'in ETD (Electronic Trade Documents) hizmetiyle etiketle birlikte elektronik olarak gönderilir. Toplu etiket ekranında birçok siparişi seçip sırayla basabilirsiniz; takip numarası eBay, Amazon ve Wix siparişlerine iletilir.

Etsy'nin sunduğu kargo seçenekleri yerine kendi FedEx anlaşmasıyla çalışan satıcılar için uygundur. Etiket basmadan önce ürünlerinizin GTİP kodu ve İngilizce açıklaması siparişte doğru olmalıdır; bu bilgiler ticari faturaya ve gümrük beyanına aynen geçer. Bir kez doğru girdiğinizde sonraki gönderilerde zaman kazanırsınız.

## Kurulum

1. Gönderici profilinizi Ayarlar'da doldurun; etiket basmak için zorunludur.
2. FedEx geliştirici hesabınızda bir API projesi oluşturup API Key ve API Secret alın.
3. Ayarlar › Bağlantılar › FedEx'e bu bilgileri ve FedEx hesap numaranızı girin.

## Sınırlar

- Yalnızca uluslararası gönderiler; yurt içi FedEx etiketi yok.
- Kendi FedEx hesabınız gerekir; fiyat sizin anlaşmanızdır.
- Gönderi durumu panelde takip edilmez.
- Etiket iptali FedEx portalından elle yapılır.
- Etiket basımı kullanım sayacına (etiket limiti) dahildir.

---
title: "DHL eCommerce (MNG Kargo) Entegrasyonu | KolayXport"
description: "Yurt içi siparişlerinize DHL eCommerce (MNG Kargo) etiketini panelden basın: kapıda ödeme, SMS, aynı gün teslimat, takip ve iptal."
h1: "DHL eCommerce (MNG Kargo) entegrasyonu"
keyword: "dhl ecommerce entegrasyonu"
updated: 2026-10-17
inventoryRefs: [settings-connections, label-dhl-ecommerce, labels-bulk, label-void, label-tracking-status, sender-profile, orders-pick-packing, usage-meters]
draft: false
name: "DHL eCommerce"
kind: carrier
status: production
setupMinutes: 5
connect: "Müşteri bilgileri: DHL eCommerce (MNG Kargo) müşteri numaranızı ve şifrenizi Ayarlar › Bağlantılar'a girersiniz."
capabilities:
  - label: "Etiket oluşturma"
    status: "yes"
    note: "Standart, Ekspres ve Aynı Gün; kapıda ödeme ve SMS seçenekleri"
    ref: label-dhl-ecommerce
  - label: "Toplu etiket"
    status: "yes"
    note: "Yurt içi siparişler toplu etikette otomatik olarak DHL eCommerce'e yönlenir"
    ref: labels-bulk
  - label: "Gönderi durumu takibi"
    status: "yes"
    ref: label-tracking-status
  - label: "Etiket iptali"
    status: "yes"
    note: "Panelden"
    ref: label-void
  - label: "Yurt dışı gönderi"
    status: "no"
    note: "Yalnızca Türkiye içi; yurt dışı için FedEx veya UPS"
    ref: label-dhl-ecommerce
faq:
  - q: "Yurtiçi, Aras veya Sürat Kargo ile etiket basabilir miyim?"
    a: "Hayır. Yurt içinde yalnızca DHL eCommerce (MNG Kargo) etiketi basabilirsiniz. Diğer firmaların takip numarasını siparişe elle girebilirsiniz."
  - q: "Kapıda ödemeli gönderi yapabilir miyim?"
    a: "Evet. Etiket oluştururken kapıda ödeme seçeneğini işaretleyebilir, alıcıya SMS bildirimi açabilirsiniz."
  - q: "Hangi bilgilere ihtiyacım var?"
    a: "DHL eCommerce (MNG Kargo) müşteri numaranız ve şifreniz. Bunları kargo firmasıyla yaptığınız sözleşmeden alırsınız."
---

## Neler çalışıyor

DHL eCommerce (eski adıyla MNG Kargo) entegrasyonu, Türkiye içindeki siparişleriniz için etiketi KolayXport'tan basmanızı sağlar. Standart, Ekspres ve Aynı Gün servisleri arasından seçer, kapıda ödeme ve SMS bildirimini açabilirsiniz. Gönderinin durumu panelde görünür; etiketi panelden iptal edersiniz. Toplu etiket ekranında yurt içi siparişler otomatik olarak DHL eCommerce'e, yurt dışı olanlar FedEx veya UPS'e ayrılır.

Yurt dışına satan ama Türkiye'den de sipariş alan satıcılar için pratik bir tamamlayıcıdır: Etsy, Shopify, Wix ya da Trendyol'dan gelen yurt içi siparişleri aynı listeden etiketler, yurt dışı siparişleri FedEx veya UPS'e bırakırsınız. Etiket basmadan önce gönderici profilinizin dolu olması gerekir; adres ve telefon bilgisi etikete buradan gelir.

## Kurulum

1. Gönderici profilinizi Ayarlar'da doldurun.
2. Ayarlar › Bağlantılar › DHL eCommerce'e müşteri numaranızı ve şifrenizi girin.
3. Siparişte "Etiket oluştur"a basıp DHL eCommerce'i seçin.

## Sınırlar

- Yalnızca Türkiye içi gönderiler.
- DHL eCommerce ile kendi müşteri sözleşmeniz gerekir; fiyat sizin anlaşmanızdır.
- Trendyol ve Shopify siparişlerinde takip numarası pazaryerine gönderilmez.
- Etiket basımı kullanım sayacına dahildir.

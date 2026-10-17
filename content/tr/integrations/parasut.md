---
title: "Paraşüt Entegrasyonu: e-Fatura ve e-Arşiv | KolayXport"
description: "Paraşüt hesabınızı bağlayın; yurt dışı siparişlerinizin ETGB gönderimi sırasında Paraşüt'te müşteri ve satış faturası oluşturulsun."
h1: "Paraşüt entegrasyonu"
keyword: "paraşüt entegrasyonu"
updated: 2026-10-17
inventoryRefs: [settings-connections, parasut-einvoice, etgb-excel-email]
draft: false
name: "Paraşüt"
kind: accounting
status: partial
setupMinutes: 10
connect: "API bilgileri: Paraşüt'ten aldığınız Client ID, Client Secret, kullanıcı adı, şifre ve firma numaranızı Ayarlar › Bağlantılar'a girersiniz."
capabilities:
  - label: "e-Fatura / e-Arşiv oluşturma"
    status: "partial"
    note: "Yalnızca ETGB gönderimi sırasında çalışır; ayrı fatura butonu yok"
    ref: parasut-einvoice
  - label: "Müşteri kaydı oluşturma"
    status: "yes"
    note: "Fatura sırasında Paraşüt'te alıcı kaydı açılır"
    ref: parasut-einvoice
  - label: "Fatura PDF'i"
    status: "yes"
    note: "Oluşan faturanın PDF'i Paraşüt'ten alınır"
    ref: parasut-einvoice
  - label: "Fatura listesi ve hata bildirimi"
    status: "no"
    note: "Faturalarınızı ve olası hataları Paraşüt'te kontrol edin"
    ref: parasut-einvoice
faq:
  - q: "Her siparişe otomatik fatura kesiliyor mu?"
    a: "Hayır. Paraşüt faturası yalnızca seçtiğiniz siparişler için ETGB gönderimi yaptığınızda oluşturulur. Ayrı bir 'fatura kes' butonu yok."
  - q: "Fatura oluşturulamazsa haberim olur mu?"
    a: "Şu an panelde ayrı bir uyarı gösterilmiyor ve ETGB e-postası yine gönderiliyor. Faturalarınızı Paraşüt'te kontrol etmenizi öneririz."
  - q: "Başka bir e-fatura sağlayıcısını kullanabilir miyim?"
    a: "Hayır. Şu an yalnızca Paraşüt destekleniyor."
---

## Neler çalışıyor

Paraşüt hesabınızı bağladığınızda, yurt dışı siparişleriniz için ETGB gönderimi yaptığınız anda KolayXport Paraşüt'te alıcı kaydını açar, satış faturasını oluşturur, e-Fatura ya da e-Arşiv olarak işler ve faturanın PDF'ini alır. Böylece mikro ihracat siparişlerinizin faturası ETGB dosyasıyla aynı adımda hazırlanır.

Bu entegrasyon, mikro ihracat siparişlerinin faturasını ETGB ile aynı anda hazırlamak isteyen ve muhasebesini zaten Paraşüt'te tutan satıcılar için tasarlandı. Faturanın içeriğini ve KDV durumunu mali müşavirinizle birlikte kontrol etmenizi öneririz.

## Kurulum

1. Paraşüt'ten API erişimi için Client ID ve Client Secret alın.
2. Ayarlar › Bağlantılar › Paraşüt'e bu bilgileri, Paraşüt kullanıcı adınızı, şifrenizi ve firma numaranızı girin.
3. Ayarlar'da ETGB alıcısını (gümrük müşaviri e-postası) tanımlayın.

## Sınırlar

- Fatura yalnızca ETGB gönderimi sırasında oluşturulur; siparişten bağımsız fatura kesme yok.
- Panelde fatura listesi yok.
- Paraşüt bir hata döndürürse panel uyarmaz ve ETGB e-postası yine gider; faturalarınızı Paraşüt'te kontrol edin.
- Paraşüt dışında e-fatura sağlayıcısı desteklenmiyor.
- Otomatik ve her siparişe fatura kesilmez.

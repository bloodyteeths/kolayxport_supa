import React from "react";
import PublicLayout from "@/components/PublicLayout";

export default function TermsOfServiceTR() {
  const companyName = "Modsons Yazılım E-Ticaret Ltd. Şti.";
  const appName = "KolayXport";
  const supportEmail = "destek@kolayxport.com";
  const lastUpdated = "15 Ekim 2026";
  const websiteUrl = "https://www.kolayxport.com";

  return (
    <PublicLayout title="Kullanım Şartları">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <article className="prose prose-slate lg:prose-lg mx-auto">
          <h1>{appName} Kullanım Şartları</h1>
          <p><em>Son Güncelleme: {lastUpdated}</em></p>
          <p>Bu Kullanım Şartları {appName} hizmeti ve <a href={websiteUrl}>{websiteUrl}</a> sitesi için geçerlidir.</p>

          <h2>1. Kabul</h2>
          <p>Hesap oluşturarak, oturum açarak ve {appName}&apos;u kullanarak bu Kullanım Şartları&apos;nı kabul etmiş olursunuz.</p>

          <h2>2. Hizmet Tanımı</h2>
          <p>
            {appName}, online satıcılar için çok kanallı bir e-ticaret yönetim platformudur. Bağladığınız entegrasyonlara ve planınıza göre hizmet şunları yapmanızı sağlar:
          </p>
          <ul>
            <li>bağlı pazaryerlerinden ve mağazalardan gelen siparişleri tek bir yerden görmek ve yönetmek;</li>
            <li>bağlı kargo firmalarıyla gönderi etiketi oluşturmak, gönderileri takip etmek ve takip bilgisini pazaryerine iletmek;</li>
            <li>ürün ilanları oluşturmak ve düzenlemek; ilanlarda yaptığınız düzenlemeler önce {appName}&apos;ta kaydedilir ve yalnızca siz senkronize etmeyi seçtiğinizde pazaryerine gönderilir;</li>
            <li>isteğe bağlı stok senkronizasyonunu açmak; onayınızdan sonra bağlı kanallardaki stok adetleri otomatik olarak eşitlenir ve tükenen ilanlar veya varyasyonlar pasife alınabilir;</li>
            <li>ürün, anahtar kelime ve pazar araştırması araçlarını kullanmak; yapay zekâ destekli öneriler isteğe bağlıdır ve kullanmadan önce sizin onayınıza sunulur;</li>
            <li>bağlı kanallardan gelen müşteri mesajlarını okumak ve yanıtlamak;</li>
            <li>bağlı hesaplarınızdaki verilere dayanan satış, komisyon, reklam ve kârlılık raporlarını görüntülemek.</li>
          </ul>
          <p>Özellikler zaman içinde değişebilir; bazı özellikler, ilgili üçüncü taraf hizmetin API&apos;si üzerinden sunduğu imkânlara bağlıdır.</p>

          <h2>3. Kullanıcı Yükümlülükleri</h2>
          <ul>
            <li>Doğru hesap bilgileri vermeli ve yalnızca kullanmaya yetkili olduğunuz pazaryeri, mağaza ve kargo hesaplarını bağlamalısınız.</li>
            <li>API'leri kötüye kullanmamalı veya hizmet işlemlerini engellememelisiniz.</li>
          </ul>

          <h2>4. Lisans</h2>
          <p>Hizmeti kişisel veya ticari ihtiyaçlarınız için sınırlı, münhasır olmayan bir lisans ile kullanma hakkı tanıyoruz.</p>

          <h2>5. Yasaklanan Davranışlar</h2>
          <ul>
            <li>İzinsiz tarama, hackleme veya kodumuzun/API'lerimizin tersine mühendisliği.</li>
            <li>Hizmeti yasa dışı, başkalarının haklarını ihlal eden veya bağlı pazaryerinin kurallarına aykırı içerik oluşturmak, yüklemek ya da yayımlamak için kullanmak.</li>
          </ul>

          <h2>6. Sorumluluğun Sınırlandırılması</h2>
          <p>Hukukun izin verdiği azami ölçüde, dolaylı, özel veya sonuçsal zararlar için sorumlu değiliz.</p>

          <h2>7. Feragatname</h2>
          <p>Tüm hizmetler, her türlü garanti olmaksızın "olduğu gibi" sağlanmaktadır.</p>

          <h2>8. Üçüncü Taraf API Entegrasyonları</h2>
          <p>
            {appName}, hizmetlerini sunmak için Etsy, Amazon, Shopify ve diğerleri dahil olmak üzere çeşitli üçüncü taraf pazaryeri API&apos;leri ile entegre olur. Hizmetimizi kullanarak:
          </p>
          <ul>
            <li>Siparişlerinizi, listelerinizi ve mağaza verilerinizi sizin adınıza almak ve yönetmek için {appName}&apos;un OAuth 2.0 aracılığıyla pazaryeri hesaplarınıza erişmesine yetki verirsiniz.</li>
            <li>Etsy API Kullanım Şartları (<a href="https://www.etsy.com/legal/api">https://www.etsy.com/legal/api</a>) dahil olmak üzere her pazaryerinin API Kullanım Şartlarına uyarız.</li>
            <li>Pazaryeri API&apos;leri aracılığıyla elde edilen listeleme verileri 6 saat içinde, diğer tüm içerikler ise 24 saat içinde yenilenir.</li>
            <li>Pazaryeri API&apos;leri aracılığıyla elde edilen veriler Gizlilik Politikamıza uygun olarak işlenir ve üçüncü taraflarla reklam amacıyla paylaşılmaz.</li>
          </ul>
          <h2>9. Markalar ve Üçüncü Taraf Hizmetler</h2>
          <p>
            {appName}, {companyName} tarafından sunulan bağımsız bir yazılım hizmetidir. {appName}, sizin verdiğiniz yetkilerle üçüncü taraf pazaryerlerine, e-ticaret platformlarına, kargo firmalarına ve diğer hizmetlere, bu firmaların yayımladığı uygulama programlama arayüzleri (API) üzerinden bağlanır. Bu API&apos;lere erişimimiz, {companyName}&apos;yi bu şirketlerin acentesi, ortağı, bayisi veya temsilcisi yapmaz.
          </p>
          <p>
            {appName} içinde gösterilen tüm ürün adları, şirket adları, logolar ve markalar ilgili sahiplerine aittir. Bunları yalnızca bağladığınız hizmetleri tanımlamak ve uyumluluğu belirtmek için kullanırız; marka sahibinin talebi hâlinde ilgili logoyu kaldırırız. Belirli bir program için açıkça belirtmediğimiz sürece bu kullanım, marka sahiplerinin {appName}&apos;a sponsor olduğu, onu onayladığı, sertifikalandırdığı veya onunla bağlantılı olduğu anlamına gelmez. Özellikle:
          </p>
          <ul>
            <li>
              The term &ldquo;Etsy&rdquo; is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.
              {" "}(&ldquo;Etsy&rdquo; terimi Etsy, Inc.&apos;in markasıdır. Bu uygulama Etsy API&apos;sini kullanır ancak Etsy, Inc. tarafından onaylanmamış veya sertifikalandırılmamıştır.)
            </li>
            <li>eBay, eBay Inc.&apos;in markasıdır.</li>
            <li>Amazon, Veeqo ve ilgili tüm markalar Amazon.com, Inc. veya bağlı şirketlerinin markalarıdır.</li>
            <li>Shopify, Shopify Inc.&apos;in markasıdır.</li>
            <li>Wix, Wix.com Ltd.&apos;nin markasıdır.</li>
            <li>Trendyol, DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş.&apos;nin markasıdır.</li>
            <li>Hepsiburada, D-Market Elektronik Hizmetler ve Ticaret A.Ş.&apos;nin markasıdır.</li>
            <li>FedEx, Federal Express Corporation&apos;ın markasıdır.</li>
            <li>UPS, UPS marka logosu ve Kahverengi Renk, United Parcel Service of America, Inc.&apos;in markalarıdır. Tüm hakları saklıdır.</li>
            <li>DHL ve DHL eCommerce, Deutsche Post AG&apos;nin markalarıdır. MNG Kargo, ilgili sahibinin markasıdır.</li>
            <li>Shippo, Goshippo, Inc.&apos;in markasıdır.</li>
            <li>Paraşüt, ilgili sahibinin markasıdır.</li>
            <li>Google, Gemini ve Chrome, Google LLC&apos;nin markalarıdır.</li>
          </ul>
          <p>
            Her üçüncü taraf hizmetin kendi koşulları, politikaları ve gizlilik uygulamaları vardır ve o hizmeti kullanımınıza bunlar uygulanır. Bu üçüncü taraflar {appName}&apos;u sağlamaz, ondan sorumlu değildir ve {appName} ya da onun üzerinden erişilen veriler hakkında hiçbir garanti vermez. Bu taraflardan herhangi biri API&apos;sini istediği zaman değiştirebilir, kısıtlayabilir veya durdurabilir; bu durum {appName}&apos;un bazı özelliklerini etkileyebilir.
          </p>
          <p>
            FERAGATNAME: BU UYGULAMA YALNIZCA {companyName.toLocaleUpperCase("tr-TR")} (&ldquo;UYGULAMA GELİŞTİRİCİSİ&rdquo;) TARAFINDAN SAĞLANMAKTADIR. ETSY, INC. VE BAĞLI ŞİRKETLERİNİN VE YUKARIDA ADI GEÇEN DİĞER ÜÇÜNCÜ TARAF HİZMET SAĞLAYICILARIN UYGULAMA GELİŞTİRİCİSİ OLMADIĞINI, UYGULAMA HİZMETİNİ SAĞLAMADIĞINI VE UYGULAMA YA DA ONUN ÜZERİNDEN ERİŞİLEN VERİLER HAKKINDA HİÇBİR TÜRDE GARANTİ VERMEDİĞİNİ KABUL EDERSİNİZ.
          </p>
          <p>
            Bir markanın uygunsuz kullanıldığını düşünüyorsanız <a href={`mailto:${supportEmail}`}>{supportEmail}</a> adresinden bize ulaşın.
          </p>

          <h2>10. Fesih</h2>
          <p>Bu Şartları ihlal etmeniz durumunda erişiminizi askıya alabilir veya sonlandırabiliriz.</p>

          <h2>11. Değişiklikler</h2>
          <p>Bu Şartları güncelleyebiliriz; güncellenen sürümler güncellenme tarihi ile yayınlanacaktır.</p>

          <h2>12. Geçerli Hukuk</h2>
          <p>Bu Şartlar, {companyName}&apos;nin bulunduğu yerin yasalarına tabidir.</p>

          <h2>13. İletişim</h2>
          <p>
            Sorular için <a href={`mailto:${supportEmail}`}>{supportEmail}</a> adresinden bize ulaşın.
          </p>
        </article>
      </div>
    </PublicLayout>
  );
} 
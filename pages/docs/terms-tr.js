import React from "react";
import PublicLayout from "@/components/PublicLayout";

export default function TermsOfServiceTR() {
  const companyName = "Tamsar Tekstil Dış Tic. Ltd. Şti.";
  const appName = "KolayXport";
  const supportEmail = "destek@kolayxport.com";
  const lastUpdated = "May 7, 2025";

  return (
    <PublicLayout title="Kullanım Şartları">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <article className="prose prose-slate lg:prose-lg mx-auto">
          <h1>{appName} Kullanım Şartları</h1>
          <p><em>Son Güncelleme: {lastUpdated}</em></p>

          <h2>1. Kabul</h2>
          <p>Google hesabınızla oturum açarak ve {appName}’i kullanarak bu Kullanım Şartları’nı kabul etmiş olursunuz.</p>

          <h2>2. Hizmet Tanımı</h2>
          <p>{appName}, kargo iş akışları için Google Drive klasörleri, E-Tablolar ve Apps Script oluşturmayı otomatikleştirir.</p>

          <h2>3. Kullanıcı Yükümlülükleri</h2>
          <ul>
            <li>Geçerli bir Google hesabı sağlamalı ve yalnızca istenen OAuth izinlerini vermelisiniz.</li>
            <li>API’leri kötüye kullanmamalı veya hizmet işlemlerini engellememelisiniz.</li>
          </ul>

          <h2>4. Lisans</h2>
          <p>Hizmeti kişisel veya ticari ihtiyaçlarınız için sınırlı, münhasır olmayan bir lisans ile kullanma hakkı tanıyoruz.</p>

          <h2>5. Yasaklanan Davranışlar</h2>
          <ul>
            <li>İzinsiz tarama, hackleme veya kodumuzun/API’lerimizin tersine mühendisliği.</li>
            <li>Oluşturulan Drive dosyaları aracılığıyla yasadışı içerik yükleme veya paylaşma.</li>
          </ul>

          <h2>6. Sorumluluğun Sınırlandırılması</h2>
          <p>Hukukun izin verdiği azami ölçüde, dolaylı, özel veya sonuçsal zararlar için sorumlu değiliz.</p>

          <h2>7. Feragatname</h2>
          <p>Tüm hizmetler, her türlü garanti olmaksızın "olduğu gibi" sağlanmaktadır.</p>

          <h2>8. Fesih</h2>
          <p>Bu Şartları ihlal etmeniz durumunda erişiminizi askıya alabilir veya sonlandırabiliriz.</p>

          <h2>9. Değişiklikler</h2>
          <p>Bu Şartları güncelleyebiliriz; güncellenen sürümler güncellenme tarihi ile yayınlanacaktır.</p>

          <h2>10. Geçerli Hukuk</h2>
          <p>Bu Şartlar, {companyName}’in bulunduğu yerin yasalarına tabidir.</p>

          <h2>11. İletişim</h2>
          <p>
            Sorular için <a href={`mailto:${supportEmail}`}>{supportEmail}</a> adresinden bize ulaşın.
          </p>
        </article>
      </div>
    </PublicLayout>
  );
} 
import React from "react";

export default function GizlilikPolitikasi() {
  return (
    <div style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1>Gizlilik Politikası</h1>
      <p>Son güncelleme: 5 Mayıs 2025</p>

      <section>
        <h2>1. Giriş</h2>
        <p>
          MyBaby Sync ("biz", "bize", "bizim") olarak, gizliliğinizi önemsiyoruz ve
          Kişisel Verilerin Korunması Kanunu (KVKK) dahil tüm yürürlükteki
          mevzuata uygun olarak kişisel verilerinizi korumaya kararlıyız.
        </p>
      </section>

      <section>
        <h2>2. Topladığımız Bilgiler</h2>
        <ul>
          <li>
            <strong>Temel Profil Bilgileri:</strong> Google OAuth ile adınız ve e-posta adresinizi alıyoruz. Bu bilgiler sadece kullanıcıyı tanımlamak ve deneyimi kişiselleştirmek için kullanılır.
          </li>
          <li>
            <strong>OAuth Jetonları:</strong> Google API'leri sizin adınıza çağırabilmek için erişim ve yenileme jetonlarınızı şifrelenmiş olarak veritabanımızda saklıyoruz.
          </li>
          <li>
            <strong>Kaynak Tanımlayıcılar:</strong> Senkronizasyon yapacağımız Google Tablosu, etiketleme yapacağımız Drive klasörü ve Apps Script dağıtım kimlikleri gibi ID'leri saklıyoruz.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Verilerinizi Nasıl Kullanıyoruz</h2>
        <ul>
          <li>
            <strong>Kimlik Doğrulama:</strong> Google profilinizle güvenli bir şekilde giriş yapmanızı sağlıyoruz.
          </li>
          <li>
            <strong>Tablo Senkronizasyonu:</strong> Belirlediğiniz tek <em>"wrapper"</em> Google Tablosu üzerinde okuma ve yazma işlemleri gerçekleştiriyoruz.
          </li>
          <li>
            <strong>Klasör Etiketleme:</strong> Sadece sizin seçtiğiniz Drive klasörüne etiket ekliyor veya güncelliyoruz.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. İstediğimiz OAuth İzinleri</h2>
        <ul>
          <li>
            <code>openid</code>, <code>userinfo.email</code>, <code>userinfo.profile</code>: Kimlik doğrulama ve temel profil bilgisi için.
          </li>
          <li>
            <code>https://www.googleapis.com/auth/spreadsheets</code>: Sadece sizin belirttiğiniz tabloyu okumak ve yazmak için.
          </li>
          <li>
            <code>https://www.googleapis.com/auth/drive.file</code>: Uygulamanın erişimine izin verdiğiniz dosya(lar) üzerinde etiketleme yapabilmek için.
          </li>
          <li>
            <code>https://www.googleapis.com/auth/script.projects</code>, <code>script.scriptapp</code>, <code>script.external_request</code>, <code>script.storage</code>: Senkronizasyon ve etiketleme işlemlerini Apps Script Execution API aracılığıyla gerçekleştirebilmek için.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Verilerin Saklanma Süresi</h2>
        <p>
          Hesabınız aktif olduğu sürece profil bilgilerinizi, jetonlarınızı ve kaynak ID'lerinizi saklıyoruz. Hesabınızı talep etmeniz halinde tüm verileriniz silinebilir.
        </p>
      </section>

      <section>
        <h2>6. KVKK Kapsamındaki Haklarınız</h2>
        <p>
          KVKK'ya göre verilerinize erişme, düzeltme, silme, işleme itiraz etme ve taşınma hakkınız bulunmaktadır. Bu haklarınızı kullanmak için bizimle iletişime geçebilirsiniz.
        </p>
      </section>

      <section>
        <h2>7. Güvenlik Önlemleri</h2>
        <p>
          Verilerinizi yetkisiz erişime, ifşaya veya hatalı kullanıma karşı korumak için sektör standartlarında teknik ve organizasyonel önlemler uyguluyoruz.
        </p>
      </section>

      <section>
        <h2>8. İletişim</h2>
        <p>
          Kişisel verileriniz hakkında sorularınız veya talepleriniz için bize <a href="mailto:support@example.com">support@example.com</a> adresinden ulaşabilirsiniz.
        </p>
      </section>

      <footer>
        <p>
          Bu politika periyodik olarak güncellenebilir. Önemli değişiklikler hakkında sizi bilgilendireceğiz.
        </p>
      </footer>
    </div>
  );
} 
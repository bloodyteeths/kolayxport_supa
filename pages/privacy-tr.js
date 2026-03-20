import React from "react";
// import Layout from "@/components/Layout"; // Old Layout removed
import PublicLayout from "@/components/PublicLayout"; // New PublicLayout imported

export default function PrivacyPolicyTR() {
  const companyName = "Tamsar Tekstil Dış Tic. Ltd. Şti.";
  const appName = "KolayXport";
  const supportEmail = "destek@kolayxport.com";
  const websiteUrl = "https://kolayxport.com";
  const lastUpdated = "May 7, 2025"; // Update as needed

  return (
    <PublicLayout title="Gizlilik Politikası">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <article className="prose prose-slate lg:prose-lg mx-auto">
          <h1>{appName} Gizlilik Politikası</h1>
          <p><em>Son Güncelleme: {lastUpdated}</em></p>

          <p>
            Bu Gizlilik Politikası, {companyName} ("Şirket", "biz", "bize" veya "bizim")
            olarak {appName} uygulamasını ("Uygulama") ve {websiteUrl} web sitesini
            ("Site") kullandığınızda kişisel verilerinizi nasıl topladığımızı, kullandığımızı,
            açıkladığımızı ve koruduğumuzu açıklamaktadır. Lütfen bu politikayı dikkatlice okuyunuz.
            Hizmetlerimizi kullanarak, bu Gizlilik Politikasında açıklanan uygulamaları kabul etmiş olursunuz.
          </p>

          <h2>1. Veri Sorumlusu</h2>
          <p>
            6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca,
            kişisel verileriniz tekintinde veri sorumlusu {companyName}, Türkiye'de kurulu bir şirkettir.
          </p>
          
          <h2>2. Topladığımız Kişisel Veriler</h2>
          <p>Sizden aşağıdaki kişisel verileri toplayabiliriz:</p>
          <ul>
            <li>
              <strong>Kimlik ve İletişim Bilgileri:</strong> Google hesabınızla oturum açtığınızda adınız, soyadınız, e-posta adresiniz.
            </li>
            <li>
              <strong>Google Hesap Verileri (OAuth İzinleriyle):</strong>
              <ul>
                <li><code>openid, https://www.googleapis.com/auth/userinfo.email, https://www.googleapis.com/auth/userinfo.profile</code>: Kimliğinizi doğrulamak ve temel profil bilgilerinizi almak için (ad, e-posta, profil resmi).</li>
                <li><code>https://www.googleapis.com/auth/spreadsheets</code>: Uygulamanın çalışması için belirlediğiniz Google E-Tablosuna veri okumak ve yazmak için. Bu, siparişlerinizin ve ilgili verilerin saklandığı ve işlendiği ana tablodur.</li>
                <li><code>https://www.googleapis.com/auth/drive.file</code>: Uygulamanın oluşturduğu veya sizin erişim izni verdiğiniz belirli dosyalara (örneğin, oluşturulan kargo etiketleri) erişmek, bunları yönetmek ve bunları belirli bir Google Drive klasörüne kaydetmek için. Tüm Drive'ınıza erişim talep etmiyoruz.</li>
                <li><code>https://www.googleapis.com/auth/script.projects, script.scriptapp, script.external_request, script.storage</code>: Sipariş senkronizasyonu ve etiket oluşturma gibi otomasyon görevlerini gerçekleştirmek üzere Google Apps Script Execution API aracılığıyla arka plan komut dosyalarımızı çalıştırmak için. Bu, Uygulamanın temel işlevlerinin yerine getirilmesini sağlar.</li>
              </ul>
            </li>
            <li>
              <strong>Kullanım Verileri:</strong> Uygulamamızı ve Sitemizi nasıl kullandığınız hakkında bilgiler (örneğin, erişim zamanları, görüntülenen sayfalar).
            </li>
             <li>
              <strong>Saklanan Diğer Veriler:</strong> Google E-Tablo Kimliğiniz, Google Drive Klasör Kimliğiniz ve Uygulama ayarlarınızı yapılandırmak için tarafınızca sağlanan üçüncü taraf API anahtarları (örneğin, kargo şirketi API anahtarları) gibi belirli tanımlayıcıları veritabanımızda saklarız. Bu anahtarlar şifrelenmiş olarak saklanır.
            </li>
          </ul>

          <h2>3. Kişisel Verilerinizi Nasıl Kullanıyoruz</h2>
          <p>Kişisel verilerinizi aşağıdaki amaçlarla kullanırız:</p>
          <ul>
            <li>Hizmetlerimizi sağlamak, sürdürmek ve iyileştirmek.</li>
            <li>Google hesabınızla kimliğinizi doğrulamak.</li>
            <li>Belirttiğiniz Google E-Tablosu ile sipariş verilerini senkronize etmek.</li>
            <li>Google Drive'ınızda kargo etiketleri oluşturmak ve yönetmek.</li>
            <li>İsteklerinize yanıt vermek ve destek sağlamak. İletişim Adresi: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</li>
            <li>Yasal yükümlülüklere uymak.</li>
          </ul>

          <h2>4. Kişisel Verilerin İşlenmesinin Hukuki Sebepleri</h2>
          <p>Kişisel verilerinizi KVKK Madde 5 uyarınca aşağıdaki hukuki sebeplere dayanarak işliyoruz:</p>
          <ul>
            <li>Bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması kaydıyla, sözleşmenin taraflarına ait kişisel verilerin işlenmesinin gerekli olması.</li>
            <li>Veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi için zorunlu olması.</li>
            <li>İlgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla, veri sorumlusunun meşru menfaatleri için veri işlenmesinin zorunlu olması.</li>
            <li>Açık rızanız (belirli durumlar için ayrıca talep edilecektir).</li>
          </ul>

          <h2>5. Kişisel Verilerin Paylaşılması</h2>
          <p>Kişisel verilerinizi aşağıdaki durumlar dışında üçüncü taraflarla paylaşmayız:</p>
          <ul>
            <li>Google (OAuth ve API hizmetleri aracılığıyla, sizin izninizle).</li>
            <li>Yasal bir zorunluluk olması halinde veya resmi makamların talebi üzerine.</li>
            <li>Hizmetlerimizi sağlamak için güvendiğimiz hizmet sağlayıcılarla (örneğin, veritabanı barındırma), ancak yalnızca bu politikaya ve gizlilik yükümlülüklerine uymaları koşuluyla.</li>
          </ul>

          <h2>6. Kişisel Verilerin Saklanması ve Güvenliği</h2>
          <p>
            Kişisel verilerinizi, toplama amaçları için gerekli olduğu sürece veya yasaların gerektirdiği şekilde saklarız.
            Verilerinizi yetkisiz erişime, değişikliğe, ifşaya veya imhaya karşı korumak için uygun teknik ve organizasyonel önlemleri alıyoruz.
            API anahtarları gibi hassas veriler veritabanımızda şifrelenmiş olarak saklanır.
          </p>

          <h2>7. KVKK Kapsamındaki Haklarınız</h2>
          <p>KVKK Madde 11 uyarınca aşağıdaki haklara sahipsiniz:</p>
          <ul>
            <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme.</li>
            <li>Kişisel verileriniz işlenmişse buna ilişkin bilgi talep etme.</li>
            <li>Kişisel verilerinizin işlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme.</li>
            <li>Yurt içinde veya yurt dışında kişisel verilerinizin aktarıldığı üçüncü kişileri bilme.</li>
            <li>Kişisel verilerinizin eksik veya yanlış işlenmiş olması hâlinde bunların düzeltilmesini isteme.</li>
            <li>KVKK Madde 7'de öngörülen şartlar çerçevesinde kişisel verilerinizin silinmesini veya yok edilmesini isteme.</li>
            <li>(d) ve (e) bentleri uyarınca yapılan işlemlerin, kişisel verilerinizin aktarıldığı üçüncü kişilere bildirilmesini isteme.</li>
            <li>İşlenen verilerinizin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme.</li>
            <li>Kişisel verilerinizin kanuna aykırı olarak işlenmesi sebebiyle zarara uğramanız hâlinde zararınızın giderilmesini talep etme.</li>
          </ul>
          <p>Bu haklarınızı kullanmak için {supportEmail} adresinden bizimle iletişime geçebilirsiniz.</p>

          <h2>8. Çerezler</h2>
          <p>
            Sitemiz, kullanıcı deneyimini geliştirmek için çerezler kullanabilir. Tarayıcı ayarlarınızdan çerezleri reddedebilirsiniz,
            ancak bu, Sitenin bazı işlevlerinin düzgün çalışmamasına neden olabilir.
          </p>

          <h2>9. Diğer Web Sitelerine Bağlantılar</h2>
          <p>
            Sitemiz, bizim tarafımızdan işletilmeyen diğer web sitelerine bağlantılar içerebilir.
            Bir üçüncü taraf bağlantısına tıklarsanız, o üçüncü tarafın sitesine yönlendirilirsiniz.
            Ziyaret ettiğiniz her sitenin Gizlilik Politikasını incelemenizi önemle tavsiye ederiz.
            Üçüncü taraf sitelerin veya hizmetlerin içeriği, gizlilik politikaları veya uygulamaları üzerinde hiçbir kontrolümüz yoktur
            ve hiçbir sorumluluk kabul etmeyiz.
          </p>

          <h2>10. Bu Gizlilik Politikasındaki Değişiklikler</h2>
          <p>
            Bu Gizlilik Politikasını zaman zaman güncelleyebiliriz. Herhangi bir değişikliği Sitede yeni Gizlilik Politikasını yayınlayarak size bildireceğiz.
            Değişiklikler için bu Gizlilik Politikasını periyodik olarak gözden geçirmeniz tavsiye edilir.
          </p>

          <h2>11. İletişim</h2>
          <p>
            Bu Gizlilik Politikası hakkında herhangi bir sorunuz varsa, lütfen bizimle iletişime geçin:
            <br />
            {companyName}
            <br />
            E-posta: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          </p>
        </article>
      </div>
    </PublicLayout>
  );
} 
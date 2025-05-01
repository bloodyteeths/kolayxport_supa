import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState } from "react";

export default function Dashboard() {
  // Ayarlar
  const [shippoKey, setShippoKey] = useState('');
  const [trendyolSup, setTrendyolSup] = useState('');
  const [trendyolKey, setTrendyolKey] = useState('');
  const [trendyolSecret, setTrendyolSecret] = useState('');
  const [fedexKey, setFedexKey] = useState('');
  const [fedexSecret, setFedexSecret] = useState('');
  const [fedexAccount, setFedexAccount] = useState('');
  const [fedexFolder, setFedexFolder] = useState('');
  const [shipperName, setShipperName] = useState('');
  const [shipperPerson, setShipperPerson] = useState('');
  const [shipperPhone, setShipperPhone] = useState('');
  const [shipperStreet, setShipperStreet] = useState('');
  const [shipperCity, setShipperCity] = useState('');
  const [shipperState, setShipperState] = useState('');
  const [shipperPostal, setShipperPostal] = useState('');
  const [shipperCountry, setShipperCountry] = useState('');
  // Script metinleri
  const [v2Script, setV2Script] = useState('');
  const [labelScript, setLabelScript] = useState('');
  // Entegrasyon sayıları
  const [marketplaces, setMarketplaces] = useState(1);
  const [carriers, setCarriers] = useState(1);
  const [integrations, setIntegrations] = useState(1);

  return (
    <div className="p-6 grid gap-6">
      <h1 className="text-2xl font-bold">Sipariş Otomasyon Paneli</h1>
      <Tabs defaultValue="ayarlar">
        <TabsList>
          <TabsTrigger value="ayarlar">Ayarlar</TabsTrigger>
          <TabsTrigger value="entegrasyon">Entegrasyonlar</TabsTrigger>
          <TabsTrigger value="senkron">Senkron</TabsTrigger>
          <TabsTrigger value="abonelik">Abonelik</TabsTrigger>
        </TabsList>
        <TabsContent value="ayarlar">
          <Card>
            <CardContent className="p-4 grid gap-4">
              <Input label="Shippo Token" placeholder="Shippo API Anahtarı" value={shippoKey} onChange={e => setShippoKey(e.target.value)} />
              <Input label="Trendyol Tedarikçi ID" placeholder="Supplier ID" value={trendyolSup} onChange={e => setTrendyolSup(e.target.value)} />
              <Input label="Trendyol API Key" placeholder="API Key" value={trendyolKey} onChange={e => setTrendyolKey(e.target.value)} />
              <Input label="Trendyol API Secret" placeholder="API Secret" value={trendyolSecret} onChange={e => setTrendyolSecret(e.target.value)} />
              <hr />
              <Input label="FedEx API Key" placeholder="API Key" value={fedexKey} onChange={e => setFedexKey(e.target.value)} />
              <Input label="FedEx API Secret" placeholder="API Secret" value={fedexSecret} onChange={e => setFedexSecret(e.target.value)} />
              <Input label="FedEx Hesap No" placeholder="Account Number" value={fedexAccount} onChange={e => setFedexAccount(e.target.value)} />
              <Input label="Drive Klasör ID" placeholder="Folder ID" value={fedexFolder} onChange={e => setFedexFolder(e.target.value)} />
              <Input label="Gönderici Şirket" placeholder="Company Name" value={shipperName} onChange={e => setShipperName(e.target.value)} />
              <Input label="Gönderici Kişi" placeholder="Person Name" value={shipperPerson} onChange={e => setShipperPerson(e.target.value)} />
              <Input label="Gönderici Telefon" placeholder="Phone" value={shipperPhone} onChange={e => setShipperPhone(e.target.value)} />
              <Input label="Gönderici Adres" placeholder="Street Lines" value={shipperStreet} onChange={e => setShipperStreet(e.target.value)} />
              <Input label="Şehir" placeholder="City" value={shipperCity} onChange={e => setShipperCity(e.target.value)} />
              <Input label="Eyalet" placeholder="State Code" value={shipperState} onChange={e => setShipperState(e.target.value)} />
              <Input label="Posta Kodu" placeholder="Postal Code" value={shipperPostal} onChange={e => setShipperPostal(e.target.value)} />
              <Input label="Ülke Kodu" placeholder="Country Code" value={shipperCountry} onChange={e => setShipperCountry(e.target.value)} />
              <hr />
              <Textarea label="syncAllToKargov2 Scripti" placeholder="V2 script kodunu buraya yapıştırın" value={v2Script} onChange={e => setV2Script(e.target.value)} rows={6} />
              <Textarea label="Etiket Scripti" placeholder="generateLabel script kodunu buraya yapıştırın" value={labelScript} onChange={e => setLabelScript(e.target.value)} rows={6} />
              <Button>Kaydet & Uygula</Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="entegrasyon">
          <Card>
            <CardContent className="p-4 grid gap-4">
              <div className="grid gap-2">
                <label>Aktif Pazaryeri Sayısı</label>
                <Input type="number" value={marketplaces} onChange={e => setMarketplaces(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <label>Kargo Entegrasyonu Sayısı</label>
                <Input type="number" value={carriers} onChange={e => setCarriers(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <label>Script Bağlantı Adedi</label>
                <Input type="number" value={integrations} onChange={e => setIntegrations(e.target.value)} />
              </div>
              <Button>Entegrasyonları Kaydet</Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="senkron">
          <Card>
            <CardContent className="p-4 grid gap-4">
              <Button>V2 Senkronu Çalıştır</Button>
              <Button>Etiket Oluşturma Akışı</Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="abonelik">
          <Card>
            <CardContent className="p-4 grid gap-4">
              <p>1 aylık ücretsiz deneme başladı. Paket seçin ve iyzico ile ödeyin:</p>
              <ul className="list-disc list-inside text-sm">
                <li>Temel: 1 pazaryeri + 1 kargo – ₺149/ay</li>
                <li>Gelişmiş: 3 pazaryeri + 2 kargo – ₺299/ay</li>
                <li>Profesyonel: Sınırsız – ₺499/ay</li>
              </ul>
              <Button>iyzico ile Öde</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
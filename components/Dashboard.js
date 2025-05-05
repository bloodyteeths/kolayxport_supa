'use client';

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import OrdersTable from "@/components/OrdersTable";
import SettingsForm from '@/components/SettingsForm';

export default function Dashboard() {
  // Script metinleri
  const [v2Script, setV2Script] = useState('');
  const [labelScript, setLabelScript] = useState('');
  // Load saved scripts from localStorage
  useEffect(() => {
    const savedV2 = localStorage.getItem('v2Script');
    const savedLabel = localStorage.getItem('labelScript');
    if (savedV2) setV2Script(savedV2);
    if (savedLabel) setLabelScript(savedLabel);
  }, []);
  
  // Handler to save scripts to localStorage
  const handleSaveScripts = () => {
    localStorage.setItem('v2Script', v2Script);
    localStorage.setItem('labelScript', labelScript);
    alert('Local script backups saved successfully');
  };
  // Entegrasyon sayıları
  const [marketplaces, setMarketplaces] = useState(1);
  const [carriers, setCarriers] = useState(1);
  const [integrations, setIntegrations] = useState(1);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-10 px-6 grid gap-6">
        <h1 className="text-3xl font-semibold text-gray-900">Sipariş Otomasyon Paneli</h1>
        <Tabs defaultValue="ayarlar">
          <TabsList>
            <TabsTrigger value="ayarlar" className="uppercase text-xs tracking-wide">Ayarlar</TabsTrigger>
            <TabsTrigger value="entegrasyon" className="uppercase text-xs tracking-wide">Entegrasyonlar</TabsTrigger>
            <TabsTrigger value="senkron" className="uppercase text-xs tracking-wide">Senkron</TabsTrigger>
            <TabsTrigger value="abonelik" className="uppercase text-xs tracking-wide">Abonelik</TabsTrigger>
          </TabsList>
          <TabsContent value="ayarlar" className="space-y-6">
            <SettingsForm />
            <Card>
              <CardContent className="grid gap-4 pt-6">
                <h3 className="text-lg font-medium">Script Yedekleri (Local Storage)</h3>
                <p className="text-sm text-muted-foreground">Bu bölüm script kodlarınızı tarayıcınızın yerel depolamasına yedeklemenizi sağlar. API anahtarlarınız Google Apps Script özelliklerinde saklanır.</p>
                <Textarea aria-label="syncOrdersToSheet Script Backup" placeholder="syncOrdersToSheet script kodunu buraya yapıştırın (yerel yedekleme için)" value={v2Script} onChange={e => setV2Script(e.target.value)} rows={6} />
                <Textarea aria-label="Label Script Backup" placeholder="Etiket script kodunu buraya yapıştırın (yerel yedekleme için)" value={labelScript} onChange={e => setLabelScript(e.target.value)} rows={6} />
                <Button onClick={handleSaveScripts} variant="outline">Yerel Yedekleri Kaydet</Button>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="entegrasyon">
            <Card>
              <CardContent className="grid gap-6">
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
            <OrdersTable />
          </TabsContent>
          <TabsContent value="abonelik">
            <Card>
              <CardContent className="grid gap-6">
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
    </div>
  );
}
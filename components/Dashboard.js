'use client';

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import OrdersTable from "@/components/OrdersTable";
import SettingsForm from '@/components/SettingsForm';
import { useTranslations } from 'next-intl';

export default function Dashboard() {
  const t = useTranslations('dashboard');
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
    alert(t('backupsSaved'));
  };
  const [marketplaces, setMarketplaces] = useState(1);
  const [carriers, setCarriers] = useState(1);
  const [integrations, setIntegrations] = useState(1);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-10 px-6 grid gap-6">
        <h1 className="text-3xl font-semibold text-gray-900">{t('legacyTitle')}</h1>
        <Tabs defaultValue="ayarlar">
          <TabsList>
            <TabsTrigger value="ayarlar" className="uppercase text-xs tracking-wide">{t('settingsTab')}</TabsTrigger>
            <TabsTrigger value="entegrasyon" className="uppercase text-xs tracking-wide">{t('integrationsTab')}</TabsTrigger>
            <TabsTrigger value="senkron" className="uppercase text-xs tracking-wide">{t('syncTab')}</TabsTrigger>
            <TabsTrigger value="abonelik" className="uppercase text-xs tracking-wide">{t('subscriptionTab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="ayarlar" className="space-y-6">
            <SettingsForm />
            <Card>
              <CardContent className="grid gap-4 pt-6">
                <h3 className="text-lg font-medium">{t('scriptBackups')}</h3>
                <p className="text-sm text-muted-foreground">{t('scriptBackupsDesc')}</p>
                <Textarea aria-label="syncOrdersToSheet Script Backup" placeholder={t('syncScriptPlaceholder')} value={v2Script} onChange={e => setV2Script(e.target.value)} rows={6} />
                <Textarea aria-label="Label Script Backup" placeholder={t('labelScriptPlaceholder')} value={labelScript} onChange={e => setLabelScript(e.target.value)} rows={6} />
                <Button onClick={handleSaveScripts} variant="outline">{t('saveLocalBackups')}</Button>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="entegrasyon">
            <Card>
              <CardContent className="grid gap-6">
                <div className="grid gap-2">
                  <label>{t('activeMarketplaces')}</label>
                  <Input type="number" value={marketplaces} onChange={e => setMarketplaces(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <label>{t('shippingIntegrations')}</label>
                  <Input type="number" value={carriers} onChange={e => setCarriers(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <label>{t('scriptConnections')}</label>
                  <Input type="number" value={integrations} onChange={e => setIntegrations(e.target.value)} />
                </div>
                <Button>{t('saveIntegrations')}</Button>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="senkron">
            <OrdersTable />
          </TabsContent>
          <TabsContent value="abonelik">
            <Card>
              <CardContent className="grid gap-6">
                <p>{t('trialStarted')}</p>
                <ul className="list-disc list-inside text-sm">
                  <li>{t('basicPlan')} – &#8378;149/ay</li>
                  <li>{t('advancedPlan')} – &#8378;299/ay</li>
                  <li>{t('proPlan')} – &#8378;499/ay</li>
                </ul>
                <Button>{t('payWithIyzico')}</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * Shared side effects for Connections tiles, panels and Carriers & API keys rows. Same endpoints and flows
 * as the legacy ConnectionsPanel/SyncPanel: confirm → API → refresh the shared connections cache (the nav
 * updates too). Toast text is i18n only; raw API errors never reach the UI (§12).
 */
import { useCallback, useState } from 'react';
// @ts-ignore -- same import as the legacy panel
import axios from 'axios';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ds/overlay';
import { useToast } from '@/components/ds/feedback';
import type { ConnectionAccount } from '@/lib/integrations/connectionStatus';
import { clearCredentialsPatch, type IntegrationSpec } from '@/lib/settings/integrations';
import type { CredentialsStore } from './useIntegrationCredentials';

export interface ConnectionActions {
  /** `provider` or `provider:accountId` while a disconnect / removal is in flight. */
  busyKey: string | null;
  refreshing: boolean;
  /** Disconnect an OAuth/install provider (all accounts), or one Etsy shop when `account` is given. */
  disconnect: (spec: IntegrationSpec, accounts: ConnectionAccount[], account?: ConnectionAccount) => Promise<void>;
  /** "Refresh all orders": the existing confirm + POST /api/orders/fullSync (no per-provider endpoint exists). */
  refreshAll: () => Promise<void>;
  /** "Remove credentials…": confirm, then PATCH empty strings for that provider's fields. */
  removeCredentials: (spec: IntegrationSpec) => Promise<void>;
}

export function useConnectionActions(opts: {
  mutateConnections: () => Promise<unknown>;
  credentials: CredentialsStore;
  onAfterDisconnect?: (spec: IntegrationSpec) => void;
}): ConnectionActions {
  const t = useTranslations('settings');
  const tc = useTranslations('settings.connections');
  const confirm = useConfirm();
  const toast = useToast();
  const { mutateConnections, credentials, onAfterDisconnect } = opts;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const disconnect = useCallback(async (spec: IntegrationSpec, accounts: ConnectionAccount[], account?: ConnectionAccount) => {
    const name = account?.name ?? spec.name;
    const ok = await confirm({
      title: tc('disconnectConfirm.title', { provider: name }),
      body: t('disconnectKeepsData'),
      items: (account ? [account] : accounts).map((a) => a.name).filter(Boolean),
      confirmLabel: tc('disconnectConfirm.confirm'),
      tone: 'danger',
    });
    if (!ok) return;
    const key = account ? `${spec.id}:${account.id}` : spec.id;
    setBusyKey(key);
    try {
      if (spec.id === 'etsy') {
        const targets = account ? [account] : accounts;
        for (const a of targets) await axios.post('/api/integrations/etsy/shops', { shopId: a.id, action: 'delete' });
      } else if (spec.disconnect) {
        const d = spec.disconnect;
        if (d.method === 'delete') await axios.delete(d.url, d.body ? { data: d.body } : undefined);
        else await axios.post(d.url, d.body ?? {});
      }
      onAfterDisconnect?.(spec);
      toast.success(tc('toast.disconnected', { provider: name }));
    } catch {
      toast.error(tc('toast.disconnectFailed', { provider: name }), { persist: false });
    } finally {
      setBusyKey(null);
      await mutateConnections();
    }
  }, [confirm, mutateConnections, onAfterDisconnect, t, tc, toast]);

  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    const ok = await confirm({ title: tc('refreshConfirm.title'), body: tc('refreshConfirm.body'), confirmLabel: tc('menu.refreshAll') });
    if (!ok) return;
    setRefreshing(true);
    try {
      const res = await fetch('/api/orders/fullSync', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(tc('toast.refreshStarted'));
    } catch {
      toast.error(tc('toast.refreshFailed'), { action: { onClick: () => void refreshAll() } });
    } finally {
      setRefreshing(false);
      await mutateConnections();
    }
  }, [confirm, mutateConnections, refreshing, tc, toast]);

  const removeCredentials = useCallback(async (spec: IntegrationSpec) => {
    const ok = await confirm({
      title: tc('removeConfirm.title', { provider: spec.name }),
      body: tc('removeConfirm.body', { provider: spec.name }),
      confirmLabel: tc('removeConfirm.confirm'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusyKey(spec.id);
    try {
      await credentials.save(clearCredentialsPatch(spec.id));
      toast.success(tc('toast.credentialsRemoved', { provider: spec.name }));
    } catch {
      toast.error(tc('toast.removeFailed', { provider: spec.name }), { persist: false });
    } finally {
      setBusyKey(null);
      await mutateConnections();
    }
  }, [confirm, credentials, mutateConnections, tc, toast]);

  return { busyKey, refreshing, disconnect, refreshAll, removeCredentials };
}

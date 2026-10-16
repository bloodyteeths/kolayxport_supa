/**
 * Settings › Carriers & API keys (`?tab=apiKeys`, settings-billing-pricing §5.1): one row per credential
 * provider in a card per group (Marketplaces / Shipping / Accounting). Every row opens the same
 * ProviderCredentialsPanel as the Connections tiles. No page save bar: every save goes through the panel.
 * `&provider=<id>` opens that provider's panel; the param is removed when it closes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { Section, useIsMobile } from '@/components/ds/page';
import { LogoTile } from '@/components/ds/data';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Button } from '@/components/ds/inputs';
import { ErrorState, ListSkeleton } from '@/components/ds/state';
import { neutral as n, px, radius, space, type as typeScale } from '@/lib/ds/tokens';
import { connectionStatus } from '@/lib/ds/status/connections';
import type { ConnectionStatusKey } from '@/lib/ds/status/vocabulary';
import { useConnections } from '@/lib/hooks/useConnections';
import {
  CREDENTIAL_GROUPS,
  credentialHints,
  getIntegration,
  integrationsInGroup,
  type IntegrationSpec,
} from '@/lib/settings/integrations';
import { ListRow } from './ListRow';
import { ProviderCredentialsPanel } from './ProviderCredentialsPanel';
import { useCredentialsStore, type CredentialsStore } from './useIntegrationCredentials';
import { useStoreAllowance } from './useStoreAllowance';
import { useSettingsShell } from '../settingsNav';

export interface CredentialsSectionProps {
  /** Optional: an already-loaded settings store (avoids a second `/api/user/settings` subscriber). */
  credentials?: CredentialsStore;
}

export function CredentialsSection({ credentials: injected }: CredentialsSectionProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('settings.connections');
  const router = useRouter();
  const isPhone = useIsMobile();
  const { connections, isLoading, isValidating, error, get, mutate } = useConnections();
  const credentials = useCredentialsStore(injected);
  const allowance = useStoreAllowance();
  const [openId, setOpenId] = useState<string | null>(null);

  const shell = useSettingsShell();
  const routerProvider = typeof router?.query?.provider === 'string' ? router.query.provider : null;
  const qProvider = shell ? shell.provider : routerProvider;
  const handled = useRef<string | null>(null);
  useEffect(() => { if (!qProvider) handled.current = null; }, [qProvider]);
  useEffect(() => {
    if ((!shell && !router?.isReady) || !qProvider || handled.current === qProvider) return;
    handled.current = qProvider;
    if (getIntegration(qProvider)?.inCredentialsList) setOpenId(qProvider);
  }, [shell, router?.isReady, qProvider]);

  const close = useCallback(() => {
    setOpenId(null);
    if (!qProvider) return;
    if (shell) { shell.clearProvider(); return; }
    if (router?.isReady) {
      const rest = { ...router.query };
      delete rest.provider;
      void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [qProvider, router, shell]);

  // GET /api/user/settings failed and nothing loaded: an inline error with Retry, never an endless skeleton.
  const credentialsFailed = credentials.loadFailed && !credentials.loaded;
  const [retryingCredentials, setRetryingCredentials] = useState(false);
  const retryCredentials = useCallback(async () => {
    setRetryingCredentials(true);
    try { await credentials.refetch(); } catch { /* loadFailed stays true; the ErrorState stays */ } finally { setRetryingCredentials(false); }
  }, [credentials]);
  const loading = (isLoading && !connections) || !credentials.loaded;
  const checkFailed = !!error;
  const statusOf = (spec: IntegrationSpec): ConnectionStatusKey => {
    const e = spec.id === 'chrome' ? undefined : get(spec.id);
    return connectionStatus(e, { checkFailed: checkFailed || !e });
  };
  const knownOf = (spec: IntegrationSpec): ConnectionStatusKey => {
    const e = spec.id === 'chrome' ? undefined : get(spec.id);
    return connectionStatus(e ?? { connected: false });
  };

  const [cs, cl] = typeScale.caption;
  const header = { id: 'settings-credentials', title: isPhone ? undefined : t('credentials.title'), description: t('credentials.description') };

  if (error && !connections && !isLoading) {
    return (
      <Section {...header} data-testid="credentials-section">
        <ErrorState variant="inline" title={tc('loadFailed')} onRetry={() => void mutate()} retrying={isValidating} />
      </Section>
    );
  }

  if (credentialsFailed) {
    return (
      <Section {...header} data-testid="credentials-section">
        <ErrorState
          variant="inline"
          title={t('credentials.loadFailed')}
          onRetry={() => void retryCredentials()}
          retrying={retryingCredentials}
          data-testid="credentials-load-failed"
        />
      </Section>
    );
  }

  return (
    <Section {...header} data-testid="credentials-section">
      {CREDENTIAL_GROUPS.map((g, gi) => {
        const specs = integrationsInGroup(g, { credentialsOnly: true });
        if (specs.length === 0) return null;
        return (
          <div key={g} data-testid={`credentials-group-${g}`}>
            <h3 style={{ margin: `${px(gi === 0 ? space[4] : space[6])} 0 ${px(space[2])}`, fontSize: cs, lineHeight: px(cl), fontWeight: 500, color: n[500] }}>
              {tc(`group.${g}` as 'group.marketplaces')}
            </h3>
            <div style={{ border: `1px solid ${n[200]}`, borderRadius: px(radius.md), background: n[0], padding: `0 ${px(space[4])}` }}>
              {loading ? (
                <ListSkeleton rows={specs.length} leading="thumb" />
              ) : specs.map((spec, i) => {
                const known = knownOf(spec);
                const label = known === 'not_connected' ? tc('action.setUp') : known === 'incomplete' ? tc('action.finishSetup') : t('credentials.configure');
                const hint = credentialHints(spec.id, credentials.values)
                  .map((h) => `${t(`credentials.field.${h.field.labelKey}` as 'credentials.field.apiKey')} ${h.value}`)
                  .join(' · ');
                return (
                  <ListRow
                    key={spec.id}
                    id={`credentials-row-${spec.id}`}
                    data-testid={`credentials-row-${spec.id}`}
                    divider={i > 0}
                    stacked={false} // phones too: one row with a small Edit on the right (stacked full-width buttons doubled each row)
                    leading={<LogoTile brand={spec.logo} size={32} label={spec.name} />}
                    title={spec.name}
                    status={<StatusPill domain="connection" status={statusOf(spec)} size="sm" />}
                    caption={hint || undefined}
                    captionMono
                    trailing={
                      <Button variant="secondary" size="sm" onClick={() => setOpenId(spec.id)} data-testid={`credentials-row-${spec.id}-action`}>
                        {label}
                      </Button>
                    }
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      <ProviderCredentialsPanel
        open={!!openId}
        providerId={openId}
        onClose={close}
        store={credentials}
        status={openId ? statusOf(getIntegration(openId)!) : null}
        onSaved={() => mutate()}
        allowance={allowance}
        isPhone={isPhone}
      />
    </Section>
  );
}

export default CredentialsSection;

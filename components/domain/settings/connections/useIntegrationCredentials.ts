/**
 * The `integrationSettings` slice for the credential panels (§5.2), over the SAME SWR key the shell uses
 * (`/api/user/settings`, components/ds/shell/AppShell SETTINGS_KEY), so it is usually already cached and a
 * save refreshes the shell too.
 *
 * Saving sends only that provider's keys — `PATCH /api/user/settings { integrationSettings: { … } }` —
 * which is the existing contract: masked secrets are stripped (here and server-side) and fields that are
 * not in the body stay untouched (Prisma ignores `undefined`). Values come back masked on refetch.
 *
 * Group A's `useSettings().saveSlice` covers the page-level save bar; the panels keep a local draft so
 * they never mark the whole page dirty. A caller that already holds the settings payload can pass its
 * own store to the sections instead (`CredentialsStore`).
 */
import useSWR, { useSWRConfig } from 'swr';
import { useCallback, useMemo } from 'react';
// @ts-ignore -- same import as lib/hooks/useSettings.ts
import axios from 'axios';
import { isMaskedValue, type CredentialValues } from '@/lib/settings/integrations';
import { useSettingsContext } from '@/lib/hooks/useSettings';

export const SETTINGS_SWR_KEY = '/api/user/settings';

export interface CredentialsStore {
  /** Masked values from the server; `null` until loaded. */
  values: CredentialValues | null;
  loaded: boolean;
  /** The settings request failed and nothing is cached. */
  loadFailed: boolean;
  /** PATCHes one provider's keys. Rejects with the axios error (status in `error.response.status`). */
  save: (patch: Record<string, string>) => Promise<void>;
  refetch: () => Promise<void>;
}

type SettingsPayload = { integrationSettings?: CredentialValues | null } & Record<string, unknown>;

const fetcher = async (url: string): Promise<SettingsPayload> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return res.json();
};

/** Never send a mask back as a value. */
export function withoutMasks(patch: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => !isMaskedValue(v)));
}

export function useIntegrationCredentials(enabled = true): CredentialsStore {
  const { data, error, mutate } = useSWR<SettingsPayload>(enabled ? SETTINGS_SWR_KEY : null, fetcher, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 2_000,
    keepPreviousData: true,
  });

  const refetch = useCallback(async () => { await mutate(); }, [mutate]);

  const save = useCallback(async (patch: Record<string, string>) => {
    await axios.patch(SETTINGS_SWR_KEY, { integrationSettings: withoutMasks(patch) }, { withCredentials: true });
    await mutate();
  }, [mutate]);

  return {
    values: data ? (data.integrationSettings ?? {}) : null,
    loaded: data !== undefined,
    loadFailed: !!error && data === undefined,
    save,
    refetch,
  };
}

/**
 * The store the sections use. Inside Group A's `SettingsProvider` it reads the page's `useSettings()`
 * instance (values = the integrationSettings slice, which only these panels edit, so it is always clean);
 * a save PATCHes the provider's keys, then `refetch()` (clean slices take the server's masked values) and
 * revalidates the shared SWR key so the shell sees it too. Outside the provider it falls back to
 * `useIntegrationCredentials()`. An explicitly injected store wins.
 */
export function useCredentialsStore(injected?: CredentialsStore): CredentialsStore {
  const ctx = useSettingsContext();
  const own = useIntegrationCredentials(!injected && !ctx);
  const { mutate: globalMutate } = useSWRConfig();

  const ctxRefetch = ctx?.refetch;
  const save = useCallback(async (patch: Record<string, string>) => {
    await axios.patch(SETTINGS_SWR_KEY, { integrationSettings: withoutMasks(patch) }, { withCredentials: true });
    await ctxRefetch?.();
    void globalMutate(SETTINGS_SWR_KEY);
  }, [ctxRefetch, globalMutate]);
  const refetch = useCallback(async () => { await ctxRefetch?.(); }, [ctxRefetch]);

  const values = ctx ? ((ctx.formData.integrationSettings ?? {}) as CredentialValues) : null;
  const loaded = !!ctx?.initialDataLoaded;
  const loadFailed = !!ctx?.loadFailed;
  const fromCtx = useMemo<CredentialsStore>(
    () => ({ values: loaded ? values : null, loaded, loadFailed, save, refetch }),
    [values, loaded, loadFailed, save, refetch],
  );

  if (injected) return injected;
  return ctx ? fromCtx : own;
}

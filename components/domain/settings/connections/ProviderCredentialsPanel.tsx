/**
 * ProviderCredentialsPanel (§5.2): one provider's keys in a `SidePanel sm` (sheet below 600). Opened from a
 * credential tile, a Carriers & API keys row, or `&provider=<id>`.
 *
 * - Fields come from the registry (`lib/settings/integrations.ts`); secrets go through CredentialField's
 *   unchanged mask logic.
 * - Validation on blur and on Save: required-together + digits-only supplier ID. Save stays enabled; on errors
 *   it focuses the first one and shows the summary Banner.
 * - Save → PATCH only this provider's keys → toast → `onSaved()` (connections mutate) → settings refetch
 *   (values come back masked) → close. Failure keeps the panel open with an inline danger Banner + a toast
 *   with Retry. A 402 shows the store-limit copy as a warning Banner instead. Forward-compatible: today's
 *   settings PATCH never returns 402 (the store limit for credential providers is a backend request).
 * - GET /api/user/settings failed: an inline ErrorState with Retry replaces the bones; Save stays disabled
 *   with a "retry first" reason (never an endless loading state).
 * - Dirty close/Esc → the SidePanel's nested "Discard changes?" confirm. ⌘S / ⌘↵ save.
 * - No optimistic UI and no fake "test connection" (§2.3).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SidePanel, type SaveState } from '@/components/ds/overlay';
import { Banner, useToast } from '@/components/ds/feedback';
import { LogoTile } from '@/components/ds/data';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Button } from '@/components/ds/inputs';
import { Bone, ErrorState } from '@/components/ds/state';
import { px, space } from '@/lib/ds/tokens';
import { icons } from '@/lib/ds/icons';
import type { ConnectionStatusKey } from '@/lib/ds/status/vocabulary';
import {
  credentialPatch,
  getIntegration,
  validateCredentials,
  type CredentialError,
  type CredentialFieldSpec,
  type CredentialValues,
} from '@/lib/settings/integrations';
import { CredentialField } from './CredentialField';
import { storeLimitModel, type StoreAllowance } from './connectionView';
import type { CredentialsStore } from './useIntegrationCredentials';

export interface ProviderCredentialsPanelProps {
  open: boolean;
  /** Registry id of a credential provider (trendyol, veeqo, shippo, fedex, ups, mng, parasut). */
  providerId: string | null;
  onClose: () => void;
  store: CredentialsStore;
  status?: ConnectionStatusKey | null;
  /** Called after a successful save (refresh `/api/integrations/status`). */
  onSaved?: () => void | Promise<unknown>;
  allowance?: StoreAllowance;
  isPhone?: boolean;
}

/** Pairs that sit side by side ≥ 600px (DS natural-pair rule). */
const PAIR_NEXT: Record<string, string> = { apiKey: 'apiSecret', clientId: 'clientSecret', username: 'password' };

function rowsOf(fields: CredentialFieldSpec[]): CredentialFieldSpec[][] {
  const rows: CredentialFieldSpec[][] = [];
  for (let i = 0; i < fields.length; i++) {
    const a = fields[i];
    const b = fields[i + 1];
    if (b && PAIR_NEXT[a.labelKey] === b.labelKey) {
      rows.push([a, b]);
      i++;
    } else rows.push([a]);
  }
  return rows;
}

const pick = (values: CredentialValues | null, names: string[]): Record<string, string> =>
  Object.fromEntries(names.map((nm) => [nm, typeof values?.[nm] === 'string' ? (values[nm] as string) : '']));

type SaveFailure = 'failed' | 'storeLimit' | null;

export function ProviderCredentialsPanel({
  open, providerId, onClose, store, status, onSaved, allowance, isPhone,
}: ProviderCredentialsPanelProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('settings.connections');
  const tb = useTranslations('billing');
  const toast = useToast();
  const spec = getIntegration(providerId);
  const fields = useMemo(() => spec?.fields ?? [], [spec]);
  const names = useMemo(() => fields.map((x) => x.name), [fields]);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure>(null);
  /** Hepsiburada only: the live check after save failed (creds are saved; HB refused them or our integrator). */
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [retryingLoad, setRetryingLoad] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const seededFor = useRef<string | null>(null);

  // Seed the draft once per open (and once the settings payload arrives); never overwrite typing.
  useEffect(() => {
    if (!open) { seededFor.current = null; return; }
    if (!providerId || !store.loaded) return;
    if (seededFor.current === providerId) return;
    seededFor.current = providerId;
    const v = pick(store.values, names);
    setDraft(v); setInitial(v); setTouched({}); setShowAll(false); setFailure(null);
  }, [open, providerId, store.loaded, store.values, names]);

  const dirty = names.some((nm) => (draft[nm] ?? '') !== (initial[nm] ?? ''));
  const allErrors = useMemo(() => (providerId ? validateCredentials(providerId, draft) : {}), [providerId, draft]);
  const visibleErrors = useMemo(() => {
    const out: Record<string, CredentialError> = {};
    for (const [k, v] of Object.entries(allErrors)) if (showAll || touched[k]) out[k] = v;
    return out;
  }, [allErrors, showAll, touched]);

  const labelOf = useCallback((x: CredentialFieldSpec) => t(`credentials.field.${x.labelKey}` as 'credentials.field.apiKey'), [t]);
  const errorText = (x: CredentialFieldSpec): string | null => {
    const e = visibleErrors[x.name];
    if (!e) return null;
    if (e.code === 'digits') return t('credentials.digitsOnly');
    if (e.code === 'uuid') return t('credentials.uuidFormat');
    return t('credentials.requiredWith', { field: labelOf(x) });
  };

  const focusField = (name: string) => {
    const el = bodyRef.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    el?.focus();
  };

  const save = useCallback(async () => {
    if (!providerId || !spec || saving) return;
    const errs = validateCredentials(providerId, draft);
    const first = names.find((nm) => errs[nm]);
    if (first) {
      setShowAll(true);
      focusField(first);
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      await store.save(credentialPatch(providerId, draft));
      setVerifyError(null);
      if (providerId === 'hepsiburada' && Object.values(draft).some(filled)) {
        const check = await verifyHepsiburada();
        if (!check.ok) {
          await onSaved?.();
          setVerifyError(t(`credentials.hepsiburadaVerify.${check.reason}` as 'credentials.hepsiburadaVerify.failed'));
          return;
        }
      }
      toast.success(t('credentials.saved', { provider: spec.name }));
      await onSaved?.();
      onClose();
    } catch (e: unknown) {
      const code = (e as { response?: { status?: number } })?.response?.status;
      if (code === 402) {
        setFailure('storeLimit');
      } else {
        setFailure('failed');
        toast.error(t('credentials.saveFailed'), { action: { onClick: () => void save() } });
      }
    } finally {
      setSaving(false);
    }
  }, [providerId, spec, draft, names, saving, store, onSaved, onClose, t, toast]);

  const retryLoad = useCallback(async () => {
    setRetryingLoad(true);
    try { await store.refetch(); } catch { /* loadFailed stays true */ } finally { setRetryingLoad(false); }
  }, [store]);

  if (!spec || !spec.fields) return null;

  const loadFailed = store.loadFailed && !store.loaded;

  const errorCount = Object.keys(allErrors).length;
  const saveState: SaveState = saving ? 'saving' : failure === 'failed' ? 'error' : dirty ? 'dirty' : 'idle';
  const limit = storeLimitModel(allowance ?? { stripeUpsell: undefined });

  const headerSlot = failure === 'storeLimit' ? (
    <Banner
      tone="warning"
      title={limit.neutral ? tc('storeLimit.neutralTitle') : tc('storeLimit.title', { limit: limit.limit })}
      action={limit.neutral ? undefined : { id: 'store-limit-compare', label: tc('comparePlans'), href: limit.compareHref }}
      data-testid="credentials-store-limit"
    >
      {limit.neutral
        ? tc('storeLimit.neutralBody')
        : tc('storeLimit.body', {
          plan: tb(`planName.${limit.plan}` as 'planName.growth'), limit: limit.limit,
          nextPlan: tb(`planName.${limit.nextPlan}` as 'planName.pro'), nextLimit: limit.nextLimit,
        })}
    </Banner>
  ) : verifyError ? (
    <Banner tone="danger" title={t('credentials.hepsiburadaVerify.title')} data-testid="credentials-verify-failed">{verifyError}</Banner>
  ) : failure === 'failed' ? (
    <Banner tone="danger" title={t('credentials.saveFailed')} data-testid="credentials-save-failed" />
  ) : showAll && errorCount > 0 ? (
    <Banner tone="danger" title={t('credentials.fixFields', { count: errorCount })} data-testid="credentials-fix-fields" />
  ) : undefined;

  return (
    <SidePanel padded
      open={open}
      onClose={onClose}
      size="sm"
      title={spec.name}
      leading={<LogoTile brand={spec.logo} size={32} label={spec.name} />}
      status={status ? <StatusPill domain="connection" status={status} /> : undefined}
      meta={tc(`blurb.${spec.id}` as 'blurb.etsy')}
      dirty={dirty && !saving}
      saveState={saveState}
      onSave={() => void save()}
      headerSlot={headerSlot}
      secondary={{ id: 'credentials-cancel', label: t('credentials.cancel'), onClick: onClose }}
      primary={{
        id: 'credentials-save',
        label: t('credentials.save'),
        loadingLabel: t('credentials.saving'),
        loading: saving,
        // A connected store with nothing changed has nothing to save.
        disabled: !store.loaded || (status === 'connected' && !dirty),
        disabledReason: loadFailed ? t('credentials.loadFailedReason') : !store.loaded ? t('credentials.loading') : undefined,
        onClick: () => void save(),
      }}
      data-testid="credentials-panel"
    >
      <div ref={bodyRef} style={{ display: 'flex', flexDirection: 'column', gap: px(space[4]) }}>
        {loadFailed ? (
          <ErrorState
            variant="inline"
            title={t('credentials.loadFailed')}
            onRetry={() => void retryLoad()}
            retrying={retryingLoad}
            data-testid="credentials-panel-load-failed"
          />
        ) : !store.loaded ? (
          fields.map((x) => (
            <div key={x.name} style={{ display: 'flex', flexDirection: 'column', gap: px(space[2]) }} data-testid="credentials-skeleton">
              <Bone w={96} h={12} />
              <Bone w="100%" h={40} />
            </div>
          ))
        ) : (
          rowsOf(fields).map((row, ri) => (
            <div
              key={row.map((x) => x.name).join('+')}
              style={{ display: 'grid', gridTemplateColumns: row.length === 2 && !isPhone ? '1fr 1fr' : '1fr', gap: px(space[4]) }}
            >
              {row.map((x, ci) => (
                <CredentialField
                  key={x.name}
                  name={x.name}
                  label={labelOf(x)}
                  value={draft[x.name] ?? ''}
                  secret={x.secret}
                  numeric={x.pattern === 'digits'}
                  width={row.length === 2 ? 'full' : x.width ?? 'full'}
                  // Only a new connection starts typing: on a connected store the phone keyboard popped up for nothing.
                  autoFocus={ri === 0 && ci === 0 && status !== 'connected' && !isPhone}
                  error={errorText(x)}
                  onChange={(nm, v) => { setDraft((d) => ({ ...d, [nm]: v })); if (failure === 'failed') setFailure(null); }}
                  onBlur={(nm) => setTouched((tt) => ({ ...tt, [nm]: true }))}
                />
              ))}
            </div>
          ))
        )}
        <div>
          <Button variant="ghost" size="sm" href={spec.guideHref} external icon={icons.externalLink}>
            {t('credentials.whereToFind')}
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}

export default ProviderCredentialsPanel;

const filled = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

type HbVerifyReason = 'credentials' | 'integrator' | 'pending' | 'failed';

/** Live check of the saved Hepsiburada credentials (`POST /api/hepsiburada/test-connection`). */
async function verifyHepsiburada(): Promise<{ ok: true } | { ok: false; reason: HbVerifyReason }> {
  try {
    const res = await fetch('/api/hepsiburada/test-connection', { method: 'POST', credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.ok) return { ok: true };
    const reason: HbVerifyReason = ['credentials', 'integrator', 'pending'].includes(body?.reason) ? body.reason : 'failed';
    return { ok: false, reason };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

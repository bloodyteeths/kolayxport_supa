// components/domain/settings/DeleteAccountSection.tsx — Settings › Preferences "Delete account" (Google Play account
// deletion requirement; public twin: /hesap-silme). Type-to-confirm with the account email, plus the password for
// email/password accounts (the server ignores it for Google-only accounts). POST /api/user/delete-account, then
// sign out to /hesap-silme?deleted=1.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { signOut, useSession } from 'next-auth/react';
import { Button, FormField, TextField } from '@/components/ds/inputs';
import { Section } from '@/components/ds/page';
import { Modal } from '@/components/ds/overlay';
import { SettingsRow } from './sender';

export function DeleteAccountSection() {
  const t = useTranslations('settings.deleteAccount');
  const { data: session } = useSession();
  const email = session?.user?.email ?? '';
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = email !== '' && confirm.trim().toLowerCase() === email.trim().toLowerCase();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setConfirm('');
    setPassword('');
    setError(null);
  };

  const run = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/user/delete-account', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm, password }),
      });
      if (res.ok) {
        await signOut({ callbackUrl: '/hesap-silme?deleted=1' });
        return;
      }
      const code = ((await res.json().catch(() => null)) as { code?: string } | null)?.code;
      setError(code === 'wrongPassword' ? t('wrongPassword') : code === 'confirmMismatch' ? t('confirmMismatch') : t('failed'));
    } catch {
      setError(t('failed'));
    }
    setBusy(false);
  };

  return (
    <Section variant="card" id="delete-account-region">
      <SettingsRow label={t('title')} helper={t('helper')} bare data-testid="preferences-row-delete-account">
        {() => (
          <Button variant="danger" size="sm" onClick={() => setOpen(true)} data-testid="delete-account-open">
            {t('open')}
          </Button>
        )}
      </SettingsRow>
      <Modal
        open={open}
        onClose={close}
        title={t('modalTitle')}
        description={t('modalBody')}
        focusSecondary
        primary={{ id: 'delete-account', label: t('confirmButton'), tone: 'danger', onClick: () => { void run(); }, disabled: !matches, loading: busy }}
        data-testid="delete-account-modal"
      >
        <FormField label={t('confirmLabel', { email })}>
          <TextField value={confirm} onChange={(v) => setConfirm(v)} type="email" autoComplete="off" data-testid="delete-account-confirm" />
        </FormField>
        <FormField label={t('passwordLabel')} helper={t('passwordHelper')} error={error}>
          <TextField value={password} onChange={(v) => setPassword(v)} type="password" autoComplete="current-password" invalid={!!error} data-testid="delete-account-password" />
        </FormField>
      </Modal>
    </Section>
  );
}

export default DeleteAccountSection;

/**
 * DS credential input (§5.2): FormField label above, TextField, a Show/Hide toggle for secrets.
 * Mask logic is the legacy ApiKeysPanel.onSecretChange, unchanged, via `nextSecretValue`
 * (lib/settings/integrations.ts). `name` passes through so the PATCH keys stay identical.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, FormField, TextField } from '@/components/ds/inputs';
import { isMaskedValue, nextSecretValue } from '@/lib/settings/integrations';

export interface CredentialFieldProps {
  name: string;
  label: string;
  value: string;
  onChange: (name: string, value: string) => void;
  onBlur?: (name: string) => void;
  secret?: boolean;
  error?: string | null;
  width?: 'short' | 'medium' | 'full';
  numeric?: boolean;
  autoFocus?: boolean;
  'data-testid'?: string;
}

export function CredentialField({
  name, label, value, onChange, onBlur, secret, error, width = 'full', numeric, autoFocus, 'data-testid': testId,
}: CredentialFieldProps) {
  const t = useTranslations('settings');
  const [show, setShow] = useState(false);
  const masked = secret && isMaskedValue(value);

  return (
    <FormField
      label={label}
      width={width}
      error={error ?? undefined}
      helper={masked ? t('credential.savedReplaceHint') : undefined}
      data-testid={testId ?? `credential-${name}`}
    >
      <TextField
        name={name}
        value={value}
        type={secret && !show ? 'password' : 'text'}
        autoComplete={secret ? 'new-password' : 'off'}
        inputMode={numeric ? 'numeric' : undefined}
        mono={numeric}
        autoFocus={autoFocus}
        onChange={(typed) => onChange(name, secret ? nextSecretValue(value, typed) : typed)}
        onBlur={() => onBlur?.(name)}
        endAction={secret && !masked ? (
          <Button variant="ghost" size="sm" onClick={() => setShow((s) => !s)} aria-label={show ? t('credential.hideValue') : t('credential.showValue')}>
            {show ? t('credential.hideValue') : t('credential.showValue')}
          </Button>
        ) : undefined}
      />
    </FormField>
  );
}

export default CredentialField;

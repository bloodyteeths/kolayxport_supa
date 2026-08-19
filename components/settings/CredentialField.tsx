import React, { useState } from 'react';
import { TextField, InputAdornment, IconButton, Tooltip } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useTranslations } from 'next-intl';

interface CredentialFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, value: string) => void;
  secret?: boolean;
  placeholder?: string;
  helperText?: string;
}

/**
 * Labeled text/password field with a show/hide toggle for secrets.
 * Passes `name` through unchanged so the PATCH payload keys stay identical.
 */
export default function CredentialField({
  label, name, value, onChange, secret, placeholder, helperText,
}: CredentialFieldProps) {
  const t = useTranslations('settings');
  const [show, setShow] = useState(false);

  return (
    <TextField
      fullWidth
      label={label}
      name={name}
      type={secret && !show ? 'password' : 'text'}
      value={value}
      placeholder={placeholder}
      helperText={helperText}
      onChange={(e) => onChange(e.target.name, e.target.value)}
      InputProps={secret ? {
        endAdornment: (
          <InputAdornment position="end">
            {value && (
              <Tooltip title={t('credential.secureHint')}>
                <LockOutlinedIcon sx={{ fontSize: 16, color: 'text.disabled', mr: 0.5 }} />
              </Tooltip>
            )}
            <Tooltip title={show ? t('credential.hideValue') : t('credential.showValue')}>
              <IconButton size="small" onClick={() => setShow(s => !s)} edge="end" tabIndex={-1}>
                {show ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
              </IconButton>
            </Tooltip>
          </InputAdornment>
        ),
      } : undefined}
    />
  );
}

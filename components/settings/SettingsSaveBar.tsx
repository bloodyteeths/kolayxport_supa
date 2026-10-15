// components/settings/SettingsSaveBar.tsx — shim (settings §17 Group A): the legacy props on the DS
// `StickyActionBar` (desktop: sticky footer of the content column; mobile: fixed above the tab bar).
// Rendered only while dirty, like every DS save bar. The integrator deletes it once the legacy settings
// page is gone (settings §17 G).
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { StickyActionBar } from '@/components/ds/page';

interface SettingsSaveBarProps {
  isDirty: boolean;
  isSubmitting: boolean;
  onSave: () => void;
  /** Adds the "Discard" secondary. */
  onDiscard?: () => void;
}

export default function SettingsSaveBar({ isDirty, isSubmitting, onSave, onDiscard }: SettingsSaveBarProps) {
  const t = useTranslations('settings.saveBar');
  return (
    <StickyActionBar
      visible={isDirty || isSubmitting}
      status={t('status')}
      secondary={onDiscard ? { id: 'settings-discard', label: t('discard'), onClick: onDiscard, disabled: isSubmitting } : undefined}
      primary={{
        id: 'settings-save',
        label: t('save'),
        onClick: onSave,
        loading: isSubmitting,
        loadingLabel: t('saving'),
        shortcut: 'mod+s',
      }}
      data-testid="settings-save-bar"
    />
  );
}

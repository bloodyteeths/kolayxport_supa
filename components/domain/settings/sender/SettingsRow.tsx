// components/domain/settings/sender/SettingsRow.tsx — the settings §0.1 "SettingsRow (240px label column)" layout
// for Sender profile and Preferences. DS §4.2 lists SettingsRow, but M1 did not ship it, so this is a domain
// composition built from DS parts only: FormField keeps the accessible label (visually hidden), the visible
// label sits in the 240px column (stacked above the control below 900px). Replace with the DS component once
// it lands (outOfScopeNeeds, settings group C).
import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { FormField, type FormFieldProps } from '@/components/ds/inputs';
import { useIsMobile } from '@/components/ds/page';
import { neutral, px, space, type as typeScale } from '@/lib/ds/tokens';

export const SETTINGS_LABEL_COL = 240;

export interface SettingsRowProps {
  label: string;
  optional?: boolean;
  required?: boolean;
  helper?: ReactNode;
  error?: string | null;
  width?: FormFieldProps['width'];
  /** Renders the control with the id it must use (DS controls also read it from the FormField context). */
  children: (id: string) => ReactNode;
  /** No FormField wrapper: the control names itself (Switch with a label, a link row, a nested form). */
  bare?: boolean;
  'data-testid'?: string;
}

export function SettingsRow({
  label, optional, required, helper, error, width = 'medium', children, bare, 'data-testid': testId,
}: SettingsRowProps) {
  const t = useTranslations('ds.inputs');
  const mobile = useIsMobile();
  const rid = useId();
  const id = `sr${rid.replace(/:/g, '')}`;
  return (
    <div
      data-testid={testId}
      style={{
        display: 'grid',
        gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : `${SETTINGS_LABEL_COL}px minmax(0, 1fr)`,
        columnGap: px(space[4]),
        rowGap: px(space[1.5]),
        padding: `${px(space[3])} 0`,
        alignItems: 'start',
      }}
    >
      <div
        aria-hidden
        style={{
          fontSize: typeScale.label[0], lineHeight: px(typeScale.label[1]), fontWeight: typeScale.label[2],
          color: neutral[800], paddingTop: mobile || bare ? 0 : px(11),
        }}
      >
        {label}
        {optional ? <span style={{ color: neutral[500], fontWeight: 400, marginLeft: px(space[1]) }}>{t('formField.optional')}</span> : null}
      </div>
      <div style={{ minWidth: 0 }}>
        {bare ? children(id) : (
          <FormField label={label} htmlFor={id} hideLabel optional={optional} required={required} helper={helper} error={error} width={width}>
            {children(id)}
          </FormField>
        )}
      </div>
    </div>
  );
}

export default SettingsRow;

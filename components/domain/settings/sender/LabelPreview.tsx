// components/domain/settings/sender/LabelPreview.tsx — settings §6 "Label preview": the sender block as the
// label prints it (mono 13, neutral-50 box). Text is shown as entered: no case change (P5, Turkish İ/ı).
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useFormatters } from '@/lib/format';
import { font, neutral, px, radius, space, type as typeScale } from '@/lib/ds/tokens';
import { labelPreviewLines, type SenderProfile } from './senderModel';

export interface LabelPreviewProps {
  profile: SenderProfile;
  'data-testid'?: string;
}

export function countryDisplayName(code: string, intlLocale: string): string {
  try {
    return new Intl.DisplayNames([intlLocale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function LabelPreview({ profile, 'data-testid': testId = 'sender-label-preview' }: LabelPreviewProps) {
  const t = useTranslations('settings.sender');
  const { intlLocale } = useFormatters();
  const lines = useMemo(() => labelPreviewLines(profile, (c) => countryDisplayName(c, intlLocale)), [profile, intlLocale]);
  return (
    <div
      data-testid={testId}
      aria-label={t('labelPreview')}
      role="group"
      style={{
        fontFamily: font.mono, fontSize: 13, lineHeight: px(typeScale.dense[1]), color: neutral[800],
        background: neutral[50], border: `1px solid ${neutral[200]}`, borderRadius: px(radius.sm),
        padding: `${px(space[3])} ${px(space[4])}`, maxWidth: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}
    >
      {lines.length ? lines.map((l, i) => <div key={i}>{l}</div>) : <span style={{ color: neutral[500] }}>{t('labelPreviewEmpty')}</span>}
    </div>
  );
}

export default LabelPreview;

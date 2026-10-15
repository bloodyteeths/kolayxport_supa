// components/domain/pricing/compareCell.tsx — one comparison value (shared by CompareTable and
// CompareMobile): numbers via Num (right-aligned by the caller), "Unlimited", ✓ / "—" with an accessible
// "Included" / "Not included" label, or a text value.
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Num } from '@/components/ds/format';
import { ICON_STROKE, icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import type { CompareCell } from './pricingModel';

const CheckIcon = icons.check;

export function CompareValue({ cell }: { cell: CompareCell }) {
  const t = useTranslations('marketing.pricingV2');
  switch (cell.kind) {
    case 'num':
      return cell.value === null ? <span>{t('compare.unlimited')}</span> : <Num value={cell.value} />;
    case 'text':
      return <span>{t(cell.key)}</span>;
    case 'check':
      return cell.on ? (
        <Box component="span" role="img" aria-label={t('compare.included')} sx={{ display: 'inline-flex', color: neutral[700] }}>
          <CheckIcon size={16} strokeWidth={ICON_STROKE} aria-hidden />
        </Box>
      ) : (
        <Box component="span" role="img" aria-label={t('compare.notIncluded')} sx={{ color: neutral[400] }}>
          —
        </Box>
      );
    default:
      return null;
  }
}

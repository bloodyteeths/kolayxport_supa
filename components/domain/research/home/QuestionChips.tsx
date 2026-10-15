// The five question chips (research.md §4.1, §4.3): secondary sm buttons, not filters. They wrap on desktop and
// scroll horizontally on mobile (the second allowed h-scroll at 390).
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { QUESTION_KEYS, type QuestionKey } from './routeSearch';

export type QuestionChipsProps = {
  onPick: (key: QuestionKey) => void;
  /** Busy while a pick is being routed. */
  disabled?: boolean;
  'data-testid'?: string;
};

export function QuestionChips({ onPick, disabled, 'data-testid': testId }: QuestionChipsProps) {
  const t = useTranslations('research');
  const mobile = useIsMobile();
  return (
    <Box
      role="group"
      aria-label={t('q.label')}
      data-testid={testId ?? 'research-questions'}
      sx={{
        display: 'flex',
        gap: '8px',
        ...(mobile
          ? { flexWrap: 'nowrap', overflowX: 'auto', mx: '-16px', px: '16px', pb: '4px', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' }, '& > *': { flexShrink: 0 } }
          : { flexWrap: 'wrap' }),
      }}
    >
      {QUESTION_KEYS.map((k) => (
        <Button key={k} variant="secondary" size="sm" onClick={() => { if (!disabled) onPick(k); }} data-testid={`research-q-${k}`}>
          {t(`q.${k}`)}
        </Button>
      ))}
    </Box>
  );
}

export default QuestionChips;

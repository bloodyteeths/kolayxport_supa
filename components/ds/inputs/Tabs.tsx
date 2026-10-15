// components/ds/inputs/Tabs.tsx — DS §4.6: ≤ 5 tabs, optional count. Route tabs pass `href` (research.md §1.1).
import MuiTabs from '@mui/material/Tabs';
import MuiTab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import NextLink from 'next/link';
import { neutral, accent, radius, type as typeScale, control } from '@/lib/ds/tokens';
import { COARSE, useIntlLocale, fmtInt } from './_shared';
import type { DsBaseProps } from './types';

export interface TabDef<T extends string> {
  value: T;
  label: string;
  count?: number;
  href?: string;
  disabled?: boolean;
}

export interface TabsProps<T extends string> extends DsBaseProps {
  value: T;
  onChange?: (value: T) => void;
  tabs: TabDef<T>[];
  'aria-label'?: string;
}

export function Tabs<T extends string>({ value, onChange, tabs, className, 'data-testid': testId, 'aria-label': ariaLabel }: TabsProps<T>) {
  const locale = useIntlLocale();
  return (
    <MuiTabs
      value={value}
      onChange={(_, v: T) => onChange?.(v)}
      variant="scrollable"
      scrollButtons={false}
      aria-label={ariaLabel}
      className={className}
      data-testid={testId}
      sx={{ minHeight: control.md, borderBottom: `1px solid ${neutral[200]}` }}
    >
      {tabs.map((tab) => (
        <MuiTab
          key={tab.value}
          value={tab.value}
          disabled={tab.disabled}
          {...(tab.href ? { component: NextLink, href: tab.href } : {})}
          label={
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span>{tab.label}</span>
              {tab.count != null ? (
                <Box
                  component="span"
                  sx={{
                    fontSize: typeScale.micro[0], lineHeight: `${typeScale.micro[1]}px`, fontWeight: typeScale.micro[2],
                    px: '6px', py: '1px', borderRadius: `${radius.full}px`, backgroundColor: tab.value === value ? accent[50] : neutral[100],
                    color: tab.value === value ? accent[700] : neutral[600], fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmtInt(tab.count, locale)}
                </Box>
              ) : null}
            </Box>
          }
          sx={{
            textTransform: 'none', minHeight: control.md, px: '12px', fontSize: typeScale.label[0], fontWeight: 500,
            color: neutral[600], '&.Mui-selected': { color: neutral[900] }, [COARSE]: { minHeight: control.lg },
          }}
        />
      ))}
    </MuiTabs>
  );
}

export default Tabs;

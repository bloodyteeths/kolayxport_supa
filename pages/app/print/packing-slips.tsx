import React from 'react';
import { useTranslations } from 'next-intl';
import PrintShell from '@/components/print/PrintShell';
import PackingSlips from '@/components/print/PackingSlips';
import { usePrintData } from '@/components/print/usePrintData';

/**
 * Printable packing slips for /app/print/packing-slips?ids=a,b,c.
 * Rendered without AppLayout (no sidebar/header) so it prints cleanly.
 */
export default function PackingSlipsPrintPage() {
  const t = useTranslations('printSlips');
  const { state, retry } = usePrintData();
  return (
    <PrintShell title={t('packingSlips')} state={state} retry={retry}>
      {data => <PackingSlips data={data} />}
    </PrintShell>
  );
}

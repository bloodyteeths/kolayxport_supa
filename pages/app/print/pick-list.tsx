import React from 'react';
import { useTranslations } from 'next-intl';
import PrintShell from '@/components/print/PrintShell';
import PickList from '@/components/print/PickList';
import { usePrintData } from '@/components/print/usePrintData';

/**
 * Printable pick list (items aggregated by SKU) for /app/print/pick-list?ids=a,b,c.
 * Rendered without AppLayout (no sidebar/header) so it prints cleanly.
 */
export default function PickListPrintPage() {
  const t = useTranslations('printSlips');
  const { state, retry } = usePrintData();
  return (
    <PrintShell title={t('pickList')} state={state} retry={retry}>
      {data => <PickList data={data} />}
    </PrintShell>
  );
}

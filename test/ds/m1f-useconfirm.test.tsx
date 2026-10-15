// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from '@/lib/hooks/useConfirm';
import { renderIntl, msg, LOCALES } from './m1f-helpers';

// lib/hooks/useConfirm re-exports the DS ConfirmProvider/useConfirm: the older promise API (description /
// destructive aliases) still works end to end through that path.

afterEach(cleanup);

function Harness({ onResult, locale }: { onResult: (ok: boolean) => void; locale: 'en' | 'tr' }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => onResult(await confirm({ title: 'Delete 3?', destructive: true, confirmLabel: msg(locale, 'common.delete'), cancelLabel: msg(locale, 'common.cancel') }))}
    >
      {'open'}
    </button>
  );
}

describe.each(LOCALES)('useConfirm through lib/hooks/useConfirm (%s)', (locale) => {
  it('resolves true on confirm and false on cancel', async () => {
    const results: boolean[] = [];
    renderIntl(
      <ConfirmProvider>
        <Harness locale={locale} onResult={(ok) => results.push(ok)} />
      </ConfirmProvider>,
      locale,
    );
    fireEvent.click(screen.getByText('open'));
    expect(await screen.findByText('Delete 3?')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: msg(locale, 'common.delete') }));
    });
    fireEvent.click(screen.getByText('open'));
    await screen.findByText('Delete 3?');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: msg(locale, 'common.cancel') }));
    });
    expect(results).toEqual([true, false]);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { DateRangeField, DateTimeField, FormField } from '@/components/ds/inputs';
import { renderDs, cleanup, LOCALES } from './m1b-harness';
import { m1bInputs } from './m1b-messages';

afterEach(cleanup);

describe.each(LOCALES)('DateRangeField (%s)', (locale) => {
  const msg = m1bInputs[locale].dateRange as { preset: Record<string, string>; any: string; dialogLabel: string };

  it('trigger shows the preset name with the label prefix, or the formatted range', () => {
    renderDs(
      <>
        <DateRangeField label="Order date" value={{ from: null, to: null, preset: 'last30' }} onChange={() => undefined} />
        <DateRangeField value={{ from: new Date(2026, 9, 1), to: new Date(2026, 9, 14), preset: 'custom' }} onChange={() => undefined} />
        <DateRangeField value={{ from: null, to: null }} onChange={() => undefined} />
      </>,
      locale,
    );
    expect(screen.getByText(`Order date: ${msg.preset.last30}`)).toBeTruthy();
    expect(screen.getByText(locale === 'en' ? /^1\s?–\s?14 Oct 2026$/ : /^1\s?–\s?14 Eki 2026$/)).toBeTruthy();
    expect(screen.getByText(msg.any)).toBeTruthy();
  });

  it('a preset click applies immediately (no Apply button)', () => {
    const onChange = vi.fn();
    renderDs(<DateRangeField value={{ from: null, to: null }} onChange={onChange} />, locale);
    fireEvent.click(screen.getByRole('button', { name: msg.any }));
    const dialog = screen.getByRole('dialog', { name: msg.dialogLabel });
    fireEvent.click(within(dialog).getByRole('button', { name: msg.preset.last7 }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const v = onChange.mock.calls[0][0];
    expect(v.preset).toBe('last7');
    expect(Math.round((v.to - v.from) / 86400000)).toBe(6);
  });

  it('two calendar months; the second day pick applies a custom range', () => {
    const onChange = vi.fn();
    renderDs(<DateRangeField value={{ from: new Date(2026, 8, 1), to: new Date(2026, 9, 14), preset: 'custom' }} onChange={onChange} forceMobile={false} />, locale);
    fireEvent.click(screen.getByRole('button', { name: /2026/ }));
    const dialog = screen.getByRole('dialog');
    const grids = within(dialog).getAllByRole('grid');
    expect(grids.length).toBe(2);
    fireEvent.click(within(grids[1]).getByRole('gridcell', { name: '3' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(grids[1]).getByRole('gridcell', { name: '10' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const v = onChange.mock.calls[0][0];
    expect(v.preset).toBe('custom');
    expect(v.from.getDate()).toBe(3);
    expect(v.to.getDate()).toBe(10);
  });

  it('mobile renders a sheet with one month', () => {
    renderDs(<DateRangeField value={{ from: null, to: null }} onChange={() => undefined} forceMobile />, locale);
    fireEvent.click(screen.getByRole('button', { name: msg.any }));
    expect(within(screen.getByRole('dialog', { name: msg.dialogLabel })).getAllByRole('grid').length).toBe(1);
  });
});

describe.each(LOCALES)('DateTimeField (%s)', (locale) => {
  const msg = m1bInputs[locale].dateTime as Record<string, string>;

  it('shows the instant in the seller zone with the zone label', () => {
    const at = new Date('2026-10-20T06:15:00.000Z');
    renderDs(
      <FormField label="Send at">
        <DateTimeField value={at} onChange={() => undefined} timezone="Europe/Istanbul" />
      </FormField>,
      locale,
    );
    const trigger = screen.getByLabelText('Send at');
    expect(trigger.textContent).toMatch(/\b0?9[.:]15/);
    expect(screen.getAllByText(/Europe\/Istanbul \(GMT\+3\)/).length).toBeGreaterThan(0);
  });

  it('picking a day keeps the time and emits the right UTC instant', () => {
    const onChange = vi.fn();
    const at = new Date('2026-10-20T06:15:00.000Z'); // 09:15 in Istanbul
    renderDs(<DateTimeField aria-label="When" value={at} onChange={onChange} timezone="Europe/Istanbul" />, locale);
    fireEvent.click(screen.getByRole('button', { name: 'When' }));
    const dialog = screen.getByRole('dialog', { name: msg.dialogLabel });
    fireEvent.click(within(dialog).getByRole('gridcell', { name: '22' }));
    expect(onChange.mock.calls[0][0].toISOString()).toBe('2026-10-22T06:15:00.000Z');
  });

  it('picking a time from the 15-minute list; min disables earlier days', () => {
    const onChange = vi.fn();
    const at = new Date('2026-10-20T06:15:00.000Z');
    renderDs(<DateTimeField aria-label="When" value={at} onChange={onChange} timezone="Europe/Istanbul" min={new Date('2026-10-18T00:00:00Z')} />, locale);
    fireEvent.click(screen.getByRole('button', { name: 'When' }));
    const dialog = screen.getByRole('dialog', { name: msg.dialogLabel });
    expect((within(dialog).getByRole('gridcell', { name: '17' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: msg.time }));
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.length).toBe(96);
    fireEvent.click(options[4 * 14 + 2]); // 14:30
    expect(onChange.mock.calls[0][0].toISOString()).toBe('2026-10-20T11:30:00.000Z');
  });
});

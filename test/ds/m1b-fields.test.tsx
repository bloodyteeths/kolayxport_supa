// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import {
  FormField, TextField, TextArea, NumberField, MoneyField, Select, Checkbox, Switch, RadioGroup, RadioCards,
  SegmentedControl, Tabs, CharCount,
} from '@/components/ds/inputs';
import { renderDs, cleanup, LOCALES } from './m1b-harness';

afterEach(cleanup);

const T = {
  en: { optional: '(optional)', changed: 'Changed', revert: 'Revert', preview: 'Preview' },
  tr: { optional: '(isteğe bağlı)', changed: 'Değiştirildi', revert: 'Geri al', preview: 'Önizleme' },
};

describe.each(LOCALES)('form fields (%s)', (locale) => {
  it('FormField: label above, wires id/aria to TextField, optional, counter, helper', () => {
    renderDs(
      <FormField label="Title" optional helper="Shown in search" counter={{ value: 112, max: 140 }}>
        <TextField value="Baby blanket" onChange={() => undefined} />
      </FormField>,
      locale,
    );
    const input = screen.getByLabelText(/Title/) as HTMLInputElement;
    expect(input.value).toBe('Baby blanket');
    expect(screen.getByText(T[locale].optional)).toBeTruthy();
    expect(screen.getByText('112 / 140')).toBeTruthy();
    const described = input.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ').length).toBe(2);
    expect(document.getElementById(described.split(' ')[0])?.textContent).toBe('Shown in search');
  });

  it('FormField: error replaces helper and marks the control invalid', () => {
    renderDs(
      <FormField label="Price" helper="In shop currency" error="Enter a price above 0.20">
        <TextField value="" onChange={() => undefined} />
      </FormField>,
      locale,
    );
    expect(screen.queryByText('In shop currency')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Enter a price above 0.20');
    expect(screen.getByLabelText('Price').getAttribute('aria-invalid')).toBe('true');
  });

  it('FormField: dirty bar + "Changed · Revert"', () => {
    const onRevert = vi.fn();
    const { container } = renderDs(
      <FormField label="Title" dirty onRevert={onRevert}><TextField value="x" onChange={() => undefined} /></FormField>,
      locale,
    );
    expect(container.querySelector('[data-dirty="true"]')).toBeTruthy();
    expect(screen.getByText(T[locale].changed)).toBeTruthy();
    fireEvent.click(screen.getByText(T[locale].revert));
    expect(onRevert).toHaveBeenCalled();
  });

  it('CharCount tones: warning at 90 %, danger above 100 %', () => {
    renderDs(<><CharCount value={10} max={20} data-testid="a" /><CharCount value={18} max={20} data-testid="b" /><CharCount value={21} max={20} data-testid="c" /></>, locale);
    expect(screen.getByTestId('a').getAttribute('data-tone')).toBe('neutral');
    expect(screen.getByTestId('b').getAttribute('data-tone')).toBe('warning');
    expect(screen.getByTestId('c').getAttribute('data-tone')).toBe('danger');
  });

  it('TextField: prefix/suffix adornments and onChange(value)', () => {
    const onChange = vi.fn();
    renderDs(<TextField aria-label="Store" value="" onChange={onChange} suffix=".myshopify.com" />, locale);
    expect(screen.getByText('.myshopify.com')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'kolay' } });
    expect(onChange.mock.calls[0][0]).toBe('kolay');
  });

  it('TextArea: Edit | Preview toggle renders the preview', () => {
    renderDs(<TextArea aria-label="Description" value={'Line 1\nLine 2'} onChange={() => undefined} preview={(v) => <span data-testid="pv">{v.toLocaleUpperCase()}</span>} />, locale);
    fireEvent.click(screen.getByRole('radio', { name: T[locale].preview }));
    expect(screen.getByTestId('pv').textContent).toContain('LINE 1');
  });

  it('NumberField: locale-aware parse and arrow-key step', () => {
    function Harness() {
      const [v, setV] = useState<number | null>(2);
      return <><NumberField aria-label="Qty" value={v} onChange={setV} min={0} max={999} /><output data-testid="out">{String(v)}</output></>;
    }
    renderDs(<Harness />, locale);
    const input = screen.getByLabelText('Qty');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByTestId('out').textContent).toBe('3');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1.109' } });
    expect(screen.getByTestId('out').textContent).toBe(locale === 'tr' ? '1109' : '1'); // EN: 1.109 is a decimal, rounded to integer
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('MoneyField: currency symbol prefix, TR decimal comma parse, formatted on blur', () => {
    function Harness() {
      const [v, setV] = useState<number | null>(null);
      return <><MoneyField aria-label="Price" currency="TRY" value={v} onChange={setV} /><output data-testid="out">{String(v)}</output></>;
    }
    renderDs(<Harness />, locale);
    expect(screen.getByText('₺')).toBeTruthy();
    const input = screen.getByLabelText('Price') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1.109,30' } });
    expect(screen.getByTestId('out').textContent).toBe('1109.3');
    fireEvent.blur(input);
    expect(input.value).toBe(locale === 'tr' ? '1.109,30' : '1,109.30');
  });

  it('Select: placeholder, then picks an option', () => {
    const onChange = vi.fn();
    renderDs(
      <Select aria-label="VAT" value={null} onChange={onChange} placeholder="Choose" options={[{ value: 10, label: '10 %' }, { value: 20, label: '20 %' }]} />,
      locale,
    );
    expect(screen.getByText('Choose')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'VAT' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('20 %'));
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('group controls inside FormField are labelled by the visible label', () => {
    renderDs(
      <>
        <FormField label="VAT rate"><Select value={20} onChange={() => undefined} options={[{ value: 20, label: '20 %' }]} /></FormField>
        <FormField label="Scope"><RadioGroup value="a" onChange={() => undefined} options={[{ value: 'a', label: 'All' }]} /></FormField>
        <FormField label="Mode"><SegmentedControl value="a" onChange={() => undefined} options={[{ value: 'a', label: 'Set' }, { value: 'b', label: 'Add' }]} /></FormField>
      </>,
      locale,
    );
    expect(screen.getByRole('combobox', { name: 'VAT rate' })).toBeTruthy();
    expect(screen.getAllByRole('radiogroup', { name: /Scope|Mode/ }).length).toBe(2);
  });

  it('Checkbox, Switch, RadioGroup', () => {
    const c = vi.fn(); const s = vi.fn(); const r = vi.fn();
    renderDs(
      <>
        <Checkbox checked={false} onChange={c} label="Match case" />
        <Switch checked onChange={s} label="Track inventory" description="Stock counts sync" />
        <RadioGroup value="a" onChange={r} aria-label="Scope" options={[{ value: 'a', label: 'Current view' }, { value: 'b', label: 'Selected' }]} />
      </>,
      locale,
    );
    fireEvent.click(screen.getByLabelText('Match case'));
    expect(c.mock.calls[0][0]).toBe(true);
    fireEvent.click(screen.getByLabelText('Track inventory'));
    expect(s.mock.calls[0][0]).toBe(false);
    fireEvent.click(screen.getByLabelText('Selected'));
    expect(r).toHaveBeenCalledWith('b');
  });

  it('RadioCards: selection, disabled reason, arrow keys', () => {
    const onChange = vi.fn();
    renderDs(
      <RadioCards
        aria-label="Plan"
        value="starter"
        onChange={onChange}
        options={[
          { value: 'starter', title: 'Starter', description: '200 orders' },
          { value: 'growth', title: 'Growth', trailing: '₺999' },
          { value: 'pro', title: 'Pro', disabledReason: 'Contact us' },
        ]}
      />,
      locale,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Contact us')).toBeTruthy();
    fireEvent.click(radios[2]);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('growth');
  });

  it('SegmentedControl and Tabs', () => {
    const seg = vi.fn(); const tab = vi.fn();
    renderDs(
      <>
        <SegmentedControl aria-label="Billing" value="month" onChange={seg} options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }]} />
        <Tabs aria-label="Research" value="home" onChange={tab} tabs={[{ value: 'home', label: 'Home' }, { value: 'kw', label: 'Keywords', count: 1234 }]} />
      </>,
      locale,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Yearly' }));
    expect(seg).toHaveBeenCalledWith('year');
    expect(screen.getByText(locale === 'tr' ? '1.234' : '1,234')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Keywords/ }));
    expect(tab).toHaveBeenCalledWith('kw');
  });
});

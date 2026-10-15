// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Printer, Send, Pencil } from 'lucide-react';
import { Button, IconButton, SplitButton } from '@/components/ds/inputs';
import { renderDs, cleanup, LOCALES } from './m1b-harness';

afterEach(cleanup);

describe.each(LOCALES)('buttons (%s)', (locale) => {
  it('Button renders each variant and fires onClick', () => {
    const onClick = vi.fn();
    renderDs(
      <>
        {(['primary', 'secondary', 'ghost', 'danger', 'danger-ghost'] as const).map((v) => (
          <Button key={v} variant={v} icon={Send} onClick={onClick} data-testid={`b-${v}`}>{`Do ${v}`}</Button>
        ))}
      </>,
      locale,
    );
    expect(screen.getByTestId('b-primary').getAttribute('data-variant')).toBe('primary');
    expect(screen.getByTestId('b-primary').className).toContain('MuiButton-contained');
    expect(screen.getByTestId('b-secondary').className).toContain('MuiButton-outlined');
    expect(screen.getByTestId('b-danger').className).toContain('MuiButton-containedError');
    fireEvent.click(screen.getByText('Do primary'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Button loading shows the verb, is busy and does not fire', () => {
    const onClick = vi.fn();
    renderDs(<Button variant="primary" loading loadingLabel="Creating label…" onClick={onClick}>Create label</Button>, locale);
    const btn = screen.getByRole('button', { name: /Creating label…/ });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn).toHaveProperty('disabled', true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Button disabled with a reason is wrapped for the tooltip; href renders a link', () => {
    renderDs(
      <>
        <Button disabled disabledReason="Connect Etsy first">Send changes</Button>
        <Button href="/app/labels">Open orders</Button>
      </>,
      locale,
    );
    expect(screen.getByRole('button', { name: 'Send changes' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('link', { name: 'Open orders' }).getAttribute('href')).toBe('/app/labels');
  });

  it('IconButton requires a label and exposes it', () => {
    const onClick = vi.fn();
    renderDs(<IconButton icon={Pencil} label="Edit listing" shortcut="e" onClick={onClick} pressed />, locale);
    const btn = screen.getByRole('button', { name: 'Edit listing' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('SplitButton runs the primary and opens the options menu', () => {
    const primary = vi.fn();
    const slip = vi.fn();
    renderDs(
      <SplitButton
        primary={{ id: 'labels', label: 'Print labels', icon: Printer, onClick: primary }}
        options={[{ id: 'slips', label: 'Packing slips', onClick: slip }, { id: 'both', label: 'Both', disabled: true, disabledReason: 'No labels yet' }]}
      />,
      locale,
    );
    fireEvent.click(screen.getByText('Print labels'));
    expect(primary).toHaveBeenCalled();
    const toggle = screen.getByRole('button', { name: locale === 'en' ? 'More options for Print labels' : 'Print labels için diğer seçenekler' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByText('Packing slips'));
    expect(slip).toHaveBeenCalled();
    expect(screen.queryByText('No labels yet')).not.toBeNull();
  });
});

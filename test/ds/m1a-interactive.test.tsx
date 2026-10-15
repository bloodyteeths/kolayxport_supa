// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '@mui/material';
import { CopyText, Kbd } from '@/components/ds/format';
import { withIntl } from './m1a-render';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockClipboard(ok: boolean) {
  const writeText = ok ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error('denied'));
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  // legacy fallback path
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = () => ok;
  return writeText;
}

describe('CopyText interaction', () => {
  it.each(['en', 'tr'] as const)('copies the full value, announces it, and does not bubble (%s)', async (locale) => {
    const writeText = mockClipboard(true);
    const rowClick = vi.fn();
    render(
      withIntl(
        <div onClick={rowClick}>
          <CopyText value="1Z999AA10123456784" truncate={10} mono />
        </div>,
        locale,
      ),
    );
    const btn = screen.getByRole('button');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeText).toHaveBeenCalledWith('1Z999AA10123456784');
    expect(rowClick).not.toHaveBeenCalled();
    expect(btn.getAttribute('data-state')).toBe('copied');
    expect(screen.getByRole('status').textContent).toBe(locale === 'en' ? 'Copied' : 'Kopyalandı');
  });

  it('reports a failed copy honestly', async () => {
    mockClipboard(false);
    render(withIntl(<CopyText value="abc" />, 'en'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByRole('status').textContent).toBe("Couldn't copy");
  });
});

describe('CopyText keyboard propagation', () => {
  it('Escape on the copy button still closes a parent Modal', () => {
    const onClose = vi.fn();
    render(
      withIntl(
        <Modal open onClose={onClose}>
          <div>
            <CopyText value="ORDER-1" />
          </div>
        </Modal>,
        'en',
      ),
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Copy ORDER-1' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter and Space on the copy button do not reach a clickable row', () => {
    const rowKey = vi.fn();
    render(
      withIntl(
        <div onKeyDown={rowKey}>
          <CopyText value="ORDER-1" />
        </div>,
        'tr',
      ),
    );
    const btn = screen.getByRole('button');
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.keyDown(btn, { key: ' ' });
    expect(rowKey).not.toHaveBeenCalled();
    fireEvent.keyDown(btn, { key: 'Tab' });
    expect(rowKey).toHaveBeenCalledTimes(1);
  });
});

describe('Kbd after mount', () => {
  it('switches mod to ⌘ on Apple platforms', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { container } = render(withIntl(<Kbd keys="mod+k" />, 'en'));
    expect(container.textContent).toBe('⌘K');
  });

  it('keeps Ctrl elsewhere', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0)');
    const { container } = render(withIntl(<Kbd keys="mod+k" />, 'tr'));
    expect(container.textContent).toBe('Ctrl K');
  });
});

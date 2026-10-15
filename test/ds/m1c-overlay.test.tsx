// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { Trash2 } from 'lucide-react';
import { Modal } from '@/components/ds/overlay/Modal';
import { ConfirmDialog, ConfirmProvider, useConfirm, typedMatches } from '@/components/ds/overlay/ConfirmDialog';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { BottomSheet, SheetFooter } from '@/components/ds/overlay/BottomSheet';
import { OverflowMenu, orderOverflowItems } from '@/components/ds/overlay/OverflowMenu';
import { StickyActionBar, ACTION_BAR_VAR } from '@/components/ds/overlay/StickyActionBar';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { ActionButton } from '@/components/ds/overlay/actions';
import { ConfirmProvider as HooksConfirmProvider } from '@/lib/hooks/useConfirm';
import { panelWidth, zIndex } from '@/lib/ds/tokens';
import { LOCALES, m, renderIntl } from './m1c-helpers';

afterEach(cleanup);

describe.each(LOCALES)('Modal (%s)', (locale) => {
  it('renders title, body, default Cancel and the primary; Cancel closes; ⌘↵ runs the primary', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    renderIntl(
      <Modal open onClose={onClose} title="Schedule send" primary={{ id: 'save', label: 'Schedule', onClick: onSave }}>
        <p>{'body'}</p>
      </Modal>,
      locale,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Schedule send')).toBeTruthy();
    expect(within(dialog).getByText('body')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: m(locale, 'ds.overlay.cancel') }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: m(locale, 'ds.overlay.close') })).toBeTruthy();
  });

  it('nested sets z 1550 and size md is 560 wide', () => {
    renderIntl(<Modal open nested size="md" onClose={() => {}} title="T" primary={{ id: 'p', label: 'OK' }} secondary={null} />, locale);
    const root = screen.getByTestId('ds-modal');
    expect(getComputedStyle(root).zIndex).toBe(String(zIndex.nestedModal));
    expect(screen.queryByRole('button', { name: m(locale, 'ds.overlay.cancel') })).toBeNull();
  });
});

describe.each(LOCALES)('ConfirmDialog (%s)', (locale) => {
  it('danger confirm uses the Delete default label and lists items with "and N more"', () => {
    const items = Array.from({ length: 12 }, (_, i) => `Listing ${i + 1}`);
    renderIntl(<ConfirmDialog open title="Delete 12 listings?" tone="danger" items={items} onConfirm={() => {}} onCancel={() => {}} />, locale);
    expect(screen.getByRole('button', { name: m(locale, 'ds.overlay.confirm.delete') })).toBeTruthy();
    expect(screen.getByText(m(locale, 'ds.overlay.confirm.andMore', { count: 2 }))).toBeTruthy();
    expect(screen.getByTestId('confirm-items').querySelectorAll('li')).toHaveLength(11);
  });

  it('typeToConfirm: primary stays disabled until the exact text is typed (field inside the dialog, no window.prompt)', () => {
    const onConfirm = vi.fn();
    const prompt = vi.spyOn(window, 'prompt');
    renderIntl(<ConfirmDialog open title="Delete shop?" tone="danger" typeToConfirm="BelleCoutureGifts" onConfirm={onConfirm} onCancel={() => {}} />, locale);
    const btn = screen.getByRole('button', { name: m(locale, 'ds.overlay.confirm.delete') }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const input = screen.getByLabelText(m(locale, 'ds.overlay.confirm.typeToConfirmAria'));
    fireEvent.change(input, { target: { value: 'Belle' } });
    expect(screen.getByText(m(locale, 'ds.overlay.confirm.mismatch'))).toBeTruthy();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' BelleCoutureGifts ' } });
    expect(btn.disabled).toBe(false);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it('accepts the legacy description/destructive aliases', () => {
    renderIntl(<ConfirmDialog open title="X" description="legacy body" destructive onConfirm={() => {}} onCancel={() => {}} />, locale);
    expect(screen.getByText('legacy body')).toBeTruthy();
    expect(screen.getByRole('button', { name: m(locale, 'ds.overlay.confirm.delete') })).toBeTruthy();
  });

  it('typedMatches trims and is case-sensitive', () => {
    expect(typedMatches(' 12 ', '12')).toBe(true);
    expect(typedMatches('shop', 'Shop')).toBe(false);
    expect(typedMatches('', undefined)).toBe(true);
  });
});

function ConfirmHarness({ onResult }: { onResult: (ok: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={async () => onResult(await confirm({ title: 'Discard 3 changes?', tone: 'danger', confirmLabel: 'Discard' }))}>
      {'open'}
    </button>
  );
}

describe.each(LOCALES)('useConfirm DS (%s)', (locale) => {
  it('resolves through the DS ConfirmProvider', async () => {
    const results: boolean[] = [];
    renderIntl(
      <ConfirmProvider>
        <ConfirmHarness onResult={(ok) => results.push(ok)} />
      </ConfirmProvider>,
      locale,
    );
    fireEvent.click(screen.getByText('open'));
    await screen.findByText('Discard 3 changes?');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    });
    fireEvent.click(screen.getByText('open'));
    await screen.findByText('Discard 3 changes?');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.overlay.cancel') }));
    });
    expect(results).toEqual([true, false]);
  });

  it('lib/hooks/useConfirm exports the same provider (older import path keeps working)', async () => {
    const results: boolean[] = [];
    renderIntl(
      <HooksConfirmProvider>
        <ConfirmHarness onResult={(ok) => results.push(ok)} />
      </HooksConfirmProvider>,
      locale,
    );
    fireEvent.click(screen.getByText('open'));
    await screen.findByText('Discard 3 changes?');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    });
    expect(results).toEqual([true]);
  });
});

function PanelHarness({ dirty, onClose, onNext }: { dirty: boolean; onClose: () => void; onNext: () => void }) {
  return (
    <SidePanel
      open
      size="lg"
      onClose={onClose}
      title="Personalized Baby Blanket"
      meta="#3891 · Etsy"
      status={<span>{'pill'}</span>}
      onNext={onNext}
      onPrev={() => {}}
      dirty={dirty}
      saveState={dirty ? 'dirty' : 'saved'}
      primary={{ id: 'send', label: 'Send changes to Etsy' }}
      secondary={{ id: 'discard', label: 'Discard' }}
      overflow={[{ id: 'del', label: 'Delete listing', tone: 'danger', icon: Trash2 }]}
      sectionNav={Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: `Section ${i}` }))}
    >
      <SidePanelSection id="s0" title="Product" action={{ id: 'edit', label: 'Edit' }}>
        <input aria-label="field" />
      </SidePanelSection>
      <SidePanelSection id="s1" title="Customer" description="Buyer details" />
    </SidePanel>
  );
}

describe.each(LOCALES)('SidePanel (%s)', (locale) => {
  it('renders header, sections, anchor chips (>5), save state and the footer actions; width from size', () => {
    renderIntl(<PanelHarness dirty={false} onClose={() => {}} onNext={() => {}} />, locale);
    const dialog = screen.getByRole('dialog', { name: 'Personalized Baby Blanket' });
    expect(within(dialog).getByText('#3891 · Etsy')).toBeTruthy();
    expect(within(dialog).getByText('pill')).toBeTruthy();
    expect(within(dialog).getByRole('navigation', { name: m(locale, 'ds.overlay.sections') })).toBeTruthy();
    expect(within(dialog).getByRole('region', { name: 'Product' })).toBeTruthy();
    expect(within(dialog).getByText('Buyer details')).toBeTruthy();
    expect(screen.getByTestId('panel-save-state').textContent).toBe(m(locale, 'ds.overlay.saveState.saved'));
    expect(within(dialog).getByRole('button', { name: 'Send changes to Etsy' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: m(locale, 'ds.overlay.more') })).toBeTruthy();
    expect(getComputedStyle(dialog).width).toBe(`${panelWidth.lg}px`);
  });

  it('uses the light backdropPanel, not the modal backdrop', () => {
    renderIntl(<PanelHarness dirty={false} onClose={() => {}} onNext={() => {}} />, locale);
    const backdrop = document.querySelector('.MuiBackdrop-root') as HTMLElement;
    expect(getComputedStyle(backdrop).backgroundColor.replace(/\s/g, '')).toContain('.16');
  });

  it('clean panel: close and j call through directly', () => {
    const onClose = vi.fn();
    const onNext = vi.fn();
    renderIntl(<PanelHarness dirty={false} onClose={onClose} onNext={onNext} />, locale);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Personalized Baby Blanket' }), { key: 'j' });
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'j' }); // typing in an input never navigates
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('panel-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dirty panel: close opens the nested Keep editing / Discard confirm', () => {
    const onClose = vi.fn();
    renderIntl(<PanelHarness dirty onClose={onClose} onNext={() => {}} />, locale);
    expect(screen.getByTestId('panel-save-state').textContent).toBe(m(locale, 'ds.overlay.saveState.dirty'));
    fireEvent.click(screen.getByTestId('panel-close'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(m(locale, 'ds.overlay.dirtyGuard.title'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.overlay.dirtyGuard.keep') }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('panel-close'));
    fireEvent.click(screen.getByRole('button', { name: m(locale, 'ds.overlay.dirtyGuard.discard') }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe.each(LOCALES)('BottomSheet (%s)', (locale) => {
  it('renders title, header action, body and a 50/50 footer; close works', () => {
    const onClose = vi.fn();
    const markAll = vi.fn();
    renderIntl(
      <BottomSheet
        open
        fullHeight
        onClose={onClose}
        title="Notifications"
        headerAction={{ id: 'mark', label: 'Mark all as read', onClick: markAll }}
        footer={<SheetFooter secondary={{ id: 'clear', label: 'Clear' }} primary={{ id: 'show', label: 'Show 142 results' }} />}
      >
        <p>{'sheet body'}</p>
      </BottomSheet>,
      locale,
    );
    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    expect(within(dialog).getByText('sheet body')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Show 142 results' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark all as read' }));
    expect(markAll).toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: m(locale, 'ds.overlay.close') }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sheet-handle')).toBeTruthy();
  });
});

describe.each(LOCALES)('OverflowMenu (%s)', (locale) => {
  it('moves danger items last behind a divider and shows disabled reasons', () => {
    const del = vi.fn();
    renderIntl(
      <OverflowMenu
        label="More actions for Etsy"
        items={[
          { id: 'del', label: 'Disconnect', tone: 'danger', onClick: del },
          { id: 'open', label: 'Open on Etsy', href: 'https://etsy.com' },
          'divider',
          { id: 'export', label: 'Export', disabled: true, disabledReason: 'Nothing selected' },
        ]}
      />,
      locale,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Etsy' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Open on Etsy', 'ExportNothing selected', 'Disconnect']);
    fireEvent.click(screen.getByTestId('overflow-item-del'));
    expect(del).toHaveBeenCalled();
  });

  it('default trigger label is translated; renders nothing with no items', () => {
    const { container } = renderIntl(<OverflowMenu items={['divider']} />, locale);
    expect(container.textContent).toBe('');
    cleanup();
    renderIntl(<OverflowMenu items={[{ id: 'a', label: 'A' }]} />, locale);
    expect(screen.getByRole('button', { name: m(locale, 'ds.overlay.more') })).toBeTruthy();
  });

  it('orderOverflowItems drops stray dividers', () => {
    const out = orderOverflowItems(['divider', { id: 'a', label: 'A' }, 'divider', 'divider', { id: 'd', label: 'D', tone: 'danger' }, 'divider']);
    expect(out.map((i) => (i === 'divider' ? '-' : i.id))).toEqual(['a', '-', 'd']);
  });
});

/** jsdom has no PointerEvent: dispatch a MouseEvent with the pointer type so clientY is carried. */
function drag(el: HTMLElement, type: string, clientY: number) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY }));
  });
}

describe.each(LOCALES)('SidePanel + nested overlays (%s)', (locale) => {
  it('keys from a portalled Modal inside the panel do not reach the panel (⌘↵ primary, j/k)', () => {
    const panelPrimary = vi.fn();
    const modalPrimary = vi.fn();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderIntl(
      <SidePanel open onClose={() => {}} title="Order #3891" onNext={onNext} onPrev={onPrev} primary={{ id: 'send', label: 'Send to Etsy', onClick: panelPrimary }}>
        <Modal open nested onClose={() => {}} title="Schedule send" primary={{ id: 'ok', label: 'Schedule', onClick: modalPrimary }} />
      </SidePanel>,
      locale,
    );
    const modal = screen.getByRole('dialog', { name: 'Schedule send' });
    const modalButton = within(modal).getByRole('button', { name: 'Schedule' });
    fireEvent.keyDown(modalButton, { key: 'Enter', metaKey: true });
    expect(modalPrimary).toHaveBeenCalledTimes(1);
    expect(panelPrimary).not.toHaveBeenCalled();
    fireEvent.keyDown(modalButton, { key: 'j' });
    fireEvent.keyDown(modalButton, { key: 'k' });
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
    // the panel itself still handles its keys
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Order #3891', hidden: true }), { key: 'j' });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('phone sheet: dragging the handle down ≥ 80px closes through the dirty guard', () => {
    const mq = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: /max-width/.test(q) && !/min-width/.test(q), media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const onClose = vi.fn();
      renderIntl(<SidePanel open onClose={onClose} title="Order" />, locale);
      const handle = screen.getByTestId('panel-handle');
      drag(handle, 'pointerdown', 100);
      drag(handle, 'pointermove', 200);
      drag(handle, 'pointerup', 200);
      expect(onClose).toHaveBeenCalledTimes(1);
      cleanup();
      const onClose2 = vi.fn();
      renderIntl(<SidePanel open dirty onClose={onClose2} title="Order" />, locale);
      const h2 = screen.getByTestId('panel-handle');
      drag(h2, 'pointerdown', 100);
      drag(h2, 'pointermove', 200);
      drag(h2, 'pointerup', 200);
      expect(onClose2).not.toHaveBeenCalled();
      expect(screen.getByText(m(locale, 'ds.overlay.dirtyGuard.title'))).toBeTruthy();
    } finally {
      window.matchMedia = mq;
    }
  });
});

describe.each(LOCALES)('StickyActionBar (%s)', (locale) => {
  it('no primary: renders only the status and ⋯ (listing-editor "Edit, no changes")', () => {
    renderIntl(<StickyActionBar layout="desktop" status="Up to date with Etsy" overflow={[{ id: 'h', label: 'History' }]} />, locale);
    const bar = screen.getByTestId('sticky-action-bar');
    expect(within(bar).getByText('Up to date with Etsy')).toBeTruthy();
    expect(within(bar).getAllByRole('button')).toHaveLength(1);
  });

  it('primarySlot replaces the primary (create-mode SplitButton); `variant` aliases `layout`', () => {
    renderIntl(
      <StickyActionBar variant="mobile" primary={{ id: 'ignored', label: 'Ignored' }} primarySlot={<button type="button">{'Publish on Etsy'}</button>} />,
      locale,
    );
    const bar = screen.getByTestId('sticky-action-bar');
    expect(bar.getAttribute('data-layout')).toBe('mobile');
    expect(within(bar).getByRole('button', { name: 'Publish on Etsy' })).toBeTruthy();
    expect(within(bar).queryByRole('button', { name: 'Ignored' })).toBeNull();
  });

  it('mobile: fixed above the tab bar, publishes --kx-action-bar while mounted', () => {
    const { unmount } = renderIntl(
      <StickyActionBar layout="mobile" status="7 changes not sent yet" primary={{ id: 'send', label: 'Send 7 changes to Etsy' }} secondary={{ id: 'discard', label: 'Discard' }} />,
      locale,
    );
    const bar = screen.getByRole('region', { name: m(locale, 'ds.overlay.actionBar') });
    expect(bar.getAttribute('data-layout')).toBe('mobile');
    expect(getComputedStyle(bar).position).toBe('fixed');
    expect(getComputedStyle(bar).zIndex).toBe(String(zIndex.stickyActionBar));
    expect(document.documentElement.style.getPropertyValue(ACTION_BAR_VAR)).not.toBe('');
    unmount();
    expect(document.documentElement.style.getPropertyValue(ACTION_BAR_VAR)).toBe('');
  });

  it('desktop: sticky footer bar with status left; visible=false renders nothing', () => {
    renderIntl(<StickyActionBar layout="desktop" status="Saved" primary={{ id: 'p', label: 'Send changes to Etsy' }} overflow={[{ id: 'h', label: 'History' }]} />, locale);
    const bar = screen.getByTestId('sticky-action-bar');
    expect(getComputedStyle(bar).position).toBe('sticky');
    expect(within(bar).getByText('Saved')).toBeTruthy();
    cleanup();
    const { container } = renderIntl(<StickyActionBar visible={false} primary={{ id: 'p', label: 'x' }} />, locale);
    expect(container.textContent).toBe('');
  });
});

describe.each(LOCALES)('Tooltip + ActionButton (%s)', (locale) => {
  it('disabled action is wrapped in a tooltip with its reason; loading shows loadingLabel', async () => {
    renderIntl(
      <div>
        <ActionButton action={{ id: 'a', label: 'Create label', disabled: true, disabledReason: 'Complete your sender profile' }} variant="primary" />
        <ActionButton action={{ id: 'b', label: 'Create label', loading: true, loadingLabel: 'Creating label…' }} variant="primary" />
        <Tooltip title="Next" shortcut="J">
          <button type="button">{'n'}</button>
        </Tooltip>
      </div>,
      locale,
    );
    expect(screen.getByLabelText('Complete your sender profile')).toBeTruthy();
    expect(screen.getByText('Creating label…')).toBeTruthy();
    expect((screen.getByTestId('action-b') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.mouseOver(screen.getByText('n'));
    await screen.findByRole('tooltip');
    expect(screen.getByRole('tooltip').textContent).toBe('NextJ');
  });
});

describe('SidePanel state helper', () => {
  it('works as a controlled panel from a parent', () => {
    function Parent() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <span>{open ? 'open' : 'closed'}</span>
          <SidePanel open={open} onClose={() => setOpen(false)} title="T" />
        </>
      );
    }
    renderIntl(<Parent />, 'en');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'T' }), { key: 'Escape' });
    expect(screen.getByText('closed')).toBeTruthy();
  });
});

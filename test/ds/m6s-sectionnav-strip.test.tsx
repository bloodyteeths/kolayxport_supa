// @vitest-environment jsdom
// M6 editor Group S: SectionNav (sticky anchor chips + scroll-spy + scrollToSection), SidePanel using it, and
// ImageGrid variant="strip" (video tile, empty dropzone, unchanged staging/keyboard behaviour). EN + TR.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within, act } from '@testing-library/react';
import { SectionNav, scrollToSection, type SectionNavItem } from '@/components/ds/page';
import { ImageGrid } from '@/components/ds/inputs';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { renderS, LOCALES, m6sKeys, flattenM6s, messagesFor } from './m6s-harness';

type IOCallback = (entries: { target: Element; isIntersecting: boolean }[]) => void;
let ioInstances: { cb: IOCallback; observed: Element[]; options?: IntersectionObserverInit }[] = [];

beforeEach(() => {
  ioInstances = [];
  class FakeIO {
    cb: IOCallback;
    observed: Element[] = [];
    options?: IntersectionObserverInit;
    constructor(cb: IOCallback, options?: IntersectionObserverInit) {
      this.cb = cb;
      this.options = options;
      ioInstances.push(this);
    }
    observe(el: Element) { this.observed.push(el); }
    unobserve() { /* noop */ }
    disconnect() { this.observed = []; }
    takeRecords() { return []; }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SECTIONS: SectionNavItem[] = [
  { id: 'photos', label: 'Photos', state: 'attention', count: 2 },
  { id: 'title', label: 'Title' },
  { id: 'tags', label: 'Tags', state: 'danger', count: 1 },
  { id: 'price', label: 'Price' },
];

function Page(props: Partial<React.ComponentProps<typeof SectionNav>>) {
  return (
    <div>
      <SectionNav sections={SECTIONS} {...props} />
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id}>
          <h2>{s.label} heading</h2>
          <input id={`${s.id}-field`} aria-label={`${s.label} field`} />
        </section>
      ))}
    </div>
  );
}

describe.each(LOCALES)('SectionNav (%s)', (locale) => {
  const k = m6sKeys[locale].sectionNav as Record<string, string>;

  it('renders a labelled nav with one chip per section, sticky, first chip active by default', () => {
    renderS(<Page />, locale);
    const nav = screen.getByRole('navigation', { name: k.label });
    expect(nav.getAttribute('data-sticky')).toBe('true');
    const chips = within(nav).getAllByRole('button');
    expect(chips).toHaveLength(4);
    expect(chips[0].getAttribute('aria-current')).toBe('location');
    expect(chips[1].getAttribute('aria-current')).toBeNull();
  });

  it('state dots have a text equivalent in the aria-label', () => {
    renderS(<Page />, locale);
    const nav = screen.getByRole('navigation');
    const photos = within(nav).getAllByRole('button')[0];
    const tags = within(nav).getAllByRole('button')[2];
    expect(photos.getAttribute('aria-label')).toContain('Photos');
    expect(photos.getAttribute('aria-label')).toContain('2');
    expect(photos.getAttribute('data-state')).toBe('attention');
    expect(tags.getAttribute('data-state')).toBe('danger');
    expect(tags.getAttribute('aria-label')).toContain('Tags');
    expect(screen.getByTestId('section-nav-dot-photos')).toBeTruthy();
    expect(screen.getByTestId('section-nav-dot-tags')).toBeTruthy();
    expect(screen.queryByTestId('section-nav-dot-title')).toBeNull();
    // No state → the visible label is the accessible name.
    expect(within(nav).getByRole('button', { name: 'Title' })).toBeTruthy();
  });

  it('click: activates the chip (uncontrolled), scrolls, focuses the section heading, calls onSelect', () => {
    const onSelect = vi.fn();
    renderS(<Page onSelect={onSelect} />, locale);
    const nav = screen.getByRole('navigation');
    fireEvent.click(within(nav).getByRole('button', { name: 'Price' }));
    expect(onSelect).toHaveBeenCalledWith('price');
    expect(within(nav).getByRole('button', { name: 'Price' }).getAttribute('aria-current')).toBe('location');
    expect(window.scrollTo).toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe('Price heading');
  });

  it('controlled activeId wins over clicks', () => {
    renderS(<Page activeId="title" />, locale);
    const nav = screen.getByRole('navigation');
    fireEvent.click(within(nav).getByRole('button', { name: 'Price' }));
    expect(within(nav).getByRole('button', { name: 'Title' }).getAttribute('aria-current')).toBe('location');
  });

  it('scroll-spy: the first intersecting section (in nav order) becomes active', () => {
    const onActive = vi.fn();
    renderS(<Page onActiveChange={onActive} />, locale);
    expect(ioInstances).toHaveLength(1);
    const io = ioInstances[0];
    expect(io.observed.map((e) => (e as HTMLElement).id)).toEqual(['photos', 'title', 'tags', 'price']);
    expect(io.options?.rootMargin).toMatch(/^-\d+px 0px -55% 0px$/);
    const el = (id: string) => document.getElementById(id) as Element;
    act(() => io.cb([{ target: el('tags'), isIntersecting: true }, { target: el('price'), isIntersecting: true }]));
    expect(onActive).toHaveBeenLastCalledWith('tags');
    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('button')[2].getAttribute('aria-current')).toBe('location');
    act(() => io.cb([{ target: el('tags'), isIntersecting: false }]));
    expect(onActive).toHaveBeenLastCalledWith('price');
  });

  it('scroll-spy is ignored right after a chip click (no flicker while smooth-scrolling)', () => {
    const onActive = vi.fn();
    renderS(<Page onActiveChange={onActive} />, locale);
    const nav = screen.getByRole('navigation');
    fireEvent.click(within(nav).getByRole('button', { name: 'Price' }));
    act(() => ioInstances[0].cb([{ target: document.getElementById('title') as Element, isIntersecting: true }]));
    expect(onActive).not.toHaveBeenCalled();
    expect(within(nav).getByRole('button', { name: 'Price' }).getAttribute('aria-current')).toBe('location');
  });

  it('scroll-spy starts when the sections mount after the nav (skeleton first) and re-observes replaced nodes', async () => {
    const onActive = vi.fn();
    let setPhase: (p: string) => void = () => undefined;
    function Late() {
      const [phase, set] = useState('');
      setPhase = set;
      return (
        <div>
          <SectionNav sections={SECTIONS} onActiveChange={onActive} />
          {phase ? SECTIONS.map((s) => <section key={`${s.id}${phase}`} id={s.id}><h2>{s.label}</h2></section>) : null}
        </div>
      );
    }
    renderS(<Late />, locale);
    const io = ioInstances[0];
    expect(io.observed).toHaveLength(0);
    act(() => setPhase('a'));
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(io.observed.map((e) => (e as HTMLElement).id)).toEqual(['photos', 'title', 'tags', 'price']);
    act(() => io.cb([{ target: document.getElementById('tags') as Element, isIntersecting: true }]));
    expect(onActive).toHaveBeenLastCalledWith('tags');
    // Same ids, new nodes: the observer follows the new elements.
    act(() => setPhase('b'));
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(io.observed).toHaveLength(4);
    expect(io.observed[0]).toBe(document.getElementById('photos'));
  });

  it('scroll-spy: leaving the end of the scroll recomputes the active chip from the visible sections', () => {
    const onActive = vi.fn();
    renderS(<Page onActiveChange={onActive} />, locale);
    const io = ioInstances[0];
    const se = document.scrollingElement ?? document.documentElement;
    const set = (top: number) => {
      Object.defineProperty(se, 'scrollHeight', { configurable: true, value: 2000 });
      Object.defineProperty(se, 'clientHeight', { configurable: true, value: 800 });
      Object.defineProperty(se, 'scrollTop', { configurable: true, value: top });
    };
    set(0);
    act(() => io.cb([{ target: document.getElementById('tags') as Element, isIntersecting: true }]));
    expect(onActive).toHaveBeenLastCalledWith('tags');
    set(1200);
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(onActive).toHaveBeenLastCalledWith('price');
    set(1100);
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(onActive).toHaveBeenLastCalledWith('tags');
  });

  it('SectionNav.scrollTo(section, fieldId) is the spec alias of scrollToSection', () => {
    renderS(<Page />, locale);
    expect(SectionNav.scrollTo('tags', 'tags-field')).toBe(true);
    expect(document.activeElement?.id).toBe('tags-field');
    expect(SectionNav.scrollTo('nope')).toBe(false);
  });

  it('sticky={false} drops the sticky marker; renders nothing with no sections', () => {
    const { unmount } = renderS(<Page sticky={false} />, locale);
    expect(screen.getByRole('navigation').getAttribute('data-sticky')).toBeNull();
    unmount();
    renderS(<SectionNav sections={[]} />, locale);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('scrollToSection', () => {
  it('scrolls a scroll-root element and focuses the requested field', () => {
    renderS(
      <div data-testid="root" style={{ overflowY: 'auto' }}>
        <section id="s1"><h2>One</h2></section>
        <section id="s2"><h2>Two</h2><input id="f2" aria-label="f2" /></section>
      </div>,
    );
    const root = screen.getByTestId('root');
    const scrollSpy = vi.fn();
    (root as unknown as { scrollTo: unknown }).scrollTo = scrollSpy;
    expect(scrollToSection('s2', { root, fieldId: 'f2', behavior: 'auto' })).toBe(true);
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    expect(document.activeElement?.id).toBe('f2');
  });

  it('auto-detects the nearest scrolling ancestor and returns false for an unknown id', () => {
    renderS(
      <div data-testid="root" style={{ overflowY: 'auto' }}>
        <section id="a1"><h2>A</h2></section>
      </div>,
    );
    const root = screen.getByTestId('root');
    const scrollSpy = vi.fn();
    (root as unknown as { scrollTo: unknown }).scrollTo = scrollSpy;
    expect(scrollToSection('a1')).toBe(true);
    expect(scrollSpy).toHaveBeenCalled();
    expect(scrollToSection('missing')).toBe(false);
  });
});

describe.each(LOCALES)('SidePanel uses SectionNav (%s)', (locale) => {
  const sectionsLabel = (messagesFor(locale) as { ds: { overlay: { sections: string } } }).ds.overlay.sections;
  it('renders the shared chips (non-sticky) above the body when there are more than 5 sections', () => {
    renderS(
      <SidePanel open onClose={() => undefined} title="Order" sectionNav={Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: `Section ${i}`, state: i === 2 ? 'attention' as const : undefined }))}>
        {Array.from({ length: 6 }, (_, i) => <SidePanelSection key={i} id={`s${i}`} title={`Section ${i}`} />)}
      </SidePanel>,
      locale,
    );
    const nav = screen.getByRole('navigation', { name: sectionsLabel });
    expect(nav.getAttribute('data-sticky')).toBeNull();
    expect(within(nav).getAllByRole('button')).toHaveLength(6);
    expect(within(nav).getAllByRole('button')[2].getAttribute('data-state')).toBe('attention');
  });
  it('no chips with 5 or fewer sections', () => {
    renderS(<SidePanel open onClose={() => undefined} title="Order" sectionNav={[{ id: 'a', label: 'A' }]} />, locale);
    expect(screen.queryByRole('navigation', { name: sectionsLabel })).toBeNull();
  });
});

describe.each(LOCALES)('ImageGrid variant="strip" (%s)', (locale) => {
  const img = (messagesFor(locale) as { ds: { inputs: { images: Record<string, string> } } }).ds.inputs.images;
  const images = [
    { id: 'a', src: '/a.jpg', alt: 'Front' },
    { id: 'b', src: '/b.jpg' },
    { id: 'c', src: '/c.jpg', alt: 'Back', staged: 'add' as const },
    { id: 'd', src: '/d.jpg', alt: 'Old', staged: 'delete' as const },
  ];
  const noop = () => undefined;

  function Strip(props: Partial<React.ComponentProps<typeof ImageGrid>>) {
    return <ImageGrid variant="strip" images={images} max={20} onReorder={noop} onUpload={noop} onDelete={noop} onOpen={noop} {...props} />;
  }

  it('one h-scrolling row with the same badges, count and keyboard reorder as the grid', () => {
    const onReorder = vi.fn();
    const onOpen = vi.fn();
    const { container } = renderS(<Strip onReorder={onReorder} onOpen={onOpen} />, locale);
    expect(container.querySelector('[data-variant="strip"]')).toBeTruthy();
    expect(screen.getByTestId('image-strip-scroller')).toBeTruthy();
    expect(screen.getByText('3 / 20')).toBeTruthy();
    expect(screen.getByText(img.new)).toBeTruthy();
    expect(screen.getByText(img.willBeRemoved)).toBeTruthy();
    expect(screen.getByTitle(img.missingAlt)).toBeTruthy();
    const tiles = screen.getAllByRole('listitem');
    expect(tiles).toHaveLength(4);
    fireEvent.keyDown(tiles[1], { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('b');
    fireEvent.keyDown(tiles[0], { key: ' ' });
    fireEvent.keyDown(tiles[0], { key: 'ArrowRight' });
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c', 'd']);
    expect(screen.getByRole('button', { name: img.upload })).toBeTruthy();
  });

  it('trailing video tile: opens, shows staged add, is outside the photo list and count', () => {
    const onOpenVideo = vi.fn();
    renderS(<Strip images={images.slice(0, 2)} video={{ poster: '/v.jpg', staged: 'add' }} onOpenVideo={onOpenVideo} />, locale);
    const tile = screen.getByRole('button', { name: `${img.videoTile}, ${img.new}` });
    expect(within(screen.getByRole('list')).queryByTestId('image-strip-video')).toBeNull();
    // No nested interactive controls: the open button is not inside another button.
    expect(tile.parentElement?.closest('button, [role="button"]')).toBeNull();
    expect(screen.getByText('2 / 20')).toBeTruthy();
    expect(within(tile).getByText(img.new)).toBeTruthy();
    expect(within(tile).getByText(img.video)).toBeTruthy();
    // A native <button>: Enter/Space activate it without custom key handling.
    expect(tile.tagName).toBe('BUTTON');
    fireEvent.click(tile);
    fireEvent.click(tile);
    expect(onOpenVideo).toHaveBeenCalledTimes(2);
  });

  it('video staged for removal: "Will be removed" + Undo', () => {
    const onUndo = vi.fn();
    const onOpenVideo = vi.fn();
    renderS(<Strip images={images.slice(0, 1)} video={{ src: '/v.mp4', staged: 'delete' }} onOpenVideo={onOpenVideo} onUndoDeleteVideo={onUndo} />, locale);
    const tile = screen.getByTestId('image-strip-video');
    expect(within(tile).getByText(img.willBeRemoved)).toBeTruthy();
    expect(within(tile).getByRole('button', { name: `${img.videoTile}, ${img.willBeRemoved}` })).toBeTruthy();
    const undo = within(tile).getByRole('button', { name: img.undoVideo });
    expect(undo.closest('button')?.parentElement?.closest('button')).toBeNull();
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onOpenVideo).not.toHaveBeenCalled();
  });

  it('video tile does not open while disabled', () => {
    const onOpenVideo = vi.fn();
    renderS(<Strip images={images.slice(0, 1)} video={{ poster: '/v.jpg' }} onOpenVideo={onOpenVideo} disabled />, locale);
    fireEvent.click(within(screen.getByTestId('image-strip-video')).getByRole('button', { hidden: true }));
    expect(onOpenVideo).not.toHaveBeenCalled();
  });

  it('no video + onAddVideo → "Add video" tile; neither without onAddVideo', () => {
    const onAddVideo = vi.fn();
    const { unmount } = renderS(<Strip onAddVideo={onAddVideo} />, locale);
    fireEvent.click(screen.getByRole('button', { name: img.addVideo }));
    expect(onAddVideo).toHaveBeenCalled();
    unmount();
    renderS(<Strip />, locale);
    expect(screen.queryByRole('button', { name: img.addVideo })).toBeNull();
    expect(screen.queryByTestId('image-strip-video')).toBeNull();
  });

  it('empty strip: one wide inline dropzone with the given message; upload still capped by max', () => {
    const onUpload = vi.fn();
    const { container } = renderS(<Strip images={[]} max={1} onUpload={onUpload} emptyMessage="This listing has no photos" />, locale);
    const drop = screen.getByTestId('image-strip-empty');
    expect(drop.textContent).toContain('This listing has no photos');
    // The visible message is the accessible name (WCAG 2.5.3); no reorder hint above an empty strip.
    expect(screen.getByRole('button', { name: /This listing has no photos/ })).toBe(drop);
    expect(screen.queryByText(img.hint)).toBeNull();
    const files = [new File(['x'], 'x.png', { type: 'image/png' }), new File(['y'], 'y.png', { type: 'image/png' })];
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files } });
    expect(onUpload).toHaveBeenCalledWith([files[0]]);
  });

  it('empty strip while disabled still shows the message, without an upload action', () => {
    renderS(<Strip images={[]} disabled emptyMessage="This listing has no photos" />, locale);
    const drop = screen.getByTestId('image-strip-empty');
    expect(drop.textContent).toContain('This listing has no photos');
    expect(drop.getAttribute('data-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: img.upload })).toBeNull();
  });

  it('grid variant is unchanged: no scroller, no video tile even when a video is passed', () => {
    renderS(<ImageGrid images={images} max={20} onReorder={noop} onUpload={noop} onDelete={noop} onOpen={noop} video={{ poster: '/v.jpg' }} onAddVideo={noop} />, locale);
    expect(screen.queryByTestId('image-strip-scroller')).toBeNull();
    expect(screen.queryByTestId('image-strip-video')).toBeNull();
    expect(screen.queryByRole('button', { name: img.addVideo })).toBeNull();
  });
});

describe('M6-S i18n keys', () => {
  it('every key has EN and TR, same ICU placeholders, no ASCII-Turkish', () => {
    const rows = flattenM6s();
    expect(rows.length).toBe(7);
    for (const r of rows) {
      expect(r.en.length).toBeGreaterThan(0);
      expect(r.tr.length).toBeGreaterThan(0);
      const ph = (s: string) => (s.match(/\{(label|count)/g) ?? []).sort().join();
      expect(ph(r.tr)).toBe(ph(r.en));
      expect(r.tr).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme|Bolum|Degisiklik|Duzelt/);
    }
  });
});


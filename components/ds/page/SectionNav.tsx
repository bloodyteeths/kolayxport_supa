// components/ds/page/SectionNav.tsx — listing-editor §4.6 (M6 editor Group S): sticky anchor chips for long
// pages (editor, creator, settings-like forms) and, non-sticky, for the SidePanel `sectionNav` (one
// implementation for both).
//
// - Chips 32px (44 on coarse pointers), active = accent-50 background + accent-600 text, `aria-current`.
// - Per-section state dot: `attention` (changes not sent) = attention-solid, `danger` (block_sync error) =
//   danger-solid. The dot has a text equivalent in the chip's aria-label ("Tags, 1 change not sent").
// - Scroll-spy with IntersectionObserver against the nearest scrolling ancestor (the AppShell <main>, a
//   SidePanel body, or the window). Controlled (`activeId`) or uncontrolled.
// - One horizontal strip with h-scroll (no wrap) at every width; the active chip is kept in view inside the
//   strip without scrolling the page.
// - Sticky by default at `stickyTop` (default `var(--kx-section-nav-top, 0px)`): in AppShell the TopBar sits
//   outside the scrolling <main>, so 0 is flush under it; a window-scrolled page passes
//   `stickyTop="var(--kx-topbar-current)"` (CRITIQUE X7).
import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { accent, focusRing, motion, neutral, radius, tone, type as typeScale, zIndex } from '@/lib/ds/tokens';
import { COARSE } from './touch';
import type { DsBaseProps } from './types';

export type SectionNavState = 'attention' | 'danger';

export interface SectionNavItem {
  /** DOM id of the section element the chip scrolls to. */
  id: string;
  label: string;
  /** `attention` = has changes not sent · `danger` = has an error that blocks sending. */
  state?: SectionNavState;
  /** Number of changes not sent / problems, used only in the chip's aria-label. */
  count?: number;
}

export interface SectionNavProps extends DsBaseProps {
  sections: SectionNavItem[];
  /** Controlled active chip. Omit to let the scroll-spy drive it. */
  activeId?: string | null;
  /** Called after a chip click (the nav has already started scrolling to the section). */
  onSelect?: (id: string) => void;
  /** Called when the scroll-spy changes the active section (controlled and uncontrolled). */
  onActiveChange?: (id: string) => void;
  /** Default true. SidePanel renders it non-sticky between its header and its scrolling body. */
  sticky?: boolean;
  /** CSS `top` while sticky. Default `var(--kx-section-nav-top, 0px)`. */
  stickyTop?: string | number;
  /**
   * The element whose scroll position the spy and the chip clicks use. Default: the nearest scrolling
   * ancestor of the nav (AppShell <main>), else the window.
   */
  scrollRoot?: RefObject<HTMLElement | null>;
  /** Extra gap between the nav's bottom edge and a section's top after a jump. Default 8. */
  scrollGap?: number;
  /** Accessible name of the <nav>. Default "Sections". */
  'aria-label'?: string;
}

/** Chip height (desktop); 44 on coarse pointers. */
export const SECTION_NAV_CHIP_H = 32;
/** Rendered height of the sticky nav (chip + 8px vertical padding + 1px rule) on fine pointers. */
export const SECTION_NAV_HEIGHT = SECTION_NAV_CHIP_H + 16 + 1;

const SPY_LOCK_MS = 900;

function isScrollable(el: HTMLElement): boolean {
  if (typeof window === 'undefined') return false;
  const oy = window.getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
}

/** Nearest ancestor that scrolls vertically, or null for the window/document. */
export function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    if (isScrollable(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function findById(id: string, root: HTMLElement | null): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (root) {
    // ids may contain characters that are not valid in a CSS selector, so match by property.
    return Array.from(root.querySelectorAll<HTMLElement>('[id]')).find((x) => x.id === id) ?? null;
  }
  return document.getElementById(id);
}

export interface ScrollToSectionOptions {
  /** Scroll container; default: nearest scrolling ancestor of the section, else the window. */
  root?: HTMLElement | null;
  /** Pixels left above the section after the jump (sticky chrome height). Default 8. */
  offset?: number;
  /** After scrolling, focus this element id (a field inside the section), or the section heading. */
  fieldId?: string;
  behavior?: ScrollBehavior;
}

/**
 * Scrolls a section into view under the sticky chrome and optionally focuses a field in it
 * (listing-editor §4.4: `Check.fix.field` → `scrollToSection(section, { fieldId })`). Returns false when the
 * section is not in the DOM.
 */
export function scrollToSection(sectionId: string, opts: ScrollToSectionOptions = {}): boolean {
  if (typeof window === 'undefined') return false;
  const el = findById(sectionId, opts.root ?? null);
  if (!el) return false;
  const root = opts.root !== undefined ? opts.root : getScrollParent(el);
  const offset = opts.offset ?? 8;
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = opts.behavior ?? (reduce ? 'auto' : 'smooth');
  const elTop = el.getBoundingClientRect().top;
  if (root) {
    const top = elTop - root.getBoundingClientRect().top + root.scrollTop - offset;
    if (typeof root.scrollTo === 'function') root.scrollTo({ top: Math.max(0, top), behavior });
    else root.scrollTop = Math.max(0, top);
  } else if (typeof window.scrollTo === 'function') {
    try {
      window.scrollTo({ top: Math.max(0, elTop + window.scrollY - offset), behavior });
    } catch {
      /* jsdom: scrollTo not implemented */
    }
  }
  const target = opts.fieldId ? findById(opts.fieldId, el) ?? document.getElementById(opts.fieldId) : null;
  const focusEl = target ?? el.querySelector<HTMLElement>('h1, h2, h3, h4, [data-section-heading]');
  if (focusEl) {
    if (!target && !focusEl.hasAttribute('tabindex')) focusEl.setAttribute('tabindex', '-1');
    focusEl.focus({ preventScroll: true });
  }
  return true;
}

/**
 * Sticky section anchor chips with a scroll-spy. See the file header for the rules.
 */
export function SectionNav({
  sections, activeId, onSelect, onActiveChange, sticky = true, stickyTop = 'var(--kx-section-nav-top, 0px)',
  scrollRoot, scrollGap = 8, className, 'data-testid': testId, 'aria-label': ariaLabel,
}: SectionNavProps) {
  const t = useTranslations('ds.page.sectionNav');
  const navRef = useRef<HTMLElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const lockUntil = useRef(0);
  const lastSpy = useRef<string | null>(null);
  const [spyId, setSpyId] = useState<string | null>(sections[0]?.id ?? null);
  const controlled = activeId !== undefined;
  const current = controlled ? activeId : spyId;

  const onActiveRef = useRef(onActiveChange);
  onActiveRef.current = onActiveChange;

  const resolveRoot = useCallback((): HTMLElement | null => {
    if (scrollRoot) return scrollRoot.current ?? null;
    return getScrollParent(navRef.current);
  }, [scrollRoot]);

  /** Space the sticky nav takes at the top of the scroll root (its sticky top + its height + gap). */
  const jumpOffset = useCallback((): number => {
    const nav = navRef.current;
    if (!nav || !sticky) return scrollGap;
    const top = parseFloat(window.getComputedStyle(nav).top) || 0;
    return top + (nav.getBoundingClientRect().height || SECTION_NAV_HEIGHT) + scrollGap;
  }, [sticky, scrollGap]);

  const idsKey = sections.map((s) => s.id).join('|');

  // Scroll-spy: the active section is the first (in nav order) whose box crosses the band just under the nav.
  // The sections may mount after the nav (skeleton first, then content; a SidePanel body that loads after
  // opening) or be replaced while keeping their ids, so a MutationObserver on the root re-collects the section
  // elements and re-observes them whenever the set of nodes changes.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return undefined;
    const root = resolveRoot();
    const ids = idsKey ? idsKey.split('|') : [];
    if (!ids.length) return undefined;
    const lastId = ids[ids.length - 1];
    const visible = new Set<string>();
    const top = Math.round(jumpOffset());
    const commit = (id: string) => {
      if (lastSpy.current === id) return;
      lastSpy.current = id;
      setSpyId(id);
      onActiveRef.current?.(id);
    };
    const atEnd = () => {
      const r = root ?? document.scrollingElement ?? document.documentElement;
      return r.scrollHeight > r.clientHeight && r.scrollTop + r.clientHeight >= r.scrollHeight - 2;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        if (Date.now() < lockUntil.current) return;
        // A short last section never reaches the band: at the end of the scroll it is the active one.
        const first = atEnd() ? lastId : ids.find((id) => visible.has(id));
        if (first) commit(first);
      },
      { root, rootMargin: `-${top}px 0px -55% 0px`, threshold: 0 },
    );
    let observed: HTMLElement[] = [];
    const attach = () => {
      const els = ids.map((id) => findById(id, root)).filter((x): x is HTMLElement => !!x);
      if (els.length === observed.length && els.every((el, i) => el === observed[i])) return;
      // disconnect() also drops queued records; the new observe() calls report the current state again.
      observer.disconnect();
      visible.clear();
      observed = els;
      els.forEach((el) => observer.observe(el));
    };
    attach();
    let raf = 0;
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; attach(); });
    });
    mo?.observe(root ?? document.body, { childList: true, subtree: true });
    const target: HTMLElement | Window = root ?? window;
    const onScroll = () => {
      if (Date.now() < lockUntil.current) return;
      if (atEnd()) { commit(lastId); return; }
      // Leaving the end of the scroll: no IO entry may cross the band, so recompute from the visible set.
      if (lastSpy.current === lastId) {
        const first = ids.find((id) => visible.has(id));
        if (first) commit(first);
      }
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      mo?.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      target.removeEventListener('scroll', onScroll);
    };
  }, [idsKey, resolveRoot, jumpOffset]);

  // Keep the active chip visible inside the strip (never scrolls the page).
  useEffect(() => {
    const strip = stripRef.current;
    const chip = current ? chipRefs.current.get(current) : undefined;
    if (!strip || !chip) return;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 16);
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 16;
  }, [current]);

  const select = (id: string) => (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    lockUntil.current = Date.now() + SPY_LOCK_MS;
    if (!controlled) setSpyId(id);
    lastSpy.current = id;
    scrollToSection(id, { root: resolveRoot(), offset: jumpOffset() });
    onSelect?.(id);
  };

  const labelFor = (s: SectionNavItem): string => {
    if (s.state === 'danger') return t('danger', { label: s.label, count: s.count ?? 0 });
    if (s.state === 'attention') return t('attention', { label: s.label, count: s.count ?? 0 });
    return s.label;
  };

  if (!sections.length) return null;

  return (
    <Box
      component="nav"
      ref={navRef}
      aria-label={ariaLabel ?? t('label')}
      className={className}
      data-testid={testId ?? 'section-nav'}
      data-sticky={sticky ? 'true' : undefined}
      data-kx-section-nav=""
      sx={{
        ...(sticky ? { position: 'sticky', top: stickyTop, zIndex: zIndex.stickyToolbar } : null),
        flexShrink: 0,
        bgcolor: neutral[0],
        borderBottom: `1px solid ${neutral[100]}`,
      }}
    >
      <Box
        ref={stripRef}
        component="ul"
        sx={{
          listStyle: 'none', m: 0, py: '8px', px: '2px', display: 'flex', gap: '6px', overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' }, overscrollBehaviorX: 'contain',
        }}
      >
        {sections.map((s) => {
          const active = s.id === current;
          return (
            <Box component="li" key={s.id} sx={{ flexShrink: 0, display: 'flex' }}>
              <Box
                component="button"
                type="button"
                ref={(el: HTMLButtonElement | null) => {
                  if (el) chipRefs.current.set(s.id, el);
                  else chipRefs.current.delete(s.id);
                }}
                aria-current={active ? 'location' : undefined}
                aria-label={s.state ? labelFor(s) : undefined}
                data-state={s.state}
                data-active={active ? 'true' : undefined}
                onClick={select(s.id)}
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px', height: SECTION_NAV_CHIP_H, px: '12px',
                  border: `1px solid ${active ? accent[100] : neutral[200]}`, borderRadius: `${radius.full}px`,
                  bgcolor: active ? accent[50] : neutral[0], color: active ? accent[600] : neutral[700],
                  fontFamily: 'inherit', fontSize: typeScale.label[0], lineHeight: `${typeScale.label[1]}px`,
                  fontWeight: active ? 600 : typeScale.label[2], whiteSpace: 'nowrap', cursor: 'pointer',
                  transition: `background-color ${motion.fast}ms ${motion.ease}, color ${motion.fast}ms ${motion.ease}`,
                  '&:hover': { bgcolor: active ? accent[50] : neutral[50] },
                  '&:focus-visible': { outline: 'none', boxShadow: focusRing },
                  [COARSE]: { height: 36, px: '12px' }, // touch: 36px chips (44px made the section bar a third of the header)
                }}
              >
                <span>{s.label}</span>
                {s.state ? (
                  <Box
                    component="span"
                    aria-hidden
                    data-testid={`section-nav-dot-${s.id}`}
                    sx={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      bgcolor: s.state === 'danger' ? tone.danger.solid : tone.attention.solid,
                    }}
                  />
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Spec name (listing-editor §4.4, `Check.fix.field`): `SectionNav.scrollTo(section, fieldId)`. Same as
 * `scrollToSection(section, { fieldId })` with the default root/offset.
 */
SectionNav.scrollTo = (sectionId: string, fieldId?: string, opts: Omit<ScrollToSectionOptions, 'fieldId'> = {}): boolean => {
  let offset = opts.offset;
  if (offset === undefined && typeof document !== 'undefined') {
    // Leave room for the page's sticky SectionNav, like a chip click does.
    const nav = document.querySelector<HTMLElement>('nav[data-kx-section-nav][data-sticky="true"]');
    if (nav) {
      const top = parseFloat(window.getComputedStyle(nav).top) || 0;
      offset = top + (nav.getBoundingClientRect().height || SECTION_NAV_HEIGHT) + 8;
    }
  }
  return scrollToSection(sectionId, { ...opts, offset, fieldId });
};

export default SectionNav;

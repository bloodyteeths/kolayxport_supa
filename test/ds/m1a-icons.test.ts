import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as lucide from 'lucide-react';
import { ICON_STROKE, iconSize, icons, toneIcons } from '@/lib/ds/icons';

describe('icon registry (DS §3.15, BUILD_PLAN §2)', () => {
  it('one icon, one meaning: no two meanings share a lucide component (aliases included)', () => {
    const seen = new Map<unknown, string>();
    const dupes: string[] = [];
    for (const [meaning, Icon] of Object.entries(icons)) {
      const prev = seen.get(Icon);
      if (prev) dupes.push(`${prev} / ${meaning}`);
      seen.set(Icon, meaning);
    }
    expect(dupes).toEqual([]);
  });

  it('every entry is a lucide-react icon', () => {
    const lucideValues = new Set(Object.values(lucide));
    for (const [meaning, Icon] of Object.entries(icons)) expect(lucideValues.has(Icon), meaning).toBe(true);
  });

  it('holds the DS core meanings and every surface addition', () => {
    const expected: Record<string, unknown> = {
      push: lucide.Send, pull: lucide.RefreshCw, label: lucide.Tag, print: lucide.Printer, order: lucide.Receipt,
      listing: lucide.LayoutGrid, research: lucide.Telescope, message: lucide.MessageSquare, reports: lucide.BarChart3,
      finance: lucide.Wallet, settings: lucide.Settings, ai: lucide.Sparkles, edit: lucide.Pencil, more: lucide.MoreHorizontal,
      delete: lucide.Trash2,
      // settings §14
      connections: lucide.Plug, credentials: lucide.KeyRound, senderProfile: lucide.Warehouse, billing: lucide.CreditCard,
      languageRegion: lucide.Globe, history: lucide.History,
      // orders §0.3
      note: lucide.StickyNote, rush: lucide.Zap,
      // shell-nav §14
      overview: lucide.Home, help: lucide.LifeBuoy, add: lucide.Plus, notifications: lucide.Bell, search: lucide.Search,
      signOut: lucide.LogOut, language: lucide.Languages, shortcuts: lucide.Keyboard, usage: lucide.Gauge,
      collapse: lucide.PanelLeftClose, expand: lucide.PanelLeftOpen, back: lucide.ChevronLeft, menu: lucide.Menu,
      // pro-gating, BUILD_PLAN §2/§7, overview, settings note (Package = Thumb placeholder)
      locked: lucide.LockKeyhole, stockSync: lucide.Boxes, etsyActivity: lucide.Activity, done: lucide.CheckCircle2,
      thumbPlaceholder: lucide.Package,
      // DS §3.3/§4.3 Toolbar, DateTimeField, ImageGrid
      density: lucide.Rows3, savedView: lucide.Bookmark, saveView: lucide.BookmarkPlus, time: lucide.Clock, primaryPhoto: lucide.Star,
    };
    for (const [k, v] of Object.entries(expected)) expect((icons as Record<string, unknown>)[k], k).toBe(v);
  });

  it('every lucide name a surface spec assigns a meaning to is registered', () => {
    // Names a spec explicitly binds to a meaning ("icon `X`", registry rows). Grep-derived list, frozen in M1-a.
    const dir = join(__dirname, '../../design/surfaces');
    const text = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    const registered = new Set(Object.values(icons));
    const required = ['Plug', 'KeyRound', 'Warehouse', 'CreditCard', 'Globe', 'History', 'StickyNote', 'Zap', 'LifeBuoy', 'Gauge', 'LockKeyhole', 'CheckCircle2', 'Telescope'];
    for (const name of required) {
      expect(new RegExp(`\\b${name}\\b`).test(text), `${name} is referenced by a surface`).toBe(true);
      expect(registered.has((lucide as Record<string, unknown>)[name] as never), name).toBe(true);
    }
  });

  it('tone icons reuse registry meanings; sizes and stroke are fixed', () => {
    const registered = new Set(Object.values(icons));
    for (const Icon of Object.values(toneIcons)) expect(registered.has(Icon as never)).toBe(true);
    expect(ICON_STROKE).toBe(1.75);
    expect(iconSize).toEqual({ control: 16, nav: 18, empty: 20 });
  });
});

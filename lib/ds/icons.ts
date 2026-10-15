// lib/ds/icons.ts — DESIGN_SYSTEM §3.15. Semantic icon registry: one icon, one meaning.
// lucide-react only. Pages and DS components import icons from here, never from lucide directly.
// Brands are never icons: use <LogoTile>. Registry frozen in M1-a (BUILD_PLAN §2); later additions go
// through the integrator. Sources: DS §3.15, settings §1.2/§14, orders §0.3/§4.3, shell-nav §2.1/§14,
// research §4, pro-gating §3.1, overview §3.3, bulk-grid §3, BUILD_PLAN §2/§7 (stock sync, Etsy activity,
// notifications).
//
// test/ds/m1a-icons.test.ts fails when two meanings share one lucide component (aliases such as
// CheckCircle2/CircleCheck resolve to the same component and are caught too).

import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Bell,
  Bookmark,
  BookmarkPlus,
  Boxes,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDot,
  CircleHelp,
  CircleX,
  Clock,
  Columns3,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Gauge,
  Globe,
  GripVertical,
  History,
  Home,
  Images,
  Info,
  KeyRound,
  Keyboard,
  Languages,
  LayoutGrid,
  LifeBuoy,
  ListFilter,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plug,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Rows3,
  Search,
  SearchX,
  Send,
  Settings,
  Sparkles,
  Star,
  StickyNote,
  Tag,
  Telescope,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  Video,
  Wallet,
  Warehouse,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type { LucideIcon };

/** Stroke width for every DS icon. */
export const ICON_STROKE = 1.75;
/** 16 in controls and tables, 18 in nav, 20 in empty-state tiles. */
export const iconSize = { control: 16, nav: 18, empty: 20 } as const;

export const icons = {
  // DS §3.15 core meanings
  push: Send, // send staged changes to a marketplace
  pull: RefreshCw, // refresh from a marketplace
  label: Tag, // shipping label / create label
  print: Printer,
  order: Receipt,
  listing: LayoutGrid, // listings; also the bulk editor empty state
  research: Telescope,
  message: MessageSquare,
  reports: BarChart3,
  finance: Wallet, // payouts, transactions
  settings: Settings,
  ai: Sparkles, // any AI action or AI suggestion marker
  edit: Pencil, // edit / fix (address, field)
  more: MoreHorizontal, // ⋯ overflow
  delete: Trash2, // menus only

  // settings-billing-pricing §1.2, §14
  connections: Plug,
  credentials: KeyRound,
  senderProfile: Warehouse,
  billing: CreditCard,
  languageRegion: Globe, // Settings › Preferences (language & region)
  history: History, // refresh / run history

  // orders §0.3
  note: StickyNote, // private note indicator
  rush: Zap, // buyer's paid shipping upgrade

  // shell-nav §2.1, §14
  overview: Home,
  help: LifeBuoy,
  add: Plus, // + New, Connect a store
  notifications: Bell,
  search: Search,
  signOut: LogOut,
  language: Languages, // UI language switch
  shortcuts: Keyboard,
  usage: Gauge, // usage meter ≥ 80%
  collapse: PanelLeftClose,
  expand: PanelLeftOpen,
  back: ChevronLeft, // back / previous record (‹)
  next: ChevronRight, // next record (›), drill-in row
  menu: Menu, // mobile "More" tab
  disclosure: ChevronDown, // opens a menu / select / accordion

  // pro-gating §3.1, BUILD_PLAN §2 / §7
  locked: LockKeyhole,
  stockSync: Boxes,
  etsyActivity: Activity,

  // states and feedback (EmptyState, Banner, toast, ScorePanel)
  done: CheckCircle2, // EmptyState kind="done", success tone
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
  unsent: CircleDot, // attention tone: changes not sent yet
  noResults: SearchX,
  fail: CircleX, // a failing check
  check: Check, // passed check, copied, selected option
  hint: CircleHelp, // TermHint (?)

  // generic actions used across surfaces
  close: X, // close panel / clear a field
  copy: Copy,
  externalLink: ExternalLink, // "Open on Etsy ↗"
  download: Download, // export CSV, download PDF
  upload: Upload,
  revert: Undo2, // revert cell / field
  filter: ListFilter,
  columns: Columns3,
  sort: ArrowUpDown,
  sortAsc: ArrowUp,
  sortDesc: ArrowDown,
  calendar: CalendarDays, // date and date-range fields
  schedule: CalendarClock, // scheduled send
  dragHandle: GripVertical,
  photos: Images,
  video: Video,
  thumbPlaceholder: Package, // Thumb with no image (never "-")

  // DS §3.3/§4.3 Toolbar, M1-b DateTimeField, ImageGrid
  density: Rows3, // table density toggle
  savedView: Bookmark, // choose a saved view
  saveView: BookmarkPlus, // save the current view
  time: Clock, // time-of-day field
  primaryPhoto: Star, // primary (first) listing photo badge
} as const satisfies Record<string, LucideIcon>;

export type IconKey = keyof typeof icons;

export type IconTone = 'success' | 'warning' | 'danger' | 'info' | 'attention' | 'neutral';
/** Tone glyphs for Banner, toast and inline validation. Built from registry meanings, not new icons. */
export const toneIcons: Record<IconTone, LucideIcon> = {
  success: icons.done,
  info: icons.info,
  neutral: icons.info,
  warning: icons.warning,
  danger: icons.error,
  attention: icons.unsent,
};

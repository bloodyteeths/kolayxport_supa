import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Select, MenuItem, FormControl, InputLabel, TextField, Button, Chip,
  CircularProgress, IconButton, SwipeableDrawer, Skeleton, Collapse,
} from '@mui/material';
import {
  Mail, Send, ArrowLeft, Package, MessageSquare, RefreshCw, ExternalLink, ShoppingBag,
  ChevronDown, ChevronUp, User, AlertTriangle, BookmarkPlus,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import AppLayout from '@/components/AppLayout';
import ConnectEmptyState from '@/components/ui/ConnectEmptyState';
import useScreenSize from '@/hooks/useScreenSize';
import { useAuth } from '@/lib/auth-context';
import { useConnections } from '@/lib/hooks/useConnections';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { notify } from '@/lib/notify';
import useMessageCountStore from '@/lib/stores/useMessageCountStore';
import type { UnifiedConversation, UnifiedMessage, OrderContext } from '@/types/messages';

const PLATFORM_COLORS: Record<string, string> = {
  wix: '#0C6EFC',
  trendyol: '#F27A1A',
};

const PLATFORM_NAMES: Record<string, string> = {
  wix: 'Wix',
  trendyol: 'Trendyol',
};

type MessagePlatform = 'wix' | 'trendyol';
type PlatformErrorCode = 'permission' | 'auth' | 'credentials' | 'rateLimited' | 'unavailable';
interface PlatformError { platform: MessagePlatform; code: PlatformErrorCode; detail?: string }

const PLATFORM_ERROR_CODES: readonly PlatformErrorCode[] = ['permission', 'auth', 'credentials', 'rateLimited', 'unavailable'];
/** Codes the user fixes in Settings — their warning chip links there. */
const FIXABLE_IN_SETTINGS: readonly PlatformErrorCode[] = ['permission', 'auth', 'credentials'];

/** initial = first load / filter change (skeleton), refresh = manual button (spinner), background = poll (silent). */
type FetchMode = 'initial' | 'refresh' | 'background';

const POLL_MS = 120_000;
const COUNT_REFRESH_DELAY_MS = 4_000;
const MAX_TEMPLATES = 20;
const MAX_TEMPLATE_LENGTH = 1000;

const convKey = (c: { platform: string; id: string }) => `${c.platform}-${c.id}`;

function parsePlatformErrors(raw: unknown): PlatformError[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is PlatformError =>
    !!e && typeof e === 'object'
    && (e.platform === 'wix' || e.platform === 'trendyol')
    && PLATFORM_ERROR_CODES.includes(e.code),
  );
}

function parseTemplates(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.slice(0, MAX_TEMPLATE_LENGTH))
      .slice(0, MAX_TEMPLATES);
  } catch {
    return [];
  }
}

export default function MessagesPage() {
  const t = useTranslations('messages');
  const tUi = useTranslations('ui');
  const locale = useLocale();
  const intlLocale = locale === 'en' ? 'en-US' : 'tr-TR';
  const { isMobile } = useScreenSize();
  // auth-context is plain JS; its user shape is untyped.
  const { user } = useAuth() as { user: { id?: string | number } | null };
  const confirm = useConfirm();
  const { has } = useConnections();
  const fetchMessageCounts = useMessageCountStore((s) => s.fetch);
  const decrementMessageCount = useMessageCountStore((s) => s.decrement);

  // Filters
  const [platform, setPlatform] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');

  // Data
  const [conversations, setConversations] = useState<UnifiedConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [platformErrors, setPlatformErrors] = useState<PlatformError[]>([]);
  const [enabledPlatforms, setEnabledPlatforms] = useState<string[]>([]);

  // Thread
  const [selectedConv, setSelectedConv] = useState<UnifiedConversation | null>(null);
  const [threadMessages, setThreadMessages] = useState<UnifiedMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Reply
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const replyInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Saved replies (per user, browser-local only)
  const [templates, setTemplates] = useState<string[]>([]);
  const userId: string | null = user?.id ? String(user.id) : null;
  const templatesKey = userId ? `kx.messages.savedReplies.${userId}` : null;

  // Order context (Wix)
  const [orderContext, setOrderContext] = useState<OrderContext[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Latest-wins guard for list requests + in-flight counter so a poll never races a user fetch.
  const fetchSeq = useRef(0);
  const inFlight = useRef(0);
  // Conversations answered from this tab: key -> reply time (ms). Keeps them "answered"
  // until the platform API catches up, so a poll can't re-enable a Trendyol one-shot reply.
  const locallyAnswered = useRef<Map<string, number>>(new Map());
  // Thread currently open, readable from async callbacks without stale closures.
  const selectedKeyRef = useRef<string | null>(null);
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (countTimer.current) clearTimeout(countTimer.current); }, []);

  const applyLocalAnswers = useCallback((list: UnifiedConversation[]): UnifiedConversation[] => {
    const answered = locallyAnswered.current;
    if (answered.size === 0) return list;
    return list.map((c) => {
      const key = convKey(c);
      const repliedAt = answered.get(key);
      if (repliedAt === undefined || c.status === 'answered') return c;
      // Trendyol: one answer per question, so it stays answered.
      // Wix: a customer message newer than our reply legitimately re-opens it.
      const lastMs = new Date(c.lastMessageDate).getTime();
      if (c.platform === 'trendyol' || !Number.isFinite(lastMs) || lastMs <= repliedAt) {
        return { ...c, status: 'answered' as const };
      }
      answered.delete(key);
      return c;
    });
  }, []);

  // ── Fetch conversations ───────────────────────────────
  const fetchConversations = useCallback(async (mode: FetchMode = 'initial') => {
    if (mode === 'background' && inFlight.current > 0) return;
    const seq = ++fetchSeq.current;
    inFlight.current += 1;
    if (mode === 'refresh') setRefreshing(true);
    else if (mode === 'initial') setLoading(true);
    try {
      const res = await fetch(`/api/messages?action=list&platform=${platform}&status=${status}&size=50`);
      const data = await res.json().catch(() => ({}));
      if (seq !== fetchSeq.current) return; // a newer request (e.g. filter change) owns the UI
      if (res.ok) {
        const fresh = applyLocalAnswers(Array.isArray(data.conversations) ? data.conversations : []);
        const errs = parsePlatformErrors(data.platformErrors);
        if (mode === 'initial') {
          setConversations(fresh);
        } else {
          // Refresh/poll: a platform that failed this time keeps its previous conversations,
          // and the open thread stays listed even if it dropped out of the filter.
          const failed = new Set(errs.map((e) => e.platform));
          const openKey = selectedKeyRef.current;
          setConversations((prev) => {
            const freshKeys = new Set(fresh.map(convKey));
            const kept = prev.filter((c) => !freshKeys.has(convKey(c))
              && (failed.has(c.platform) || (openKey !== null && convKey(c) === openKey)));
            if (kept.length === 0) return fresh;
            return [...fresh, ...kept].sort((a, b) =>
              (new Date(b.lastMessageDate).getTime() || 0) - (new Date(a.lastMessageDate).getTime() || 0));
          });
        }
        setPlatformErrors(errs);
        setEnabledPlatforms(Array.isArray(data.enabledPlatforms) ? data.enabledPlatforms : []);
        // Keep the open thread (and its draft) — only refresh its metadata if it's still listed.
        setSelectedConv((prev) => {
          if (!prev) return prev;
          const match = fresh.find((c) => convKey(c) === convKey(prev));
          return match ? { ...match, messages: prev.messages } : prev;
        });
      } else if (mode !== 'background') {
        notify.error({ status: res.status, ...data }, 'messages.fetchFailed');
        if (mode === 'initial') setConversations([]);
      }
    } catch (err) {
      // Background polls fail silently; the next poll or a manual refresh retries.
      if (mode !== 'background' && seq === fetchSeq.current) notify.error(err, 'messages.fetchFailed');
    } finally {
      inFlight.current = Math.max(0, inFlight.current - 1);
      if (seq === fetchSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [platform, status, applyLocalAnswers]);

  useEffect(() => {
    fetchConversations('initial');
  }, [fetchConversations]);

  // Poll every 2 minutes in the background (never swaps the view for skeletons).
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchConversations('background');
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  // ── Saved replies ─────────────────────────────────────
  useEffect(() => {
    if (!templatesKey) { setTemplates([]); return; }
    try {
      setTemplates(parseTemplates(window.localStorage.getItem(templatesKey)));
    } catch {
      setTemplates([]);
    }
  }, [templatesKey]);

  const persistTemplates = useCallback((next: string[]) => {
    setTemplates(next);
    if (!templatesKey) return;
    try {
      window.localStorage.setItem(templatesKey, JSON.stringify(next));
    } catch {
      // Storage blocked/full: templates still work for this session.
    }
  }, [templatesKey]);

  const saveCurrentAsTemplate = () => {
    const text = replyText.trim();
    if (!text) return;
    if (text.length > MAX_TEMPLATE_LENGTH) {
      notify.info(t('templates.tooLong', { max: MAX_TEMPLATE_LENGTH }));
      return;
    }
    if (templates.includes(text)) {
      notify.info(t('templates.alreadySaved'));
      return;
    }
    if (templates.length >= MAX_TEMPLATES) {
      notify.info(t('templates.limitReached', { max: MAX_TEMPLATES }));
      return;
    }
    persistTemplates([...templates, text]);
    notify.success(t('templates.saved'));
  };

  const deleteTemplate = async (text: string) => {
    const ok = await confirm({
      title: t('templates.deleteTitle'),
      description: text.length > 160 ? `${text.slice(0, 159)}…` : text,
      destructive: true,
    });
    if (ok) persistTemplates(templates.filter((x) => x !== text));
  };

  const insertTemplate = (text: string) => {
    setReplyText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${text}` : text));
    // Focus after the value update so the caret lands at the end.
    setTimeout(() => {
      const el = replyInputRef.current;
      if (el) {
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    }, 0);
  };

  // ── Fetch thread ──────────────────────────────────────
  const openThread = useCallback(async (conv: UnifiedConversation) => {
    const key = convKey(conv);
    if (selectedKeyRef.current !== key) setReplyText(''); // re-opening the same thread keeps the draft
    selectedKeyRef.current = key;
    setSelectedConv(conv);
    setOrderContext([]);
    setContextExpanded(!isMobile); // expanded on desktop, collapsed on mobile
    if (isMobile) setDrawerOpen(true);

    // If Trendyol, messages already loaded in the conversation
    if (conv.platform === 'trendyol') {
      setThreadMessages(conv.messages);
      return;
    }

    // Wix: fetch full thread
    setThreadMessages([]);
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/messages?action=thread&platform=${conv.platform}&conversationId=${conv.id}`);
      if (res.ok) {
        const data = await res.json();
        if (selectedKeyRef.current === key) setThreadMessages(Array.isArray(data.messages) ? data.messages : []);
      }
    } catch {
      if (selectedKeyRef.current === key) setThreadMessages([]);
    } finally {
      if (selectedKeyRef.current === key) setThreadLoading(false);
    }

    // Wix: lazy fetch order context (non-blocking)
    if (conv.contactId) {
      setOrderLoading(true);
      fetch(`/api/messages?action=orderContext&contactId=${conv.contactId}`)
        .then(r => r.ok ? r.json() : { orders: [] })
        .then(data => { if (selectedKeyRef.current === key) setOrderContext(Array.isArray(data.orders) ? data.orders : []); })
        .catch(() => { if (selectedKeyRef.current === key) setOrderContext([]); })
        .finally(() => { if (selectedKeyRef.current === key) setOrderLoading(false); });
    }
  }, [isMobile]);

  // Scroll to bottom when messages load
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages]);

  // ── Send reply ────────────────────────────────────────
  const handleReply = async () => {
    if (!replyText.trim() || !selectedConv || sending) return;
    const conv = selectedConv;
    const key = convKey(conv);
    setSending(true);
    try {
      const body: any = {
        platform: conv.platform,
        text: replyText.trim(),
      };
      if (conv.platform === 'trendyol') {
        body.questionId = conv.id;
      } else {
        body.conversationId = conv.id;
      }

      const res = await fetch('/api/messages?action=reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        notify.success(t('replySent'));
        locallyAnswered.current.set(key, Date.now());

        // Unread badge: drop it now, then confirm with the server once the platform has caught up.
        if (conv.status === 'unanswered') decrementMessageCount(conv.platform);
        if (countTimer.current) clearTimeout(countTimer.current);
        countTimer.current = setTimeout(() => { fetchMessageCounts({ force: true }); }, COUNT_REFRESH_DELAY_MS);

        // Update conversation status locally
        setConversations(prev => prev.map(c =>
          convKey(c) === key ? { ...c, status: 'answered' as const } : c
        ));

        // Only touch the thread view if the user is still on that conversation.
        if (selectedKeyRef.current === key) {
          setReplyText('');
          setThreadMessages(prev => [...prev, {
            id: `reply-${Date.now()}`,
            sender: 'seller',
            text: body.text,
            date: new Date().toISOString(),
          }]);
          setSelectedConv(prev => prev && convKey(prev) === key ? { ...prev, status: 'answered' } : prev);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        notify.error({ status: res.status, ...err }, 'messages.replyFailed');
      }
    } catch (err) {
      notify.error(err, 'messages.replyFailed');
    } finally {
      setSending(false);
    }
  };

  const canReply = selectedConv && !(selectedConv.platform === 'trendyol' && selectedConv.status === 'answered');

  // ── Formatting (current locale) ───────────────────────
  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) return '';
      const diffMs = Date.now() - date.getTime();
      const diffH = diffMs / (1000 * 60 * 60);

      if (diffH < 1) return t('time.minutes', { n: Math.max(1, Math.floor(diffMs / 60000)) });
      if (diffH < 24) return t('time.hours', { n: Math.floor(diffH) });
      if (diffH < 48) return t('time.yesterday');
      return date.toLocaleDateString(intlLocale, { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  };

  const formatTime = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  // ── Connection state ──────────────────────────────────
  // undefined = still loading / unknown -> keep showing the inbox (never hide data on a transient error).
  const wixConnected = has('wix');
  const trendyolConnected = has('trendyol');
  // Also require the inbox API to agree (it can see credentials connectionStatus doesn't),
  // and only on the unfiltered view so a filter can never lock the user out of the inbox.
  const noneConnected = wixConnected === false && trendyolConnected === false
    && !loading && platform === 'all' && enabledPlatforms.length === 0;

  // ── Render helpers ────────────────────────────────────

  const ConversationCard = ({ conv, onClick }: { conv: UnifiedConversation; onClick: () => void }) => {
    const isSelected = selectedConv?.id === conv.id && selectedConv?.platform === conv.platform;
    return (
      <div
        onClick={onClick}
        className={`p-3 border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50 ${
          isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
        }`}
      >
        <div className="flex items-start gap-2.5">
          {/* Thumbnail: product image (Trendyol) or user avatar (Wix) */}
          {conv.platform === 'trendyol' && conv.productInfo?.imageUrl ? (
            <img
              src={conv.productInfo.imageUrl}
              alt=""
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-slate-100"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
              <User size={18} className="text-slate-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <Chip
                  label={PLATFORM_NAMES[conv.platform] || conv.platform}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    bgcolor: PLATFORM_COLORS[conv.platform] + '15',
                    color: PLATFORM_COLORS[conv.platform],
                    '& .MuiChip-label': { px: 1 },
                  }}
                />
                <span className="text-xs font-semibold text-slate-800 truncate">{conv.customerName || t('customer')}</span>
                {conv.status === 'unanswered' && (
                  <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                )}
              </div>
              <span className="text-[10px] text-slate-400 flex-shrink-0 whitespace-nowrap">
                {formatDate(conv.lastMessageDate)}
              </span>
            </div>
            {conv.platform === 'trendyol' && conv.productInfo?.title && (
              <p className="text-[11px] text-slate-500 truncate mb-0.5">
                <Package size={10} className="inline mr-1 -mt-0.5" />
                {conv.productInfo.title}
              </p>
            )}
            <p className="text-xs text-slate-400 truncate">{conv.lastMessageText}</p>
          </div>
        </div>
      </div>
    );
  };

  const platformErrorChips = platformErrors.length > 0 && (
    <div className="flex flex-wrap gap-1.5 mb-2" role="status">
      {platformErrors.map((err) => {
        const name = PLATFORM_NAMES[err.platform] || err.platform;
        const fixable = FIXABLE_IN_SETTINGS.includes(err.code);
        const tab = err.platform === 'trendyol' ? 'apiKeys' : 'connections';
        return (
          <Chip
            key={`${err.platform}-${err.code}`}
            icon={<AlertTriangle size={14} />}
            label={t(`platformErrors.${err.code}`, { name })}
            size="small"
            {...(fixable ? { component: Link, href: `/ayarlar?tab=${tab}`, clickable: true } : {})}
            sx={{
              height: 'auto',
              minHeight: isMobile && fixable ? 44 : 28,
              py: 0.5,
              bgcolor: '#fffbeb',
              color: '#92400e',
              border: '1px solid #fde68a',
              fontSize: '0.75rem',
              '& .MuiChip-icon': { color: '#d97706' },
              '& .MuiChip-label': { whiteSpace: 'normal' },
            }}
          />
        );
      })}
    </div>
  );

  const templateRow = canReply && userId && (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-2" role="group" aria-label={t('templates.label')}>
      {templates.map((tpl) => (
        <Chip
          key={tpl}
          label={tpl}
          title={tpl}
          size="small"
          onClick={() => insertTemplate(tpl)}
          onDelete={() => deleteTemplate(tpl)}
          disabled={sending}
          sx={{
            flexShrink: 0,
            maxWidth: 200,
            height: isMobile ? 44 : 28,
            borderRadius: '14px',
            bgcolor: '#f1f5f9',
            fontSize: '0.75rem',
            '& .MuiChip-deleteIcon': isMobile
              // 22px glyph + 11px padding = 44x44 hit area, kept clear of the insert tap zone.
              ? { fontSize: 22, boxSizing: 'content-box', p: '11px', m: '0 -6px 0 -4px' }
              : { fontSize: 16 },
          }}
        />
      ))}
      <Chip
        icon={<BookmarkPlus size={14} />}
        label={t('templates.saveCurrent')}
        size="small"
        variant="outlined"
        onClick={saveCurrentAsTemplate}
        disabled={!replyText.trim() || sending}
        sx={{
          flexShrink: 0,
          height: isMobile ? 44 : 28,
          borderRadius: '14px',
          fontSize: '0.75rem',
          borderStyle: 'dashed',
        }}
      />
    </div>
  );

  const threadView = (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      {selectedConv && (
        <div className="flex items-center gap-3 p-3 border-b border-slate-100 bg-white">
          {isMobile && (
            <IconButton size="small" onClick={() => setDrawerOpen(false)} sx={{ minWidth: 44, minHeight: 44 }}>
              <ArrowLeft size={18} />
            </IconButton>
          )}
          <Chip
            label={PLATFORM_NAMES[selectedConv.platform] || selectedConv.platform}
            size="small"
            sx={{
              height: 22,
              fontSize: '0.7rem',
              fontWeight: 700,
              bgcolor: PLATFORM_COLORS[selectedConv.platform] + '15',
              color: PLATFORM_COLORS[selectedConv.platform],
            }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{selectedConv.customerName || t('customer')}</p>
            {selectedConv.productInfo && (
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <Package size={12} />
                <span className="truncate">{selectedConv.productInfo.title}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context Panel: Product (Trendyol) or Orders (Wix) */}
      {selectedConv && (selectedConv.productInfo || selectedConv.platform === 'wix') && (
        <div className="border-b border-slate-100 bg-slate-50">
          {/* Trendyol: product info bar */}
          {selectedConv.platform === 'trendyol' && selectedConv.productInfo && (
            <div className="flex items-center gap-3 px-3 py-2">
              {selectedConv.productInfo.imageUrl && (
                <img
                  src={selectedConv.productInfo.imageUrl}
                  alt=""
                  className="w-12 h-12 rounded-lg object-cover bg-white border border-slate-200"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-700 truncate">{selectedConv.productInfo.title}</p>
                <p className="text-[10px] text-slate-400">{t('productContext')} · {selectedConv.productInfo.id}</p>
              </div>
              {selectedConv.productInfo.webUrl && (
                <a
                  href={selectedConv.productInfo.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 flex-shrink-0"
                >
                  {t('viewProduct')}
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}

          {/* Wix: recent orders (collapsible) */}
          {selectedConv.platform === 'wix' && selectedConv.contactId && (
            <div>
              <button
                onClick={() => setContextExpanded(!contextExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <ShoppingBag size={13} />
                  {t('recentOrders')}
                  {orderContext.length > 0 && (
                    <span className="text-[10px] text-slate-400">({orderContext.length})</span>
                  )}
                </span>
                {contextExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <Collapse in={contextExpanded}>
                <div className="px-3 pb-2">
                  {orderLoading ? (
                    <p className="text-[11px] text-slate-400 py-1">{t('loadingOrders')}</p>
                  ) : orderContext.length === 0 ? (
                    <p className="text-[11px] text-slate-400 py-1">{t('noOrders')}</p>
                  ) : (
                    <div className="space-y-2">
                      {orderContext.map((order) => (
                        <div key={order.orderNumber} className="bg-white rounded-lg border border-slate-200 p-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-slate-700">
                              {t('orderNumber')}{order.orderNumber}
                            </span>
                            <Chip
                              label={order.status}
                              size="small"
                              sx={{
                                height: 18,
                                fontSize: '0.6rem',
                                fontWeight: 600,
                                bgcolor: order.status === 'FULFILLED' ? '#dcfce7' : order.status === 'PAID' ? '#dbeafe' : '#f1f5f9',
                                color: order.status === 'FULFILLED' ? '#166534' : order.status === 'PAID' ? '#1e40af' : '#475569',
                              }}
                            />
                          </div>
                          <div className="flex items-center gap-1.5 mb-1">
                            {order.items.slice(0, 3).map((item, idx) => (
                              item.imageUrl ? (
                                <img key={idx} src={item.imageUrl} alt="" className="w-8 h-8 rounded object-cover bg-slate-50" />
                              ) : (
                                <div key={idx} className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center">
                                  <Package size={12} className="text-slate-300" />
                                </div>
                              )
                            ))}
                            {order.items.length > 3 && (
                              <span className="text-[10px] text-slate-400">+{order.items.length - 3}</span>
                            )}
                            <div className="flex-1 min-w-0 ml-1">
                              {order.items.slice(0, 2).map((item, idx) => (
                                <p key={idx} className="text-[10px] text-slate-500 truncate">{item.name}</p>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>{formatDate(order.createdDate)}</span>
                            <span className="font-medium text-slate-600">{order.total} {order.currency}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Collapse>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ backgroundColor: '#f8fafc' }}>
        {threadLoading ? (
          <div className="flex justify-center py-8">
            <CircularProgress size={24} />
          </div>
        ) : threadMessages.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8">{t('noMessages')}</p>
        ) : (
          threadMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender === 'seller' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                  msg.sender === 'seller'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-white text-slate-800 border border-slate-200 rounded-bl-md'
                }`}
                style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                <p className={`text-[10px] mt-1 ${
                  msg.sender === 'seller' ? 'text-blue-200' : 'text-slate-400'
                }`}>
                  {msg.sender === 'seller' ? t('you') : t('customer')} · {formatTime(msg.date)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply box */}
      {selectedConv && (
        <div className="p-3 border-t border-slate-100 bg-white">
          {canReply ? (
            <>
              {templateRow}
              <div className="flex items-end gap-2">
                <TextField
                  fullWidth
                  multiline
                  maxRows={4}
                  size="small"
                  placeholder={t('replyPlaceholder')}
                  value={replyText}
                  inputRef={replyInputRef}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleReply();
                    }
                  }}
                  disabled={sending}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '12px',
                      fontSize: '0.875rem',
                    },
                  }}
                />
                <IconButton
                  onClick={handleReply}
                  disabled={!replyText.trim() || sending}
                  aria-label={t('sendReply')}
                  sx={{
                    bgcolor: 'rgb(37 99 235)',
                    color: 'white',
                    '&:hover': { bgcolor: 'rgb(29 78 216)' },
                    '&:disabled': { bgcolor: 'rgb(203 213 225)', color: 'white' },
                    borderRadius: '12px',
                    width: 44,
                    height: 44,
                  }}
                >
                  {sending ? <CircularProgress size={18} color="inherit" /> : <Send size={18} />}
                </IconButton>
              </div>
            </>
          ) : (
            <p className="text-xs text-center text-slate-400 py-2">{t('trendyolAnswered')}</p>
          )}
        </div>
      )}
    </div>
  );

  if (noneConnected) {
    return (
      <AppLayout title={t('title')}>
        <div className="bg-white rounded-xl" style={{ border: '1px solid #e2e8f0' }}>
          <ConnectEmptyState provider="wix" description={t('connectEitherDescription')} className="pb-4" />
          <div className="flex justify-center pb-10 px-6">
            <Button
              component={Link}
              href="/ayarlar?tab=apiKeys"
              variant="outlined"
              sx={{ minHeight: 44, textTransform: 'none', borderRadius: 2 }}
            >
              {tUi('connectEmpty.cta', { name: 'Trendyol' })}
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={t('title')}>
      <div className="h-full flex flex-col" style={{ maxHeight: 'calc(100vh - 5rem)' }}>
        {/* ── Filter Bar ────────────────────────────────── */}
        <div className="flex items-center gap-2 p-2 bg-white rounded-xl mb-2" style={{ border: '1px solid #e2e8f0' }}>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel sx={{ fontSize: '0.8rem' }}>{t('allPlatforms')}</InputLabel>
            <Select
              value={platform}
              label={t('allPlatforms')}
              onChange={(e) => setPlatform(e.target.value)}
              sx={{ borderRadius: '10px', fontSize: '0.8rem' }}
            >
              <MenuItem value="all">{t('allPlatforms')}</MenuItem>
              <MenuItem value="wix">Wix</MenuItem>
              <MenuItem value="trendyol">Trendyol</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel sx={{ fontSize: '0.8rem' }}>{t('all')}</InputLabel>
            <Select
              value={status}
              label={t('all')}
              onChange={(e) => setStatus(e.target.value)}
              sx={{ borderRadius: '10px', fontSize: '0.8rem' }}
            >
              <MenuItem value="all">{t('all')}</MenuItem>
              <MenuItem value="unanswered">{t('unanswered')}</MenuItem>
              <MenuItem value="answered">{t('answered')}</MenuItem>
            </Select>
          </FormControl>

          <div className="flex-1" />

          <IconButton
            size="small"
            onClick={() => fetchConversations('refresh')}
            disabled={refreshing}
            aria-label={t('refresh')}
            sx={{ color: 'rgb(100 116 139)', minWidth: 44, minHeight: 44 }}
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </IconButton>
        </div>

        {/* ── Per-platform warnings (shown even when the other platform has conversations) ── */}
        {!loading && platformErrorChips}

        {/* ── Main content ──────────────────────────────── */}
        {loading ? (
          <div className="bg-white rounded-xl flex-1 p-4" style={{ border: '1px solid #e2e8f0' }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 mb-4">
                <Skeleton variant="circular" width={32} height={32} />
                <div className="flex-1">
                  <Skeleton variant="text" width="60%" height={16} />
                  <Skeleton variant="text" width="40%" height={14} />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 && !selectedConv ? (
          <div className="bg-white rounded-xl flex-1 flex flex-col items-center justify-center p-8" style={{ border: '1px solid #e2e8f0' }}>
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <MessageSquare size={28} className="text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-500">{t('noMessages')}</p>
            {platformErrors.length > 0 ? null : enabledPlatforms.length === 0 ? (
              <p className="text-xs text-slate-400 mt-1">{t('noCredentials')}</p>
            ) : (
              <p className="text-xs text-slate-400 mt-1">
                {t('connectedPlatforms', { platforms: enabledPlatforms.map((p) => PLATFORM_NAMES[p] || p).join(', ') })}
              </p>
            )}
          </div>
        ) : isMobile ? (
          /* ── Mobile: Full-width list + Drawer ─────── */
          <>
            <div className="bg-white rounded-xl flex-1 overflow-y-auto" style={{ border: '1px solid #e2e8f0' }}>
              {conversations.length === 0 && (
                <p className="text-xs text-center text-slate-400 p-6">{t('noMessages')}</p>
              )}
              {conversations.map((conv) => (
                <ConversationCard
                  key={convKey(conv)}
                  conv={conv}
                  onClick={() => openThread(conv)}
                />
              ))}
            </div>

            <SwipeableDrawer
              anchor="bottom"
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              onOpen={() => {}}
              PaperProps={{
                sx: {
                  height: '92vh',
                  borderTopLeftRadius: 16,
                  borderTopRightRadius: 16,
                },
              }}
            >
              <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mt-2 mb-1" />
              {threadView}
            </SwipeableDrawer>
          </>
        ) : (
          /* ── Desktop: Split view ──────────────────── */
          <div className="flex-1 flex gap-2 min-h-0">
            {/* Left: Conversation list */}
            <div className="w-[380px] flex-shrink-0 bg-white rounded-xl overflow-y-auto" style={{ border: '1px solid #e2e8f0' }}>
              {conversations.length === 0 && (
                <p className="text-xs text-center text-slate-400 p-6">{t('noMessages')}</p>
              )}
              {conversations.map((conv) => (
                <ConversationCard
                  key={convKey(conv)}
                  conv={conv}
                  onClick={() => openThread(conv)}
                />
              ))}
            </div>

            {/* Right: Thread */}
            <div className="flex-1 bg-white rounded-xl overflow-hidden" style={{ border: '1px solid #e2e8f0' }}>
              {selectedConv ? (
                threadView
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <Mail size={40} className="mb-3 text-slate-300" />
                  <p className="text-sm">{t('selectConversation')}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

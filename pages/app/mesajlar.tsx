import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Select, MenuItem, FormControl, InputLabel, TextField, Button, Chip,
  CircularProgress, IconButton, SwipeableDrawer, Badge, Skeleton,
} from '@mui/material';
import { Mail, Send, ArrowLeft, Package, MessageSquare, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import useScreenSize from '@/hooks/useScreenSize';
import type { UnifiedConversation, UnifiedMessage, MessagesListResponse } from '@/types/messages';

const PLATFORM_COLORS: Record<string, string> = {
  wix: '#0C6EFC',
  trendyol: '#F27A1A',
};

export default function MessagesPage() {
  const t = useTranslations('messages');
  const { isMobile } = useScreenSize();

  // Filters
  const [platform, setPlatform] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');

  // Data
  const [conversations, setConversations] = useState<UnifiedConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiErrors, setApiErrors] = useState<string[]>([]);
  const [enabledPlatforms, setEnabledPlatforms] = useState<string[]>([]);

  // Thread
  const [selectedConv, setSelectedConv] = useState<UnifiedConversation | null>(null);
  const [threadMessages, setThreadMessages] = useState<UnifiedMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Reply
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch conversations ───────────────────────────────
  const fetchConversations = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/messages?action=list&platform=${platform}&status=${status}&size=50`);
      const data = await res.json();
      if (res.ok) {
        setConversations(data.conversations || []);
        setApiErrors(data.errors || []);
        setEnabledPlatforms(data.enabledPlatforms || []);
      } else {
        toast.error(data.error || `Error: ${res.status}`);
        setConversations([]);
      }
    } catch {
      toast.error('Failed to fetch messages');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [platform, status, t]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Poll every 2 minutes
  useEffect(() => {
    const interval = setInterval(() => fetchConversations(), 120_000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  // ── Fetch thread ──────────────────────────────────────
  const openThread = useCallback(async (conv: UnifiedConversation) => {
    setSelectedConv(conv);
    setReplyText('');
    if (isMobile) setDrawerOpen(true);

    // If Trendyol, messages already loaded in the conversation
    if (conv.platform === 'trendyol') {
      setThreadMessages(conv.messages);
      return;
    }

    // Wix: fetch full thread
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/messages?action=thread&platform=${conv.platform}&conversationId=${conv.id}`);
      if (res.ok) {
        const data = await res.json();
        setThreadMessages(data.messages || []);
      }
    } catch {
      setThreadMessages([]);
    } finally {
      setThreadLoading(false);
    }
  }, [isMobile]);

  // Scroll to bottom when messages load
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages]);

  // ── Send reply ────────────────────────────────────────
  const handleReply = async () => {
    if (!replyText.trim() || !selectedConv) return;
    setSending(true);
    try {
      const body: any = {
        platform: selectedConv.platform,
        text: replyText.trim(),
      };
      if (selectedConv.platform === 'trendyol') {
        body.questionId = selectedConv.id;
      } else {
        body.conversationId = selectedConv.id;
      }

      const res = await fetch('/api/messages?action=reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success(t('replySent'));
        setReplyText('');
        // Add message locally
        setThreadMessages(prev => [...prev, {
          id: `reply-${Date.now()}`,
          sender: 'seller',
          text: body.text,
          date: new Date().toISOString(),
        }]);
        // Update conversation status locally
        setConversations(prev => prev.map(c =>
          c.id === selectedConv.id ? { ...c, status: 'answered' as const } : c
        ));
        setSelectedConv(prev => prev ? { ...prev, status: 'answered' } : null);
      } else {
        const err = await res.json();
        toast.error(err.error || t('replyFailed'));
      }
    } catch {
      toast.error(t('replyFailed'));
    } finally {
      setSending(false);
    }
  };

  const canReply = selectedConv && !(selectedConv.platform === 'trendyol' && selectedConv.status === 'answered');

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
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Chip
                label={conv.platform === 'wix' ? 'Wix' : 'Trendyol'}
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
              <span className="text-xs font-semibold text-slate-800 truncate">{conv.customerName}</span>
              {conv.status === 'unanswered' && (
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
              )}
            </div>
            {conv.subject && (
              <p className="text-xs text-slate-500 truncate mb-0.5">{conv.subject}</p>
            )}
            <p className="text-xs text-slate-400 truncate">{conv.lastMessageText}</p>
          </div>
          <span className="text-[10px] text-slate-400 flex-shrink-0 whitespace-nowrap">
            {formatDate(conv.lastMessageDate)}
          </span>
        </div>
      </div>
    );
  };

  const threadView = (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      {selectedConv && (
        <div className="flex items-center gap-3 p-3 border-b border-slate-100 bg-white">
          {isMobile && (
            <IconButton size="small" onClick={() => setDrawerOpen(false)}>
              <ArrowLeft size={18} />
            </IconButton>
          )}
          <Chip
            label={selectedConv.platform === 'wix' ? 'Wix' : 'Trendyol'}
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
            <p className="text-sm font-semibold text-slate-800 truncate">{selectedConv.customerName}</p>
            {selectedConv.productInfo && (
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <Package size={12} />
                <span className="truncate">{selectedConv.productInfo.title}</span>
              </div>
            )}
          </div>
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
            <div className="flex items-end gap-2">
              <TextField
                fullWidth
                multiline
                maxRows={4}
                size="small"
                placeholder={t('replyPlaceholder')}
                value={replyText}
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
                sx={{
                  bgcolor: 'rgb(37 99 235)',
                  color: 'white',
                  '&:hover': { bgcolor: 'rgb(29 78 216)' },
                  '&:disabled': { bgcolor: 'rgb(203 213 225)', color: 'white' },
                  borderRadius: '12px',
                  width: 40,
                  height: 40,
                }}
              >
                {sending ? <CircularProgress size={18} color="inherit" /> : <Send size={18} />}
              </IconButton>
            </div>
          ) : (
            <p className="text-xs text-center text-slate-400 py-2">{t('trendyolAnswered')}</p>
          )}
        </div>
      )}
    </div>
  );

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
            onClick={() => fetchConversations(true)}
            disabled={refreshing}
            sx={{ color: 'rgb(100 116 139)' }}
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </IconButton>
        </div>

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
        ) : conversations.length === 0 ? (
          <div className="bg-white rounded-xl flex-1 flex flex-col items-center justify-center p-8" style={{ border: '1px solid #e2e8f0' }}>
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <MessageSquare size={28} className="text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-500">{t('noMessages')}</p>
            {enabledPlatforms.length === 0 ? (
              <p className="text-xs text-slate-400 mt-1">{t('noCredentials')}</p>
            ) : (
              <p className="text-xs text-slate-400 mt-1">
                {enabledPlatforms.join(', ')} connected
              </p>
            )}
            {apiErrors.length > 0 && (
              <div className="mt-3 text-xs text-red-500 text-center space-y-1">
                {apiErrors.map((err, i) => <p key={i}>{err}</p>)}
              </div>
            )}
          </div>
        ) : isMobile ? (
          /* ── Mobile: Full-width list + Drawer ─────── */
          <>
            <div className="bg-white rounded-xl flex-1 overflow-y-auto" style={{ border: '1px solid #e2e8f0' }}>
              {conversations.map((conv) => (
                <ConversationCard
                  key={`${conv.platform}-${conv.id}`}
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
              {conversations.map((conv) => (
                <ConversationCard
                  key={`${conv.platform}-${conv.id}`}
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

// ── Utilities ──────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffH = diffMs / (1000 * 60 * 60);

    if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / 60000))}m`;
    if (diffH < 24) return `${Math.floor(diffH)}h`;
    if (diffH < 48) return 'dün';
    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * One notification as an expandable card (owner W5). Mobile-first: the whole
 * header row is a 56px+ tap target; details and actions expand below it.
 */
import React, { useState } from 'react';
import { Button, Chip, Collapse } from '@mui/material';
import { ChevronDown, ExternalLink, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SEVERITY_COLOR, absoluteTime, groupOf, relativeTime, type CenterItem } from './shared';
import { useNotificationText } from './useNotificationText';

export interface NotificationCardProps {
  item: CenterItem;
  locale: string;
  onOpen: (item: CenterItem) => void;
  onMarkRead: (item: CenterItem) => void;
  defaultExpanded?: boolean;
}

export default function NotificationCard({ item, locale, onOpen, onMarkRead, defaultExpanded = false }: NotificationCardProps) {
  const t = useTranslations('notificationCenter');
  const { title, typeLabel } = useNotificationText();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const color = SEVERITY_COLOR[item.severity] || SEVERITY_COLOR.info;
  const unread = !item.readAt && item.badge;
  const group = groupOf(item.type);
  const panelId = `ncard-${item.id}`;

  return (
    <li
      className={`rounded-xl border bg-white transition-colors ${unread ? 'border-blue-200' : 'border-slate-200'}`}
      style={unread ? { backgroundColor: 'rgba(239,246,255,0.45)' } : undefined}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full text-left flex items-start gap-3 px-3 sm:px-4 py-3"
        style={{ minHeight: 56 }}
      >
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: color.bg }}
          aria-hidden="true"
        >
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color.dot }} />
        </span>
        <span className="flex-1 min-w-0">
          <span className={`block text-[13px] sm:text-sm leading-snug break-words ${unread ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>
            {title(item)}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-slate-400">
            {group && <span>{t(`groups.${group}` as any)}</span>}
            {group && <span aria-hidden="true">·</span>}
            <time dateTime={item.createdAt}>{relativeTime(item.createdAt, locale)}</time>
            {item.resolvedAt && (
              <span className="text-emerald-600 font-medium">{t('page.resolved')}</span>
            )}
          </span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0 mt-1.5">
          {unread && (
            <>
              <span className="w-2 h-2 rounded-full bg-blue-500" aria-hidden="true" />
              <span className="sr-only">{t('page.unread')}</span>
            </>
          )}
          <ChevronDown
            size={16}
            className="text-slate-400 transition-transform"
            style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
            aria-hidden="true"
          />
        </span>
      </button>

      <Collapse in={expanded} unmountOnExit>
        <div id={panelId} className="px-3 sm:px-4 pb-3 pt-0 sm:pl-[60px]">
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <Chip
              size="small"
              label={t(`severity.${item.severity}` as any)}
              sx={{ bgcolor: color.bg, color: color.fg, fontWeight: 600, height: 22 }}
            />
            <Chip size="small" variant="outlined" label={typeLabel(item.type)} sx={{ height: 22 }} />
          </div>
          <p className="text-xs text-slate-500 mb-3">
            {t('page.receivedAt', { date: absoluteTime(item.createdAt, locale) })}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            {item.link && (
              <Button
                variant="contained"
                disableElevation
                size="small"
                startIcon={<ExternalLink size={14} />}
                onClick={() => onOpen(item)}
                sx={{ minHeight: 44, textTransform: 'none', borderRadius: 2 }}
              >
                {t('page.open')}
              </Button>
            )}
            {unread && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<Check size={14} />}
                onClick={() => onMarkRead(item)}
                sx={{ minHeight: 44, textTransform: 'none', borderRadius: 2 }}
              >
                {t('page.markRead')}
              </Button>
            )}
          </div>
        </div>
      </Collapse>
    </li>
  );
}

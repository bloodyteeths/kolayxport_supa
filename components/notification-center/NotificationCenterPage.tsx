/**
 * Body of /app/bildirimler (owner W5): Unread / All / Activity / Preferences
 * tabs. The active tab and group filter live in the URL (?tab=&group=) so the
 * bell's "See all" and the email footer can deep-link.
 */
import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/router';
import { Tab, Tabs } from '@mui/material';
import { useLocale, useTranslations } from 'next-intl';
import { PageHeader, type ActionSpec } from '@/components/ds/page';
import { icons } from '@/lib/ds/icons';
import { isNotificationGroup, type NotificationGroup } from '@/lib/notificationCenter/registry';
import NotificationFeed, { type FeedView } from './NotificationFeed';
import NotificationPreferencesPanel from './NotificationPreferencesPanel';

const TABS = ['unread', 'all', 'activity', 'preferences'] as const;
type TabKey = (typeof TABS)[number];

function asTab(v: unknown): TabKey {
  const s = Array.isArray(v) ? v[0] : v;
  return (TABS as readonly string[]).includes(s as string) ? (s as TabKey) : 'unread';
}

export default function NotificationCenterPage() {
  const t = useTranslations('notificationCenter');
  const locale = useLocale();
  const router = useRouter();
  const tab = asTab(router.query.tab);
  const rawGroup = Array.isArray(router.query.group) ? router.query.group[0] : router.query.group;
  const group: NotificationGroup | null = isNotificationGroup(rawGroup) ? rawGroup : null;

  const [markAll, setMarkAll] = useState<(() => Promise<void>) | null>(null);
  const [marking, setMarking] = useState(false);
  const registerMarkAll = useCallback((fn: (() => Promise<void>) | null) => setMarkAll(() => fn), []);

  const setQuery = useCallback(
    (next: { tab?: TabKey; group?: NotificationGroup | null }) => {
      const q: Record<string, string> = {};
      const nt = next.tab ?? tab;
      if (nt !== 'unread') q.tab = nt;
      const ng = next.group === undefined ? group : next.group;
      if (ng && nt !== 'preferences') q.group = ng;
      void router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true, scroll: false });
    },
    [router, tab, group],
  );

  const markAllAction: ActionSpec | undefined =
    tab !== 'preferences' && tab !== 'activity' && markAll
      ? {
          id: 'notifications-mark-all-read',
          label: t('page.markAllRead'),
          icon: icons.check,
          loading: marking,
          disabled: marking,
          onClick: async () => {
            setMarking(true);
            try {
              await markAll();
            } finally {
              setMarking(false);
            }
          },
        }
      : undefined;

  // DS PageHeader: inside the shell-managed <Page> (pages/app/bildirimler.tsx) the mobile title row
  // belongs to the shell TopBar, so the title is not rendered twice on mobile.
  return (
    <div className="w-full">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        secondaryActions={markAllAction ? [markAllAction] : undefined}
      />

      <Tabs
        value={tab}
        onChange={(_, v: TabKey) => setQuery({ tab: v })}
        variant="scrollable"
        scrollButtons={false}
        allowScrollButtonsMobile
        sx={{ mb: 2, minHeight: 44, borderBottom: '1px solid #e2e8f0', '& .MuiTab-root': { minHeight: 44, textTransform: 'none' } }}
      >
        {TABS.map((k) => (
          <Tab key={k} value={k} label={t(`page.tabs.${k}` as any)} />
        ))}
      </Tabs>

      {tab === 'preferences' ? (
        <NotificationPreferencesPanel locale={locale} />
      ) : (
        <NotificationFeed
          key={tab}
          view={tab as FeedView}
          group={group}
          onGroupChange={(g) => setQuery({ group: g })}
          locale={locale}
          onRegisterMarkAll={registerMarkAll}
        />
      )}
    </div>
  );
}

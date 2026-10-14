/**
 * Client-side text for notification rows (owner W5).
 *
 * Titles keep the existing convention: t(titleKey, params) under the
 * 'notifications' namespace. Before the deferred fragment merge the new types
 * only exist under notificationCenter.types, so that is the fallback. Missing
 * required ICU params -> notifications.fallback (next-intl does not throw on a
 * missing argument, it returns the key path).
 */
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { hasRequiredParams, typeFromTitleKey } from '@/lib/notificationCenter/params';
import type { CenterItem } from './shared';

export function useNotificationText() {
  const tN = useTranslations('notifications');
  const tC = useTranslations('notificationCenter');

  const title = useCallback(
    (item: Pick<CenterItem, 'type' | 'titleKey' | 'params'>): string => {
      try {
        const params = (item.params ?? {}) as Record<string, string | number>;
        const typeName = typeFromTitleKey(item.titleKey, item.type);
        if (!hasRequiredParams(typeName, params)) return tN('fallback');
        if (tN.has(item.titleKey as any)) return tN(item.titleKey as any, params as any);
        if (tC.has(item.titleKey as any)) return tC(item.titleKey as any, params as any);
        return tN('fallback');
      } catch {
        return tN('fallback');
      }
    },
    [tN, tC],
  );

  const typeLabel = useCallback(
    (type: string): string => {
      const key = `typeLabels.${type}`;
      try {
        return tC.has(key as any) ? tC(key as any) : type;
      } catch {
        return type;
      }
    },
    [tC],
  );

  return { title, typeLabel, tC };
}

export default useNotificationText;

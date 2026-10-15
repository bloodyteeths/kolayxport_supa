// /app/mesajlar — Messages. Flag `messages` (lib/ds/uiFlags.ts, DS §7.1.5, messages §8 G5): the new inbox
// (components/domain/messages/MessagesPage.tsx) or the legacy page, moved verbatim to
// components/legacy/MessagesPageLegacy.tsx (kept for one release after the flip, then deleted, messages §9).
// Auth: both render inside the AppShell like the page did before the move (no extra wrapper).
import MessagesPageLegacy from '@/components/legacy/MessagesPageLegacy';
import { MessagesPage } from '@/components/domain/messages/MessagesPage';
import { useUiFlag } from '@/lib/ds/uiFlags';

export default function MessagesRoute() {
  const v2 = useUiFlag('messages');
  return v2 ? <MessagesPage /> : <MessagesPageLegacy />;
}

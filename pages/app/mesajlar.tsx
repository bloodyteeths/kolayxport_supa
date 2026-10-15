// /app/mesajlar — Messages: the inbox (components/domain/messages/MessagesPage.tsx, messages §8 G5).
// Auth: renders inside the AppShell (no extra wrapper).
import { MessagesPage } from '@/components/domain/messages/MessagesPage';

export default function MessagesRoute() {
  return <MessagesPage />;
}

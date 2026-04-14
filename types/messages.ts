export interface UnifiedConversation {
  id: string;
  platform: 'wix' | 'trendyol';
  status: 'unanswered' | 'answered';
  customerName: string;
  subject: string;
  lastMessageText: string;
  lastMessageDate: string; // ISO string
  productInfo?: {
    id: string;
    title: string;
    imageUrl?: string;
  };
  unreadCount: number;
  messages: UnifiedMessage[];
}

export interface UnifiedMessage {
  id: string;
  sender: 'customer' | 'seller';
  text: string;
  date: string; // ISO string
}

export interface MessagesListResponse {
  conversations: UnifiedConversation[];
  totalCount: number;
  unansweredCount: number;
  page: number;
  pageSize: number;
}

export interface MessageCountsResponse {
  wix: number;
  trendyol: number;
  total: number;
}

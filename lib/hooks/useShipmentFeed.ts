import { useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createBrowserClient<Database>(supabaseUrl, supabaseKey);

/**
 * Listens for new successful Shipment rows belonging to this user
 * and calls `onNew(shipment)` each time one arrives.
 */
export function useShipmentFeed(
  userId: string,
  onNew: (shipment: Database['public']['Tables']['LabelJob']['Row']) => void,
): void {
  useEffect(() => {
    const channel = supabase
      .channel('shipments-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'LabelJob',
          filter: `order.user_id=eq.${userId}`,
        },
        payload => {
          onNew(payload.new as Database['public']['Tables']['LabelJob']['Row']);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, onNew]);
}

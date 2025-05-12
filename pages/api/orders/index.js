import { createPagesServerClient } from '@supabase/ssr';
import prisma from '@/lib/prisma';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const supabase = createPagesServerClient({ req, res });
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    console.error('Session error:', sessionError.message);
    return res.status(401).json({ error: 'Not authenticated', details: sessionError.message });
  }

  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const userId = session.user.id;

  try {
    const userOrders = await prisma.order.findMany({
      where: {
        userId: userId,
      },
      include: {
        items: true, // Include related order items
      },
      orderBy: {
        createdAt: 'desc', // Or marketplaceCreatedAt, depending on preference
      },
    });

    // Transform data to the flat array structure previously expected by OrdersTable.jsx
    // Old structure: [Image, Name, Variant, DecorNote, EtsyNote, Status, ShipBy, Market, Key]
    // This transformation is a temporary bridge. Ideally, OrdersTable.jsx should be updated
    // to directly use the structured data from Prisma (object with fields).
    const transformedOrders = userOrders.map(order => {
      // Basic transformation, can be made more sophisticated
      // For notes, we might need a strategy if they are stored differently now
      // For image, we'd pick the first item's image or a placeholder
      const firstItem = order.items && order.items[0];
      const imageUrl = firstItem?.imageUrl ? `=IMAGE(\"${firstItem.imageUrl}\")` : '';
      
      // Placeholder for DecorSweet and Etsy notes - assuming 'notes' field in OrderItem might hold this or needs specific logic
      let decorSweetNote = '';
      let etsyNote = '';
      if (firstItem?.notes) {
        // Example: if notes are "DS:note1|ET:note2"
        const notesParts = firstItem.notes.split('|');
        notesParts.forEach(part => {
          if (part.startsWith('DS:')) decorSweetNote = part.substring(3);
          if (part.startsWith('ET:')) etsyNote = part.substring(3);
        });
        // If not structured, assign to a default or based on marketplace
        if (!decorSweetNote && !etsyNote) {
            if (order.marketplace?.toLowerCase().includes('decorsweet') || order.marketplace?.toLowerCase().includes('amazon')) {
                decorSweetNote = firstItem.notes;
            } else if (order.marketplace?.toLowerCase().includes('etsy')) {
                etsyNote = firstItem.notes;
            }
        }
      }


      return [
        imageUrl, // 0: Image
        order.customerName || '', // 1: Name
        firstItem?.productName || (firstItem?.variantInfo || ''), // 2: Variant (Product Name or Variant Info)
        decorSweetNote, // 3: DecorNote (Placeholder - adapt based on actual note storage)
        etsyNote, // 4: EtsyNote (Placeholder - adapt based on actual note storage)
        order.status || '', // 5: Status
        order.shipByDate ? new Date(order.shipByDate).toLocaleDateString() : '', // 6: ShipBy
        order.marketplace || '', // 7: Market
        order.marketplaceKey || '', // 8: Key (Marketplace Order ID)
        // Add other fields if your table expects more, or pass the whole order object
        order.id // 9: Our internal order ID (useful for keys if marketplaceKey isn't always unique across retries/errors)
      ];
    });

    return res.status(200).json({ success: true, data: transformedOrders });

  } catch (error) {
    console.error('Error fetching orders from DB:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch orders from database.', details: error.message });
  }
} 
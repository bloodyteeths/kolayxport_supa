import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '../../../lib/prisma';
import { v4 as uuidv4 } from 'uuid';

interface OrderItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  weight: number;
  sku: string;
  hsCode: string;
  countryOfOrigin: string;
}

interface ManualOrderData {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  orderNumber: string;
  currency: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  items: OrderItem[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const orderData: ManualOrderData = req.body;

    // Validation
    if (!orderData.customerName?.trim()) {
      return res.status(400).json({ error: 'Müşteri adı gerekli' });
    }
    if (!orderData.orderNumber?.trim()) {
      return res.status(400).json({ error: 'Sipariş numarası gerekli' });
    }
    if (!orderData.street1?.trim()) {
      return res.status(400).json({ error: 'Adres gerekli' });
    }
    if (!orderData.city?.trim()) {
      return res.status(400).json({ error: 'Şehir gerekli' });
    }
    if (!orderData.postal?.trim()) {
      return res.status(400).json({ error: 'Posta kodu gerekli' });
    }
    if (!orderData.items || orderData.items.length === 0) {
      return res.status(400).json({ error: 'En az bir ürün gerekli' });
    }

    // Validate items
    for (const item of orderData.items) {
      if (!item.productName?.trim()) {
        return res.status(400).json({ error: 'Tüm ürünler için ürün adı gerekli' });
      }
      if (item.quantity <= 0) {
        return res.status(400).json({ error: 'Ürün miktarı 0\'dan büyük olmalı' });
      }
      if (item.unitPrice <= 0) {
        return res.status(400).json({ error: 'Ürün fiyatı 0\'dan büyük olmalı' });
      }
      if (item.weight <= 0) {
        return res.status(400).json({ error: 'Ürün ağırlığı 0\'dan büyük olmalı' });
      }
    }

    // Check if order number already exists for this user
    const existingOrder = await prisma.order.findFirst({
      where: {
        userId: user.id,
        orderNumber: orderData.orderNumber.trim()
      }
    });

    if (existingOrder) {
      return res.status(400).json({ error: 'Bu sipariş numarası zaten mevcut' });
    }

    // Calculate total price
    const totalPrice = orderData.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

    // Create shipping address object
    const shippingAddress = {
      name: orderData.customerName.trim(),
      street1: orderData.street1.trim(),
      street2: orderData.street2?.trim() || '',
      city: orderData.city.trim(),
      state: orderData.state?.trim() || '',
      postal: orderData.postal.trim(),
      country: orderData.country || 'TR',
      phone: orderData.customerPhone?.trim() || '',
      email: orderData.customerEmail?.trim() || '',
      isResidential: true
    };

    // Generate unique marketplace key for manual orders
    const marketplaceKey = `manual-${Date.now()}-${uuidv4().slice(0, 8)}`;

    // Create the order with transaction to ensure consistency
    const result = await prisma.$transaction(async (tx) => {
      // Create order
      const order = await tx.order.create({
        data: {
          userId: user.id,
          marketplace: 'Manual',
          marketplaceKey,
          customerName: orderData.customerName.trim(),
          status: 'Created',
          currency: orderData.currency || 'TRY',
          totalPrice,
          orderNumber: orderData.orderNumber.trim(),
          shippingAddress,
          rawData: {
            source: 'manual',
            createdBy: user.id,
            createdAt: new Date().toISOString(),
            customerInfo: {
              name: orderData.customerName.trim(),
              email: orderData.customerEmail?.trim() || null,
              phone: orderData.customerPhone?.trim() || null
            },
            shippingAddress,
            items: orderData.items.map(item => ({
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              weight: item.weight,
              sku: item.sku,
              hsCode: item.hsCode,
              countryOfOrigin: item.countryOfOrigin
            })),
            manualOrder: true
          } as any,
          labelStatus: null,
          weightKg: orderData.items.reduce((sum, item) => sum + (item.weight * item.quantity), 0),
          uiOrderDate: new Date()
        }
      });

      // Create order items
      const orderItems = await Promise.all(
        orderData.items.map((item, index) =>
          tx.orderItem.create({
            data: {
              orderId: order.id,
              sku: item.sku?.trim() || `MANUAL-${order.id}-${index + 1}`,
              productName: item.productName.trim(),
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.quantity * item.unitPrice,
              weightKg: item.weight,
              harmonizedCode: item.hsCode?.trim() || '',
              countryOfMfg: item.countryOfOrigin?.trim() || 'TR',
              marketplaceKey: `${marketplaceKey}-item-${index + 1}`,
              orderNumber: orderData.orderNumber.trim(),
              uniqueLineKey: `manual-${order.id}-${index + 1}`,
              remoteLineId: `manual-${order.id}-${index + 1}`
            }
          })
        )
      );

      return { order, orderItems };
    });

    // Return created order in the same format as existing orders
    const createdOrder = {
      id: result.order.id,
      marketplace: result.order.marketplace,
      marketplaceKey: result.order.marketplaceKey,
      orderNumber: result.order.orderNumber,
      customerName: result.order.customerName,
      status: result.order.status,
      currency: result.order.currency,
      totalPrice: result.order.totalPrice,
      source: 'manual',
      channel: 'manual',
      to_address: shippingAddress,
      line_items: result.orderItems.map(item => ({
        id: item.id,
        title: item.productName,
        value: Number(item.unitPrice),
        quantity: item.quantity,
        weight: item.weightKg,
        sku: item.sku,
        hs_code: item.harmonizedCode,
        country_of_origin: item.countryOfMfg
      })),
      marketplaceOrderDate: result.order.uiOrderDate?.toISOString(),
      createdAt: result.order.createdAt.toISOString(),
      updatedAt: result.order.updatedAt.toISOString(),
      rawData: result.order.rawData,
      trackingNumber: null,
      labelStatus: null,
      shippingLabelUrl: null,
      shipments: []
    };

    res.status(201).json({
      success: true,
      order: createdOrder,
      message: 'Manuel sipariş başarıyla oluşturuldu'
    });

  } catch (error) {
    console.error('Error creating manual order:', error);
    
    // Handle specific database errors
    if (error instanceof Error) {
      if (error.message.includes('Unique constraint')) {
        return res.status(400).json({ error: 'Bu sipariş numarası zaten mevcut' });
      }
    }

    res.status(500).json({ 
      error: 'Manuel sipariş oluşturulurken hata oluştu',
      details: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
  }
}
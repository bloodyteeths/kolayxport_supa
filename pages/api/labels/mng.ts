import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { getMngCredentialsForUser } from '@/lib/mng/mng.credentials';
import { createMngShipment, trackMngShipment } from '@/lib/mng/mng.service';
import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';
import type { MngOrderRequest, MngRecipient, MngPackage } from '@/lib/mng/mng.types';
// Default values for MNG options (value=1 is standard/sender/address/package)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authUser = await getAuthUser(req, res);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });

  const userId = authUser.id;

  // ─── GET: Track a shipment ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { barcode, billOfLandingId } = req.query;
    if (!barcode && !billOfLandingId) {
      return res.status(400).json({ error: 'barcode or billOfLandingId required' });
    }

    try {
      const creds = await getMngCredentialsForUser(userId);
      const tracking = await trackMngShipment(creds, {
        barcode: barcode as string | undefined,
        billOfLandingId: billOfLandingId as string | undefined,
      });
      return res.status(200).json({ success: true, tracking });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ─── POST: Create MNG shipment label ────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    orderId,
    recipient,
    packageInfo,
    serviceType = 1,
    paymentType = 1,
    deliveryType = 1,
    packagingType = 1,
    isCOD = false,
    codAmount,
    content,
    smsPreference1 = false,
    smsPreference2 = true,
    smsPreference3 = true,
    description,
  } = req.body || {};

  if (!orderId || !recipient) {
    return res.status(400).json({ error: 'Missing required fields: orderId, recipient' });
  }

  try {
    // Load MNG credentials
    let mngCreds;
    try {
      mngCreds = await getMngCredentialsForUser(userId);
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: 'MNG Kargo kimlik bilgileri eksik veya geçersiz: ' + (err.message || 'Ayarlardan MNG müşteri numarası ve şifrenizi kontrol edin.'),
      });
    }

    // Check for existing shipments to prevent duplicates
    const existingShipments = await prisma.shipment.findMany({
      where: { orderId, status: 'created' },
    });

    if (existingShipments.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bu sipariş için zaten bir etiket mevcut. Yeni etiket oluşturmak için mevcut etiketi silin.',
      });
    }

    // Load order details for reference ID
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Build MNG recipient from request
    const mngRecipient: MngRecipient = {
      name: recipient.name || '',
      city: recipient.city || '',
      district: recipient.district || '',
      neighbourhood: recipient.neighbourhood || '',
      street: recipient.street || '',
      address: recipient.address || `${recipient.street1 || ''} ${recipient.street2 || ''}`.trim(),
      postCode: recipient.postalCode || '',
      phone: recipient.phone || '',
      email: recipient.email || '',
    };

    // Build package info
    const parcels: MngPackage[] = [
      {
        weight: packageInfo?.weight || 0.5,
        width: packageInfo?.width,
        height: packageInfo?.height,
        length: packageInfo?.length,
        content: content || order.orderNumber || 'Paket',
      },
    ];

    // Build MNG order request
    const mngOrder: MngOrderRequest = {
      referenceId: order.orderNumber || orderId,
      isCOD,
      codAmount: isCOD ? codAmount : 0,
      shipmentServiceType: serviceType,
      packagingType,
      content: content || order.orderNumber || 'E-ticaret siparişi',
      smsPreference1,
      smsPreference2,
      smsPreference3,
      paymentType,
      deliveryType,
      description: description || '',
      recipient: mngRecipient,
      parcels,
    };

    // Create shipment (two-step: order + invoice)
    const result = await createMngShipment(mngCreds, mngOrder);

    // Save to Shipment table
    await prisma.shipment.create({
      data: {
        order: { connect: { id: orderId } },
        carrier: 'MNG',
        status: 'created',
        trackingNumber: result.trackingNumber,
        pdfUrl: result.labelUrl || (result.labelBase64 ? `data:application/pdf;base64,${result.labelBase64}` : null),
        serviceType: String(serviceType),
      },
    });

    // Increment usage counter
    if ((res as any).incrementUsage) {
      await (res as any).incrementUsage();
    }

    return res.status(200).json({
      success: true,
      trackingNumber: result.trackingNumber,
      barcode: result.barcode,
      billOfLandingId: result.billOfLandingId,
      labelUrl: result.labelUrl,
      labelBase64: result.labelBase64,
    });
  } catch (error: any) {
    console.error('MNG label error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
}

export default withUsageLimiter(handler, 'label');

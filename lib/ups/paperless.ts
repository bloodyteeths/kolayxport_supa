// lib/ups/paperless.ts

import fetch, { RequestInit, Response } from 'node-fetch';
import PDFDocument from 'pdfkit';
import getStream from 'get-stream';
import type { CreateShipmentInput, UpsShipperProfile } from './createUpsShipment';

async function generateInvoicePdf(
  shipment: CreateShipmentInput,
  internationalForms: any
): Promise<Buffer> {
  console.log('[UPS PDF DEBUG] generateInvoicePdf start');
  const doc = new PDFDocument();
  doc.text('Commercial Invoice', { align: 'center' });
  doc.moveDown();
  doc.text(`Invoice Number: ${internationalForms.invoiceNumber}`);
  doc.text(`Invoice Date: ${internationalForms.invoiceDate}`);
  doc.text(`Shipper: ${shipment.shipper.shipperName}`);
  doc.text(`Recipient: ${shipment.recipient?.name}`);
  doc.text(
    `Total: ${internationalForms.invoiceLineTotal?.monetaryValue} ${internationalForms.invoiceLineTotal?.currencyCode}`
  );
  doc.text(`Product: ${internationalForms.products?.[0]?.description}`);
  doc.end();
  const buffer = await getStream.buffer(doc);
  console.log('[UPS PDF DEBUG] generateInvoicePdf end, buffer size:', buffer.length);
  return buffer;
}

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout = 15000
): Promise<Response> {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Fetch timeout')), timeout)
    ),
  ]) as Promise<Response>;
}

interface PushPaperlessDocumentParams {
  token: string;
  pdfBuffer: Buffer;
  shipper: UpsShipperProfile;
  shipmentIdentifier: string;
  trackingNumber: string;
  orderId?: string;
}

/**
 * Uploads a paperless document (like a commercial invoice) and associates it
 * with a shipment in a single "Push" API call.
 */
async function pushPaperlessDocument({
  token,
  pdfBuffer,
  shipper,
  shipmentIdentifier,
  trackingNumber,
  orderId,
}: PushPaperlessDocumentParams): Promise<any> {
  const pushUrl = 'https://onlinetools.ups.com/api/paperlessdocuments/v1/image';
  const transId = Date.now().toString();
  const shipperNumber = shipper.upsAccountNumber;
  const pdfBase64 = pdfBuffer.toString('base64');

  console.log('[UPS PDF DEBUG] pushPaperlessDocument start');

  const payload = {
    PushToImageRepositoryRequest: {
      Request: {
        RequestOption: '1',
        TransactionReference: {
          CustomerContext: 'PushPaperlessDocument',
          TransactionIdentifier: transId,
        },
      },
      ShipmentIdentifier: shipmentIdentifier,
      UserCreatedForm: {
        UserCreatedFormFileName: orderId
          ? `invoice-${orderId}.pdf`
          : 'invoice.pdf',
        UserCreatedFormFile: pdfBase64,
        UserCreatedFormFileFormat: 'PDF',
        UserCreatedFormDocumentType: '002', // Commercial Invoice
      },
    },
  };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ShipperNumber: shipperNumber,
  };

  console.log('[UPS PDF DEBUG] pushPaperlessDocument POSTing to', pushUrl);
  console.log('[UPS PDF DEBUG] Headers:', JSON.stringify(headers, null, 2));
  console.log('[UPS PDF DEBUG] Payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetchWithTimeout(pushUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const responseBody = await response.json();
    console.log(
      '[UPS PDF DEBUG] pushPaperlessDocument got response, status:',
      response.status
    );
    console.log(
      '[UPS PDF DEBUG] Raw push response:',
      JSON.stringify(responseBody)
    );

    if (!response.ok) {
      throw new Error(
        `UPS push failed: ${JSON.stringify(responseBody)}`
      );
    }

    return responseBody;
  } catch (error) {
    console.error('[UPS PDF DEBUG] UPS push failed:', error.message);
    throw error;
  }
}

export {
  generateInvoicePdf,
  pushPaperlessDocument,
  fetchWithTimeout,
};

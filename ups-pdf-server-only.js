// UPS server-only PDF/document upload helpers

const fs = require('fs');
console.log('[UPS PDF DEBUG] process.cwd():', process.cwd());
try {
  const pdfkitPath = require.resolve('pdfkit');
  console.log('[UPS PDF DEBUG] pdfkit resolved at:', pdfkitPath);
} catch (e) {
  console.error('[UPS PDF DEBUG] pdfkit could not be resolved:', e.message);
}
console.log('[UPS PDF DEBUG] node_modules/pdfkit exists:', fs.existsSync('node_modules/pdfkit'));

async function generateInvoicePdf(shipment, internationalForms) {
  console.log('[UPS PDF DEBUG] generateInvoicePdf start');
  const PDFDocument = require('pdfkit');
  const getStream = require('get-stream');
  const doc = new PDFDocument();
  doc.text('Commercial Invoice', { align: 'center' });
  doc.moveDown();
  doc.text(`Invoice Number: ${internationalForms.invoiceNumber}`);
  doc.text(`Invoice Date: ${internationalForms.invoiceDate}`);
  doc.text(`Shipper: ${shipment.shipperName}`);
  doc.text(`Recipient: ${shipment.recipient?.name}`);
  doc.text(`Total: ${internationalForms.invoiceLineTotal?.monetaryValue} ${internationalForms.invoiceLineTotal?.currencyCode}`);
  doc.text(`Product: ${internationalForms.products?.[0]?.description}`);
  doc.end();
  const buffer = await getStream.buffer(doc);
  console.log('[UPS PDF DEBUG] generateInvoicePdf end, buffer size:', buffer.length);
  return buffer;
}

function fetchWithTimeout(url, options, timeout = 15000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch timeout')), timeout))
  ]);
}

async function uploadInvoiceToUps(token, pdfBuffer, shipper, transactionSrc = 'MyApp', orderId = null) {
  console.log('[UPS PDF DEBUG] uploadInvoiceToUps start');
  // FINAL: Use the exact endpoint from UPS docs
  const uploadUrl = 'https://onlinetools.ups.com/api/paperlessdocuments/v2/upload';
  const transId = Date.now().toString();
  const shipperNumber = shipper.upsAccountNumber;
  // 1. Encode PDF to base64
  const pdfBase64 = pdfBuffer.toString('base64');
  console.log('[UPS PDF DEBUG] PDF encoded to base64, length:', pdfBase64.length);
  // 2. Build JSON body per UPS v2 spec (double-check key names and casing)
  const uploadBody = {
    UploadRequest: {
        Request: {
            RequestOption: '1',
            TransactionReference: { 
                CustomerContext: 'InvoiceUpload',
                TransactionIdentifier: transId 
            }
        },
        UserCreatedForm: [{
            UserCreatedFormFileName: orderId ? `invoice-${orderId}.pdf` : "invoice.pdf",
            UserCreatedFormFile: pdfBase64,
            UserCreatedFormFileFormat: 'pdf',
            UserCreatedFormDocumentType: '002' // 002 = Commercial Invoice per UPS docs
        }]
    }
  };
  // 3. Prepare headers (all required, spelled exactly)
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    transactionSrc,
    ShipperNumber: shipperNumber
  };
  console.log('[UPS PDF DEBUG] uploadInvoiceToUps POSTing to', uploadUrl);
  console.log('[UPS PDF DEBUG] Headers:', headers);
  console.log('[UPS PDF DEBUG] Payload:', JSON.stringify(uploadBody, null, 2));
  // 4. POST JSON to UPS
  const res = await fetchWithTimeout(uploadUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(uploadBody)
  });
  console.log('[UPS PDF DEBUG] uploadInvoiceToUps got response, status:', res.status);
  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();
  console.log('[UPS PDF DEBUG] Content-Type:', contentType);
  console.log('[UPS PDF DEBUG] Raw upload response:', raw.slice(0, 200));
  if (!contentType.includes('application/json')) {
    console.error('[UPS PDF DEBUG] Invalid content-type from UPS:', contentType);
    throw new Error('UPS upload failed: expected JSON, got ' + contentType + '. HTML snippet: ' + raw.slice(0, 200) + '\nIf this persists, test the same request in Postman or cURL to compare.');
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error('[UPS PDF DEBUG] Invalid JSON upload response:', err);
    throw new Error('UPS upload returned non-JSON response');
  }
  console.log('[UPS PDF DEBUG] uploadInvoiceToUps response JSON:', JSON.stringify(json, null, 2));
  // If UPS returned an error, throw it directly for clarity
  if (json?.response?.errors && Array.isArray(json.response.errors) && json.response.errors.length > 0) {
    const errMsg = json.response.errors.map(e => `${e.code}: ${e.message}`).join('; ');
    console.error('[UPS PDF DEBUG] UPS API error:', errMsg);
    throw new Error('UPS API error: ' + errMsg);
  }
  // 5. Extract DocumentID from response (check multiple possible paths)
  const docIds = json.UploadResponse?.FormsHistoryDocumentID?.DocumentID || json.FormsHistoryDocumentID?.DocumentID || json.DocumentID;

  if (Array.isArray(docIds) && docIds.length > 0) {
    console.log('[UPS PDF DEBUG] uploadInvoiceToUps end, DocumentID:', docIds[0]);
    return docIds[0];
  } else if (typeof docIds === 'string' && docIds) {
    console.log('[UPS PDF DEBUG] uploadInvoiceToUps end, DocumentID:', docIds);
    return docIds;
  }

  throw new Error('No DocumentID returned from UPS upload. Full response: ' + JSON.stringify(json));
}

async function pushInvoiceToUpsImageRepository(token, pdfBuffer, shipper, transactionSrc = 'MyApp') {
  console.log('[UPS PDF DEBUG] pushInvoiceToUpsImageRepository start');
  const url = 'https://onlinetools.ups.com/api/paperlessdocuments/v1/pushToImageRepository';
  const transId = Date.now().toString();
  const shipperNumber = shipper.upsAccountNumber;
  const pdfBase64 = pdfBuffer.toString('base64');
  const payload = {
    PushToImageRepositoryRequest: {
        Request: {
            RequestOption: '1',
            TransactionReference: { 
                CustomerContext: 'InvoicePush',
                TransactionIdentifier: transId
            }
        },
        Image: {
            Image: pdfBase64,
            ImageFormat: {
                Code: 'pdf',
                Description: 'pdf'
            },
            ImageTypeCode: {
                Code: '01',
                Description: 'Commercial Invoice'
            }
        }
    }
  };
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    transactionSrc,
    ShipperNumber: shipperNumber
  };
  console.log('[UPS PDF DEBUG] pushInvoiceToUpsImageRepository POSTing to', url);
  console.log('[UPS PDF DEBUG] Headers:', headers);
  console.log('[UPS PDF DEBUG] Payload:', JSON.stringify(payload, null, 2));
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  console.log('[UPS PDF DEBUG] pushInvoiceToUpsImageRepository got response, status:', res.status);
  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();
  console.log('[UPS PDF DEBUG] Content-Type:', contentType);
  console.log('[UPS PDF DEBUG] Raw push response:', raw.slice(0, 200));
  if (!contentType.includes('application/json')) {
    console.error('[UPS PDF DEBUG] Invalid content-type from UPS:', contentType);
    throw new Error('UPS pushToImageRepository failed: expected JSON, got ' + contentType + '. HTML snippet: ' + raw.slice(0, 200));
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error('[UPS PDF DEBUG] Invalid JSON push response:', err);
    throw new Error('UPS pushToImageRepository returned non-JSON response');
  }
  console.log('[UPS PDF DEBUG] pushInvoiceToUpsImageRepository response JSON:', JSON.stringify(json, null, 2));
  // Try to extract DocumentID
  const docIds = json.FormsHistoryDocumentID?.DocumentID || json.DocumentID || (json.UploadResponse?.FormsHistoryDocumentID?.DocumentID);
  if (Array.isArray(docIds) && docIds.length > 0) {
    console.log('[UPS PDF DEBUG] pushInvoiceToUpsImageRepository end, DocumentID:', docIds[0]);
    return docIds[0];
  } else if (typeof docIds === 'string') {
    console.log('[UPS PDF DEBUG] pushInvoiceToUpsImageRepository end, DocumentID:', docIds);
    return docIds;
  }
  throw new Error('No DocumentID returned from UPS pushToImageRepository. Full response: ' + JSON.stringify(json));
}

async function pushToImageRepository({
  token,
  documentId,
  shipmentIdentifier,
  shipmentDateTime,
  shipmentType = '1',
  trackingNumber,
  shipper,
  transactionSrc = 'MyApp',
  customerContext = 'InvoicePush'
}) {
  console.log('[UPS PDF DEBUG] pushToImageRepository start');
  const url = 'https://onlinetools.ups.com/api/paperlessdocuments/v1/image';
  const transId = Date.now().toString();
  const shipperNumber = shipper.upsAccountNumber;
  const payload = {
    PushToImageRepositoryRequest: {
      Request: {
        TransactionReference: {
          CustomerContext: customerContext
        }
      },
      FormsHistoryDocumentID: {
        DocumentID: documentId
      },
      ShipmentIdentifier: shipmentIdentifier,
      ShipmentDateAndTime: shipmentDateTime,
      ShipmentType: shipmentType,
      TrackingNumber: trackingNumber
    }
  };
  console.log('[UPS PDF DEBUG] pushToImageRepository payload:', JSON.stringify(payload, null, 2));
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'transId': transId,
    'transactionSrc': transactionSrc,
    'ShipperNumber': shipperNumber
  };
  console.log('[UPS PDF DEBUG] pushToImageRepository headers:', headers);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  const contentType = response.headers.get('content-type');
  console.log('[UPS PDF DEBUG] pushToImageRepository response content-type:', contentType);
  console.log('[UPS PDF DEBUG] pushToImageRepository raw response:', raw.slice(0, 200));
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error(`UPS pushToImageRepository failed: expected JSON, got ${contentType}. HTML snippet: ${raw.slice(0,200)}`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error('UPS pushToImageRepository returned invalid JSON');
  }
  if (json?.response?.errors) {
    throw new Error('UPS pushToImageRepository error: ' + JSON.stringify(json.response.errors));
  }
  return json;
}

module.exports = { generateInvoicePdf, uploadInvoiceToUps, fetchWithTimeout, pushInvoiceToUpsImageRepository, pushToImageRepository }; 
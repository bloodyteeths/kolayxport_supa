import axios from 'axios';
import { logger } from '../logger';

export interface FedexShipResponse {
  output: {
    jobId?: string;
    completedShipmentDetail?: {
      masterTrackingId?: {
        trackingNumber: string;
      };
      masterTrackingNumber?: string;
      completedPackageDetails?: Array<{
        trackingNumber?: string;
        label?: {
          labelUrl?: string;
          url?: string;
        };
      }>;
    };
    alerts?: Array<{
      code: string;
      message: string;
      type?: string;
    }>;
  };
}

export class FedexAsyncError extends Error {
  constructor(
    message: string,
    public readonly code: 'ASYNC.TIMEOUT' | 'MISSING.LABEL.DATA',
    public readonly jobId?: string
  ) {
    super(message);
    this.name = 'FedexAsyncError';
  }
}

/**
 * Polls the FedEx async shipment endpoint until the shipment is ready or timeout is reached.
 * Uses exponential backoff starting at 2 seconds, doubling each time up to 5 attempts.
 */
export async function retrieveAsyncShipment(
  jobId: string,
  accountNumber: string,
  accessToken: string
): Promise<FedexShipResponse> {
  const maxAttempts = 5;
  let attempt = 0;
  let delay = 2000; // Start with 2 seconds

  while (attempt < maxAttempts) {
    try {
      const response = await axios.get(
        `https://apis.fedex.com/ship/v1/async/shipments?jobId=${jobId}&accountNumber=${accountNumber}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-locale': 'en_US',
          },
        }
      );

      if (response.status === 200 && response.data?.output?.completedShipmentDetail) {
        logger.info(`[FedEx Service] Async shipment ready. jobId=${jobId}`);
        return response.data;
      }

      // If we get here, the shipment is not ready yet
      attempt++;
      if (attempt < maxAttempts) {
        logger.info(`[FedEx Service] Async shipment not ready yet. jobId=${jobId} attempt=${attempt}/${maxAttempts}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    } catch (error: any) {
      logger.error(`[FedEx Service] Error polling async shipment. jobId=${jobId} attempt=${attempt}/${maxAttempts}`, error);
      throw error;
    }
  }

  throw new FedexAsyncError(
    `Async shipment not ready after ${maxAttempts} attempts`,
    'ASYNC.TIMEOUT',
    jobId
  );
}

/**
 * Extracts tracking number and label URL from a FedEx ship response.
 * Supports both synchronous and asynchronous response formats.
 */
export function extractShipmentDetails(response: FedexShipResponse): { trackingNumber: string; labelUrl: string } {
  const detail = response.output.completedShipmentDetail;
  if (!detail) {
    throw new FedexAsyncError('Missing completedShipmentDetail in response', 'MISSING.LABEL.DATA');
  }

  // Try different paths for tracking number
  const trackingNumber = 
    detail.masterTrackingId?.trackingNumber ||
    detail.masterTrackingNumber ||
    detail.completedPackageDetails?.[0]?.trackingNumber;

  // Try different paths for label URL
  let labelUrl =
    detail.completedPackageDetails?.[0]?.label?.labelUrl ||
    detail.completedPackageDetails?.[0]?.label?.url;

  // Fallback: check for packageDocuments array (like in transactionShipments)
  const pkgDetail = detail.completedPackageDetails?.[0];
  if (!labelUrl && pkgDetail && 'packageDocuments' in pkgDetail && Array.isArray((pkgDetail as any).packageDocuments)) {
    const docs = (pkgDetail as any).packageDocuments;
    labelUrl = docs.find(
      (doc: any) =>
        doc.url &&
        (
          doc.contentType === 'LABEL' ||
          doc.docType === 'SHIPPING_LABEL' ||
          doc.docType === 'PDF'
        )
    )?.url || docs[0]?.url;
  }

  if (!trackingNumber || !labelUrl) {
    throw new FedexAsyncError(
      'Missing tracking number or label URL in response',
      'MISSING.LABEL.DATA'
    );
  }

  return { trackingNumber, labelUrl };
} 